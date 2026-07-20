import type { Logger } from "pino";
import type { CallAttemptStatus } from "../domain/statuses.js";
import { isTerminalCallAttemptStatus } from "../domain/statuses.js";
import type { CreateCallInput } from "./voice-provider.js";

export type StatusEmitter = (
  callAttemptId: string,
  status: CallAttemptStatus,
) => Promise<unknown>;

export type MockCallAutoSimulatorConfig = {
  answerRate: number;
  minStepMs: number;
  maxStepMs: number;
  minTalkMs: number;
  maxTalkMs: number;
  /** Weights for non-answer terminal outcomes (normalized at runtime). */
  busyWeight: number;
  failedWeight: number;
  noAnswerWeight: number;
};

export type MockCallAutoSimulatorOptions = Partial<MockCallAutoSimulatorConfig> & {
  random?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  logger?: Logger;
};

type PendingCall = {
  callAttemptId: string;
  providerCallId: string;
  canceled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export const MOCK_AUTO_SIMULATE_DEFAULTS: MockCallAutoSimulatorConfig = {
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
 * Schedules Twilio-like status progressions for mock calls so the visualizer
 * can run without manual /simulate clicks.
 */
export class MockCallAutoSimulator {
  private emitter: StatusEmitter | null = null;
  private enabled = true;
  private readonly pendingByProviderId = new Map<string, PendingCall>();
  private config: MockCallAutoSimulatorConfig;
  private readonly random: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly logger: Logger | undefined;

  constructor(options: MockCallAutoSimulatorOptions = {}) {
    this.config = normalizeConfig(options);
    this.random = options.random ?? Math.random;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.logger = options.logger;
  }

  setEmitter(emitter: StatusEmitter | null): void {
    this.emitter = emitter;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Pause/resume scheduling. Disabling cancels in-flight auto progressions. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAll();
    }
  }

  getConfig(): MockCallAutoSimulatorConfig {
    return { ...this.config };
  }

  /** Update timing/outcome knobs. Applies to newly scheduled steps immediately. */
  configure(patch: Partial<MockCallAutoSimulatorConfig>): MockCallAutoSimulatorConfig {
    this.config = normalizeConfig({ ...this.config, ...patch });
    return this.getConfig();
  }

  /** Begin a random status progression after the provider creates a call. */
  schedule(input: CreateCallInput, providerCallId: string): void {
    if (!this.enabled) {
      return;
    }
    this.cancel(providerCallId);

    const pending: PendingCall = {
      callAttemptId: input.callAttemptId,
      providerCallId,
      canceled: false,
      timer: null,
    };
    this.pendingByProviderId.set(providerCallId, pending);

    void this.runLifecycle(pending).catch((error) => {
      this.logger?.warn(
        { err: error, callAttemptId: pending.callAttemptId, providerCallId },
        "mock auto-simulate lifecycle failed",
      );
    });
  }

  /** Stop further status emissions (cancel / disconnect). */
  cancel(providerCallId: string): void {
    const pending = this.pendingByProviderId.get(providerCallId);
    if (!pending) return;
    pending.canceled = true;
    if (pending.timer) {
      this.clearTimeoutFn(pending.timer);
      pending.timer = null;
    }
    this.pendingByProviderId.delete(providerCallId);
  }

  stopAll(): void {
    for (const providerCallId of [...this.pendingByProviderId.keys()]) {
      this.cancel(providerCallId);
    }
  }

  get pendingCount(): number {
    return this.pendingByProviderId.size;
  }

  private async runLifecycle(pending: PendingCall): Promise<void> {
    // Orchestrator already marks the attempt queued after createCall returns.
    const earlySteps: CallAttemptStatus[] = ["initiated", "ringing"];
    for (const status of earlySteps) {
      const { minStepMs, maxStepMs } = this.config;
      await this.delay(pending, this.randomBetween(minStepMs, maxStepMs));
      if (pending.canceled) return;
      await this.emit(pending, status);
    }

    {
      const { minStepMs, maxStepMs } = this.config;
      await this.delay(pending, this.randomBetween(minStepMs, maxStepMs));
    }
    if (pending.canceled) return;

    const answered = this.random() < this.config.answerRate;
    if (answered) {
      await this.emit(pending, "in_progress");
      const { minTalkMs, maxTalkMs } = this.config;
      await this.delay(pending, this.randomBetween(minTalkMs, maxTalkMs));
      if (pending.canceled) return;
      await this.emit(pending, "completed");
      return;
    }

    await this.emit(pending, this.pickNonAnswerOutcome());
  }

  private async emit(pending: PendingCall, status: CallAttemptStatus): Promise<void> {
    if (pending.canceled) return;
    const emitter = this.emitter;
    if (!emitter) {
      this.logger?.warn(
        { callAttemptId: pending.callAttemptId, status },
        "mock auto-simulate skipped; emitter not configured",
      );
      return;
    }

    try {
      await emitter(pending.callAttemptId, status);
    } catch (error) {
      this.logger?.warn(
        {
          err: error,
          callAttemptId: pending.callAttemptId,
          providerCallId: pending.providerCallId,
          status,
        },
        "mock auto-simulate status emission failed",
      );
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
    if (total <= 0) {
      return "no_answer";
    }
    let roll = this.random() * total;
    if (roll < busyWeight) return "busy";
    roll -= busyWeight;
    if (roll < failedWeight) return "failed";
    return "no_answer";
  }

  private randomBetween(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(min + this.random() * (max - min + 1));
  }

  private delay(pending: PendingCall, ms: number): Promise<void> {
    if (pending.canceled) return Promise.resolve();
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      pending.timer = this.setTimeoutFn(() => {
        pending.timer = null;
        resolve();
      }, ms);
    });
  }
}

export function normalizeConfig(
  input: Partial<MockCallAutoSimulatorConfig>,
): MockCallAutoSimulatorConfig {
  const answerRate = clamp01(input.answerRate ?? MOCK_AUTO_SIMULATE_DEFAULTS.answerRate);
  const minStepMs = Math.max(0, Math.floor(input.minStepMs ?? MOCK_AUTO_SIMULATE_DEFAULTS.minStepMs));
  const maxStepMs = Math.max(
    minStepMs,
    Math.floor(input.maxStepMs ?? MOCK_AUTO_SIMULATE_DEFAULTS.maxStepMs),
  );
  const minTalkMs = Math.max(0, Math.floor(input.minTalkMs ?? MOCK_AUTO_SIMULATE_DEFAULTS.minTalkMs));
  const maxTalkMs = Math.max(
    minTalkMs,
    Math.floor(input.maxTalkMs ?? MOCK_AUTO_SIMULATE_DEFAULTS.maxTalkMs),
  );
  return {
    answerRate,
    minStepMs,
    maxStepMs,
    minTalkMs,
    maxTalkMs,
    busyWeight: Math.max(0, input.busyWeight ?? MOCK_AUTO_SIMULATE_DEFAULTS.busyWeight),
    failedWeight: Math.max(0, input.failedWeight ?? MOCK_AUTO_SIMULATE_DEFAULTS.failedWeight),
    noAnswerWeight: Math.max(0, input.noAnswerWeight ?? MOCK_AUTO_SIMULATE_DEFAULTS.noAnswerWeight),
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
