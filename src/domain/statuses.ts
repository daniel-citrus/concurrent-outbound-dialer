export const SESSION_STATUSES = [
  "created",
  "running",
  "paused",
  "winner_selected",
  "stopping",
  "stopped",
  "completed",
  "failed",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ACTIVE_SESSION_STATUSES: readonly SessionStatus[] = [
  "created",
  "running",
  "paused",
  "winner_selected",
  "stopping",
] as const;

export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = [
  "stopped",
  "completed",
  "failed",
] as const;

export const CONTACT_STATUSES = [
  "queued",
  "claimed",
  "dialing",
  "answered",
  "completed",
  "failed",
  "canceled",
  "skipped",
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CALL_ATTEMPT_STATUSES = [
  "creating",
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
] as const;

export type CallAttemptStatus = (typeof CALL_ATTEMPT_STATUSES)[number];

export const ACTIVE_CALL_ATTEMPT_STATUSES: readonly CallAttemptStatus[] = [
  "creating",
  "queued",
  "initiated",
  "ringing",
  "in_progress",
] as const;

export const TERMINAL_CALL_ATTEMPT_STATUSES: readonly CallAttemptStatus[] = [
  "completed",
  "busy",
  "failed",
  "no_answer",
  "canceled",
] as const;

export const SIMULATABLE_CALL_STATUSES: readonly CallAttemptStatus[] = [
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
] as const;

export const DIAL_EVENT_TYPES = [
  "session_created",
  "session_started",
  "session_paused",
  "session_resumed",
  "session_stopping",
  "session_stopped",
  "session_completed",
  "session_failed",
  "contact_claimed",
  "call_reserved",
  "call_creation_requested",
  "call_created",
  "call_status_received",
  "call_creation_failed",
  "winner_selected",
  "losing_answer_detected",
  "call_cancel_requested",
  "call_disconnect_requested",
  "call_terminal",
  "controller_created",
  "controller_removed",
  "recovery_started",
  "recovery_completed",
  "session_continued",
  "session_auto_continued",
  "session_auto_continue_updated",
] as const;

export type DialEventType = (typeof DIAL_EVENT_TYPES)[number];

export function isSessionStatus(value: string): value is SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(value);
}

export function isContactStatus(value: string): value is ContactStatus {
  return (CONTACT_STATUSES as readonly string[]).includes(value);
}

export function isCallAttemptStatus(value: string): value is CallAttemptStatus {
  return (CALL_ATTEMPT_STATUSES as readonly string[]).includes(value);
}

export function isActiveCallAttemptStatus(status: CallAttemptStatus): boolean {
  return (ACTIVE_CALL_ATTEMPT_STATUSES as readonly CallAttemptStatus[]).includes(status);
}

export function isTerminalCallAttemptStatus(status: CallAttemptStatus): boolean {
  return (TERMINAL_CALL_ATTEMPT_STATUSES as readonly CallAttemptStatus[]).includes(status);
}

export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return (TERMINAL_SESSION_STATUSES as readonly SessionStatus[]).includes(status);
}

/** Allowed call-attempt transitions. Same status = duplicate no-op. */
const CALL_TRANSITIONS: Record<CallAttemptStatus, readonly CallAttemptStatus[]> = {
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
  | { kind: "apply"; to: CallAttemptStatus }
  | { kind: "duplicate" }
  | { kind: "reject"; reason: string };

export function evaluateCallAttemptTransition(
  from: CallAttemptStatus,
  to: CallAttemptStatus,
): TransitionResult {
  if (from === to) {
    return { kind: "duplicate" };
  }
  if (isTerminalCallAttemptStatus(from) && isActiveCallAttemptStatus(to)) {
    return { kind: "reject", reason: "terminal_to_active_regression" };
  }
  if (isTerminalCallAttemptStatus(from) && isTerminalCallAttemptStatus(to) && from !== to) {
    // Do not allow switching between distinct terminal statuses.
    return { kind: "reject", reason: "terminal_to_terminal_regression" };
  }
  const allowed = CALL_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return { kind: "reject", reason: "disallowed_transition" };
  }
  return { kind: "apply", to };
}

const SESSION_START_FROM: readonly SessionStatus[] = ["created", "paused"];
const SESSION_PAUSE_FROM: readonly SessionStatus[] = ["running"];
const SESSION_RESUME_FROM: readonly SessionStatus[] = ["paused"];
const SESSION_STOP_FROM: readonly SessionStatus[] = [
  "created",
  "running",
  "paused",
  "winner_selected",
  "stopping",
];

export function canStartSession(status: SessionStatus): boolean {
  return (SESSION_START_FROM as readonly SessionStatus[]).includes(status);
}

export function canPauseSession(status: SessionStatus): boolean {
  return (SESSION_PAUSE_FROM as readonly SessionStatus[]).includes(status);
}

export function canResumeSession(status: SessionStatus): boolean {
  return (SESSION_RESUME_FROM as readonly SessionStatus[]).includes(status);
}

export function canStopSession(status: SessionStatus): boolean {
  return (SESSION_STOP_FROM as readonly SessionStatus[]).includes(status);
}

export function canContinueSession(status: SessionStatus): boolean {
  return status === "winner_selected";
}

export function calculateLaunchCount(input: {
  concurrencyLimit: number;
  persistedActiveCount: number;
  locallyAvailablePermits: number;
}): number {
  const databaseCapacity = Math.max(0, input.concurrencyLimit - input.persistedActiveCount);
  return Math.min(databaseCapacity, input.locallyAvailablePermits);
}

export function cancelActionForStatus(
  status: CallAttemptStatus,
): "cleanup_pending" | "cancel" | "disconnect" | "none" {
  switch (status) {
    case "creating":
      return "cleanup_pending";
    case "queued":
    case "initiated":
    case "ringing":
      return "cancel";
    case "in_progress":
      return "disconnect";
    default:
      return "none";
  }
}
