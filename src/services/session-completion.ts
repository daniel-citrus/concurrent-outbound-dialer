import type { Logger } from "pino";
import type { DbPool } from "../database/pool.js";
import type { SessionManager } from "../controllers/session-manager.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { EventRepository } from "../repositories/event.repository.js";
import { SessionRepository } from "../repositories/session.repository.js";

export async function tryCompleteSessionIfExhausted(
  db: DbPool,
  sessionManager: SessionManager,
  sessionId: string,
): Promise<boolean> {
  const attempts = new CallAttemptRepository(db);
  const activeCount = await attempts.countActiveBySession(sessionId);
  if (activeCount > 0) {
    return false;
  }

  const contacts = new ContactRepository(db);
  const sessions = new SessionRepository(db);
  const events = new EventRepository(db);
  const counts = await contacts.countByStatus(sessionId);
  const queued = counts["queued"] ?? 0;
  const claimed = counts["claimed"] ?? 0;
  if (queued > 0 || claimed > 0) {
    return false;
  }

  const completed = await sessions.markCompleted(sessionId);
  if (completed) {
    await events.append({
      sessionId,
      eventType: "session_completed",
      payload: {},
    });
    const controller = sessionManager.get(sessionId);
    if (controller) {
      controller.status = "completed";
    }
    return true;
  }

  return false;
}

export type AutoContinueDialing = (
  sessionId: string,
  reason: "auto",
) => Promise<unknown>;

/**
 * After a winning call ends (or on recovery into winner_selected with no actives):
 * mark the session completed when the queue is exhausted, otherwise auto-continue
 * dialing when enabled.
 */
export async function tryCompleteOrAutoContinue(
  db: DbPool,
  sessionManager: SessionManager,
  sessionId: string,
  options: {
    autoContinue: boolean;
    continueDialing?: AutoContinueDialing | null;
    logger: Logger;
    warnMessage: string;
  },
): Promise<"completed" | "continued" | "idle"> {
  const completed = await tryCompleteSessionIfExhausted(db, sessionManager, sessionId);
  if (completed) {
    return "completed";
  }

  if (options.autoContinue && options.continueDialing) {
    try {
      await options.continueDialing(sessionId, "auto");
      return "continued";
    } catch (error) {
      options.logger.warn({ err: error, sessionId }, options.warnMessage);
    }
  }

  return "idle";
}
