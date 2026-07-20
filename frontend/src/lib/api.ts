import type {
  CallAttempt,
  CallAttemptStatus,
  CreateSessionInput,
  CreateSessionResponse,
  DialingContact,
  DialingSession,
  NebulaUsersResponse,
  NebulaProspectListContactsResponse,
  NebulaProspectListsResponse,
  SessionStatusSnapshot,
  SessionRuntimeSnapshot,
  MockAutoSimulateConfig,
  MockAutoSimulateState,
} from "./types";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as {
        error?: { message?: string; code?: string };
      };
      if (body.error?.message) message = body.error.message;
      code = body.error?.code;
    } catch {
      // ignore
    }
    throw new ApiError(response.status, message, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const dialerApi = {
  getHealth(): Promise<{ status: string; voiceProvider?: string; database?: string }> {
    return request("/health");
  },

  getMockAutoSimulate(): Promise<MockAutoSimulateState> {
    return request("/mock/auto-simulate");
  },

  setMockAutoSimulate(
    patch: { enabled?: boolean; reset?: boolean } & Partial<MockAutoSimulateConfig>,
  ): Promise<MockAutoSimulateState> {
    return request("/mock/auto-simulate", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  getNebulaUsers(): Promise<NebulaUsersResponse> {
    return request("/nebula/users");
  },

  getAgentProspectLists(agentId: string): Promise<NebulaProspectListsResponse> {
    return request(`/nebula/agents/${encodeURIComponent(agentId)}/prospect-lists`);
  },

  getProspectListContacts(listId: string): Promise<NebulaProspectListContactsResponse> {
    return request(`/nebula/prospect-lists/${encodeURIComponent(listId)}/contacts`);
  },

  createSession(input: CreateSessionInput): Promise<CreateSessionResponse> {
    return request("/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  getSession(sessionId: string): Promise<DialingSession> {
    return request(`/sessions/${sessionId}`);
  },

  getStatus(
    sessionId: string,
    afterVersion?: number,
  ): Promise<SessionStatusSnapshot | undefined> {
    const q =
      afterVersion !== undefined ? `?afterVersion=${afterVersion}` : "";
    return request(`/sessions/${sessionId}/status${q}`);
  },

  getRuntime(sessionId: string): Promise<SessionRuntimeSnapshot> {
    return request(`/sessions/${sessionId}/runtime`);
  },

  getContacts(sessionId: string): Promise<DialingContact[]> {
    return request(`/sessions/${sessionId}/contacts`);
  },

  getCalls(sessionId: string): Promise<CallAttempt[]> {
    return request(`/sessions/${sessionId}/calls`);
  },

  start(sessionId: string): Promise<DialingSession> {
    return request(`/sessions/${sessionId}/start`, { method: "POST" });
  },

  setAutoContinue(sessionId: string, autoContinue: boolean): Promise<DialingSession> {
    return request(`/sessions/${sessionId}/auto-continue`, {
      method: "PATCH",
      body: JSON.stringify({ autoContinue }),
    });
  },

  pause(sessionId: string): Promise<DialingSession> {
    return request(`/sessions/${sessionId}/pause`, { method: "POST" });
  },

  resume(sessionId: string): Promise<DialingSession> {
    return request(`/sessions/${sessionId}/resume`, { method: "POST" });
  },

  stop(sessionId: string): Promise<DialingSession> {
    return request(`/sessions/${sessionId}/stop`, { method: "POST" });
  },

  simulate(callAttemptId: string, status: CallAttemptStatus): Promise<CallAttempt> {
    return request(`/calls/${callAttemptId}/simulate`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
  },
};
