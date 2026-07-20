import type { Logger } from "pino";
import type { DbPool } from "../database/pool.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import type { CallAttemptStatus } from "../domain/statuses.js";
import {
  evaluateCallAttemptTransition,
  isTerminalCallAttemptStatus,
} from "../domain/statuses.js";
import { callAttemptNotFound } from "../domain/errors.js";
import type { SessionManager } from "../controllers/session-manager.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { EventRepository } from "../repositories/event.repository.js";
import { SessionRepository } from "../repositories/session.repository.js";
import type { WinnerSelector } from "./winner-selector.js";
import type { SessionOrchestrator } from "./session-orchestrator.js";
import type { SessionService } from "./session-service.js";
import { tryCompleteSessionIfExhausted } from "./session-completion.js";

export class CallStatusProcessor {
  private orchestrator: SessionOrchestrator | undefined;
  private sessionService: SessionService | undefined;

  constructor(
    private readonly db: DbPool,
    private readonly sessionManager: SessionManager,
    private readonly winnerSelector: WinnerSelector,
    private readonly logger: Logger,
  ) {}

  setOrchestrator(orchestrator: SessionOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  setSessionService(sessionService: SessionService): void {
    this.sessionService = sessionService;
  }

  async processStatus(
    callAttemptId: string,
    rawStatus: CallAttemptStatus,
  ): Promise<CallAttempt> {
    const attempts = new CallAttemptRepository(this.db);
    const contacts = new ContactRepository(this.db);
    const events = new EventRepository(this.db);

    const attempt = await attempts.findById(callAttemptId);
    if (!attempt) {
      throw callAttemptNotFound(callAttemptId);
    }

    const controller = await this.sessionManager.getOrCreate(attempt.sessionId);

    await events.append({
      sessionId: attempt.sessionId,
      callAttemptId: attempt.id,
      eventType: "call_status_received",
      payload: { status: rawStatus, previousStatus: attempt.status },
    });

    // Unknown is stored when safe but never treated as a normal regression crash.
    const nextStatus: CallAttemptStatus = rawStatus;

    const transition = evaluateCallAttemptTransition(attempt.status, nextStatus);
    if (transition.kind === "duplicate") {
      return attempt;
    }
    if (transition.kind === "reject") {
      this.logger.warn(
        {
          callAttemptId,
          sessionId: attempt.sessionId,
          from: attempt.status,
          to: nextStatus,
          reason: transition.reason,
        },
        "ignored invalid call status transition",
      );
      return attempt;
    }

    const patches: {
      answeredAt?: Date | null;
      completedAt?: Date | null;
    } = {};
    if (nextStatus === "in_progress" && !attempt.answeredAt) {
      patches.answeredAt = new Date();
    }
    if (isTerminalCallAttemptStatus(nextStatus)) {
      patches.completedAt = new Date();
    }

    const updated = await attempts.updateStatus(attempt.id, nextStatus, {
      ...patches,
      expectedStatuses: [attempt.status],
    });
    if (!updated) {
      // Concurrent update won; reload.
      const reloaded = await attempts.findById(callAttemptId);
      return reloaded ?? attempt;
    }

    if (nextStatus === "in_progress") {
      await this.winnerSelector.selectWinner(updated.id);
      const afterWinner = await attempts.findById(updated.id);
      return afterWinner ?? updated;
    }

    if (isTerminalCallAttemptStatus(nextStatus)) {
      await this.handleTerminal(updated, contacts, events, controller);
    }

    return (await attempts.findById(updated.id)) ?? updated;
  }

  private async handleTerminal(
    attempt: CallAttempt,
    contacts: ContactRepository,
    events: EventRepository,
    controller: Awaited<ReturnType<SessionManager["getOrCreate"]>>,
  ): Promise<void> {
    const attempts = new CallAttemptRepository(this.db);

    if (!attempt.isWinner) {
      const contactStatus =
        attempt.status === "failed"
          ? "failed"
          : attempt.status === "canceled"
            ? "canceled"
            : attempt.status === "completed"
              ? "completed"
              : "failed";

      await contacts.updateStatus(attempt.contactId, contactStatus, {
        completedAt: new Date(),
      });
    } else if (attempt.status === "completed") {
      await contacts.updateStatus(attempt.contactId, "completed", {
        completedAt: new Date(),
      });
    }

    const marked = await attempts.markPermitReleased(attempt.id);
    if (marked) {
      controller.releasePermit(attempt.id);
    } else {
      controller.releasePermit(attempt.id);
    }

    await events.append({
      sessionId: attempt.sessionId,
      callAttemptId: attempt.id,
      eventType: "call_terminal",
      payload: { status: attempt.status, isWinner: attempt.isWinner },
    });

    if (attempt.isWinner) {
      const completed = await tryCompleteSessionIfExhausted(
        this.db,
        this.sessionManager,
        attempt.sessionId,
      );
      if (!completed) {
        const sessions = new SessionRepository(this.db);
        const session = await sessions.findById(attempt.sessionId);
        if (session?.autoContinue && this.sessionService) {
          try {
            await this.sessionService.continueDialing(attempt.sessionId, "auto");
          } catch (error) {
            this.logger.warn(
              { err: error, sessionId: attempt.sessionId },
              "auto-continue after winning call failed",
            );
          }
        }
      }
    } else if (this.orchestrator) {
      this.orchestrator.scheduleReconcile(attempt.sessionId);
    }

    // Allow terminal sessions to drop inactive controllers after cleanup.
    void this.sessionManager.removeIfInactive(attempt.sessionId);
  }
}
