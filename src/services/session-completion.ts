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
