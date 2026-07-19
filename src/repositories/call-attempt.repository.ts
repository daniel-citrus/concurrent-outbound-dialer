import type { DbClient, DbPool } from "../database/pool.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import type { CallAttemptStatus } from "../domain/statuses.js";
import { ACTIVE_CALL_ATTEMPT_STATUSES } from "../domain/statuses.js";
import { mapCallAttempt, type CallAttemptRow } from "./mappers.js";

type Queryable = DbPool | DbClient;

export class CallAttemptRepository {
  constructor(private readonly db: Queryable) {}

  async findById(callAttemptId: string): Promise<CallAttempt | null> {
    const result = await this.db.query<CallAttemptRow>(
      `SELECT * FROM call_attempts WHERE id = $1`,
      [callAttemptId],
    );
    const row = result.rows[0];
    return row ? mapCallAttempt(row) : null;
  }

  async listBySession(
    sessionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<CallAttempt[]> {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const result = await this.db.query<CallAttemptRow>(
      `SELECT * FROM call_attempts
       WHERE session_id = $1
       ORDER BY created_at
       LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset],
    );
    return result.rows.map(mapCallAttempt);
  }

  async listActiveBySession(sessionId: string): Promise<CallAttempt[]> {
    const result = await this.db.query<CallAttemptRow>(
      `SELECT * FROM call_attempts
       WHERE session_id = $1
         AND status = ANY($2::text[])
       ORDER BY created_at`,
      [sessionId, ACTIVE_CALL_ATTEMPT_STATUSES],
    );
    return result.rows.map(mapCallAttempt);
  }

  async countActiveBySession(sessionId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM call_attempts
       WHERE session_id = $1
         AND status = ANY($2::text[])`,
      [sessionId, ACTIVE_CALL_ATTEMPT_STATUSES],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async updateStatus(
    callAttemptId: string,
    status: CallAttemptStatus,
    patches: {
      providerCallId?: string | null;
      isWinner?: boolean;
      permitReleased?: boolean;
      errorCode?: string | null;
      errorMessage?: string | null;
      answeredAt?: Date | null;
      completedAt?: Date | null;
      expectedStatuses?: readonly CallAttemptStatus[];
    } = {},
  ): Promise<CallAttempt | null> {
    const sets = ["status = $2", "updated_at = NOW()"];
    const params: unknown[] = [callAttemptId, status];
    let idx = 3;

    if (patches.providerCallId !== undefined) {
      sets.push(`provider_call_id = $${idx++}`);
      params.push(patches.providerCallId);
    }
    if (patches.isWinner !== undefined) {
      sets.push(`is_winner = $${idx++}`);
      params.push(patches.isWinner);
    }
    if (patches.permitReleased !== undefined) {
      sets.push(`permit_released = $${idx++}`);
      params.push(patches.permitReleased);
    }
    if (patches.errorCode !== undefined) {
      sets.push(`error_code = $${idx++}`);
      params.push(patches.errorCode);
    }
    if (patches.errorMessage !== undefined) {
      sets.push(`error_message = $${idx++}`);
      params.push(patches.errorMessage);
    }
    if (patches.answeredAt !== undefined) {
      sets.push(`answered_at = $${idx++}`);
      params.push(patches.answeredAt);
    }
    if (patches.completedAt !== undefined) {
      sets.push(`completed_at = $${idx++}`);
      params.push(patches.completedAt);
    }

    let where = `id = $1`;
    if (patches.expectedStatuses && patches.expectedStatuses.length > 0) {
      where += ` AND status = ANY($${idx++}::text[])`;
      params.push(patches.expectedStatuses);
    }

    const result = await this.db.query<CallAttemptRow>(
      `UPDATE call_attempts SET ${sets.join(", ")} WHERE ${where} RETURNING *`,
      params,
    );
    const row = result.rows[0];
    return row ? mapCallAttempt(row) : null;
  }

  async markWinner(callAttemptId: string): Promise<CallAttempt | null> {
    return this.updateStatus(callAttemptId, "in_progress", {
      isWinner: true,
      answeredAt: new Date(),
    });
  }

  async markPermitReleased(callAttemptId: string): Promise<CallAttempt | null> {
    const result = await this.db.query<CallAttemptRow>(
      `UPDATE call_attempts
       SET permit_released = TRUE, updated_at = NOW()
       WHERE id = $1 AND permit_released = FALSE
       RETURNING *`,
      [callAttemptId],
    );
    const row = result.rows[0];
    return row ? mapCallAttempt(row) : null;
  }

  async listStaleCreating(timeoutSeconds: number): Promise<CallAttempt[]> {
    const result = await this.db.query<CallAttemptRow>(
      `SELECT * FROM call_attempts
       WHERE status = 'creating'
         AND created_at < NOW() - ($1::text || ' seconds')::interval`,
      [String(timeoutSeconds)],
    );
    return result.rows.map(mapCallAttempt);
  }
}
