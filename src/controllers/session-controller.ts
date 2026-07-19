import { Mutex, Semaphore } from "async-mutex";
import type { SessionStatus } from "../domain/statuses.js";

export type ActiveCallRuntimeState = {
  callAttemptId: string;
  providerCallId: string | null;
  releasePermit: (() => void) | null;
  permitReleased: boolean;
};

export type SessionControllerInit = {
  sessionId: string;
  clientId: string;
  agentId: string;
  concurrencyLimit: number;
  status: SessionStatus;
};

export class SessionController {
  readonly sessionId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly concurrencyLimit: number;
  readonly semaphore: Semaphore;
  readonly reconciliationMutex: Mutex;
  readonly activeCalls: Map<string, ActiveCallRuntimeState>;
  status: SessionStatus;
  reconciliationPending = false;

  constructor(init: SessionControllerInit) {
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

  /**
   * Acquire a permit without waiting forever — used during recovery when
   * we know permits should be available for persisted active attempts.
   */
  async acquirePermitForRecovery(callAttemptId: string, providerCallId: string | null): Promise<void> {
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

  /** Idempotent local permit release. Returns true if a permit was released. */
  releasePermit(callAttemptId: string): boolean {
    const state = this.activeCalls.get(callAttemptId);
    if (!state) {
      return false;
    }
    if (state.permitReleased) {
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

  hasActiveWork(): boolean {
    return this.activeCalls.size > 0 || this.occupiedPermits() > 0 || this.reconciliationMutex.isLocked();
  }

  isSafeToRemove(terminal: boolean): boolean {
    return (
      terminal &&
      this.activeCalls.size === 0 &&
      this.occupiedPermits() === 0 &&
      !this.reconciliationMutex.isLocked() &&
      !this.reconciliationPending
    );
  }
}
