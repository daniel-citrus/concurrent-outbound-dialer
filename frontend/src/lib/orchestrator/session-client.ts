import { dialerApi } from "../api";
import type { CallAttempt, CallAttemptStatus, DialingSession } from "../types";
import type { ReservedClaim } from "./call-placer";

export type ReportStatusResult = CallAttempt & {
  sessionId: string;
  triggeredReconcile: boolean;
  winnerSelected: boolean;
  winningCallAttemptId: string | null;
};

export type ReconcileHint = {
  sessionId: string;
  sessionStatus: string;
  concurrencyLimit: number;
  persistedActiveCount: number;
  queuedContactCount: number;
  claimedContactCount: number;
};

export const sessionClient = {
  getSession(sessionId: string): Promise<DialingSession> {
    return dialerApi.getSession(sessionId);
  },

  getReconcileHint(sessionId: string): Promise<ReconcileHint> {
    return dialerApi.getReconcileHint(sessionId);
  },

  claim(sessionId: string, limit: number): Promise<{ claims: ReservedClaim[] }> {
    return dialerApi.claim(sessionId, limit);
  },

  markCallCreated(callAttemptId: string, providerCallId: string): Promise<CallAttempt> {
    return dialerApi.markCallCreated(callAttemptId, providerCallId);
  },

  markCallCreationFailed(
    callAttemptId: string,
    error: { errorCode?: string; errorMessage?: string },
  ): Promise<CallAttempt> {
    return dialerApi.markCallCreationFailed(callAttemptId, error);
  },

  reportStatus(
    callAttemptId: string,
    status: CallAttemptStatus,
  ): Promise<ReportStatusResult> {
    return dialerApi.reportStatus(callAttemptId, status);
  },
};
