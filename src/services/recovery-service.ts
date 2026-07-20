import type { Logger } from "pino";
import type { DbPool } from "../database/pool.js";
import type { Env } from "../config/env.js";
import type { SessionManager } from "../controllers/session-manager.js";
import type { SessionOrchestrator } from "./session-orchestrator.js";
import type { CallCanceler } from "./call-canceler.js";
import type { SessionService } from "./session-service.js";
import { isTerminalCallAttemptStatus } from "../domain/statuses.js";
import { tryCompleteSessionIfExhausted } from "./session-completion.js";
import { SessionRepository } from "../repositories/session.repository.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { EventRepository } from "../repositories/event.repository.js";

export class RecoveryService {
  constructor(
    private readonly db: DbPool,
    private readonly env: Env,
    private readonly sessionManager: SessionManager,
    private readonly orchestrator: SessionOrchestrator,
    private readonly callCanceler: CallCanceler,
    private readonly sessionService: SessionService | null,
    private readonly logger: Logger,
  ) {}

  async recover(): Promise<void> {
    const sessions = new SessionRepository(this.db);
    const events = new EventRepository(this.db);
    const attempts = new CallAttemptRepository(this.db);
    const contacts = new ContactRepository(this.db);

    await this.failStaleCreatingAttempts(attempts, contacts, events);

    const recoverable = await sessions.listByStatuses([
      "running",
      "winner_selected",
      "stopping",
    ]);

    for (const session of recoverable) {
      await events.append({
        sessionId: session.id,
        eventType: "recovery_started",
        payload: { status: session.status },
      });

      const controller = await this.sessionManager.getOrCreate(session.id);
      controller.status = session.status;

      this.logger.info(
        {
          sessionId: session.id,
          sessionStatus: session.status,
          activeCalls: controller.activeCalls.size,
          concurrencyLimit: controller.concurrencyLimit,
        },
        "recovered session controller",
      );

      if (session.status === "running") {
        this.orchestrator.scheduleReconcile(session.id);
      } else if (session.status === "winner_selected") {
        await this.callCanceler.cancelNonWinningActiveCalls(
          session.id,
          session.winningCallAttemptId,
        );

        if (session.winningCallAttemptId) {
          const winningCall = await attempts.findById(session.winningCallAttemptId);
          const active = await attempts.countActiveBySession(session.id);
          if (
            winningCall &&
            isTerminalCallAttemptStatus(winningCall.status) &&
            active === 0
          ) {
            const completed = await tryCompleteSessionIfExhausted(
              this.db,
              this.sessionManager,
              session.id,
            );
            if (!completed && session.autoContinue && this.sessionService) {
              try {
                await this.sessionService.continueDialing(session.id, "auto");
              } catch (error) {
                this.logger.warn(
                  { err: error, sessionId: session.id },
                  "recovery auto-continue skipped",
                );
              }
            }
          }
        }
      } else if (session.status === "stopping") {
        await this.callCanceler.cancelAllActiveCalls(session.id);
        const active = await attempts.countActiveBySession(session.id);
        if (active === 0) {
          await sessions.updateStatus(session.id, "stopped", {
            stoppedAt: new Date(),
            expectedStatuses: ["stopping"],
          });
          await events.append({
            sessionId: session.id,
            eventType: "session_stopped",
            payload: { via: "recovery" },
          });
          const ctl = this.sessionManager.get(session.id);
          if (ctl) ctl.status = "stopped";
          await this.sessionManager.removeIfInactive(session.id);
        }
      }

      await events.append({
        sessionId: session.id,
        eventType: "recovery_completed",
        payload: { status: session.status },
      });
    }

    // Note: with MockVoiceProvider, provider-side call state verification
    // is limited — we trust persisted attempt rows.
  }

  private async failStaleCreatingAttempts(
    attempts: CallAttemptRepository,
    contacts: ContactRepository,
    events: EventRepository,
  ): Promise<void> {
    const stale = await attempts.listStaleCreating(this.env.CREATING_ATTEMPT_TIMEOUT_SECONDS);
    for (const attempt of stale) {
      const updated = await attempts.updateStatus(attempt.id, "failed", {
        errorCode: "CREATING_TIMEOUT",
        errorMessage: "Call attempt stuck in creating beyond timeout",
        completedAt: new Date(),
        permitReleased: true,
        expectedStatuses: ["creating"],
      });
      if (!updated) continue;

      await contacts.updateStatus(attempt.contactId, "failed", {
        completedAt: new Date(),
      });
      await events.append({
        sessionId: attempt.sessionId,
        callAttemptId: attempt.id,
        eventType: "call_creation_failed",
        payload: { reason: "creating_timeout" },
      });

      const controller = this.sessionManager.get(attempt.sessionId);
      controller?.releasePermit(attempt.id);

      this.orchestrator.scheduleReconcile(attempt.sessionId);
    }
  }
}
