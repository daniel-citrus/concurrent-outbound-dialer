import {
  ACTIVE_CALL_ATTEMPT_STATUSES,
  evaluateCallAttemptTransition,
  isTerminalCallAttemptStatus,
} from "../domain/statuses";
import type {
  CallAttempt,
  CallAttemptStatus,
  CreateSessionInput,
  CreateSessionResponse,
  DialingContact,
  DialingSession,
  SessionRuntimeSnapshot,
  SessionStatus,
  SessionStatusSnapshot,
} from "../types";

/**
 * In-browser stand-in for the Fastify + Postgres durable store. Runs entirely
 * client-side (single tab, single-threaded), so there is no need for the
 * transactions / row locks / RPCs the real backend uses for concurrency
 * safety — the same sequential logic just runs synchronously here.
 *
 * Mirrors, in order: src/services/session-service.ts, call-launch.ts,
 * call-status-processor.ts, winner-selector.ts, call-canceler.ts,
 * session-completion.ts, and the dialer_* Postgres RPCs.
 */

export class MockBackendError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "MockBackendError";
    this.status = status;
    this.code = code;
  }
}

const E164_LIKE = /^\+[1-9]\d{6,14}$/;
const ACTIVE_SESSION_STATUSES: readonly SessionStatus[] = [
  "created",
  "running",
  "paused",
  "winner_selected",
  "stopping",
];

const sessions = new Map<string, DialingSession>();
const contactsById = new Map<string, DialingContact>();
const contactIdsBySession = new Map<string, string[]>();
const callsById = new Map<string, CallAttempt>();
const callIdsBySession = new Map<string, string[]>();

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function requireSession(sessionId: string): DialingSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new MockBackendError(404, `Session not found: ${sessionId}`, "SESSION_NOT_FOUND");
  }
  return session;
}

function touchSession(session: DialingSession, patch: Partial<DialingSession>): DialingSession {
  const updated: DialingSession = {
    ...session,
    ...patch,
    stateVersion: session.stateVersion + 1,
    updatedAt: nowIso(),
  };
  sessions.set(session.id, updated);
  return updated;
}

function listContacts(sessionId: string): DialingContact[] {
  return (contactIdsBySession.get(sessionId) ?? []).map((id) => contactsById.get(id)!);
}

function listCalls(sessionId: string): CallAttempt[] {
  return (callIdsBySession.get(sessionId) ?? []).map((id) => callsById.get(id)!);
}

function setContactStatus(
  contactId: string,
  status: DialingContact["status"],
  patch: { claimedAt?: string | null; completedAt?: string | null } = {},
): void {
  const contact = contactsById.get(contactId);
  if (!contact) return;
  contactsById.set(contactId, { ...contact, status, ...patch, updatedAt: nowIso() });
}

function countActive(sessionId: string): number {
  return listCalls(sessionId).filter((c) =>
    (ACTIVE_CALL_ATTEMPT_STATUSES as readonly string[]).includes(c.status),
  ).length;
}

function cancelAttempt(attempt: CallAttempt): void {
  if (isTerminalCallAttemptStatus(attempt.status)) return;
  const now = nowIso();
  callsById.set(attempt.id, {
    ...attempt,
    status: "canceled",
    completedAt: now,
    permitReleased: true,
    updatedAt: now,
  });
  if (!attempt.isWinner) {
    setContactStatus(attempt.contactId, "canceled", { completedAt: now });
  }
}

function cancelAllActive(sessionId: string): void {
  for (const call of listCalls(sessionId)) {
    if ((ACTIVE_CALL_ATTEMPT_STATUSES as readonly string[]).includes(call.status)) {
      cancelAttempt(call);
    }
  }
}

function cancelNonWinningActive(sessionId: string, winningCallAttemptId: string): void {
  for (const call of listCalls(sessionId)) {
    if (
      call.id !== winningCallAttemptId &&
      (ACTIVE_CALL_ATTEMPT_STATUSES as readonly string[]).includes(call.status)
    ) {
      cancelAttempt(call);
    }
  }
}

/** Mirrors session-completion.ts tryCompleteSessionIfExhausted. */
function tryCompleteIfExhausted(sessionId: string): boolean {
  if (countActive(sessionId) > 0) return false;
  const contacts = listContacts(sessionId);
  const queued = contacts.filter((c) => c.status === "queued").length;
  const claimed = contacts.filter((c) => c.status === "claimed").length;
  if (queued > 0 || claimed > 0) return false;

  const session = sessions.get(sessionId);
  if (!session || (session.status !== "running" && session.status !== "winner_selected")) {
    return false;
  }
  touchSession(session, { status: "completed", completedAt: nowIso() });
  return true;
}

export function createSession(input: CreateSessionInput): CreateSessionResponse {
  if (input.contacts.length === 0) {
    throw new MockBackendError(400, "contacts array required", "VALIDATION_ERROR");
  }
  const seen = new Set<string>();
  for (const contact of input.contacts) {
    if (seen.has(contact.externalContactId)) {
      throw new MockBackendError(
        400,
        `Duplicate externalContactId: ${contact.externalContactId}`,
        "VALIDATION_ERROR",
      );
    }
    seen.add(contact.externalContactId);
    if (!E164_LIKE.test(contact.phoneNumber)) {
      throw new MockBackendError(
        400,
        `Phone number must be E.164-like: ${contact.phoneNumber}`,
        "VALIDATION_ERROR",
      );
    }
  }

  const hasActiveForClient = [...sessions.values()].some(
    (s) => s.clientId === input.clientId && ACTIVE_SESSION_STATUSES.includes(s.status),
  );
  if (hasActiveForClient) {
    throw new MockBackendError(
      409,
      `duplicate active session for client ${input.clientId}`,
      "DUPLICATE_ACTIVE_SESSION",
    );
  }

  const id = newId();
  const now = nowIso();
  const session: DialingSession = {
    id,
    clientId: input.clientId,
    agentId: input.agentId,
    status: "created",
    concurrencyLimit: input.concurrencyLimit,
    winningCallAttemptId: null,
    autoContinue: input.autoContinue ?? true,
    stateVersion: 0,
    createdAt: now,
    startedAt: null,
    pausedAt: null,
    stoppedAt: null,
    completedAt: null,
    updatedAt: now,
  };
  sessions.set(id, session);

  const contactIds: string[] = [];
  const contacts: DialingContact[] = input.contacts.map((c, index) => {
    const contact: DialingContact = {
      id: newId(),
      sessionId: id,
      externalContactId: c.externalContactId,
      phoneNumber: c.phoneNumber,
      position: index,
      status: "queued",
      claimedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    contactsById.set(contact.id, contact);
    contactIds.push(contact.id);
    return contact;
  });
  contactIdsBySession.set(id, contactIds);
  callIdsBySession.set(id, []);

  return { ...session, contacts };
}

export function getSession(sessionId: string): DialingSession {
  return requireSession(sessionId);
}

export function getContacts(
  sessionId: string,
  options?: { limit?: number; offset?: number },
): DialingContact[] {
  requireSession(sessionId);
  const limit = options?.limit ?? 10_000;
  const offset = options?.offset ?? 0;
  return listContacts(sessionId).slice(offset, offset + limit);
}

export function getCalls(
  sessionId: string,
  options?: { limit?: number; offset?: number },
): CallAttempt[] {
  requireSession(sessionId);
  const limit = options?.limit ?? 10_000;
  const offset = options?.offset ?? 0;
  return listCalls(sessionId).slice(offset, offset + limit);
}

export function getStatusSnapshot(
  sessionId: string,
  afterVersion?: number,
): SessionStatusSnapshot | undefined {
  const session = requireSession(sessionId);
  if (afterVersion !== undefined && session.stateVersion <= afterVersion) {
    return undefined;
  }

  const counts: Record<string, number> = {};
  for (const contact of listContacts(sessionId)) {
    counts[contact.status] = (counts[contact.status] ?? 0) + 1;
  }
  const calls = listCalls(sessionId);
  const activeCalls = calls.filter((c) =>
    (ACTIVE_CALL_ATTEMPT_STATUSES as readonly string[]).includes(c.status),
  );
  const winningCall = session.winningCallAttemptId
    ? (calls.find((c) => c.id === session.winningCallAttemptId) ?? null)
    : null;

  return {
    sessionId: session.id,
    clientId: session.clientId,
    agentId: session.agentId,
    status: session.status,
    concurrencyLimit: session.concurrencyLimit,
    stateVersion: session.stateVersion,
    activeCallCount: activeCalls.length,
    queuedContactCount: counts["queued"] ?? 0,
    completedContactCount: (counts["completed"] ?? 0) + (counts["answered"] ?? 0),
    failedContactCount: counts["failed"] ?? 0,
    winningCall,
    activeCalls,
    updatedAt: session.updatedAt,
  };
}

export function getRuntimeSnapshot(sessionId: string): SessionRuntimeSnapshot {
  const session = requireSession(sessionId);
  const active = listCalls(sessionId).filter((c) =>
    (ACTIVE_CALL_ATTEMPT_STATUSES as readonly string[]).includes(c.status),
  );
  return {
    sessionId: session.id,
    sessionStatus: session.status,
    concurrencyLimit: session.concurrencyLimit,
    controllerPresent: false,
    semaphore: {
      capacity: session.concurrencyLimit,
      availablePermits: Math.max(0, session.concurrencyLimit - active.length),
      occupiedPermits: active.length,
      waiters: 0,
    },
    mutex: { locked: false, resource: "reconciliation" },
    orchestrator: { reconcileRunning: false, reconcileQueued: false },
    reconciliationPending: false,
    resources: active.map((attempt) => {
      const contact = contactsById.get(attempt.contactId);
      return {
        callAttemptId: attempt.id,
        providerCallId: attempt.providerCallId,
        permitReleased: attempt.permitReleased,
        contactId: attempt.contactId,
        phoneNumber: contact?.phoneNumber ?? null,
        callStatus: attempt.status,
      };
    }),
  };
}

export function start(sessionId: string): DialingSession {
  const session = requireSession(sessionId);
  if (session.status === "winner_selected") {
    return continueDialing(sessionId, "manual_start");
  }
  if (session.status !== "created" && session.status !== "paused") {
    throw new MockBackendError(
      409,
      `Session cannot be started from status ${session.status}.`,
      "INVALID_SESSION_TRANSITION",
    );
  }
  if (countActive(sessionId) > 0) {
    throw new MockBackendError(409, "Cannot start while a call is ongoing.", "INVALID_SESSION_TRANSITION");
  }
  return touchSession(session, { status: "running", startedAt: session.startedAt ?? nowIso(), pausedAt: null });
}

export function continueDialing(sessionId: string, reason: "manual_start" | "auto"): DialingSession {
  void reason;
  const session = requireSession(sessionId);
  if (session.status !== "winner_selected") {
    throw new MockBackendError(
      409,
      `Session cannot continue dialing from status ${session.status}.`,
      "INVALID_SESSION_TRANSITION",
    );
  }
  if (!session.winningCallAttemptId) {
    throw new MockBackendError(409, "Session has no winning call to continue from.", "INVALID_SESSION_TRANSITION");
  }
  const winningCall = callsById.get(session.winningCallAttemptId);
  if (!winningCall || !isTerminalCallAttemptStatus(winningCall.status)) {
    throw new MockBackendError(409, "Finish the current call before continuing.", "INVALID_SESSION_TRANSITION");
  }
  if (countActive(sessionId) > 0) {
    throw new MockBackendError(409, "Cannot start while a call is ongoing.", "INVALID_SESSION_TRANSITION");
  }
  const queued = listContacts(sessionId).filter((c) => c.status === "queued").length;
  if (queued <= 0) {
    throw new MockBackendError(409, "No contacts remaining in queue.", "INVALID_SESSION_TRANSITION");
  }
  return touchSession(session, { status: "running", winningCallAttemptId: null, pausedAt: null });
}

export function setAutoContinue(sessionId: string, autoContinue: boolean): DialingSession {
  const session = requireSession(sessionId);
  if (session.autoContinue === autoContinue) return session;
  return touchSession(session, { autoContinue });
}

export function pause(sessionId: string): DialingSession {
  const session = requireSession(sessionId);
  if (session.status !== "running") {
    throw new MockBackendError(
      409,
      `Session cannot be paused from status ${session.status}.`,
      "INVALID_SESSION_TRANSITION",
    );
  }
  const updated = touchSession(session, { status: "paused", pausedAt: nowIso() });
  cancelAllActive(sessionId);
  return updated;
}

export function resume(sessionId: string): DialingSession {
  const session = requireSession(sessionId);
  if (session.status !== "paused") {
    throw new MockBackendError(
      409,
      `Session cannot be resumed from status ${session.status}.`,
      "INVALID_SESSION_TRANSITION",
    );
  }
  return touchSession(session, { status: "running", pausedAt: null });
}

export function stop(sessionId: string): DialingSession {
  const session = requireSession(sessionId);
  if (session.status === "stopped" || session.status === "completed" || session.status === "failed") {
    return session;
  }
  if (
    !["created", "running", "paused", "winner_selected", "stopping"].includes(session.status)
  ) {
    throw new MockBackendError(
      409,
      `Session cannot be stopped from status ${session.status}.`,
      "INVALID_SESSION_TRANSITION",
    );
  }

  let current = session;
  if (session.status !== "stopping") {
    current = touchSession(session, { status: "stopping" });
  }

  cancelAllActive(sessionId);

  if (countActive(sessionId) === 0) {
    return touchSession(current, { status: "stopped", stoppedAt: nowIso() });
  }
  return current;
}

export function claim(
  sessionId: string,
  limit: number,
): Array<{ contact: DialingContact; callAttempt: CallAttempt }> {
  const session = requireSession(sessionId);
  if (session.status !== "running") {
    return [];
  }
  if (limit <= 0) {
    tryCompleteIfExhausted(sessionId);
    return [];
  }

  const queued = listContacts(sessionId)
    .filter((c) => c.status === "queued")
    .slice(0, limit);

  if (queued.length === 0) {
    tryCompleteIfExhausted(sessionId);
    return [];
  }

  const now = nowIso();
  const callIds = callIdsBySession.get(sessionId) ?? [];
  const claims = queued.map((contact) => {
    const updatedContact: DialingContact = {
      ...contact,
      status: "claimed",
      claimedAt: now,
      updatedAt: now,
    };
    contactsById.set(contact.id, updatedContact);

    const attempt: CallAttempt = {
      id: newId(),
      sessionId,
      contactId: contact.id,
      providerCallId: null,
      status: "creating",
      isWinner: false,
      permitReleased: false,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      answeredAt: null,
      completedAt: null,
      updatedAt: now,
    };
    callsById.set(attempt.id, attempt);
    callIds.push(attempt.id);

    return { contact: updatedContact, callAttempt: attempt };
  });
  callIdsBySession.set(sessionId, callIds);

  return claims;
}

export function getReconcileHint(sessionId: string): {
  sessionId: string;
  sessionStatus: string;
  concurrencyLimit: number;
  persistedActiveCount: number;
  queuedContactCount: number;
  claimedContactCount: number;
} {
  const session = requireSession(sessionId);
  const contacts = listContacts(sessionId);
  return {
    sessionId: session.id,
    sessionStatus: session.status,
    concurrencyLimit: session.concurrencyLimit,
    persistedActiveCount: countActive(sessionId),
    queuedContactCount: contacts.filter((c) => c.status === "queued").length,
    claimedContactCount: contacts.filter((c) => c.status === "claimed").length,
  };
}

export function markCallCreated(callAttemptId: string, providerCallId: string): CallAttempt {
  const attempt = callsById.get(callAttemptId);
  if (!attempt) {
    throw new MockBackendError(404, `Call attempt not found: ${callAttemptId}`, "CALL_ATTEMPT_NOT_FOUND");
  }
  if (attempt.status !== "creating") {
    return attempt; // idempotent no-op, mirrors dialer_mark_call_created
  }
  const updated: CallAttempt = { ...attempt, status: "queued", providerCallId, updatedAt: nowIso() };
  callsById.set(attempt.id, updated);
  setContactStatus(attempt.contactId, "dialing");
  return updated;
}

export function markCallCreationFailed(
  callAttemptId: string,
  input: { errorCode?: string; errorMessage?: string },
): CallAttempt {
  const attempt = callsById.get(callAttemptId);
  if (!attempt) {
    throw new MockBackendError(404, `Call attempt not found: ${callAttemptId}`, "CALL_ATTEMPT_NOT_FOUND");
  }
  if (attempt.status !== "creating") {
    return attempt;
  }
  const now = nowIso();
  const updated: CallAttempt = {
    ...attempt,
    status: "failed",
    errorCode: input.errorCode ?? "PROVIDER_FAILURE",
    errorMessage: input.errorMessage ?? "provider failure",
    completedAt: now,
    permitReleased: true,
    updatedAt: now,
  };
  callsById.set(attempt.id, updated);
  setContactStatus(attempt.contactId, "failed", { completedAt: now });
  return updated;
}

export type ReportStatusResult = CallAttempt & {
  sessionId: string;
  triggeredReconcile: boolean;
  winnerSelected: boolean;
  winningCallAttemptId: string | null;
};

/** Mirrors winner-selector.ts selectWinner. */
function selectWinner(callAttemptId: string): void {
  const attempt = callsById.get(callAttemptId)!;
  const session = requireSession(attempt.sessionId);

  if (session.status === "running" && session.winningCallAttemptId === null) {
    touchSession(session, {
      status: "winner_selected",
      winningCallAttemptId: attempt.id,
      pausedAt: nowIso(),
    });
    const now = nowIso();
    callsById.set(attempt.id, {
      ...attempt,
      isWinner: true,
      answeredAt: attempt.answeredAt ?? now,
      updatedAt: now,
    });
    setContactStatus(attempt.contactId, "answered", { completedAt: null });
    cancelNonWinningActive(session.id, attempt.id);
    return;
  }

  // Lost the race to another already-selected winner.
  cancelAttempt(attempt);
}

/** Mirrors call-status-processor.ts handleTerminal. Returns triggeredReconcile. */
function handleTerminal(attempt: CallAttempt): boolean {
  if (!attempt.isWinner) {
    const contactStatus =
      attempt.status === "failed"
        ? "failed"
        : attempt.status === "canceled"
          ? "canceled"
          : attempt.status === "completed"
            ? "completed"
            : "failed";
    setContactStatus(attempt.contactId, contactStatus, { completedAt: nowIso() });
  } else if (attempt.status === "completed") {
    setContactStatus(attempt.contactId, "completed", { completedAt: nowIso() });
  }

  const current = callsById.get(attempt.id);
  if (current && !current.permitReleased) {
    callsById.set(attempt.id, { ...current, permitReleased: true, updatedAt: nowIso() });
  }

  if (!attempt.isWinner) {
    return true;
  }

  const completed = tryCompleteIfExhausted(attempt.sessionId);
  if (completed) return false;

  const session = sessions.get(attempt.sessionId);
  if (session?.autoContinue) {
    try {
      continueDialing(attempt.sessionId, "auto");
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function reportStatus(
  callAttemptId: string,
  rawStatus: CallAttemptStatus,
): ReportStatusResult {
  const attempt = callsById.get(callAttemptId);
  if (!attempt) {
    throw new MockBackendError(404, `Call attempt not found: ${callAttemptId}`, "CALL_ATTEMPT_NOT_FOUND");
  }

  const transition = evaluateCallAttemptTransition(attempt.status, rawStatus);
  if (transition.kind !== "apply") {
    return {
      ...attempt,
      sessionId: attempt.sessionId,
      triggeredReconcile: false,
      winnerSelected: false,
      winningCallAttemptId: null,
    };
  }

  const now = nowIso();
  const patch: Partial<CallAttempt> = { status: rawStatus, updatedAt: now };
  if (rawStatus === "in_progress" && !attempt.answeredAt) {
    patch.answeredAt = now;
  }
  if (isTerminalCallAttemptStatus(rawStatus)) {
    patch.completedAt = now;
  }
  const updated: CallAttempt = { ...attempt, ...patch };
  callsById.set(updated.id, updated);

  if (rawStatus === "in_progress") {
    selectWinner(updated.id);
    const afterWinner = callsById.get(updated.id)!;
    const session = requireSession(updated.sessionId);
    return {
      ...afterWinner,
      sessionId: updated.sessionId,
      triggeredReconcile: false,
      winnerSelected: Boolean(afterWinner.isWinner || session.status === "winner_selected"),
      winningCallAttemptId: session.winningCallAttemptId,
    };
  }

  if (isTerminalCallAttemptStatus(rawStatus)) {
    const triggeredReconcile = handleTerminal(updated);
    const finalAttempt = callsById.get(updated.id)!;
    return {
      ...finalAttempt,
      sessionId: updated.sessionId,
      triggeredReconcile,
      winnerSelected: false,
      winningCallAttemptId: null,
    };
  }

  return {
    ...updated,
    sessionId: updated.sessionId,
    triggeredReconcile: false,
    winnerSelected: false,
    winningCallAttemptId: null,
  };
}
