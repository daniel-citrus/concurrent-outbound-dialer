import type { SessionStatus } from "./statuses.js";

export type DialingSession = {
  id: string;
  clientId: string;
  agentId: string;
  status: SessionStatus;
  concurrencyLimit: number;
  winningCallAttemptId: string | null;
  autoContinue: boolean;
  stateVersion: number;
  createdAt: Date;
  startedAt: Date | null;
  pausedAt: Date | null;
  stoppedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
};
