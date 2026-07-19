export type SessionStatus =
  | "created"
  | "running"
  | "paused"
  | "winner_selected"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed";

export type ContactStatus =
  | "queued"
  | "claimed"
  | "dialing"
  | "answered"
  | "completed"
  | "failed"
  | "canceled"
  | "skipped";

export type CallAttemptStatus =
  | "creating"
  | "queued"
  | "initiated"
  | "ringing"
  | "in_progress"
  | "completed"
  | "busy"
  | "failed"
  | "no_answer"
  | "canceled"
  | "unknown";

export type DialingSession = {
  id: string;
  clientId: string;
  agentId: string;
  status: SessionStatus;
  concurrencyLimit: number;
  winningCallAttemptId: string | null;
  stateVersion: number;
  createdAt: string;
  startedAt: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type DialingContact = {
  id: string;
  sessionId: string;
  externalContactId: string;
  phoneNumber: string;
  position: number;
  status: ContactStatus;
  claimedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CallAttempt = {
  id: string;
  sessionId: string;
  contactId: string;
  providerCallId: string | null;
  status: CallAttemptStatus;
  isWinner: boolean;
  permitReleased: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  answeredAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type SessionStatusSnapshot = {
  sessionId: string;
  clientId: string;
  agentId: string;
  status: SessionStatus;
  concurrencyLimit: number;
  stateVersion: number;
  activeCallCount: number;
  queuedContactCount: number;
  completedContactCount: number;
  failedContactCount: number;
  winningCall: CallAttempt | null;
  activeCalls: CallAttempt[];
  updatedAt: string;
};

export type CreateSessionInput = {
  clientId: string;
  agentId: string;
  concurrencyLimit: number;
  contacts: Array<{ externalContactId: string; phoneNumber: string }>;
};

export type CreateSessionResponse = DialingSession & {
  contacts: DialingContact[];
};

export const ACTIVE_CALL_STATUSES: readonly CallAttemptStatus[] = [
  "creating",
  "queued",
  "initiated",
  "ringing",
  "in_progress",
] as const;

export const SIMULATE_STATUSES: readonly CallAttemptStatus[] = [
  "queued",
  "initiated",
  "ringing",
  "in_progress",
  "completed",
  "busy",
  "failed",
  "no_answer",
  "canceled",
] as const;

export function formatStatus(status: string): string {
  return status.replaceAll("_", " ");
}

export function isActiveCall(status: CallAttemptStatus): boolean {
  return (ACTIVE_CALL_STATUSES as readonly string[]).includes(status);
}
