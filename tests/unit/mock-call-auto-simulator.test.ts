import { describe, expect, it, vi } from "vitest";
import { MockCallAutoSimulator } from "../../src/providers/mock-call-auto-simulator.js";
import type { CallAttemptStatus } from "../../src/domain/statuses.js";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("MockCallAutoSimulator", () => {
  it("emits initiated → ringing → non-answer when answer rate is 0", async () => {
    const emissions: Array<{ id: string; status: CallAttemptStatus }> = [];
    const timers: Array<() => void> = [];

    const simulator = new MockCallAutoSimulator({
      answerRate: 0,
      minStepMs: 10,
      maxStepMs: 10,
      noAnswerWeight: 1,
      busyWeight: 0,
      failedWeight: 0,
      random: () => 0,
      setTimeoutFn: ((fn: () => void) => {
        timers.push(fn as () => void);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    });

    simulator.setEmitter(async (id, status) => {
      emissions.push({ id, status });
    });

    simulator.schedule(
      {
        sessionId: "s",
        callAttemptId: "attempt-1",
        contactId: "c1",
        phoneNumber: "+14155550101",
        statusCallbackUrl: "http://localhost/simulate",
      },
      "mock_1",
    );

    // Flush three step delays: initiated, ringing, outcome
    for (let i = 0; i < 3; i++) {
      await flushMicrotasks();
      expect(timers.length).toBe(i + 1);
      timers[i]!();
      await flushMicrotasks();
    }

    expect(emissions.map((e) => e.status)).toEqual([
      "initiated",
      "ringing",
      "no_answer",
    ]);
    expect(simulator.pendingCount).toBe(0);
  });

  it("emits in_progress then completed when answer rate is 1", async () => {
    const emissions: CallAttemptStatus[] = [];
    const timers: Array<() => void> = [];

    const simulator = new MockCallAutoSimulator({
      answerRate: 1,
      minStepMs: 5,
      maxStepMs: 5,
      minTalkMs: 5,
      maxTalkMs: 5,
      random: () => 0,
      setTimeoutFn: ((fn: () => void) => {
        timers.push(fn as () => void);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    });

    simulator.setEmitter(async (_id, status) => {
      emissions.push(status);
    });

    simulator.schedule(
      {
        sessionId: "s",
        callAttemptId: "attempt-2",
        contactId: "c1",
        phoneNumber: "+14155550101",
        statusCallbackUrl: "http://localhost/simulate",
      },
      "mock_2",
    );

    // initiated, ringing, answer decision, talk → completed
    for (let i = 0; i < 4; i++) {
      await flushMicrotasks();
      expect(timers.length).toBe(i + 1);
      timers[i]!();
      await flushMicrotasks();
    }

    expect(emissions).toEqual(["initiated", "ringing", "in_progress", "completed"]);
  });

  it("stops emitting after cancel", async () => {
    const emissions: CallAttemptStatus[] = [];
    const timers: Array<() => void> = [];
    const clear = vi.fn();

    const simulator = new MockCallAutoSimulator({
      answerRate: 1,
      minStepMs: 5,
      maxStepMs: 5,
      minTalkMs: 5,
      maxTalkMs: 5,
      random: () => 0,
      setTimeoutFn: ((fn: () => void) => {
        timers.push(fn as () => void);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: clear as unknown as typeof clearTimeout,
    });

    simulator.setEmitter(async (_id, status) => {
      emissions.push(status);
    });

    simulator.schedule(
      {
        sessionId: "s",
        callAttemptId: "attempt-3",
        contactId: "c1",
        phoneNumber: "+14155550101",
        statusCallbackUrl: "http://localhost/simulate",
      },
      "mock_3",
    );

    await flushMicrotasks();
    timers[0]!();
    await flushMicrotasks();
    expect(emissions).toEqual(["initiated"]);

    simulator.cancel("mock_3");
    expect(clear).toHaveBeenCalled();

    for (const fn of timers.slice(1)) {
      fn();
      await flushMicrotasks();
    }

    expect(emissions).toEqual(["initiated"]);
    expect(simulator.pendingCount).toBe(0);
  });

  it("skips scheduling while disabled and cancels pending on disable", async () => {
    const emissions: CallAttemptStatus[] = [];
    const timers: Array<() => void> = [];

    const simulator = new MockCallAutoSimulator({
      answerRate: 1,
      minStepMs: 5,
      maxStepMs: 5,
      random: () => 0,
      setTimeoutFn: ((fn: () => void) => {
        timers.push(fn as () => void);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    });

    simulator.setEmitter(async (_id, status) => {
      emissions.push(status);
    });

    simulator.setEnabled(false);
    expect(simulator.isEnabled()).toBe(false);

    simulator.schedule(
      {
        sessionId: "s",
        callAttemptId: "attempt-4",
        contactId: "c1",
        phoneNumber: "+14155550101",
        statusCallbackUrl: "http://localhost/simulate",
      },
      "mock_4",
    );
    await flushMicrotasks();
    expect(timers).toHaveLength(0);
    expect(emissions).toEqual([]);

    simulator.setEnabled(true);
    simulator.schedule(
      {
        sessionId: "s",
        callAttemptId: "attempt-5",
        contactId: "c1",
        phoneNumber: "+14155550101",
        statusCallbackUrl: "http://localhost/simulate",
      },
      "mock_5",
    );
    await flushMicrotasks();
    expect(timers).toHaveLength(1);

    simulator.setEnabled(false);
    expect(simulator.pendingCount).toBe(0);
  });

  it("updates config at runtime for subsequent schedules", () => {
    const simulator = new MockCallAutoSimulator({ answerRate: 0.1 });
    expect(simulator.getConfig().answerRate).toBe(0.1);
    simulator.configure({ answerRate: 0.9, minStepMs: 100, maxStepMs: 50 });
    const config = simulator.getConfig();
    expect(config.answerRate).toBe(0.9);
    // max is raised to at least min
    expect(config.minStepMs).toBe(100);
    expect(config.maxStepMs).toBe(100);
  });
});
