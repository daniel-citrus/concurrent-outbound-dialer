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
  autoContinue: boolean;
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

export type SessionRuntimeResource = {
  callAttemptId: string;
  providerCallId: string | null;
  permitReleased: boolean;
  contactId: string | null;
  phoneNumber: string | null;
  callStatus: CallAttemptStatus | null;
};

export type SessionRuntimeSnapshot = {
  sessionId: string;
  sessionStatus: SessionStatus;
  concurrencyLimit: number;
  controllerPresent: boolean;
  semaphore: {
    capacity: number;
    availablePermits: number;
    occupiedPermits: number;
    waiters: number;
  };
  mutex: {
    locked: boolean;
    resource: "reconciliation";
  };
  orchestrator: {
    reconcileRunning: boolean;
    reconcileQueued: boolean;
  };
  reconciliationPending: boolean;
  resources: SessionRuntimeResource[];
};

export type CreateSessionInput = {
  clientId: string;
  agentId: string;
  concurrencyLimit: number;
  autoContinue?: boolean;
  contacts: Array<{ externalContactId: string; phoneNumber: string }>;
};

export type CreateSessionResponse = DialingSession & {
  contacts: DialingContact[];
};

export type NebulaUser = {
  id: string;
  email: string | null;
  name: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  label: string;
};

export function nebulaUserDisplayName(user: Omit<NebulaUser, "label">): string {
  return (
    user.name ||
    user.fullName ||
    (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : null) ||
    user.email?.split("@")[0] ||
    "Unknown"
  );
}

export type NebulaUsersResponse =
  | { configured: false; users: [] }
  | { configured: true; users: NebulaUser[] };

export type NebulaProspectList = {
  id: string;
  name: string;
  status: string;
  prospectCount: number;
  label: string;
};

export type NebulaProspectListsResponse =
  | { configured: false; lists: [] }
  | { configured: true; lists: NebulaProspectList[] };

export type NebulaProspectListContactsResponse =
  | { configured: false; contacts: []; totalInList: 0; skippedWithoutPhone: 0 }
  | {
      configured: true;
      contacts: NebulaProspectContact[];
      totalInList: number;
      skippedWithoutPhone: number;
    };

export type NebulaProspectContact = {
  externalContactId: string;
  phoneNumber: string;
  name: string;
  company: string;
  title: string;
  activity: string;
  status: string;
  emailStatus: string | null;
  lastOutboundAt: string | null;
  lastOutboundType: string | null;
  lastInboundAt: string | null;
  lastInboundType: string | null;
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

export type MockAutoSimulateConfig = {
  answerRate: number;
  minStepMs: number;
  maxStepMs: number;
  minTalkMs: number;
  maxTalkMs: number;
  busyWeight: number;
  failedWeight: number;
  noAnswerWeight: number;
};

export type MockAutoSimulateState = {
  available: boolean;
  enabled: boolean;
  config: MockAutoSimulateConfig;
  defaults: MockAutoSimulateConfig;
};
