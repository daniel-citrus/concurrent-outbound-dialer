import { describe, expect, it } from "vitest";
import {
  ACTIVE_CALL_ATTEMPT_STATUSES,
  calculateLaunchCount,
  cancelActionForStatus,
  canContinueSession,
  canPauseSession,
  canResumeSession,
  canStartSession,
  canStopSession,
  evaluateCallAttemptTransition,
  isActiveCallAttemptStatus,
  isTerminalCallAttemptStatus,
  SIMULATABLE_CALL_STATUSES,
} from "../../src/domain/statuses.js";

describe("session transitions", () => {
  it("allows start from created or paused", () => {
    expect(canStartSession("created")).toBe(true);
    expect(canStartSession("paused")).toBe(true);
    expect(canStartSession("running")).toBe(false);
    expect(canStartSession("completed")).toBe(false);
  });

  it("allows pause only from running", () => {
    expect(canPauseSession("running")).toBe(true);
    expect(canPauseSession("paused")).toBe(false);
  });

  it("allows resume only from paused", () => {
    expect(canResumeSession("paused")).toBe(true);
    expect(canResumeSession("running")).toBe(false);
  });

  it("allows stop from active non-terminal statuses", () => {
    expect(canStopSession("running")).toBe(true);
    expect(canStopSession("winner_selected")).toBe(true);
    expect(canStopSession("completed")).toBe(false);
  });

  it("allows continue only from winner_selected", () => {
    expect(canContinueSession("winner_selected")).toBe(true);
    expect(canContinueSession("running")).toBe(false);
    expect(canContinueSession("paused")).toBe(false);
    expect(canContinueSession("completed")).toBe(false);
  });
});

describe("call attempt transitions", () => {
  it("classifies active and terminal statuses", () => {
    expect(isActiveCallAttemptStatus("ringing")).toBe(true);
    expect(isActiveCallAttemptStatus("completed")).toBe(false);
    expect(isTerminalCallAttemptStatus("busy")).toBe(true);
    expect(isTerminalCallAttemptStatus("creating")).toBe(false);
  });

  it("treats duplicate statuses as no-ops", () => {
    expect(evaluateCallAttemptTransition("ringing", "ringing")).toEqual({
      kind: "duplicate",
    });
  });

  it("prevents terminal to active regression", () => {
    const result = evaluateCallAttemptTransition("completed", "ringing");
    expect(result.kind).toBe("reject");
  });

  it("allows ringing to in_progress", () => {
    expect(evaluateCallAttemptTransition("ringing", "in_progress")).toEqual({
      kind: "apply",
      to: "in_progress",
    });
  });

  it("rejects terminal to different terminal", () => {
    expect(evaluateCallAttemptTransition("busy", "failed").kind).toBe("reject");
  });
});

describe("status list contracts mirrored by the frontend", () => {
  it("keeps active call statuses stable for the visualizer", () => {
    expect([...ACTIVE_CALL_ATTEMPT_STATUSES]).toEqual([
      "creating",
      "queued",
      "initiated",
      "ringing",
      "in_progress",
    ]);
  });

  it("includes unknown among simulatable statuses", () => {
    expect(SIMULATABLE_CALL_STATUSES).toContain("unknown");
    expect([...SIMULATABLE_CALL_STATUSES]).toEqual([
      "queued",
      "initiated",
      "ringing",
      "in_progress",
      "completed",
      "busy",
      "failed",
      "no_answer",
      "canceled",
      "unknown",
    ]);
  });
});

describe("capacity calculation", () => {
  it("uses the minimum of database and local permits", () => {
    expect(
      calculateLaunchCount({
        concurrencyLimit: 4,
        persistedActiveCount: 2,
        locallyAvailablePermits: 3,
      }),
    ).toBe(2);

    expect(
      calculateLaunchCount({
        concurrencyLimit: 4,
        persistedActiveCount: 0,
        locallyAvailablePermits: 1,
      }),
    ).toBe(1);

    expect(
      calculateLaunchCount({
        concurrencyLimit: 4,
        persistedActiveCount: 4,
        locallyAvailablePermits: 4,
      }),
    ).toBe(0);
  });
});

describe("cancellation operation selection", () => {
  it("maps statuses to cancel/disconnect/cleanup", () => {
    expect(cancelActionForStatus("creating")).toBe("cleanup_pending");
    expect(cancelActionForStatus("queued")).toBe("cancel");
    expect(cancelActionForStatus("initiated")).toBe("cancel");
    expect(cancelActionForStatus("ringing")).toBe("cancel");
    expect(cancelActionForStatus("in_progress")).toBe("disconnect");
    expect(cancelActionForStatus("completed")).toBe("none");
  });
});
