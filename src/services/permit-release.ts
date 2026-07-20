import type { DbPool } from "../database/pool.js";
import type { SessionController } from "../controllers/session-controller.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";

/**
 * Mark the attempt's permit released in Postgres, then clear local controller state.
 * Local release is always attempted so in-memory permits cannot leak if the DB
 * row was already marked.
 */
export async function releasePermitDurable(
  db: DbPool,
  controller: SessionController | undefined | null,
  callAttemptId: string,
): Promise<void> {
  const attempts = new CallAttemptRepository(db);
  await attempts.markPermitReleased(callAttemptId);
  controller?.releasePermit(callAttemptId);
}
