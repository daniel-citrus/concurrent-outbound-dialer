import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { InMemorySessionManager } from "../../src/controllers/session-manager.js";
import type { DialingSession } from "../../src/domain/session.js";
import type { DialerSupabase } from "../../src/database/supabase.js";

function makeSession(id: string): DialingSession {
  return {
    id,
    clientId: "client-a",
    agentId: "agent-a",
    status: "running",
    concurrencyLimit: 3,
    winningCallAttemptId: null,
    autoContinue: false,
    stateVersion: 1,
    createdAt: new Date(),
    startedAt: new Date(),
    pausedAt: null,
    stoppedAt: null,
    completedAt: null,
    updatedAt: new Date(),
  };
}

function mockSupabase(session: DialingSession): DialerSupabase {
  const sessionRow = {
    id: session.id,
    client_id: session.clientId,
    agent_id: session.agentId,
    status: session.status,
    concurrency_limit: session.concurrencyLimit,
    winning_call_attempt_id: session.winningCallAttemptId,
    auto_continue: session.autoContinue,
    state_version: session.stateVersion,
    created_at: session.createdAt.toISOString(),
    started_at: session.startedAt?.toISOString() ?? null,
    paused_at: null,
    stopped_at: null,
    completed_at: null,
    updated_at: session.updatedAt.toISOString(),
  };

  const from = vi.fn((table: string) => {
    if (table === "dialing_sessions") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: sessionRow, error: null }),
          }),
        }),
      };
    }
    if (table === "call_attempts") {
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              order: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      };
    }
    if (table === "dial_events") {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: {
                id: "e1",
                session_id: session.id,
                call_attempt_id: null,
                event_type: "controller_created",
                payload: {},
                created_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { from } as unknown as DialerSupabase;
}

describe("SessionManager", () => {
  it("prevents duplicate controller creation for the same session", async () => {
    const session = makeSession("s1");
    const db = mockSupabase(session);

    const manager = new InMemorySessionManager(db, pino({ level: "silent" }));

    const [a, b] = await Promise.all([
      manager.getOrCreate("s1"),
      manager.getOrCreate("s1"),
    ]);

    expect(a).toBe(b);
    expect(manager.listActiveControllers()).toHaveLength(1);
    expect(a.concurrencyLimit).toBe(3);
    expect(a.availablePermits()).toBe(3);
  });
});
