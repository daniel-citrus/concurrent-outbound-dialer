import { randomUUID } from "node:crypto";
import type { DialerSupabase } from "./supabase.js";
import type {
  SessionRow,
  ContactRow,
  CallAttemptRow,
  EventRow,
} from "../repositories/mappers.js";
import { ACTIVE_CALL_ATTEMPT_STATUSES } from "../domain/statuses.js";

/**
 * Drop-in replacement for the real Supabase client, used when the dialer's
 * own Supabase project is not configured or unreachable. Implements only the
 * `.from(...)`/`.rpc(...)` call shapes this codebase actually issues (see
 * repositories/*.ts and call-launch.ts) — not a general PostgREST emulator.
 * Sessions/contacts/call attempts start empty and are populated as the app
 * creates sessions, so no seed data is required here.
 */

type AnyRow = Record<string, unknown>;

type PgError = { message: string; code?: string };

type QueryResult<T> = { data: T; error: PgError | null; count?: number | null };

const ACTIVE_SESSION_STATUSES = [
  "created",
  "running",
  "paused",
  "winner_selected",
  "stopping",
];

type Filter = { type: "eq" | "in" | "lt"; column: string; value: unknown };

class MemoryQueryBuilder<T extends AnyRow>
  implements PromiseLike<QueryResult<T[] | T | null>>
{
  private op: "select" | "insert" | "update" = "select";
  private payload: Partial<T> | null = null;
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private limitN: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;
  private countMode = false;

  constructor(
    private readonly rows: T[],
    private readonly makeDefaults?: () => T,
  ) {}

  select(_columns?: string, opts?: { count?: "exact"; head?: boolean }): this {
    if (opts?.count) this.countMode = true;
    return this;
  }

  insert(payload: Partial<T>): this {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Partial<T>): this {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ type: "in", column, value: values });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ type: "lt", column, value });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderCol = column;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  single(): this {
    this.singleMode = "single";
    return this;
  }

  maybeSingle(): this {
    this.singleMode = "maybeSingle";
    return this;
  }

  private matches(row: T): boolean {
    return this.filters.every((f) => {
      const rowValue = row[f.column];
      if (f.type === "eq") return rowValue === f.value;
      if (f.type === "in") return (f.value as unknown[]).includes(rowValue);
      if (f.type === "lt") return String(rowValue) < String(f.value);
      return true;
    });
  }

  private execute(): QueryResult<T[] | T | null> {
    if (this.op === "insert") {
      const now = new Date().toISOString();
      const fallbackDefaults = { id: randomUUID(), created_at: now } as unknown as Partial<T>;
      const row = {
        ...(this.makeDefaults?.() ?? fallbackDefaults),
        ...this.payload,
      } as T;
      this.rows.push(row);
      return this.finish([row]);
    }

    if (this.op === "update") {
      const now = new Date().toISOString();
      const matched = this.rows.filter((r) => this.matches(r));
      for (const row of matched) {
        Object.assign(row, this.payload, {
          updated_at: (this.payload as AnyRow | null)?.updated_at ?? now,
        });
      }
      return this.finish(matched);
    }

    let matched = this.rows.filter((r) => this.matches(r));
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      matched = [...matched].sort((a, b) => {
        const av = a[col] as string | number;
        const bv = b[col] as string | number;
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return asc ? cmp : -cmp;
      });
    }
    if (this.countMode) {
      return { data: null, error: null, count: matched.length };
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      matched = matched.slice(this.rangeFrom, this.rangeTo + 1);
    } else if (this.limitN !== null) {
      matched = matched.slice(0, this.limitN);
    }
    return this.finish(matched);
  }

  private finish(matched: T[]): QueryResult<T[] | T | null> {
    if (this.singleMode === "single") {
      if (matched.length !== 1) {
        return { data: null, error: { message: "no rows returned", code: "PGRST116" } };
      }
      return { data: matched[0]!, error: null };
    }
    if (this.singleMode === "maybeSingle") {
      if (matched.length > 1) {
        return { data: null, error: { message: "multiple rows returned" } };
      }
      return { data: matched[0] ?? null, error: null };
    }
    return { data: matched, error: null };
  }

  then<TResult1 = QueryResult<T[] | T | null>, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult<T[] | T | null>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

function newEventDefaults(): EventRow {
  return {
    id: randomUUID(),
    session_id: "",
    call_attempt_id: null,
    event_type: "session_created",
    payload: {},
    created_at: new Date().toISOString(),
  };
}

class InMemoryDialerClient {
  private sessions: SessionRow[] = [];
  private contacts: ContactRow[] = [];
  private callAttempts: CallAttemptRow[] = [];
  private events: EventRow[] = [];

  from(table: string) {
    switch (table) {
      case "dialing_sessions":
        return new MemoryQueryBuilder(this.sessions);
      case "dialing_contacts":
        return new MemoryQueryBuilder(this.contacts);
      case "call_attempts":
        return new MemoryQueryBuilder(this.callAttempts);
      case "dial_events":
        return new MemoryQueryBuilder(this.events, newEventDefaults);
      default:
        throw new Error(`in-memory data store: unsupported table "${table}"`);
    }
  }

  async rpc(name: string, args: AnyRow = {}): Promise<QueryResult<unknown>> {
    switch (name) {
      case "dialer_create_session":
        return this.createSession(args);
      case "dialer_claim_contacts":
        return this.claimContacts(args);
      case "dialer_try_select_winner":
        return this.trySelectWinner(args);
      case "dialer_continue_from_winner":
        return this.continueFromWinner(args);
      case "dialer_reconcile_hint":
        return this.reconcileHint(args);
      case "dialer_mark_call_created":
        return this.markCallCreated(args);
      case "dialer_mark_call_creation_failed":
        return this.markCallCreationFailed(args);
      default:
        return { data: null, error: { message: `unsupported rpc "${name}"` } };
    }
  }

  private createSession(
    args: AnyRow,
  ): QueryResult<{ session: SessionRow; contacts: ContactRow[] } | null> {
    const clientId = args.p_client_id as string;
    const contactsInput = args.p_contacts as Array<{
      externalContactId: string;
      phoneNumber: string;
    }>;
    if (!Array.isArray(contactsInput) || contactsInput.length < 1) {
      return { data: null, error: { message: "contacts array required" } };
    }

    const hasActive = this.sessions.some(
      (s) => s.client_id === clientId && ACTIVE_SESSION_STATUSES.includes(s.status),
    );
    if (hasActive) {
      return {
        data: null,
        error: { message: `duplicate active session for client ${clientId}`, code: "23505" },
      };
    }

    const now = new Date().toISOString();
    const session: SessionRow = {
      id: randomUUID(),
      client_id: clientId,
      agent_id: args.p_agent_id as string,
      status: "created",
      concurrency_limit: args.p_concurrency_limit as number,
      winning_call_attempt_id: null,
      auto_continue: (args.p_auto_continue as boolean | undefined) ?? true,
      state_version: 0,
      created_at: now,
      started_at: null,
      paused_at: null,
      stopped_at: null,
      completed_at: null,
      updated_at: now,
    };
    this.sessions.push(session);

    const contacts: ContactRow[] = contactsInput.map((c, idx) => ({
      id: randomUUID(),
      session_id: session.id,
      external_contact_id: c.externalContactId,
      phone_number: c.phoneNumber,
      position: idx,
      status: "queued",
      claimed_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    }));
    this.contacts.push(...contacts);

    this.events.push({
      id: randomUUID(),
      session_id: session.id,
      call_attempt_id: null,
      event_type: "session_created",
      payload: {
        clientId: session.client_id,
        agentId: session.agent_id,
        contactCount: contacts.length,
        concurrencyLimit: session.concurrency_limit,
      },
      created_at: now,
    });

    return { data: { session, contacts }, error: null };
  }

  private claimContacts(
    args: AnyRow,
  ): QueryResult<Array<{ contact: ContactRow; call_attempt: CallAttemptRow }>> {
    const sessionId = args.p_session_id as string;
    const limit = args.p_limit as number;
    if (!limit || limit <= 0) {
      return { data: [], error: null };
    }

    const claimable = this.contacts
      .filter((c) => c.session_id === sessionId && c.status === "queued")
      .sort((a, b) => a.position - b.position)
      .slice(0, limit);

    const now = new Date().toISOString();
    const pairs = claimable.map((contact) => {
      contact.status = "claimed";
      contact.claimed_at = now;
      contact.updated_at = now;

      const callAttempt: CallAttemptRow = {
        id: randomUUID(),
        session_id: sessionId,
        contact_id: contact.id,
        provider_call_id: null,
        status: "creating",
        is_winner: false,
        permit_released: false,
        error_code: null,
        error_message: null,
        created_at: now,
        answered_at: null,
        completed_at: null,
        updated_at: now,
      };
      this.callAttempts.push(callAttempt);

      this.events.push({
        id: randomUUID(),
        session_id: sessionId,
        call_attempt_id: callAttempt.id,
        event_type: "contact_claimed",
        payload: { contactId: contact.id, position: contact.position },
        created_at: now,
      });
      this.events.push({
        id: randomUUID(),
        session_id: sessionId,
        call_attempt_id: callAttempt.id,
        event_type: "call_reserved",
        payload: { contactId: contact.id },
        created_at: now,
      });

      return { contact, call_attempt: callAttempt };
    });

    return { data: pairs, error: null };
  }

  private trySelectWinner(args: AnyRow): QueryResult<SessionRow | null> {
    const sessionId = args.p_session_id as string;
    const callAttemptId = args.p_call_attempt_id as string;
    const session = this.sessions.find(
      (s) =>
        s.id === sessionId && s.status === "running" && s.winning_call_attempt_id === null,
    );
    if (!session) {
      return { data: null, error: null };
    }

    const now = new Date().toISOString();
    session.status = "winner_selected";
    session.winning_call_attempt_id = callAttemptId;
    session.paused_at = now;
    session.state_version += 1;
    session.updated_at = now;

    return { data: session, error: null };
  }

  private continueFromWinner(args: AnyRow): QueryResult<SessionRow | null> {
    const sessionId = args.p_session_id as string;
    const session = this.sessions.find(
      (s) =>
        s.id === sessionId &&
        s.status === "winner_selected" &&
        s.winning_call_attempt_id !== null,
    );
    if (!session) {
      return { data: null, error: null };
    }

    const now = new Date().toISOString();
    session.status = "running";
    session.winning_call_attempt_id = null;
    session.paused_at = null;
    session.state_version += 1;
    session.updated_at = now;

    return { data: session, error: null };
  }

  private reconcileHint(args: AnyRow): QueryResult<AnyRow | null> {
    const sessionId = args.p_session_id as string;
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) {
      return { data: null, error: null };
    }

    const persistedActiveCount = this.callAttempts.filter(
      (a) =>
        a.session_id === sessionId &&
        (ACTIVE_CALL_ATTEMPT_STATUSES as readonly string[]).includes(a.status),
    ).length;
    const queuedContactCount = this.contacts.filter(
      (c) => c.session_id === sessionId && c.status === "queued",
    ).length;
    const claimedContactCount = this.contacts.filter(
      (c) => c.session_id === sessionId && c.status === "claimed",
    ).length;

    return {
      data: {
        sessionId: session.id,
        sessionStatus: session.status,
        concurrencyLimit: session.concurrency_limit,
        persistedActiveCount,
        queuedContactCount,
        claimedContactCount,
      },
      error: null,
    };
  }

  private markCallCreated(args: AnyRow): QueryResult<CallAttemptRow | null> {
    const callAttemptId = args.p_call_attempt_id as string;
    const providerCallId = args.p_provider_call_id as string;
    const attempt = this.callAttempts.find((a) => a.id === callAttemptId);
    if (!attempt) {
      return { data: null, error: null };
    }

    if (attempt.status !== "creating") {
      return { data: attempt, error: null };
    }

    const now = new Date().toISOString();
    attempt.status = "queued";
    attempt.provider_call_id = providerCallId;
    attempt.updated_at = now;

    const contact = this.contacts.find((c) => c.id === attempt.contact_id);
    if (contact) {
      contact.status = "dialing";
      contact.updated_at = now;
    }

    this.events.push({
      id: randomUUID(),
      session_id: attempt.session_id,
      call_attempt_id: attempt.id,
      event_type: "call_created",
      payload: { providerCallId },
      created_at: now,
    });

    return { data: attempt, error: null };
  }

  private markCallCreationFailed(args: AnyRow): QueryResult<CallAttemptRow | null> {
    const callAttemptId = args.p_call_attempt_id as string;
    const errorCode = (args.p_error_code as string | undefined) ?? "PROVIDER_FAILURE";
    const errorMessage = (args.p_error_message as string | undefined) ?? "provider failure";
    const attempt = this.callAttempts.find((a) => a.id === callAttemptId);
    if (!attempt) {
      return { data: null, error: null };
    }

    if (attempt.status !== "creating") {
      return { data: attempt, error: null };
    }

    const now = new Date().toISOString();
    attempt.status = "failed";
    attempt.error_code = errorCode;
    attempt.error_message = errorMessage;
    attempt.completed_at = now;
    attempt.permit_released = true;
    attempt.updated_at = now;

    const contact = this.contacts.find((c) => c.id === attempt.contact_id);
    if (contact) {
      contact.status = "failed";
      contact.completed_at = now;
      contact.updated_at = now;
    }

    this.events.push({
      id: randomUUID(),
      session_id: attempt.session_id,
      call_attempt_id: attempt.id,
      event_type: "call_creation_failed",
      payload: { error: errorMessage, code: errorCode },
      created_at: now,
    });

    return { data: attempt, error: null };
  }
}

export function createInMemoryDialerSupabase(): DialerSupabase {
  return new InMemoryDialerClient() as unknown as DialerSupabase;
}
