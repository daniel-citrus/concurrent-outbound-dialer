import { describe, expect, it } from "vitest";
import { SessionController } from "../../src/controllers/session-controller.js";

describe("SessionController semaphore", () => {
  it("acquires up to concurrency limit", async () => {
    const controller = new SessionController({
      sessionId: "s1",
      clientId: "c1",
      agentId: "a1",
      concurrencyLimit: 2,
      status: "running",
    });

    await controller.acquirePermitForAttempt("a");
    await controller.acquirePermitForAttempt("b");
    expect(controller.availablePermits()).toBe(0);
    expect(controller.activeCalls.size).toBe(2);
  });

  it("releases permits idempotently", async () => {
    const controller = new SessionController({
      sessionId: "s1",
      clientId: "c1",
      agentId: "a1",
      concurrencyLimit: 2,
      status: "running",
    });

    await controller.acquirePermitForAttempt("a");
    expect(controller.releasePermit("a")).toBe(true);
    expect(controller.releasePermit("a")).toBe(false);
    expect(controller.availablePermits()).toBe(2);
    expect(controller.activeCalls.has("a")).toBe(false);
  });

  it("isSafeToRemove requires terminal with no active work", async () => {
    const controller = new SessionController({
      sessionId: "s1",
      clientId: "c1",
      agentId: "a1",
      concurrencyLimit: 1,
      status: "completed",
    });
    expect(controller.isSafeToRemove(true)).toBe(true);

    await controller.acquirePermitForAttempt("a");
    expect(controller.isSafeToRemove(true)).toBe(false);
  });
});
