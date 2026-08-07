import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  contactList,
  expectOk,
  hasSupabaseEnv,
  setupTestApp,
  startSessionWithContacts,
  truncateDialerTables,
  uniqueClient,
  waitFor,
  type TestContext,
} from "../helpers/test-app.js";

const describeIntegration = hasSupabaseEnv() ? describe : describe.skip;

describeIntegration("integration: dialer multi-session service", () => {
  let ctx: TestContext;
  let app: TestContext["app"];
  let orch: TestContext["orch"];

  beforeAll(async () => {
    ctx = await setupTestApp();
    app = ctx.app;
    orch = ctx.orch;
  });

  beforeEach(async () => {
    ctx.provider.reset();
    orch.clear();
    await truncateDialerTables(ctx.db);
    app.services.sessionManager.clear();
  });

  afterAll(async () => {
    orch.stop();
    await app.close();
  });

  it("1. dialer RPCs are available on Supabase", async () => {
    const { data, error } = await ctx.db.rpc("dialer_reconcile_hint", {
      p_session_id: "00000000-0000-0000-0000-000000000000",
    });
    // null data is fine (session missing); function must exist
    expect(error).toBeNull();
    expect(data).toBeNull();

    const { error: truncErr } = await ctx.db.rpc("dialer_test_truncate");
    expect(truncErr).toBeNull();
  });

  it("2. creates session and ordered contacts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        clientId: uniqueClient(),
        agentId: "agent-a",
        concurrencyLimit: 2,
        contacts: contactList(3),
      },
    });
    expectOk(res, 201);
    const body = res.json<{ id: string; status: string }>();
    expect(body.status).toBe("created");

    const contacts = await app.inject({
      method: "GET",
      url: `/sessions/${body.id}/contacts`,
    });
    expectOk(contacts);
    const list = contacts.json<Array<{ position: number; externalContactId: string }>>();
    expect(list.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(list.map((c) => c.externalContactId)).toEqual([
      "contact-1",
      "contact-2",
      "contact-3",
    ]);
  });

  it("3. rejects a second active session for the same client", async () => {
    const clientId = uniqueClient();
    const first = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        clientId,
        agentId: "a1",
        concurrencyLimit: 2,
        contacts: contactList(1),
      },
    });
    expectOk(first, 201);

    const second = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        clientId,
        agentId: "a2",
        concurrencyLimit: 2,
        contacts: contactList(1),
      },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe(
      "DUPLICATE_ACTIVE_CLIENT_SESSION",
    );
  });

  it("4-6. different clients run simultaneously with independent semaphores", async () => {
    const sessionA = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient("A"),
        concurrencyLimit: 4,
        contacts: contactList(10),
      },
      orch,
    );
    const sessionB = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient("B"),
        concurrencyLimit: 3,
        contacts: contactList(10),
      },
      orch,
    );

    await waitFor(async () => {
      const a = orch.get(sessionA);
      const b = orch.get(sessionB);
      return Boolean(a && b && a.activeCalls.size === 4 && b.activeCalls.size === 3);
    });

    const controllerA = orch.get(sessionA)!;
    const controllerB = orch.get(sessionB)!;

    expect(controllerA.availablePermits()).toBe(0);
    expect(controllerB.availablePermits()).toBe(0);
    expect(controllerA.activeCalls.size).toBe(4);
    expect(controllerB.activeCalls.size).toBe(3);
    expect(controllerA.semaphore).not.toBe(controllerB.semaphore);

    const callsA = await app.inject({ method: "GET", url: `/sessions/${sessionA}/calls` });
    const callsB = await app.inject({ method: "GET", url: `/sessions/${sessionB}/calls` });
    const activeA = callsA
      .json<Array<{ status: string }>>()
      .filter((c) =>
        ["creating", "queued", "initiated", "ringing", "in_progress"].includes(c.status),
      );
    const activeB = callsB
      .json<Array<{ status: string }>>()
      .filter((c) =>
        ["creating", "queued", "initiated", "ringing", "in_progress"].includes(c.status),
      );
    expect(activeA.length).toBe(4);
    expect(activeB.length).toBe(3);
  });

  it("7-9. launches up to concurrency, never exceeds, claims in order", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 3,
        contacts: contactList(8),
      },
      orch,
    );

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 3;
    });

    const calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ contactId: string; status: string }>>();
    expect(calls.length).toBeLessThanOrEqual(3);

    const contacts = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/contacts` })
    ).json<Array<{ id: string; position: number; status: string }>>();

    const dialing = contacts
      .filter((c) => c.status === "dialing" || c.status === "claimed")
      .sort((a, b) => a.position - b.position);
    expect(dialing.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it("10. duplicate reconciliation does not duplicate contacts", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 2,
        contacts: contactList(5),
      },
      orch,
    );

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length >= 2;
    });

    await Promise.all([
      orch.reconcileSession(sessionId),
      orch.reconcileSession(sessionId),
      orch.reconcileSession(sessionId),
    ]);

    const calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<unknown[]>();
    expect(calls.length).toBe(2);
  });

  it("11-13. terminal release frees capacity; duplicate terminal is safe", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 1,
        contacts: contactList(3),
      },
      orch,
    );

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 1;
    });

    let calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string; permitReleased?: boolean }>>();
    const firstId = calls[0]!.id;

    await orch.reportStatus(firstId, "no_answer");
    await orch.reportStatus(firstId, "no_answer");

    await waitFor(async () => {
      const next = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return next.json<unknown[]>().length === 2;
    });

    calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string; permitReleased?: boolean }>>();
    expect(calls.length).toBe(2);
    const first = calls.find((c) => c.id === firstId)!;
    expect(first.permitReleased).toBe(true);

    const controller = orch.get(sessionId)!;
    expect(controller.availablePermits() + controller.activeCalls.size).toBe(
      controller.concurrencyLimit,
    );
  });

  it("14-17. concurrent answers produce one winner; loser disconnected; others canceled; no new launches", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 3,
        contacts: contactList(10),
      },
      orch,
    );

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 3;
    });

    const calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string; providerCallId: string | null }>>();

    for (const call of calls) {
      await orch.reportStatus(call.id, "ringing");
    }

    const [a, b] = calls;
    await Promise.all([
      orch.reportStatus(a!.id, "in_progress"),
      orch.reportStatus(b!.id, "in_progress"),
    ]);

    await waitFor(async () => {
      const session = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
      return session.json<{ status: string }>().status === "winner_selected";
    });

    const session = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}` })
    ).json<{ winningCallAttemptId: string | null; status: string }>();
    expect(session.status).toBe("winner_selected");
    expect(session.winningCallAttemptId).toBeTruthy();

    await waitFor(async () => {
      const after = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      const list = after.json<Array<{ id: string; status: string; isWinner: boolean }>>();
      const winners = list.filter((c) => c.isWinner);
      return winners.length === 1;
    });

    const after = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string; status: string; isWinner: boolean }>>();
    expect(after.filter((c) => c.isWinner)).toHaveLength(1);

    const winnerId = session.winningCallAttemptId!;
    const losers = after.filter((c) => c.id !== winnerId);
    expect(losers.every((c) => c.status === "canceled" || c.isWinner)).toBe(true);

    expect(
      ctx.provider.disconnectRequests.length + ctx.provider.cancelRequests.length,
    ).toBeGreaterThan(0);

    const callCountBefore = after.length;
    await orch.reconcileSession(sessionId);
    await new Promise((r) => setTimeout(r, 50));
    const callCountAfter = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<unknown[]>().length;
    expect(callCountAfter).toBe(callCountBefore);
  });

  it("18-19. pause stops launches; resume replenishes", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 2,
        contacts: contactList(6),
      },
      orch,
    );

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 2;
    });

    const paused = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/pause`,
    });
    expectOk(paused);
    expect(paused.json<{ status: string }>().status).toBe("paused");

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      const list = calls.json<Array<{ status: string }>>();
      return list.every((c) =>
        ["canceled", "completed", "busy", "failed", "no_answer"].includes(c.status),
      );
    });

    // Release local permits for canceled calls so resume capacity is accurate.
    const canceled = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string; status: string }>>();
    for (const call of canceled) {
      if (["canceled", "completed", "busy", "failed", "no_answer"].includes(call.status)) {
        orch.get(sessionId)?.releasePermit(call.id);
      }
    }

    const midCount = canceled.length;

    await new Promise((r) => setTimeout(r, 80));
    const still = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<unknown[]>().length;
    expect(still).toBe(midCount);

    const resumed = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/resume`,
    });
    expectOk(resumed);
    orch.scheduleReconcile(sessionId);

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length > midCount;
    });
  });

  it("20. stop is idempotent", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 2,
        contacts: contactList(4),
      },
      orch,
    );

    await waitFor(async () => {
      return (orch.get(sessionId)?.activeCalls.size ?? 0) > 0;
    });

    const first = await app.inject({ method: "POST", url: `/sessions/${sessionId}/stop` });
    expectOk(first);
    const second = await app.inject({ method: "POST", url: `/sessions/${sessionId}/stop` });
    expectOk(second);
    expect(second.json<{ status: string }>().status).toBe("stopped");
  });

  it("21. completed session finishes when queue exhausted", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 1,
        contacts: contactList(1),
      },
      orch,
    );

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 1;
    });

    const callId = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string }>>()[0]!.id;

    await orch.reportStatus(callId, "no_answer");

    await waitFor(async () => {
      const session = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
      return session.json<{ status: string }>().status === "completed";
    });
  });

  it("22. client controller can be restored after clear", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 2,
        contacts: contactList(5),
      },
      orch,
    );

    await waitFor(async () => {
      return (orch.get(sessionId)?.activeCalls.size ?? 0) === 2;
    });

    orch.clear();
    expect(orch.get(sessionId)).toBeUndefined();

    const restored = await orch.ensure(sessionId);
    expect(restored.activeCalls.size).toBe(2);
    expect(restored.availablePermits()).toBe(0);
  });

  it("23-24. status polling returns version updates and 204 when unchanged", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 1,
        contacts: contactList(2),
      },
      orch,
    );

    const status1 = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/status`,
    });
    expectOk(status1);
    const snap = status1.json<{ stateVersion: number }>();
    expect(snap.stateVersion).toBeGreaterThan(0);

    const none = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/status?afterVersion=${snap.stateVersion}`,
    });
    expect(none.statusCode).toBe(204);

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 1;
    });
    const callId = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string }>>()[0]!.id;

    await orch.reportStatus(callId, "ringing");

    await app.inject({ method: "POST", url: `/sessions/${sessionId}/pause` });

    const status2 = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/status?afterVersion=${snap.stateVersion}`,
    });
    expectOk(status2);
    expect(status2.json<{ stateVersion: number }>().stateVersion).toBeGreaterThan(
      snap.stateVersion,
    );
  });

  it("25. manual Start after winner resumes dialing when queue remains", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 2,
        contacts: contactList(6),
        autoContinue: false,
      },
      orch,
    );

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 2;
    });

    const calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string }>>();

    await orch.reportStatus(calls[0]!.id, "in_progress");

    await waitFor(async () => {
      const session = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
      return session.json<{ status: string }>().status === "winner_selected";
    });

    const blocked = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/start`,
    });
    expect(blocked.statusCode).toBe(409);

    const winnerId = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}` })
    ).json<{ winningCallAttemptId: string }>().winningCallAttemptId;

    await orch.reportStatus(winnerId, "completed");

    const continued = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/start`,
    });
    expectOk(continued);
    expect(continued.json<{ status: string }>().status).toBe("running");
    orch.scheduleReconcile(sessionId);

    await waitFor(async () => {
      const callsAfter = await app.inject({
        method: "GET",
        url: `/sessions/${sessionId}/calls`,
      });
      return callsAfter.json<unknown[]>().length > 2;
    });

    const allCalls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string; isWinner: boolean }>>();
    expect(allCalls.filter((c) => c.isWinner)).toHaveLength(1);
  });

  it("26. auto-continue resumes dialing after winning call ends", async () => {
    const sessionId = await startSessionWithContacts(
      app,
      {
        clientId: uniqueClient(),
        concurrencyLimit: 2,
        contacts: contactList(6),
        autoContinue: true,
      },
      orch,
    );

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 2;
    });

    const callId = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string }>>()[0]!.id;

    await orch.reportStatus(callId, "in_progress");

    await waitFor(async () => {
      const session = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
      return session.json<{ status: string }>().status === "winner_selected";
    });

    const winnerId = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}` })
    ).json<{ winningCallAttemptId: string }>().winningCallAttemptId;

    await orch.reportStatus(winnerId, "completed");

    await waitFor(async () => {
      const session = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
      return session.json<{ status: string }>().status === "running";
    });

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length > 2;
    });
  });
});
