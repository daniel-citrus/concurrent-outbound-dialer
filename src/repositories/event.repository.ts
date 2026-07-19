import type { DbClient, DbPool } from "../database/pool.js";
import type { DialEvent } from "../domain/event.js";
import type { DialEventType } from "../domain/statuses.js";
import { mapEvent, type EventRow } from "./mappers.js";

type Queryable = DbPool | DbClient;

export class EventRepository {
  constructor(private readonly db: Queryable) {}

  async append(
    input: {
      sessionId: string;
      callAttemptId?: string | null;
      eventType: DialEventType;
      payload?: Record<string, unknown>;
    },
    client?: DbClient,
  ): Promise<DialEvent> {
    const db = client ?? this.db;
    const result = await db.query<EventRow>(
      `INSERT INTO dial_events (session_id, call_attempt_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *`,
      [
        input.sessionId,
        input.callAttemptId ?? null,
        input.eventType,
        JSON.stringify(input.payload ?? {}),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to append dial event");
    }
    return mapEvent(row);
  }

  async listBySession(
    sessionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DialEvent[]> {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const result = await this.db.query<EventRow>(
      `SELECT * FROM dial_events
       WHERE session_id = $1
       ORDER BY created_at
       LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset],
    );
    return result.rows.map(mapEvent);
  }
}
