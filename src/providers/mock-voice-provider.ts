import { randomUUID } from "node:crypto";
import type {
  CreateCallInput,
  CreateCallResult,
  VoiceProvider,
} from "./voice-provider.js";
import { providerFailure } from "../domain/errors.js";
import type { MockCallAutoSimulator } from "./mock-call-auto-simulator.js";

export type MockVoiceProviderOptions = {
  delayMs?: number;
  failureRate?: number;
  /** Deterministic failure for specific attempt IDs (tests). */
  failAttemptIds?: Set<string>;
  /** When set, schedules random status progressions after createCall. */
  autoSimulator?: MockCallAutoSimulator | null;
};

export type MockProviderCallRecord = {
  providerCallId: string;
  input: CreateCallInput;
  createdAt: Date;
  canceled: boolean;
  disconnected: boolean;
};

export class MockVoiceProvider implements VoiceProvider {
  readonly createdCalls: MockProviderCallRecord[] = [];
  readonly cancelRequests: string[] = [];
  readonly disconnectRequests: string[] = [];

  private delayMs: number;
  private failureRate: number;
  private failAttemptIds: Set<string>;
  private autoSimulator: MockCallAutoSimulator | null;

  constructor(options: MockVoiceProviderOptions = {}) {
    this.delayMs = options.delayMs ?? 0;
    this.failureRate = options.failureRate ?? 0;
    this.failAttemptIds = options.failAttemptIds ?? new Set();
    this.autoSimulator = options.autoSimulator ?? null;
  }

  configure(options: MockVoiceProviderOptions): void {
    if (options.delayMs !== undefined) this.delayMs = options.delayMs;
    if (options.failureRate !== undefined) this.failureRate = options.failureRate;
    if (options.failAttemptIds !== undefined) this.failAttemptIds = options.failAttemptIds;
    if (options.autoSimulator !== undefined) this.autoSimulator = options.autoSimulator;
  }

  getAutoSimulator(): MockCallAutoSimulator | null {
    return this.autoSimulator;
  }

  async createCall(input: CreateCallInput): Promise<CreateCallResult> {
    if (this.delayMs > 0) {
      await sleep(this.delayMs);
    }

    if (
      this.failAttemptIds.has(input.callAttemptId) ||
      (this.failureRate > 0 && Math.random() < this.failureRate)
    ) {
      throw providerFailure("Mock voice provider failed to create call");
    }

    const providerCallId = `mock_${randomUUID()}`;
    this.createdCalls.push({
      providerCallId,
      input,
      createdAt: new Date(),
      canceled: false,
      disconnected: false,
    });

    this.autoSimulator?.schedule(input, providerCallId);

    return { providerCallId, status: "queued" };
  }

  async cancelCall(providerCallId: string): Promise<void> {
    if (this.delayMs > 0) {
      await sleep(this.delayMs);
    }
    this.autoSimulator?.cancel(providerCallId);
    this.cancelRequests.push(providerCallId);
    const record = this.createdCalls.find((c) => c.providerCallId === providerCallId);
    if (record) {
      record.canceled = true;
    }
  }

  async disconnectCall(providerCallId: string): Promise<void> {
    if (this.delayMs > 0) {
      await sleep(this.delayMs);
    }
    this.autoSimulator?.cancel(providerCallId);
    this.disconnectRequests.push(providerCallId);
    const record = this.createdCalls.find((c) => c.providerCallId === providerCallId);
    if (record) {
      record.disconnected = true;
    }
  }

  reset(): void {
    this.autoSimulator?.stopAll();
    this.createdCalls.length = 0;
    this.cancelRequests.length = 0;
    this.disconnectRequests.length = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
