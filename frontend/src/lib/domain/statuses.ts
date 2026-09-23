/** Must stay aligned with `src/domain/statuses.ts` calculateLaunchCount. */
export function calculateLaunchCount(input: {
  concurrencyLimit: number;
  persistedActiveCount: number;
  locallyAvailablePermits: number;
}): number {
  const databaseCapacity = Math.max(0, input.concurrencyLimit - input.persistedActiveCount);
  return Math.min(databaseCapacity, input.locallyAvailablePermits);
}

export const TERMINAL_CALL_ATTEMPT_STATUSES = [
  "completed",
  "busy",
  "failed",
  "no_answer",
  "canceled",
] as const;

export const ACTIVE_CALL_ATTEMPT_STATUSES = [
  "creating",
  "queued",
  "initiated",
  "ringing",
  "in_progress",
] as const;

export type CallAttemptStatusLike = string;

export function isTerminalCallAttemptStatus(status: CallAttemptStatusLike): boolean {
  return (TERMINAL_CALL_ATTEMPT_STATUSES as readonly string[]).includes(status);
}

export function isActiveCallAttemptStatus(status: CallAttemptStatusLike): boolean {
  return (ACTIVE_CALL_ATTEMPT_STATUSES as readonly string[]).includes(status);
}

/** Allowed call-attempt transitions. Same status = duplicate no-op. Must stay aligned with `src/domain/statuses.ts`. */
const CALL_TRANSITIONS: Record<string, readonly string[]> = {
  creating: [
    "queued",
    "initiated",
    "ringing",
    "in_progress",
    "completed",
    "busy",
    "failed",
    "no_answer",
    "canceled",
    "unknown",
  ],
  queued: [
    "initiated",
    "ringing",
    "in_progress",
    "completed",
    "busy",
    "failed",
    "no_answer",
    "canceled",
    "unknown",
  ],
  initiated: [
    "ringing",
    "in_progress",
    "completed",
    "busy",
    "failed",
    "no_answer",
    "canceled",
    "unknown",
  ],
  ringing: ["in_progress", "completed", "busy", "failed", "no_answer", "canceled", "unknown"],
  in_progress: ["completed", "busy", "failed", "no_answer", "canceled", "unknown"],
  completed: [],
  busy: [],
  failed: [],
  no_answer: [],
  canceled: [],
  unknown: ["completed", "busy", "failed", "no_answer", "canceled", "unknown"],
};

export type TransitionResult =
  | { kind: "apply"; to: CallAttemptStatusLike }
  | { kind: "duplicate" }
  | { kind: "reject"; reason: string };

export function evaluateCallAttemptTransition(
  from: CallAttemptStatusLike,
  to: CallAttemptStatusLike,
): TransitionResult {
  if (from === to) {
    return { kind: "duplicate" };
  }
  if (isTerminalCallAttemptStatus(from) && isActiveCallAttemptStatus(to)) {
    return { kind: "reject", reason: "terminal_to_active_regression" };
  }
  if (isTerminalCallAttemptStatus(from) && isTerminalCallAttemptStatus(to) && from !== to) {
    return { kind: "reject", reason: "terminal_to_terminal_regression" };
  }
  const allowed = CALL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return { kind: "reject", reason: "disallowed_transition" };
  }
  return { kind: "apply", to };
}
