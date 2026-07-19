import type { CallAttemptStatus } from "./statuses.js";

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
  createdAt: Date;
  answeredAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
};
