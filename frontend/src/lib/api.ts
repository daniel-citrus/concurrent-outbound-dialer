import * as backend from "./mock-backend/store";
import { MockBackendError } from "./mock-backend/store";
import * as prospects from "./mock-backend/prospects";
import type {
  CallAttempt,
  CallAttemptStatus,
  CreateSessionInput,
  CreateSessionResponse,
  DialingContact,
  DialingSession,
  ProspectAgentsResponse,
  ProspectListContactsResponse,
  ProspectListsResponse,
  SessionStatusSnapshot,
  SessionRuntimeSnapshot,
  MockAutoSimulateConfig,
  MockAutoSimulateState,
} from "./types";

/**
 * This app runs standalone in the browser — there is no server. Every
 * `dialerApi` method below is backed by an in-memory store
 * (./mock-backend/store.ts) instead of a `fetch` call, so the whole
 * visualizer works from a static deploy with zero backend.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function run<T>(fn: () => T): Promise<T> {
  try {
    return fn();
  } catch (error) {
    if (error instanceof MockBackendError) {
      throw new ApiError(error.status, error.message, error.code);
    }
    throw error;
  }
}

export const dialerApi = {
  getHealth(): Promise<{ status: string; voiceProvider?: string; database?: string }> {
    return Promise.resolve({ status: "ok", voiceProvider: "mock-browser", database: "in-memory" });
  },

  getMockAutoSimulate(): Promise<MockAutoSimulateState> {
    throw new ApiError(404, "Auto-simulate is configured client-side in this build.", "NOT_FOUND");
  },

  setMockAutoSimulate(
    _patch: { enabled?: boolean; reset?: boolean } & Partial<MockAutoSimulateConfig>,
  ): Promise<MockAutoSimulateState> {
    throw new ApiError(404, "Auto-simulate is configured client-side in this build.", "NOT_FOUND");
  },

  getProspectAgents(): Promise<ProspectAgentsResponse> {
    return run(() => ({ agents: prospects.listProspectAgents() }));
  },

  getAgentProspectLists(agentId: string): Promise<ProspectListsResponse> {
    return run(() => ({ lists: prospects.listProspectListsForAgent(agentId) }));
  },

  getProspectListContacts(listId: string): Promise<ProspectListContactsResponse> {
    return run(() => prospects.listProspectListContacts(listId));
  },

  createSession(input: CreateSessionInput): Promise<CreateSessionResponse> {
    return run(() => backend.createSession(input));
  },

  getSession(sessionId: string): Promise<DialingSession> {
    return run(() => backend.getSession(sessionId));
  },

  getStatus(
    sessionId: string,
    afterVersion?: number,
  ): Promise<SessionStatusSnapshot | undefined> {
    return run(() => backend.getStatusSnapshot(sessionId, afterVersion));
  },

  getRuntime(sessionId: string): Promise<SessionRuntimeSnapshot> {
    return run(() => backend.getRuntimeSnapshot(sessionId));
  },

  getContacts(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<DialingContact[]> {
    return run(() => backend.getContacts(sessionId, options));
  },

  getCalls(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<CallAttempt[]> {
    return run(() => backend.getCalls(sessionId, options));
  },

  start(sessionId: string): Promise<DialingSession> {
    return run(() => backend.start(sessionId));
  },

  setAutoContinue(sessionId: string, autoContinue: boolean): Promise<DialingSession> {
    return run(() => backend.setAutoContinue(sessionId, autoContinue));
  },

  pause(sessionId: string): Promise<DialingSession> {
    return run(() => backend.pause(sessionId));
  },

  resume(sessionId: string): Promise<DialingSession> {
    return run(() => backend.resume(sessionId));
  },

  stop(sessionId: string): Promise<DialingSession> {
    return run(() => backend.stop(sessionId));
  },

  claim(
    sessionId: string,
    limit: number,
  ): Promise<{
    claims: Array<{
      contact: DialingContact;
      callAttempt: CallAttempt;
    }>;
  }> {
    return run(() => ({ claims: backend.claim(sessionId, limit) }));
  },

  getReconcileHint(sessionId: string): Promise<{
    sessionId: string;
    sessionStatus: string;
    concurrencyLimit: number;
    persistedActiveCount: number;
    queuedContactCount: number;
    claimedContactCount: number;
  }> {
    return run(() => backend.getReconcileHint(sessionId));
  },

  markCallCreated(callAttemptId: string, providerCallId: string): Promise<CallAttempt> {
    return run(() => backend.markCallCreated(callAttemptId, providerCallId));
  },

  markCallCreationFailed(
    callAttemptId: string,
    error: { errorCode?: string; errorMessage?: string },
  ): Promise<CallAttempt> {
    return run(() => backend.markCallCreationFailed(callAttemptId, error));
  },

  reportStatus(
    callAttemptId: string,
    status: CallAttemptStatus,
  ): Promise<
    CallAttempt & {
      sessionId: string;
      triggeredReconcile: boolean;
      winnerSelected: boolean;
      winningCallAttemptId: string | null;
    }
  > {
    return run(() => backend.reportStatus(callAttemptId, status));
  },

  simulate(callAttemptId: string, status: CallAttemptStatus): Promise<CallAttempt> {
    return run(() => backend.reportStatus(callAttemptId, status));
  },
};
