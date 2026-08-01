import { Mutex, Semaphore } from "async-mutex";
import type { CallAttemptStatus, SessionStatus } from "../types";

export type ActiveCallRuntimeState = {
  callAttemptId: string;
  providerCallId: string | null;
  releasePermit: (() => void) | null;
  permitReleased: boolean;
};

export type ClientSessionControllerInit = {
  sessionId: string;
  clientId: string;
  agentId: string;
  concurrencyLimit: number;
  status: SessionStatus;
};

export class ClientSessionController {
  readonly sessionId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly concurrencyLimit: number;
  readonly semaphore: Semaphore;
  readonly reconciliationMutex: Mutex;
  readonly activeCalls: Map<string, ActiveCallRuntimeState>;
  status: SessionStatus;
  reconciliationPending = false;

  constructor(init: ClientSessionControllerInit) {
    this.sessionId = init.sessionId;
    this.clientId = init.clientId;
    this.agentId = init.agentId;
    this.concurrencyLimit = init.concurrencyLimit;
    this.status = init.status;
    this.semaphore = new Semaphore(init.concurrencyLimit);
    this.reconciliationMutex = new Mutex();
    this.activeCalls = new Map();
  }

  availablePermits(): number {
    return this.semaphore.getValue();
  }

  occupiedPermits(): number {
    return this.concurrencyLimit - this.availablePermits();
  }

  semaphoreWaiterCount(): number {
    const internal = this.semaphore as unknown as { _queue?: unknown[] };
    return internal._queue?.length ?? 0;
  }

  async acquirePermitForAttempt(callAttemptId: string): Promise<void> {
    const [, release] = await this.semaphore.acquire();
    const existing = this.activeCalls.get(callAttemptId);
    if (existing) {
      existing.releasePermit = release;
      existing.permitReleased = false;
    } else {
      this.activeCalls.set(callAttemptId, {
        callAttemptId,
        providerCallId: null,
        releasePermit: release,
        permitReleased: false,
      });
    }
  }

  async acquirePermitForRecovery(
    callAttemptId: string,
    providerCallId: string | null,
  ): Promise<void> {
    const [, release] = await this.semaphore.acquire();
    this.activeCalls.set(callAttemptId, {
      callAttemptId,
      providerCallId,
      releasePermit: release,
      permitReleased: false,
    });
  }

  setProviderCallId(callAttemptId: string, providerCallId: string): void {
    const state = this.activeCalls.get(callAttemptId);
    if (state) {
      state.providerCallId = providerCallId;
    }
  }

  releasePermit(callAttemptId: string): boolean {
    const state = this.activeCalls.get(callAttemptId);
    if (!state || state.permitReleased) {
      return false;
    }
    state.permitReleased = true;
    if (state.releasePermit) {
      state.releasePermit();
      state.releasePermit = null;
    }
    this.activeCalls.delete(callAttemptId);
    return true;
  }

  toRuntimeSnapshot(sessionStatus: SessionStatus) {
    return {
      sessionId: this.sessionId,
      sessionStatus,
      concurrencyLimit: this.concurrencyLimit,
      controllerPresent: true,
      semaphore: {
        capacity: this.concurrencyLimit,
        availablePermits: this.availablePermits(),
        occupiedPermits: this.occupiedPermits(),
        waiters: this.semaphoreWaiterCount(),
      },
      mutex: {
        locked: this.reconciliationMutex.isLocked(),
        resource: "reconciliation" as const,
      },
      orchestrator: {
        reconcileRunning: false,
        reconcileQueued: false,
      },
      reconciliationPending: this.reconciliationPending,
      resources: [...this.activeCalls.values()].map((state) => ({
        callAttemptId: state.callAttemptId,
        providerCallId: state.providerCallId,
        permitReleased: state.permitReleased,
        contactId: null as string | null,
        phoneNumber: null as string | null,
        callStatus: null as CallAttemptStatus | null,
      })),
    };
  }
}
