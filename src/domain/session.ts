import type { SessionStatus } from "./statuses.js";

export type DialingSession = {
  id: string;
  clientId: string;
  agentId: string;
  status: SessionStatus;
  concurrencyLimit: number;
  winningCallAttemptId: string | null;
  stateVersion: number;
  createdAt: Date;
  startedAt: Date | null;
  pausedAt: Date | null;
  stoppedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
};

export type CreateSessionInput = {
  clientId: string;
  agentId: string;
  concurrencyLimit: number;
  contacts: Array<{
    externalContactId: string;
    phoneNumber: string;
  }>;
};
