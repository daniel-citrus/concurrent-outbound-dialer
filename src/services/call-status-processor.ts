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
import type { SessionService } from "./session-service.js";
import { tryCompleteOrAutoContinue } from "./session-completion.js";
import { releasePermitDurable } from "./permit-release.js";

export type ProcessStatusResult = {
  attempt: CallAttempt;
  sessionId: string;
  triggeredReconcile: boolean;
  winnerSelected: boolean;
  winningCallAttemptId: string | null;
};

export class CallStatusProcessor {
  private sessionService: SessionService | undefined;

  constructor(
    private readonly db: DbPool,
    private readonly sessionManager: SessionManager,
    private readonly winnerSelector: WinnerSelector,
    private readonly logger: Logger,
  ) {}

  setSessionService(sessionService: SessionService): void {
    this.sessionService = sessionService;
  }

  async processStatus(
    callAttemptId: string,
    rawStatus: CallAttemptStatus,
  ): Promise<ProcessStatusResult> {
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

    const nextStatus: CallAttemptStatus = rawStatus;

    const transition = evaluateCallAttemptTransition(attempt.status, nextStatus);
    if (transition.kind === "duplicate") {
      return {
        attempt,
        sessionId: attempt.sessionId,
        triggeredReconcile: false,
        winnerSelected: false,
        winningCallAttemptId: null,
      };
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
      return {
        attempt,
        sessionId: attempt.sessionId,
        triggeredReconcile: false,
        winnerSelected: false,
        winningCallAttemptId: null,
      };
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
      const reloaded = await attempts.findById(callAttemptId);
      return {
        attempt: reloaded ?? attempt,
        sessionId: attempt.sessionId,
        triggeredReconcile: false,
        winnerSelected: false,
        winningCallAttemptId: null,
      };
    }

    if (nextStatus === "in_progress") {
      await this.winnerSelector.selectWinner(updated.id);
      const afterWinner = await attempts.findById(updated.id);
      const sessions = new SessionRepository(this.db);
      const session = await sessions.findById(updated.sessionId);
      return {
        attempt: afterWinner ?? updated,
        sessionId: updated.sessionId,
        triggeredReconcile: false,
        winnerSelected: Boolean(afterWinner?.isWinner || session?.status === "winner_selected"),
        winningCallAttemptId: session?.winningCallAttemptId ?? null,
      };
    }

    if (isTerminalCallAttemptStatus(nextStatus)) {
      const terminalResult = await this.handleTerminal(updated, contacts, events, controller);
      return {
        attempt: (await attempts.findById(updated.id)) ?? updated,
        sessionId: updated.sessionId,
        triggeredReconcile: terminalResult.triggeredReconcile,
        winnerSelected: false,
        winningCallAttemptId: null,
      };
    }

    return {
      attempt: (await attempts.findById(updated.id)) ?? updated,
      sessionId: updated.sessionId,
      triggeredReconcile: false,
      winnerSelected: false,
      winningCallAttemptId: null,
    };
  }

  private async handleTerminal(
    attempt: CallAttempt,
    contacts: ContactRepository,
    events: EventRepository,
    controller: Awaited<ReturnType<SessionManager["getOrCreate"]>>,
  ): Promise<{ triggeredReconcile: boolean }> {
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

    await releasePermitDurable(this.db, controller, attempt.id);

    await events.append({
      sessionId: attempt.sessionId,
      callAttemptId: attempt.id,
      eventType: "call_terminal",
      payload: { status: attempt.status, isWinner: attempt.isWinner },
    });

    let triggeredReconcile = false;

    if (attempt.isWinner) {
      const sessions = new SessionRepository(this.db);
      const session = await sessions.findById(attempt.sessionId);
      const outcome = await tryCompleteOrAutoContinue(
        this.db,
        this.sessionManager,
        attempt.sessionId,
        {
          autoContinue: session?.autoContinue ?? false,
          continueDialing: this.sessionService
            ? (id, reason) => this.sessionService!.continueDialing(id, reason)
            : null,
          logger: this.logger,
          warnMessage: "auto-continue after winning call failed",
        },
      );
      triggeredReconcile = outcome === "continued";
    } else {
      // Client orchestrator should refill concurrency after a non-winner terminal.
      triggeredReconcile = true;
    }

    void this.sessionManager.removeIfInactive(attempt.sessionId);
    return { triggeredReconcile };
  }
}
