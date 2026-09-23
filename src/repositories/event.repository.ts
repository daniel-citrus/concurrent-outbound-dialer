import type { DialerSupabase } from "../database/supabase.js";
import { throwIfError } from "../database/supabase.js";
import type { DialEvent } from "../domain/event.js";
import type { DialEventType } from "../domain/statuses.js";
import { mapEvent, type EventRow } from "./mappers.js";

export class EventRepository {
  constructor(private readonly sb: DialerSupabase) {}

  async append(input: {
    sessionId: string;
    callAttemptId?: string | null;
    eventType: DialEventType;
    payload?: Record<string, unknown>;
  }): Promise<DialEvent> {
    const { data, error } = await this.sb
      .from("dial_events")
      .insert({
        session_id: input.sessionId,
        call_attempt_id: input.callAttemptId ?? null,
        event_type: input.eventType,
        payload: input.payload ?? {},
      })
      .select("*")
      .single();
    throwIfError(error, "append dial event");
    if (!data) {
      throw new Error("Failed to append dial event");
    }
    return mapEvent(data as EventRow);
  }

  async listBySession(
    sessionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DialEvent[]> {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const { data, error } = await this.sb
      .from("dial_events")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);
    throwIfError(error, "list dial events");
    return (data ?? []).map((row) => mapEvent(row as EventRow));
  }
}
