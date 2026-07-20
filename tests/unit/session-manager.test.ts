import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { InMemorySessionManager } from "../../src/controllers/session-manager.js";
import type { DialingSession } from "../../src/domain/session.js";

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

describe("SessionManager", () => {
  it("prevents duplicate controller creation for the same session", async () => {
    const sessions = new Map([["s1", makeSession("s1")]]);

    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM dialing_sessions")) {
          const id = params?.[0] as string;
          const session = sessions.get(id);
          if (!session) return { rows: [], rowCount: 0 };
          return {
            rows: [
              {
                id: session.id,
                client_id: session.clientId,
                agent_id: session.agentId,
                status: session.status,
                concurrency_limit: session.concurrencyLimit,
                winning_call_attempt_id: session.winningCallAttemptId,
                auto_continue: session.autoContinue,
                state_version: session.stateVersion,
                created_at: session.createdAt,
                started_at: session.startedAt,
                paused_at: session.pausedAt,
                stopped_at: session.stoppedAt,
                completed_at: session.completedAt,
                updated_at: session.updatedAt,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM call_attempts")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("INSERT INTO dial_events")) {
          return {
            rows: [
              {
                id: "e1",
                session_id: params?.[0],
                call_attempt_id: null,
                event_type: params?.[2],
                payload: {},
                created_at: new Date(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const manager = new InMemorySessionManager(
      db as never,
      pino({ level: "silent" }),
    );

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
