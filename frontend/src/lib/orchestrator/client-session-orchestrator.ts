import {
  calculateLaunchCount,
  isTerminalCallAttemptStatus,
} from "../domain/statuses";
import type { CallAttemptStatus, DialingSession } from "../types";
import type { CallPlacer, ReservedClaim } from "./call-placer";
import type { ClientMockAutoSimulator } from "./client-mock-auto-simulator";
import type { ClientSessionController } from "./client-session-controller";
import { ClientSessionManager } from "./client-session-manager";
import { sessionClient } from "./session-client";

export type ClientOrchestratorOptions = {
  callPlacer: CallPlacer;
  autoSimulator?: ClientMockAutoSimulator | null;
  onChange?: () => void;
};

export class ClientSessionOrchestrator {
  private readonly sessionManager = new ClientSessionManager();
  private readonly running = new Set<string>();
  private readonly queued = new Set<string>();
  private acceptingWork = true;
  private readonly callPlacer: CallPlacer;
  private readonly autoSimulator: ClientMockAutoSimulator | null;
  private readonly onChange?: () => void;

  constructor(options: ClientOrchestratorOptions) {
    this.callPlacer = options.callPlacer;
    this.autoSimulator = options.autoSimulator ?? null;
    this.onChange = options.onChange;
  }

  getAutoSimulator(): ClientMockAutoSimulator | null {
    return this.autoSimulator;
  }

  stop(): void {
    this.acceptingWork = false;
    this.autoSimulator?.stopAll();
  }

  clear(): void {
    this.autoSimulator?.stopAll();
    this.sessionManager.clear();
    this.running.clear();
    this.queued.clear();
  }

  getController(sessionId: string) {
    return this.sessionManager.get(sessionId);
  }

  async hydrate(session: DialingSession, activeCallAttemptIds: string[]): Promise<void> {
    const controller = this.sessionManager.getOrCreate({
      sessionId: session.id,
      clientId: session.clientId,
      agentId: session.agentId,
      concurrencyLimit: session.concurrencyLimit,
      status: session.status,
    });

    for (const callAttemptId of activeCallAttemptIds) {
      if (!controller.activeCalls.has(callAttemptId)) {
        await controller.acquirePermitForRecovery(callAttemptId, null);
      }
    }

    if (session.status === "running") {
      this.scheduleReconcile(session.id);
    }
    this.notify();
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

  getReconcileState(sessionId: string): { running: boolean; queued: boolean } {
    return {
      running: this.running.has(sessionId),
      queued: this.queued.has(sessionId),
    };
  }

  cancelAutoSimulate(providerCallId: string | null | undefined): void {
    if (providerCallId) {
      this.autoSimulator?.cancel(providerCallId);
    }
  }

  async reportStatus(callAttemptId: string, status: CallAttemptStatus) {
    const result = await sessionClient.reportStatus(callAttemptId, status);
    const controller = this.sessionManager.get(result.sessionId);
    if (controller && isTerminalCallAttemptStatus(result.status)) {
      const active = controller.activeCalls.get(callAttemptId);
      this.cancelAutoSimulate(active?.providerCallId ?? result.providerCallId);
      controller.releasePermit(callAttemptId);
    }
    if (result.triggeredReconcile) {
      this.scheduleReconcile(result.sessionId);
    }
    if (result.winnerSelected && this.callPlacer.cancelNonWinners) {
      await this.callPlacer.cancelNonWinners(
        result.sessionId,
        result.winningCallAttemptId,
      );
    }
    this.notify();
    return result;
  }

  private async drain(sessionId: string): Promise<void> {
    while (this.acceptingWork && this.queued.has(sessionId)) {
      this.queued.delete(sessionId);
      this.running.add(sessionId);
      this.notify();
      try {
        await this.reconcileSession(sessionId);
      } finally {
        this.running.delete(sessionId);
        this.notify();
      }
    }
  }

  async reconcileSession(sessionId: string): Promise<void> {
    if (!this.acceptingWork) return;

    let session: DialingSession;
    try {
      session = await sessionClient.getSession(sessionId);
    } catch {
      return;
    }

    const controller = this.sessionManager.getOrCreate({
      sessionId: session.id,
      clientId: session.clientId,
      agentId: session.agentId,
      concurrencyLimit: session.concurrencyLimit,
      status: session.status,
    });

    controller.reconciliationPending = true;
    this.notify();

    try {
      const reserved = await controller.reconciliationMutex.runExclusive(async () => {
        const latest = await sessionClient.getSession(sessionId);
        controller.status = latest.status;
        if (latest.status !== "running") return [] as ReservedClaim[];

        const hint = await sessionClient.getReconcileHint(sessionId);
        const launchCount = calculateLaunchCount({
          concurrencyLimit: latest.concurrencyLimit,
          persistedActiveCount: hint.persistedActiveCount,
          locallyAvailablePermits: controller.availablePermits(),
        });
        if (launchCount <= 0) return [];

        const { claims } = await sessionClient.claim(sessionId, launchCount);
        return claims;
      });

      await Promise.allSettled(
        reserved.map((item) => this.launchReserved(controller, item)),
      );
    } finally {
      controller.reconciliationPending = false;
      this.notify();
    }
  }

  private async launchReserved(
    controller: ClientSessionController,
    item: ReservedClaim,
  ): Promise<void> {
    await controller.acquirePermitForAttempt(item.callAttempt.id);
    this.notify();
    try {
      const result = await this.callPlacer.createCall(item);
      controller.setProviderCallId(item.callAttempt.id, result.providerCallId);
      await sessionClient.markCallCreated(item.callAttempt.id, result.providerCallId);
      this.autoSimulator?.schedule(item.callAttempt.id, result.providerCallId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "provider failure";
      await sessionClient.markCallCreationFailed(item.callAttempt.id, {
        errorCode: "PROVIDER_FAILURE",
        errorMessage: message,
      });
      controller.releasePermit(item.callAttempt.id);
      this.scheduleReconcile(controller.sessionId);
    } finally {
      this.notify();
    }
  }

  private notify(): void {
    this.onChange?.();
  }
}
