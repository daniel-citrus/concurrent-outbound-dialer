import { dialerApi } from "./api";
import type {
  CallAttempt,
  DialingContact,
  DialingSession,
  NebulaProspectContact,
  MockAutoSimulateConfig,
  MockAutoSimulateState,
  SessionStatusSnapshot,
  SessionRuntimeSnapshot,
} from "./types";
import { isActiveCall } from "./types";
import { fallbackContactDetail } from "./contact-display";

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function createVisualizerStore() {
  let session = $state<DialingSession | null>(null);
  let agentLabel = $state<string | null>(null);
  let snapshot = $state<SessionStatusSnapshot | null>(null);
  let runtime = $state<SessionRuntimeSnapshot | null>(null);
  let contacts = $state<DialingContact[]>([]);
  let contactDetailsByExternalId = $state<Record<string, NebulaProspectContact>>({});
  let calls = $state<CallAttempt[]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let healthOk = $state<boolean | null>(null);
  let voiceProvider = $state<string | null>(null);
  let autoSimulateAvailable = $state(false);
  let autoSimulateEnabled = $state(false);
  let autoSimulateConfig = $state<MockAutoSimulateConfig | null>(null);
  let autoSimulateDefaults = $state<MockAutoSimulateConfig | null>(null);

  async function refreshHealth() {
    try {
      const health = await dialerApi.getHealth();
      healthOk = health.status === "ok";
      voiceProvider = health.voiceProvider ?? null;
    } catch {
      healthOk = false;
      voiceProvider = null;
    }
  }

  function applyAutoSimulateState(state: MockAutoSimulateState) {
    autoSimulateAvailable = state.available;
    autoSimulateEnabled = state.enabled;
    autoSimulateConfig = { ...state.config };
    autoSimulateDefaults = { ...state.defaults };
  }

  async function refreshAutoSimulate() {
    try {
      const state = await dialerApi.getMockAutoSimulate();
      applyAutoSimulateState(state);
    } catch {
      autoSimulateAvailable = false;
      autoSimulateEnabled = false;
      autoSimulateConfig = null;
      autoSimulateDefaults = null;
    }
  }

  async function refreshAll() {
    if (!session) return;
    const id = session.id;
    try {
      const [nextSession, nextContacts, nextCalls, nextSnap, nextRuntime] = await Promise.all([
        dialerApi.getSession(id),
        dialerApi.getContacts(id),
        dialerApi.getCalls(id),
        dialerApi.getStatus(id),
        dialerApi.getRuntime(id),
      ]);
      session = nextSession;
      contacts = nextContacts;
      calls = nextCalls;
      if (nextSnap) snapshot = nextSnap;
      runtime = nextRuntime;
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
    get agentLabel() {
      return agentLabel;
    },
    get snapshot() {
      return snapshot;
    },
    get runtime() {
      return runtime;
    },
    get contacts() {
      return contacts;
    },
    get contactDetailsByExternalId() {
      return contactDetailsByExternalId;
    },
    getContactDetail(externalContactId: string): NebulaProspectContact {
      return (
        contactDetailsByExternalId[externalContactId] ??
        fallbackContactDetail(externalContactId)
      );
    },
    getContactDetailByContactId(contactId: string): NebulaProspectContact {
      const contact = contacts.find((c) => c.id === contactId);
      if (!contact) {
        return fallbackContactDetail("—");
      }
      return (
        contactDetailsByExternalId[contact.externalContactId] ??
        fallbackContactDetail(contact.externalContactId, contact.phoneNumber)
      );
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
    get voiceProvider() {
      return voiceProvider;
    },
    get autoSimulateAvailable() {
      return autoSimulateAvailable;
    },
    get autoSimulateEnabled() {
      return autoSimulateEnabled;
    },
    get autoSimulateConfig() {
      return autoSimulateConfig;
    },
    get autoSimulateDefaults() {
      return autoSimulateDefaults;
    },
    setError(message: string | null) {
      error = message;
    },
    refreshHealth,
    refreshAutoSimulate,
    refreshAll,
    startPolling,
    stopPolling,
    async createAndLoad(input: {
      clientId: string;
      agentId: string;
      agentLabel?: string;
      concurrencyLimit: number;
      autoContinue?: boolean;
      contacts: Array<{ externalContactId: string; phoneNumber: string }>;
      contactDetails?: NebulaProspectContact[];
    }) {
      await run(async () => {
        const created = await dialerApi.createSession(input);
        const { contacts: createdContacts, ...rest } = created;
        session = rest;
        agentLabel = input.agentLabel ?? null;
        contacts = createdContacts;
        contactDetailsByExternalId = Object.fromEntries(
          (input.contactDetails ?? []).map((detail) => [detail.externalContactId, detail]),
        );
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
    async setAutoContinue(autoContinue: boolean) {
      if (!session) return;
      const id = session.id;
      await run(async () => {
        session = await dialerApi.setAutoContinue(id, autoContinue);
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
    async setAutoSimulate(enabled: boolean) {
      await run(async () => {
        const state = await dialerApi.setMockAutoSimulate({ enabled });
        applyAutoSimulateState(state);
      });
    },
    async updateAutoSimulateConfig(config: Partial<MockAutoSimulateConfig>) {
      await run(async () => {
        const state = await dialerApi.setMockAutoSimulate(config);
        applyAutoSimulateState(state);
      });
    },
    async resetAutoSimulateConfig() {
      await run(async () => {
        const state = await dialerApi.setMockAutoSimulate({ reset: true });
        applyAutoSimulateState(state);
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
      agentLabel = null;
      snapshot = null;
      runtime = null;
      contacts = [];
      contactDetailsByExternalId = {};
      calls = [];
      error = null;
    },
  };
}

export type VisualizerStore = ReturnType<typeof createVisualizerStore>;
