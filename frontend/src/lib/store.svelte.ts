import { dialerApi } from "./api";
import { createClientOrchestrator } from "./orchestrator";
import type {
  CallAttempt,
  DialingContact,
  DialingSession,
  NebulaProspectContact,
  MockAutoSimulateConfig,
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
  let autoSimulateAvailable = $state(true);
  let autoSimulateEnabled = $state(true);
  let autoSimulateConfig = $state<MockAutoSimulateConfig | null>(null);
  let autoSimulateDefaults = $state<MockAutoSimulateConfig | null>(null);
  let orchRevision = $state(0);

  const { orchestrator, autoSimulator } = createClientOrchestrator(() => {
    orchRevision += 1;
    syncRuntimeFromOrchestrator();
  });

  function syncAutoSimulateFromClient() {
    autoSimulateAvailable = true;
    autoSimulateEnabled = autoSimulator.isEnabled();
    autoSimulateConfig = autoSimulator.getConfig();
    autoSimulateDefaults = autoSimulator.getDefaults();
  }

  syncAutoSimulateFromClient();

  function syncRuntimeFromOrchestrator() {
    if (!session) {
      runtime = null;
      return;
    }
    const controller = orchestrator.getController(session.id);
    if (!controller) {
      runtime = null;
      return;
    }
    const local = controller.toRuntimeSnapshot(session.status);
    const reconcile = orchestrator.getReconcileState(session.id);
    local.orchestrator = {
      reconcileRunning: reconcile.running,
      reconcileQueued: reconcile.queued,
    };
    local.resources = local.resources.map((resource) => {
      const call = calls.find((c) => c.id === resource.callAttemptId);
      const contact = call ? contacts.find((c) => c.id === call.contactId) : undefined;
      return {
        ...resource,
        contactId: call?.contactId ?? null,
        phoneNumber: contact?.phoneNumber ?? null,
        callStatus: call?.status ?? null,
      };
    });
    runtime = local;
  }

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

  async function refreshAutoSimulate() {
    syncAutoSimulateFromClient();
  }

  async function refreshAll() {
    if (!session) return;
    const id = session.id;
    const listOpts = { limit: 10_000 };
    try {
      const [nextSession, nextContacts, nextCalls, nextSnap] = await Promise.all([
        dialerApi.getSession(id),
        dialerApi.getContacts(id, listOpts),
        dialerApi.getCalls(id, listOpts),
        dialerApi.getStatus(id),
      ]);
      session = nextSession;
      contacts = nextContacts;
      calls = nextCalls;
      if (nextSnap) snapshot = nextSnap;

      const controller = orchestrator.getController(id);
      if (controller) {
        for (const call of nextCalls) {
          if (!isActiveCall(call.status) || call.permitReleased) {
            orchestrator.cancelAutoSimulate(call.providerCallId);
            controller.releasePermit(call.id);
          }
        }
      }

      syncRuntimeFromOrchestrator();
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
      void orchRevision;
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
        orchestrator.clear();
        await orchestrator.hydrate(rest, []);
        startPolling();
      });
    },
    async start() {
      if (!session) return;
      const id = session.id;
      await run(async () => {
        session = await dialerApi.start(id);
        await orchestrator.hydrate(
          session,
          calls.filter((c) => isActiveCall(c.status) && !c.permitReleased).map((c) => c.id),
        );
        orchestrator.scheduleReconcile(id);
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
        autoSimulator.stopAll();
      });
    },
    async resume() {
      if (!session) return;
      const id = session.id;
      await run(async () => {
        session = await dialerApi.resume(id);
        orchestrator.scheduleReconcile(id);
      });
    },
    async stop() {
      if (!session) return;
      const id = session.id;
      await run(async () => {
        session = await dialerApi.stop(id);
        autoSimulator.stopAll();
      });
    },
    async setAutoSimulate(enabled: boolean) {
      autoSimulator.setEnabled(enabled);
      syncAutoSimulateFromClient();
    },
    async updateAutoSimulateConfig(config: Partial<MockAutoSimulateConfig>) {
      autoSimulator.configure(config);
      syncAutoSimulateFromClient();
    },
    async resetAutoSimulateConfig() {
      autoSimulator.resetConfig();
      syncAutoSimulateFromClient();
    },
    async simulate(callAttemptId: string, status: Parameters<typeof dialerApi.simulate>[1]) {
      await run(async () => {
        await orchestrator.reportStatus(callAttemptId, status);
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
          uniqueIds.map((id) => orchestrator.reportStatus(id, status)),
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
          uniqueIds.map((id) => orchestrator.reportStatus(id, status)),
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
      orchestrator.clear();
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
