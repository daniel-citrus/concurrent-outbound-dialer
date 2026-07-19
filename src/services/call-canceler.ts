import type { Logger } from "pino";
import type { DbPool } from "../database/pool.js";
import type { VoiceProvider } from "../providers/voice-provider.js";
import type { SessionManager } from "../controllers/session-manager.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import { cancelActionForStatus, isTerminalCallAttemptStatus } from "../domain/statuses.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { EventRepository } from "../repositories/event.repository.js";

export class CallCanceler {
  constructor(
    private readonly db: DbPool,
    private readonly voiceProvider: VoiceProvider,
    private readonly sessionManager: SessionManager,
    private readonly logger: Logger,
  ) {}

  async cancelNonWinningActiveCalls(sessionId: string, winningCallAttemptId?: string | null): Promise<void> {
    const attempts = new CallAttemptRepository(this.db);
    const active = await attempts.listActiveBySession(sessionId);
    const targets = active.filter((a) => a.id !== winningCallAttemptId);

    await Promise.allSettled(targets.map((attempt) => this.cancelOrDisconnect(attempt)));
  }

  async cancelAllActiveCalls(sessionId: string): Promise<void> {
    const attempts = new CallAttemptRepository(this.db);
    const active = await attempts.listActiveBySession(sessionId);
    await Promise.allSettled(active.map((attempt) => this.cancelOrDisconnect(attempt)));
  }

  async cancelOrDisconnect(attempt: CallAttempt): Promise<void> {
    if (isTerminalCallAttemptStatus(attempt.status)) {
      return;
    }

    const action = cancelActionForStatus(attempt.status);
    const events = new EventRepository(this.db);
    const attempts = new CallAttemptRepository(this.db);
    const contacts = new ContactRepository(this.db);
    const controller = this.sessionManager.get(attempt.sessionId);

    try {
      if (action === "cleanup_pending" || action === "cancel") {
        if (attempt.providerCallId && action === "cancel") {
          await events.append({
            sessionId: attempt.sessionId,
            callAttemptId: attempt.id,
            eventType: "call_cancel_requested",
            payload: { providerCallId: attempt.providerCallId },
          });
          await this.voiceProvider.cancelCall(attempt.providerCallId);
        }

        const updated = await attempts.updateStatus(attempt.id, "canceled", {
          completedAt: new Date(),
          expectedStatuses: ["creating", "queued", "initiated", "ringing"],
        });
        if (updated) {
          await contacts.updateStatus(attempt.contactId, "canceled", {
            completedAt: new Date(),
          });
          await this.releasePermitIdempotent(attempt.id, controller);
          await events.append({
            sessionId: attempt.sessionId,
            callAttemptId: attempt.id,
            eventType: "call_terminal",
            payload: { status: "canceled" },
          });
        }
        return;
      }

      if (action === "disconnect") {
        if (attempt.providerCallId) {
          await events.append({
            sessionId: attempt.sessionId,
            callAttemptId: attempt.id,
            eventType: "call_disconnect_requested",
            payload: { providerCallId: attempt.providerCallId },
          });
          await this.voiceProvider.disconnectCall(attempt.providerCallId);
        }

        const updated = await attempts.updateStatus(attempt.id, "canceled", {
          completedAt: new Date(),
          expectedStatuses: ["in_progress"],
        });
        if (updated) {
          if (!updated.isWinner) {
            await contacts.updateStatus(attempt.contactId, "canceled", {
              completedAt: new Date(),
            });
          }
          await this.releasePermitIdempotent(attempt.id, controller);
          await events.append({
            sessionId: attempt.sessionId,
            callAttemptId: attempt.id,
            eventType: "call_terminal",
            payload: { status: "canceled", disconnected: true },
          });
        }
      }
    } catch (error) {
      this.logger.error(
        {
          err: error,
          sessionId: attempt.sessionId,
          callAttemptId: attempt.id,
          providerCallId: attempt.providerCallId,
        },
        "call cancel/disconnect failed",
      );
      await events.append({
        sessionId: attempt.sessionId,
        callAttemptId: attempt.id,
        eventType: "call_cancel_requested",
        payload: {
          error: error instanceof Error ? error.message : "unknown",
          providerCallId: attempt.providerCallId,
        },
      });
    }
  }

  private async releasePermitIdempotent(
    callAttemptId: string,
    controller: ReturnType<SessionManager["get"]>,
  ): Promise<void> {
    const attempts = new CallAttemptRepository(this.db);
    const marked = await attempts.markPermitReleased(callAttemptId);
    if (marked && controller) {
      controller.releasePermit(callAttemptId);
    } else if (controller) {
      // Already released in DB; still clear local state if present.
      controller.releasePermit(callAttemptId);
    }
  }
}
