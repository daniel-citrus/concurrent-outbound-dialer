import { dialerApi } from "./api";
import type {
  CallAttempt,
  DialingContact,
  DialingSession,
  SessionStatusSnapshot,
} from "./types";
import { isActiveCall } from "./types";

export type VisualizerState = {
  session: DialingSession | null;
  snapshot: SessionStatusSnapshot | null;
  contacts: DialingContact[];
  calls: CallAttempt[];
  error: string | null;
  busy: boolean;
  healthOk: boolean | null;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function createVisualizerStore() {
  let session = $state<DialingSession | null>(null);
  let snapshot = $state<SessionStatusSnapshot | null>(null);
  let contacts = $state<DialingContact[]>([]);
  let calls = $state<CallAttempt[]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let healthOk = $state<boolean | null>(null);

  async function refreshHealth() {
    try {
      const health = await dialerApi.getHealth();
      healthOk = health.status === "ok";
    } catch {
      healthOk = false;
    }
  }

  async function refreshAll() {
    if (!session) return;
    const id = session.id;
    try {
      const [nextSession, nextContacts, nextCalls, nextSnap] = await Promise.all([
        dialerApi.getSession(id),
        dialerApi.getContacts(id),
        dialerApi.getCalls(id),
        dialerApi.getStatus(id),
      ]);
      session = nextSession;
      contacts = nextContacts;
      calls = nextCalls;
      if (nextSnap) snapshot = nextSnap;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to refresh";
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      void refreshAll();
    }, 800);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function run(action: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await action();
      await refreshAll();
    } catch (err) {
      error = err instanceof Error ? err.message : "Action failed";
    } finally {
      busy = false;
    }
  }

  return {
    get session() {
      return session;
    },
    get snapshot() {
      return snapshot;
    },
    get contacts() {
      return contacts;
    },
    get calls() {
      return calls;
    },
    get error() {
      return error;
    },
    get busy() {
      return busy;
    },
    get healthOk() {
      return healthOk;
    },
    setError(message: string | null) {
      error = message;
    },
    refreshHealth,
    refreshAll,
    startPolling,
    stopPolling,
    async createAndLoad(input: {
      clientId: string;
      agentId: string;
      concurrencyLimit: number;
      contacts: Array<{ externalContactId: string; phoneNumber: string }>;
    }) {
      await run(async () => {
        const created = await dialerApi.createSession(input);
        const { contacts: createdContacts, ...rest } = created;
        session = rest;
        contacts = createdContacts;
        calls = [];
        snapshot = null;
        startPolling();
      });
    },
    async start() {
      if (!session) return;
      const id = session.id;
      await run(async () => {
        session = await dialerApi.start(id);
      });
    },
    async pause() {
      if (!session) return;
      const id = session.id;
      await run(async () => {
        session = await dialerApi.pause(id);
      });
    },
    async resume() {
      if (!session) return;
      const id = session.id;
      await run(async () => {
        session = await dialerApi.resume(id);
      });
    },
    async stop() {
      if (!session) return;
      const id = session.id;
      await run(async () => {
        session = await dialerApi.stop(id);
      });
    },
    async simulate(callAttemptId: string, status: Parameters<typeof dialerApi.simulate>[1]) {
      await run(async () => {
        await dialerApi.simulate(callAttemptId, status);
      });
    },
    async simulateMany(
      callAttemptIds: string[],
      status: Parameters<typeof dialerApi.simulate>[1],
    ) {
      const uniqueIds = [...new Set(callAttemptIds)];
      if (uniqueIds.length === 0) {
        error = "Select at least one active call.";
        return;
      }
      await run(async () => {
        const results = await Promise.allSettled(
          uniqueIds.map((id) => dialerApi.simulate(id, status)),
        );
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0) {
          const first = failed[0] as PromiseRejectedResult;
          const message =
            first.reason instanceof Error
              ? first.reason.message
              : "Simulate partially failed";
          throw new Error(
            `${failed.length}/${uniqueIds.length} simulates failed: ${message}`,
          );
        }
      });
    },
    async simulateAllActive(status: Parameters<typeof dialerApi.simulate>[1]) {
      const targets = calls.filter((c) => isActiveCall(c.status) && !c.isWinner);
      if (targets.length === 0) {
        error = "No active non-winning calls to simulate.";
        return;
      }
      const uniqueIds = targets.map((c) => c.id);
      await run(async () => {
        const results = await Promise.allSettled(
          uniqueIds.map((id) => dialerApi.simulate(id, status)),
        );
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0) {
          const first = failed[0] as PromiseRejectedResult;
          const message =
            first.reason instanceof Error
              ? first.reason.message
              : "Simulate partially failed";
          throw new Error(
            `${failed.length}/${uniqueIds.length} simulates failed: ${message}`,
          );
        }
      });
    },
    reset() {
      stopPolling();
      session = null;
      snapshot = null;
      contacts = [];
      calls = [];
      error = null;
    },
  };
}

export type VisualizerStore = ReturnType<typeof createVisualizerStore>;
