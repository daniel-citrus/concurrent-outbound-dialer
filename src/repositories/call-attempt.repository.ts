import type { DialerSupabase } from "../database/supabase.js";
import { throwIfError } from "../database/supabase.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import type { CallAttemptStatus } from "../domain/statuses.js";
import { ACTIVE_CALL_ATTEMPT_STATUSES } from "../domain/statuses.js";
import { mapCallAttempt, type CallAttemptRow } from "./mappers.js";

export class CallAttemptRepository {
  constructor(private readonly sb: DialerSupabase) {}

  async findById(callAttemptId: string): Promise<CallAttempt | null> {
    const { data, error } = await this.sb
      .from("call_attempts")
      .select("*")
      .eq("id", callAttemptId)
      .maybeSingle();
    throwIfError(error, "find call attempt");
    return data ? mapCallAttempt(data as CallAttemptRow) : null;
  }

  async listBySession(
    sessionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<CallAttempt[]> {
    const limit = options.limit ?? 10_000;
    const offset = options.offset ?? 0;
    const { data, error } = await this.sb
      .from("call_attempts")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);
    throwIfError(error, "list call attempts");
    return (data ?? []).map((row) => mapCallAttempt(row as CallAttemptRow));
  }

  async listActiveBySession(sessionId: string): Promise<CallAttempt[]> {
    const { data, error } = await this.sb
      .from("call_attempts")
      .select("*")
      .eq("session_id", sessionId)
      .in("status", [...ACTIVE_CALL_ATTEMPT_STATUSES])
      .order("created_at", { ascending: true });
    throwIfError(error, "list active call attempts");
    return (data ?? []).map((row) => mapCallAttempt(row as CallAttemptRow));
  }

  async countActiveBySession(sessionId: string): Promise<number> {
    const { count, error } = await this.sb
      .from("call_attempts")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .in("status", [...ACTIVE_CALL_ATTEMPT_STATUSES]);
    throwIfError(error, "count active call attempts");
    return count ?? 0;
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
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (patches.providerCallId !== undefined) {
      update.provider_call_id = patches.providerCallId;
    }
    if (patches.isWinner !== undefined) {
      update.is_winner = patches.isWinner;
    }
    if (patches.permitReleased !== undefined) {
      update.permit_released = patches.permitReleased;
    }
    if (patches.errorCode !== undefined) {
      update.error_code = patches.errorCode;
    }
    if (patches.errorMessage !== undefined) {
      update.error_message = patches.errorMessage;
    }
    if (patches.answeredAt !== undefined) {
      update.answered_at = patches.answeredAt?.toISOString() ?? null;
    }
    if (patches.completedAt !== undefined) {
      update.completed_at = patches.completedAt?.toISOString() ?? null;
    }

    let query = this.sb.from("call_attempts").update(update).eq("id", callAttemptId);
    if (patches.expectedStatuses && patches.expectedStatuses.length > 0) {
      query = query.in("status", [...patches.expectedStatuses]);
    }

    const { data, error } = await query.select("*").maybeSingle();
    throwIfError(error, "update call attempt status");
    return data ? mapCallAttempt(data as CallAttemptRow) : null;
  }

  async markWinner(callAttemptId: string): Promise<CallAttempt | null> {
    return this.updateStatus(callAttemptId, "in_progress", {
      isWinner: true,
      answeredAt: new Date(),
    });
  }

  async markPermitReleased(callAttemptId: string): Promise<CallAttempt | null> {
    const { data, error } = await this.sb
      .from("call_attempts")
      .update({
        permit_released: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", callAttemptId)
      .eq("permit_released", false)
      .select("*")
      .maybeSingle();
    throwIfError(error, "mark permit released");
    return data ? mapCallAttempt(data as CallAttemptRow) : null;
  }

  async listStaleCreating(timeoutSeconds: number): Promise<CallAttempt[]> {
    const cutoff = new Date(Date.now() - timeoutSeconds * 1000).toISOString();
    const { data, error } = await this.sb
      .from("call_attempts")
      .select("*")
      .eq("status", "creating")
      .lt("created_at", cutoff);
    throwIfError(error, "list stale creating attempts");
    return (data ?? []).map((row) => mapCallAttempt(row as CallAttemptRow));
  }
}
