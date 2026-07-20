import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  contactList,
  expectOk,
  setupTestApp,
  startSessionWithContacts,
  truncateDialerTables,
  uniqueClient,
  waitFor,
  type TestContext,
} from "../helpers/test-app.js";
import { migrate } from "../../src/database/migrate.js";
import { loadEnv, resetEnvCache } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";

describe("integration: dialer multi-session service", () => {
  let ctx: TestContext;
  let app: TestContext["app"];

  beforeAll(async () => {
    ctx = await setupTestApp();
    app = ctx.app;
  });

  beforeEach(async () => {
    ctx.provider.reset();
    await truncateDialerTables(ctx.db);
    app.services.sessionManager.clear();
  });

  afterAll(async () => {
    await app.close();
    await ctx.db.end();
  });

  it("1. migration replaces schema with required tables and indexes", async () => {
    resetEnvCache();
    const env = loadEnv({ NODE_ENV: "test" });
    const db = createPool(env.DATABASE_URL);
    await migrate(env.DATABASE_URL);

    const tables = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename IN ('dialing_sessions','dialing_contacts','call_attempts','dial_events')
       ORDER BY tablename`,
    );
    expect(tables.rows.map((r) => r.tablename)).toEqual([
      "call_attempts",
      "dial_events",
      "dialing_contacts",
      "dialing_sessions",
    ]);

    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('one_active_session_per_client','one_winner_per_session')`,
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual(["one_active_session_per_client"]);

    const autoContinueCol = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'dialing_sessions' AND column_name = 'auto_continue'`,
    );
    expect(autoContinueCol.rows).toHaveLength(1);

    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'call_attempts' AND column_name = 'permit_released'`,
    );
    expect(cols.rows).toHaveLength(1);
    await db.end();
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
    const sessionA = await startSessionWithContacts(app, {
      clientId: uniqueClient("A"),
      concurrencyLimit: 4,
      contacts: contactList(10),
    });
    const sessionB = await startSessionWithContacts(app, {
      clientId: uniqueClient("B"),
      concurrencyLimit: 3,
      contacts: contactList(10),
    });

    await waitFor(async () => {
      const a = app.services.sessionManager.get(sessionA);
      const b = app.services.sessionManager.get(sessionB);
      return Boolean(a && b && a.activeCalls.size === 4 && b.activeCalls.size === 3);
    });

    const controllerA = app.services.sessionManager.get(sessionA)!;
    const controllerB = app.services.sessionManager.get(sessionB)!;

    expect(controllerA.availablePermits()).toBe(0);
    expect(controllerB.availablePermits()).toBe(0);
    expect(controllerA.activeCalls.size).toBe(4);
    expect(controllerB.activeCalls.size).toBe(3);
    // Semaphores are distinct objects
    expect(controllerA.semaphore).not.toBe(controllerB.semaphore);

    const callsA = await app.inject({ method: "GET", url: `/sessions/${sessionA}/calls` });
    const callsB = await app.inject({ method: "GET", url: `/sessions/${sessionB}/calls` });
    const activeA = callsA
      .json<Array<{ status: string }>>()
      .filter((c) => ["creating", "queued", "initiated", "ringing", "in_progress"].includes(c.status));
    const activeB = callsB
      .json<Array<{ status: string }>>()
      .filter((c) => ["creating", "queued", "initiated", "ringing", "in_progress"].includes(c.status));
    expect(activeA.length).toBe(4);
    expect(activeB.length).toBe(3);
  });

  it("7-9. launches up to concurrency, never exceeds, claims in order", async () => {
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 3,
      contacts: contactList(8),
    });

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
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 2,
      contacts: contactList(5),
    });

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length >= 2;
    });

    await Promise.all([
      app.services.orchestrator.reconcileSession(sessionId),
      app.services.orchestrator.reconcileSession(sessionId),
      app.services.orchestrator.reconcileSession(sessionId),
    ]);

    const calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<unknown[]>();
    expect(calls.length).toBe(2);
  });

  it("11-13. terminal release frees capacity; duplicate terminal is safe", async () => {
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 1,
      contacts: contactList(3),
    });

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 1;
    });

    let calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string; permitReleased?: boolean }>>();
    const firstId = calls[0]!.id;

    const sim = await app.inject({
      method: "POST",
      url: `/calls/${firstId}/simulate`,
      payload: { status: "no_answer" },
    });
    expectOk(sim);

    // Duplicate terminal
    const dup = await app.inject({
      method: "POST",
      url: `/calls/${firstId}/simulate`,
      payload: { status: "no_answer" },
    });
    expectOk(dup);

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

    const controller = app.services.sessionManager.get(sessionId)!;
    expect(controller.availablePermits() + controller.activeCalls.size).toBe(
      controller.concurrencyLimit,
    );
  });

  it("14-17. concurrent answers produce one winner; loser disconnected; others canceled; no new launches", async () => {
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 3,
      contacts: contactList(10),
    });

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 3;
    });

    const calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string; providerCallId: string | null }>>();

    // Advance all to ringing first
    for (const call of calls) {
      await app.inject({
        method: "POST",
        url: `/calls/${call.id}/simulate`,
        payload: { status: "ringing" },
      });
    }

    const [a, b] = calls;
    const results = await Promise.all([
      app.inject({
        method: "POST",
        url: `/calls/${a!.id}/simulate`,
        payload: { status: "in_progress" },
      }),
      app.inject({
        method: "POST",
        url: `/calls/${b!.id}/simulate`,
        payload: { status: "in_progress" },
      }),
    ]);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);

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

    // Loser disconnect tracked on provider when they were in_progress
    expect(
      ctx.provider.disconnectRequests.length + ctx.provider.cancelRequests.length,
    ).toBeGreaterThan(0);

    const callCountBefore = after.length;
    await app.services.orchestrator.reconcileSession(sessionId);
    await new Promise((r) => setTimeout(r, 50));
    const callCountAfter = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<unknown[]>().length;
    expect(callCountAfter).toBe(callCountBefore);
  });

  it("18-19. pause stops launches; resume replenishes", async () => {
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 2,
      contacts: contactList(6),
    });

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

    const midCount = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<unknown[]>().length;

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

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length > midCount;
    });
  });

  it("20. stop is idempotent", async () => {
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 2,
      contacts: contactList(4),
    });

    await waitFor(async () => {
      return (app.services.sessionManager.get(sessionId)?.activeCalls.size ?? 0) > 0;
    });

    const first = await app.inject({ method: "POST", url: `/sessions/${sessionId}/stop` });
    expectOk(first);
    const second = await app.inject({ method: "POST", url: `/sessions/${sessionId}/stop` });
    expectOk(second);
    expect(second.json<{ status: string }>().status).toBe("stopped");
  });

  it("21. completed session controller is removed safely", async () => {
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 1,
      contacts: contactList(1),
    });

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 1;
    });

    const callId = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string }>>()[0]!.id;

    await app.inject({
      method: "POST",
      url: `/calls/${callId}/simulate`,
      payload: { status: "no_answer" },
    });

    await waitFor(async () => {
      const session = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
      return session.json<{ status: string }>().status === "completed";
    });

    await waitFor(() => !app.services.sessionManager.get(sessionId));
    expect(app.services.sessionManager.get(sessionId)).toBeUndefined();
  });

  it("22. running controller can be restored after registry clear", async () => {
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 2,
      contacts: contactList(5),
    });

    await waitFor(async () => {
      return (app.services.sessionManager.get(sessionId)?.activeCalls.size ?? 0) === 2;
    });

    app.services.sessionManager.clear();
    expect(app.services.sessionManager.get(sessionId)).toBeUndefined();

    const restored = await app.services.sessionManager.getOrCreate(sessionId);
    expect(restored.activeCalls.size).toBe(2);
    expect(restored.availablePermits()).toBe(0);
  });

  it("23-24. status polling returns version updates and 204 when unchanged", async () => {
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 1,
      contacts: contactList(2),
    });

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

    await app.inject({
      method: "POST",
      url: `/calls/${callId}/simulate`,
      payload: { status: "ringing" },
    });

    // bump via terminal to change state version on session when completed path...
    // ringing may not bump session state_version; start already did.
    // trigger pause to bump version
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
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 2,
      contacts: contactList(6),
      autoContinue: false,
    });

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 2;
    });

    const calls = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string }>>();

    await app.inject({
      method: "POST",
      url: `/calls/${calls[0]!.id}/simulate`,
      payload: { status: "in_progress" },
    });

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

    await app.inject({
      method: "POST",
      url: `/calls/${winnerId}/simulate`,
      payload: { status: "completed" },
    });

    const continued = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/start`,
    });
    expectOk(continued);
    expect(continued.json<{ status: string }>().status).toBe("running");

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
    const sessionId = await startSessionWithContacts(app, {
      clientId: uniqueClient(),
      concurrencyLimit: 2,
      contacts: contactList(6),
      autoContinue: true,
    });

    await waitFor(async () => {
      const calls = await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` });
      return calls.json<unknown[]>().length === 2;
    });

    const callId = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}/calls` })
    ).json<Array<{ id: string }>>()[0]!.id;

    await app.inject({
      method: "POST",
      url: `/calls/${callId}/simulate`,
      payload: { status: "in_progress" },
    });

    await waitFor(async () => {
      const session = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
      return session.json<{ status: string }>().status === "winner_selected";
    });

    const winnerId = (
      await app.inject({ method: "GET", url: `/sessions/${sessionId}` })
    ).json<{ winningCallAttemptId: string }>().winningCallAttemptId;

    await app.inject({
      method: "POST",
      url: `/calls/${winnerId}/simulate`,
      payload: { status: "completed" },
    });

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
