import type { DbClient, DbPool } from "../database/pool.js";
import type { DialingSession } from "../domain/session.js";
import type { SessionStatus } from "../domain/statuses.js";
import { databaseConflict, duplicateActiveClientSession } from "../domain/errors.js";
import { mapSession, type SessionRow } from "./mappers.js";

type Queryable = DbPool | DbClient;

export class SessionRepository {
  constructor(private readonly db: Queryable) {}

  async findById(sessionId: string): Promise<DialingSession | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT * FROM dialing_sessions WHERE id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async listByStatuses(statuses: readonly SessionStatus[]): Promise<DialingSession[]> {
    const result = await this.db.query<SessionRow>(
      `SELECT * FROM dialing_sessions WHERE status = ANY($1::text[]) ORDER BY created_at`,
      [statuses],
    );
    return result.rows.map(mapSession);
  }

  async create(
    client: DbClient,
    input: {
      clientId: string;
      agentId: string;
      concurrencyLimit: number;
      autoContinue?: boolean;
    },
  ): Promise<DialingSession> {
    try {
      const result = await client.query<SessionRow>(
        `INSERT INTO dialing_sessions (client_id, agent_id, status, concurrency_limit, auto_continue)
         VALUES ($1, $2, 'created', $3, $4)
         RETURNING *`,
        [input.clientId, input.agentId, input.concurrencyLimit, input.autoContinue ?? false],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Failed to create dialing session");
      }
      return mapSession(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw duplicateActiveClientSession(input.clientId);
      }
      throw error;
    }
  }

  async updateStatus(
    sessionId: string,
    status: SessionStatus,
    patches: {
      startedAt?: Date | null;
      pausedAt?: Date | null;
      stoppedAt?: Date | null;
      completedAt?: Date | null;
      winningCallAttemptId?: string | null;
      expectedStatuses?: readonly SessionStatus[];
    } = {},
  ): Promise<DialingSession | null> {
    const sets: string[] = ["status = $2", "state_version = state_version + 1", "updated_at = NOW()"];
    const params: unknown[] = [sessionId, status];
    let idx = 3;

    if (patches.startedAt !== undefined) {
      sets.push(`started_at = $${idx++}`);
      params.push(patches.startedAt);
    }
    if (patches.pausedAt !== undefined) {
      sets.push(`paused_at = $${idx++}`);
      params.push(patches.pausedAt);
    }
    if (patches.stoppedAt !== undefined) {
      sets.push(`stopped_at = $${idx++}`);
      params.push(patches.stoppedAt);
    }
    if (patches.completedAt !== undefined) {
      sets.push(`completed_at = $${idx++}`);
      params.push(patches.completedAt);
    }
    if (patches.winningCallAttemptId !== undefined) {
      sets.push(`winning_call_attempt_id = $${idx++}`);
      params.push(patches.winningCallAttemptId);
    }

    let where = `id = $1`;
    if (patches.expectedStatuses && patches.expectedStatuses.length > 0) {
      where += ` AND status = ANY($${idx++}::text[])`;
      params.push(patches.expectedStatuses);
    }

    const result = await this.db.query<SessionRow>(
      `UPDATE dialing_sessions SET ${sets.join(", ")} WHERE ${where} RETURNING *`,
      params,
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async trySelectWinner(
    sessionId: string,
    callAttemptId: string,
  ): Promise<DialingSession | null> {
    const result = await this.db.query<SessionRow>(
      `UPDATE dialing_sessions
       SET
         status = 'winner_selected',
         winning_call_attempt_id = $1,
         paused_at = NOW(),
         state_version = state_version + 1,
         updated_at = NOW()
       WHERE id = $2
         AND status = 'running'
         AND winning_call_attempt_id IS NULL
       RETURNING *`,
      [callAttemptId, sessionId],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async bumpStateVersion(sessionId: string): Promise<DialingSession | null> {
    const result = await this.db.query<SessionRow>(
      `UPDATE dialing_sessions
       SET state_version = state_version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [sessionId],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async markCompleted(sessionId: string): Promise<DialingSession | null> {
    return this.updateStatus(sessionId, "completed", {
      completedAt: new Date(),
      expectedStatuses: ["running", "winner_selected"],
    });
  }

  async continueFromWinner(sessionId: string): Promise<DialingSession | null> {
    const result = await this.db.query<SessionRow>(
      `UPDATE dialing_sessions
       SET
         status = 'running',
         winning_call_attempt_id = NULL,
         paused_at = NULL,
         state_version = state_version + 1,
         updated_at = NOW()
       WHERE id = $1
         AND status = 'winner_selected'
         AND winning_call_attempt_id IS NOT NULL
       RETURNING *`,
      [sessionId],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async setAutoContinue(
    sessionId: string,
    autoContinue: boolean,
  ): Promise<DialingSession | null> {
    const result = await this.db.query<SessionRow>(
      `UPDATE dialing_sessions
       SET auto_continue = $2, state_version = state_version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [sessionId, autoContinue],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async markFailed(sessionId: string): Promise<DialingSession | null> {
    return this.updateStatus(sessionId, "failed", {
      completedAt: new Date(),
    });
  }

  async assertUpdateOrConflict(
    session: DialingSession | null,
    message: string,
  ): Promise<DialingSession> {
    if (!session) {
      throw databaseConflict(message);
    }
    return session;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}
