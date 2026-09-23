import { Mutex, Semaphore } from "async-mutex";
import type { CallAttemptStatus } from "../../src/domain/statuses.js";
import { calculateLaunchCount, isTerminalCallAttemptStatus } from "../../src/domain/statuses.js";
import type { buildApp } from "../../src/app.js";
import type { MockVoiceProvider } from "../../src/providers/mock-voice-provider.js";
import type { ReservedClaim } from "../../src/repositories/claim.repository.js";

type App = Awaited<ReturnType<typeof buildApp>>;

type Controller = {
  sessionId: string;
  concurrencyLimit: number;
  semaphore: Semaphore;
  reconciliationMutex: Mutex;
  activeCalls: Map<string, { releasePermit: (() => void) | null; permitReleased: boolean }>;
  reconciliationPending: boolean;
  availablePermits(): number;
  acquirePermitForAttempt(callAttemptId: string): Promise<void>;
  releasePermit(callAttemptId: string): boolean;
  setProviderCallId(callAttemptId: string, providerCallId: string): void;
};

/**
 * Integration-test stand-in for the browser client orchestrator.
 * Uses claim / created / report-status APIs + MockVoiceProvider.createCall.
 */
export class TestClientOrchestrator {
  private readonly controllers = new Map<string, Controller>();
  private readonly running = new Set<string>();
  private readonly queued = new Set<string>();
  private acceptingWork = true;

  constructor(
    private readonly app: App,
    private readonly voiceProvider: MockVoiceProvider,
  ) {}

  stop(): void {
    this.acceptingWork = false;
  }

  clear(): void {
    this.controllers.clear();
    this.running.clear();
    this.queued.clear();
  }

  get(sessionId: string): Controller | undefined {
    return this.controllers.get(sessionId);
  }

  async ensure(sessionId: string): Promise<Controller> {
    const existing = this.controllers.get(sessionId);
    if (existing) return existing;

    const sessionRes = await this.app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const session = sessionRes.json<{ concurrencyLimit: number }>();
    const controller = this.createController(sessionId, session.concurrencyLimit);

    // Restore permits for already-active attempts (registry clear / recovery-like).
    const callsRes = await this.app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/calls`,
    });
    const calls = callsRes.json<
      Array<{ id: string; status: string; providerCallId: string | null; permitReleased: boolean }>
    >();
    for (const call of calls) {
      if (
        ["creating", "queued", "initiated", "ringing", "in_progress"].includes(call.status) &&
        !call.permitReleased
      ) {
        await controller.acquirePermitForAttempt(call.id);
        if (call.providerCallId) {
          controller.setProviderCallId(call.id, call.providerCallId);
        }
      }
    }

    this.controllers.set(sessionId, controller);
    return controller;
  }

  scheduleReconcile(sessionId: string): void {
    if (!this.acceptingWork) return;
    if (this.running.has(sessionId)) {
      this.queued.add(sessionId);
      return;
    }
    if (this.queued.has(sessionId)) return;
    this.queued.add(sessionId);
    queueMicrotask(() => {
      void this.drain(sessionId);
    });
  }

  async reconcileSession(sessionId: string): Promise<void> {
    if (!this.acceptingWork) return;
    const controller = await this.ensure(sessionId);
    controller.reconciliationPending = true;
    try {
      const reserved = await controller.reconciliationMutex.runExclusive(async () => {
        const sessionRes = await this.app.inject({
          method: "GET",
          url: `/sessions/${sessionId}`,
        });
        const session = sessionRes.json<{ status: string; concurrencyLimit: number }>();
        if (session.status !== "running") return [] as ReservedClaim[];

        const hintRes = await this.app.inject({
          method: "GET",
          url: `/sessions/${sessionId}/reconcile-hint`,
        });
        const hint = hintRes.json<{ persistedActiveCount: number }>();
        const launchCount = calculateLaunchCount({
          concurrencyLimit: session.concurrencyLimit,
          persistedActiveCount: hint.persistedActiveCount,
          locallyAvailablePermits: controller.availablePermits(),
        });
        if (launchCount <= 0) return [];

        const claimRes = await this.app.inject({
          method: "POST",
          url: `/sessions/${sessionId}/claim`,
          payload: { limit: launchCount },
        });
        if (claimRes.statusCode !== 200) return [];
        const body = claimRes.json<{
          claims: Array<{
            contact: { id: string; phoneNumber: string };
            callAttempt: { id: string };
          }>;
        }>();
        return body.claims.map((c) => ({
          contact: {
            id: c.contact.id,
            phoneNumber: c.contact.phoneNumber,
          },
          callAttempt: { id: c.callAttempt.id },
        })) as unknown as ReservedClaim[];
      });

      await Promise.allSettled(
        reserved.map((item) => this.launchReserved(controller, item)),
      );
    } finally {
      controller.reconciliationPending = false;
    }
  }

  async reportStatus(
    callAttemptId: string,
    status: CallAttemptStatus,
  ): Promise<{
    sessionId: string;
    triggeredReconcile: boolean;
    winnerSelected: boolean;
    winningCallAttemptId: string | null;
  }> {
    const res = await this.app.inject({
      method: "POST",
      url: `/calls/${callAttemptId}/report-status`,
      payload: { status },
    });
    const body = res.json<{
      sessionId: string;
      triggeredReconcile: boolean;
      winnerSelected: boolean;
      winningCallAttemptId: string | null;
      id: string;
      status: CallAttemptStatus;
    }>();

    const controller = this.controllers.get(body.sessionId);
    if (controller && isTerminalCallAttemptStatus(body.status)) {
      controller.releasePermit(callAttemptId);
    }
    if (body.triggeredReconcile) {
      this.scheduleReconcile(body.sessionId);
    }
    return body;
  }

  private async drain(sessionId: string): Promise<void> {
    while (this.acceptingWork && this.queued.has(sessionId)) {
      this.queued.delete(sessionId);
      this.running.add(sessionId);
      try {
        await this.reconcileSession(sessionId);
      } finally {
        this.running.delete(sessionId);
      }
    }
  }

  private async launchReserved(
    controller: Controller,
    item: { callAttempt: { id: string }; contact: { id: string; phoneNumber: string } },
  ): Promise<void> {
    await controller.acquirePermitForAttempt(item.callAttempt.id);
    try {
      const result = await this.voiceProvider.createCall({
        sessionId: controller.sessionId,
        callAttemptId: item.callAttempt.id,
        contactId: item.contact.id,
        phoneNumber: item.contact.phoneNumber,
        statusCallbackUrl: `/calls/${item.callAttempt.id}/simulate`,
      });
      controller.setProviderCallId(item.callAttempt.id, result.providerCallId);
      await this.app.inject({
        method: "POST",
        url: `/calls/${item.callAttempt.id}/created`,
        payload: { providerCallId: result.providerCallId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "provider failure";
      await this.app.inject({
        method: "POST",
        url: `/calls/${item.callAttempt.id}/creation-failed`,
        payload: { errorCode: "PROVIDER_FAILURE", errorMessage: message },
      });
      controller.releasePermit(item.callAttempt.id);
      this.scheduleReconcile(controller.sessionId);
    }
  }

  private createController(sessionId: string, concurrencyLimit: number): Controller {
    const semaphore = new Semaphore(concurrencyLimit);
    const activeCalls = new Map<
      string,
      { releasePermit: (() => void) | null; permitReleased: boolean; providerCallId: string | null }
    >();

    return {
      sessionId,
      concurrencyLimit,
      semaphore,
      reconciliationMutex: new Mutex(),
      activeCalls,
      reconciliationPending: false,
      availablePermits() {
        return semaphore.getValue();
      },
      async acquirePermitForAttempt(callAttemptId: string) {
        const [, release] = await semaphore.acquire();
        const existing = activeCalls.get(callAttemptId);
        if (existing) {
          existing.releasePermit = release;
          existing.permitReleased = false;
        } else {
          activeCalls.set(callAttemptId, {
            releasePermit: release,
            permitReleased: false,
            providerCallId: null,
          });
        }
      },
      releasePermit(callAttemptId: string) {
        const state = activeCalls.get(callAttemptId);
        if (!state || state.permitReleased) return false;
        state.permitReleased = true;
        if (state.releasePermit) {
          state.releasePermit();
          state.releasePermit = null;
        }
        activeCalls.delete(callAttemptId);
        return true;
      },
      setProviderCallId(callAttemptId: string, providerCallId: string) {
        const state = activeCalls.get(callAttemptId);
        if (state) state.providerCallId = providerCallId;
      },
    };
  }
}
