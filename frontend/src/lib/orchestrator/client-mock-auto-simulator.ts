import type { CallAttemptStatus } from "../types";
import { isTerminalCallAttemptStatus } from "../domain/statuses";

export type StatusEmitter = (
  callAttemptId: string,
  status: CallAttemptStatus,
) => Promise<unknown>;

export type ClientMockAutoSimulateConfig = {
  answerRate: number;
  minStepMs: number;
  maxStepMs: number;
  minTalkMs: number;
  maxTalkMs: number;
  busyWeight: number;
  failedWeight: number;
  noAnswerWeight: number;
};

type PendingCall = {
  callAttemptId: string;
  providerCallId: string;
  canceled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export const CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS: ClientMockAutoSimulateConfig = {
  answerRate: 0.11,
  minStepMs: 400,
  maxStepMs: 2_000,
  minTalkMs: 1_500,
  maxTalkMs: 6_000,
  busyWeight: 2,
  failedWeight: 1,
  noAnswerWeight: 7,
};

/**
 * Browser-side stand-in for server MockCallAutoSimulator.
 * Emits via report-status so the client orchestrator can refill concurrency.
 */
export class ClientMockAutoSimulator {
  private emitter: StatusEmitter | null = null;
  private enabled = true;
  private readonly pendingByProviderId = new Map<string, PendingCall>();
  private config: ClientMockAutoSimulateConfig;

  constructor(config: Partial<ClientMockAutoSimulateConfig> = {}) {
    this.config = normalizeConfig(config);
  }

  setEmitter(emitter: StatusEmitter | null): void {
    this.emitter = emitter;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAll();
    }
  }

  getConfig(): ClientMockAutoSimulateConfig {
    return { ...this.config };
  }

  getDefaults(): ClientMockAutoSimulateConfig {
    return { ...CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS };
  }

  configure(patch: Partial<ClientMockAutoSimulateConfig>): ClientMockAutoSimulateConfig {
    this.config = normalizeConfig({ ...this.config, ...patch });
    return this.getConfig();
  }

  resetConfig(): ClientMockAutoSimulateConfig {
    this.config = normalizeConfig({});
    return this.getConfig();
  }

  schedule(callAttemptId: string, providerCallId: string): void {
    if (!this.enabled) {
      return;
    }
    this.cancel(providerCallId);

    const pending: PendingCall = {
      callAttemptId,
      providerCallId,
      canceled: false,
      timer: null,
    };
    this.pendingByProviderId.set(providerCallId, pending);

    void this.runLifecycle(pending).catch(() => {
      this.pendingByProviderId.delete(providerCallId);
    });
  }

  cancel(providerCallId: string): void {
    const pending = this.pendingByProviderId.get(providerCallId);
    if (!pending) return;
    pending.canceled = true;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    this.pendingByProviderId.delete(providerCallId);
  }

  stopAll(): void {
    for (const providerCallId of [...this.pendingByProviderId.keys()]) {
      this.cancel(providerCallId);
    }
  }

  private async runLifecycle(pending: PendingCall): Promise<void> {
    // Attempt is already queued after /created.
    for (const status of ["initiated", "ringing"] as const) {
      await this.delay(pending, this.randomBetween(this.config.minStepMs, this.config.maxStepMs));
      if (pending.canceled) return;
      await this.emit(pending, status);
    }

    await this.delay(pending, this.randomBetween(this.config.minStepMs, this.config.maxStepMs));
    if (pending.canceled) return;

    const answered = Math.random() < this.config.answerRate;
    if (answered) {
      await this.emit(pending, "in_progress");
      await this.delay(pending, this.randomBetween(this.config.minTalkMs, this.config.maxTalkMs));
      if (pending.canceled) return;
      await this.emit(pending, "completed");
      return;
    }

    await this.emit(pending, this.pickNonAnswerOutcome());
  }

  private async emit(pending: PendingCall, status: CallAttemptStatus): Promise<void> {
    if (pending.canceled) return;
    const emitter = this.emitter;
    if (!emitter) return;

    try {
      await emitter(pending.callAttemptId, status);
    } catch {
      pending.canceled = true;
      this.pendingByProviderId.delete(pending.providerCallId);
      return;
    }

    if (isTerminalCallAttemptStatus(status)) {
      this.pendingByProviderId.delete(pending.providerCallId);
    }
  }

  private pickNonAnswerOutcome(): CallAttemptStatus {
    const { busyWeight, failedWeight, noAnswerWeight } = this.config;
    const total = busyWeight + failedWeight + noAnswerWeight;
    if (total <= 0) return "no_answer";
    let roll = Math.random() * total;
    if (roll < busyWeight) return "busy";
    roll -= busyWeight;
    if (roll < failedWeight) return "failed";
    return "no_answer";
  }

  private randomBetween(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  private delay(pending: PendingCall, ms: number): Promise<void> {
    if (pending.canceled || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      pending.timer = setTimeout(() => {
        pending.timer = null;
        resolve();
      }, ms);
    });
  }
}

function normalizeConfig(
  input: Partial<ClientMockAutoSimulateConfig>,
): ClientMockAutoSimulateConfig {
  const answerRate = clamp01(input.answerRate ?? CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS.answerRate);
  const minStepMs = Math.max(
    0,
    Math.floor(input.minStepMs ?? CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS.minStepMs),
  );
  const maxStepMs = Math.max(
    minStepMs,
    Math.floor(input.maxStepMs ?? CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS.maxStepMs),
  );
  const minTalkMs = Math.max(
    0,
    Math.floor(input.minTalkMs ?? CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS.minTalkMs),
  );
  const maxTalkMs = Math.max(
    minTalkMs,
    Math.floor(input.maxTalkMs ?? CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS.maxTalkMs),
  );
  return {
    answerRate,
    minStepMs,
    maxStepMs,
    minTalkMs,
    maxTalkMs,
    busyWeight: Math.max(0, input.busyWeight ?? CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS.busyWeight),
    failedWeight: Math.max(0, input.failedWeight ?? CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS.failedWeight),
    noAnswerWeight: Math.max(
      0,
      input.noAnswerWeight ?? CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS.noAnswerWeight,
    ),
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
