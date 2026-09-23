import type { DialerSupabase } from "../database/supabase.js";
import { isUniqueViolation, throwIfError } from "../database/supabase.js";
import type { DialingContact } from "../domain/contact.js";
import type { DialingSession } from "../domain/session.js";
import type { SessionStatus } from "../domain/statuses.js";
import { databaseConflict, duplicateActiveClientSession } from "../domain/errors.js";
import { mapContact, mapSession, type ContactRow, type SessionRow } from "./mappers.js";

export class SessionRepository {
  constructor(private readonly sb: DialerSupabase) {}

  async findById(sessionId: string): Promise<DialingSession | null> {
    const { data, error } = await this.sb
      .from("dialing_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    throwIfError(error, "find session");
    return data ? mapSession(data as SessionRow) : null;
  }

  async listByStatuses(statuses: readonly SessionStatus[]): Promise<DialingSession[]> {
    const { data, error } = await this.sb
      .from("dialing_sessions")
      .select("*")
      .in("status", [...statuses])
      .order("created_at", { ascending: true });
    throwIfError(error, "list sessions by status");
    return (data ?? []).map((row) => mapSession(row as SessionRow));
  }

  async create(input: {
    clientId: string;
    agentId: string;
    concurrencyLimit: number;
    autoContinue?: boolean;
    contacts: Array<{ externalContactId: string; phoneNumber: string }>;
  }): Promise<{ session: DialingSession; contacts: DialingContact[] }> {
    const { data, error } = await this.sb.rpc("dialer_create_session", {
      p_client_id: input.clientId,
      p_agent_id: input.agentId,
      p_concurrency_limit: input.concurrencyLimit,
      p_auto_continue: input.autoContinue ?? true,
      p_contacts: input.contacts.map((c) => ({
        externalContactId: c.externalContactId,
        phoneNumber: c.phoneNumber,
      })),
    });

    if (error) {
      if (isUniqueViolation(error)) {
        throw duplicateActiveClientSession(input.clientId);
      }
      throwIfError(error, "create session");
    }

    const payload = data as {
      session: SessionRow;
      contacts: ContactRow[];
    };
    return {
      session: mapSession(payload.session),
      contacts: payload.contacts.map(mapContact),
    };
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
    const current = await this.findById(sessionId);
    if (!current) return null;
    if (
      patches.expectedStatuses &&
      patches.expectedStatuses.length > 0 &&
      !patches.expectedStatuses.includes(current.status)
    ) {
      return null;
    }

    const update: Record<string, unknown> = {
      status,
      state_version: current.stateVersion + 1,
      updated_at: new Date().toISOString(),
    };
    if (patches.startedAt !== undefined) {
      update.started_at = patches.startedAt?.toISOString() ?? null;
    }
    if (patches.pausedAt !== undefined) {
      update.paused_at = patches.pausedAt?.toISOString() ?? null;
    }
    if (patches.stoppedAt !== undefined) {
      update.stopped_at = patches.stoppedAt?.toISOString() ?? null;
    }
    if (patches.completedAt !== undefined) {
      update.completed_at = patches.completedAt?.toISOString() ?? null;
    }
    if (patches.winningCallAttemptId !== undefined) {
      update.winning_call_attempt_id = patches.winningCallAttemptId;
    }

    let query = this.sb.from("dialing_sessions").update(update).eq("id", sessionId);
    if (patches.expectedStatuses && patches.expectedStatuses.length > 0) {
      query = query.in("status", [...patches.expectedStatuses]);
    }

    const { data, error } = await query.select("*").maybeSingle();
    throwIfError(error, "update session status");
    return data ? mapSession(data as SessionRow) : null;
  }

  async trySelectWinner(
    sessionId: string,
    callAttemptId: string,
  ): Promise<DialingSession | null> {
    const { data, error } = await this.sb.rpc("dialer_try_select_winner", {
      p_session_id: sessionId,
      p_call_attempt_id: callAttemptId,
    });
    throwIfError(error, "try select winner");
    if (!data) return null;
    return mapSession(data as SessionRow);
  }

  async bumpStateVersion(sessionId: string): Promise<DialingSession | null> {
    const current = await this.findById(sessionId);
    if (!current) return null;
    const { data, error } = await this.sb
      .from("dialing_sessions")
      .update({
        state_version: current.stateVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .select("*")
      .maybeSingle();
    throwIfError(error, "bump state version");
    return data ? mapSession(data as SessionRow) : null;
  }

  async markCompleted(sessionId: string): Promise<DialingSession | null> {
    return this.updateStatus(sessionId, "completed", {
      completedAt: new Date(),
      expectedStatuses: ["running", "winner_selected"],
    });
  }

  async continueFromWinner(sessionId: string): Promise<DialingSession | null> {
    const { data, error } = await this.sb.rpc("dialer_continue_from_winner", {
      p_session_id: sessionId,
    });
    throwIfError(error, "continue from winner");
    if (!data) return null;
    return mapSession(data as SessionRow);
  }

  async setAutoContinue(
    sessionId: string,
    autoContinue: boolean,
  ): Promise<DialingSession | null> {
    const current = await this.findById(sessionId);
    if (!current) return null;
    const { data, error } = await this.sb
      .from("dialing_sessions")
      .update({
        auto_continue: autoContinue,
        state_version: current.stateVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .select("*")
      .maybeSingle();
    throwIfError(error, "set auto continue");
    return data ? mapSession(data as SessionRow) : null;
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
