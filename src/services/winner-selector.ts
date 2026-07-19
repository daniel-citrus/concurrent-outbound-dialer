import type { Logger } from "pino";
import type { DbPool } from "../database/pool.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import type { DialingSession } from "../domain/session.js";
import type { SessionManager } from "../controllers/session-manager.js";
import { SessionRepository } from "../repositories/session.repository.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { EventRepository } from "../repositories/event.repository.js";
import type { CallCanceler } from "./call-canceler.js";

export type WinnerSelectionResult =
  | { outcome: "won"; session: DialingSession; attempt: CallAttempt }
  | { outcome: "lost"; session: DialingSession; attempt: CallAttempt }
  | { outcome: "noop" };

export class WinnerSelector {
  constructor(
    private readonly db: DbPool,
    private readonly sessionManager: SessionManager,
    private readonly callCanceler: CallCanceler,
    private readonly logger: Logger,
  ) {}

  async selectWinner(callAttemptId: string): Promise<WinnerSelectionResult> {
    const attempts = new CallAttemptRepository(this.db);
    const sessions = new SessionRepository(this.db);
    const contacts = new ContactRepository(this.db);
    const events = new EventRepository(this.db);

    const attempt = await attempts.findById(callAttemptId);
    if (!attempt) {
      return { outcome: "noop" };
    }

    const wonSession = await sessions.trySelectWinner(attempt.sessionId, attempt.id);
    if (wonSession) {
      const winningAttempt = await attempts.markWinner(attempt.id);
      if (!winningAttempt) {
        return { outcome: "noop" };
      }

      await contacts.updateStatus(attempt.contactId, "answered", {
        completedAt: null,
      });

      await events.append({
        sessionId: attempt.sessionId,
        callAttemptId: attempt.id,
        eventType: "winner_selected",
        payload: { callAttemptId: attempt.id },
      });

      const controller = this.sessionManager.get(attempt.sessionId);
      if (controller) {
        controller.status = "winner_selected";
      }

      this.logger.info(
        {
          sessionId: attempt.sessionId,
          callAttemptId: attempt.id,
          sessionStatus: "winner_selected",
        },
        "winner selected",
      );

      // Cancel/disconnect non-winners without holding transaction.
      void this.callCanceler
        .cancelNonWinningActiveCalls(attempt.sessionId, attempt.id)
        .catch((error: unknown) => {
          this.logger.error({ err: error, sessionId: attempt.sessionId }, "winner cleanup failed");
        });

      return { outcome: "won", session: wonSession, attempt: winningAttempt };
    }

    // Lost the race — another winner already selected.
    const session = await sessions.findById(attempt.sessionId);
    if (!session) {
      return { outcome: "noop" };
    }

    await events.append({
      sessionId: attempt.sessionId,
      callAttemptId: attempt.id,
      eventType: "losing_answer_detected",
      payload: {
        callAttemptId: attempt.id,
        winningCallAttemptId: session.winningCallAttemptId,
      },
    });

    this.logger.info(
      {
        sessionId: attempt.sessionId,
        callAttemptId: attempt.id,
        winningCallAttemptId: session.winningCallAttemptId,
      },
      "losing answer detected",
    );

    await this.callCanceler.cancelOrDisconnect(attempt);

    return { outcome: "lost", session, attempt };
  }
}
