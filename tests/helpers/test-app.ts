import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { loadEnv, resetEnvCache, resolveSupabaseCredentials } from "../../src/config/env.js";
import { createDialerSupabase, type DialerSupabase } from "../../src/database/supabase.js";
import { buildApp } from "../../src/app.js";
import { MockVoiceProvider } from "../../src/providers/mock-voice-provider.js";
import { TestClientOrchestrator } from "./test-orchestrator.js";
import type { CallAttemptStatus } from "../../src/domain/statuses.js";

export type TestContext = {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: DialerSupabase;
  provider: MockVoiceProvider;
  orch: TestClientOrchestrator;
};

let sharedDb: DialerSupabase | undefined;

export function hasSupabaseEnv(): boolean {
  try {
    resetEnvCache();
    const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    resolveSupabaseCredentials(env);
    return true;
  } catch {
    return false;
  }
}

export async function setupTestApp(): Promise<TestContext> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Integration tests require SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY " +
        "(or NEBULA_SUPABASE_URL + NEBULA_SUPABASE_SERVICE_ROLE_KEY). " +
        "Apply migrations/001 and migrations/002 to that project first.",
    );
  }

  resetEnvCache();
  const env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MOCK_PROVIDER_DELAY_MS: "0",
    MOCK_PROVIDER_FAILURE_RATE: "0",
    SERVICE_API_KEY: "",
  });
  const creds = resolveSupabaseCredentials(env);

  if (!sharedDb) {
    sharedDb = createDialerSupabase(creds.url, creds.serviceRoleKey);
  }

  await truncateDialerTables(sharedDb);

  const provider = new MockVoiceProvider({ delayMs: 0, failureRate: 0 });
  const app = await buildApp({
    env,
    db: sharedDb,
    voiceProvider: provider,
    runRecovery: false,
  });
  await app.ready();

  const orch = new TestClientOrchestrator(app, provider);
  return { app, db: sharedDb, provider, orch };
}

export async function truncateDialerTables(db: DialerSupabase): Promise<void> {
  const { error } = await db.rpc("dialer_test_truncate");
  if (error) {
    throw new Error(
      `dialer_test_truncate failed (apply migrations/002_dialer_supabase_rpcs.sql): ${error.message}`,
    );
  }
}

export function uniqueClient(prefix = "client"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export function contactList(count: number, start = 1) {
  return Array.from({ length: count }, (_, i) => {
    const n = start + i;
    const suffix = String(1000 + n).slice(-4);
    return {
      externalContactId: `contact-${n}`,
      phoneNumber: `+1415555${suffix}`,
    };
  });
}

export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 25;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timed out");
}

export async function startSessionWithContacts(
  app: TestContext["app"],
  opts: {
    clientId: string;
    agentId?: string;
    concurrencyLimit: number;
    contacts: ReturnType<typeof contactList>;
    autoContinue?: boolean;
    start?: boolean;
  },
  orch?: TestClientOrchestrator,
) {
  const created = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      clientId: opts.clientId,
      agentId: opts.agentId ?? "agent-1",
      concurrencyLimit: opts.concurrencyLimit,
      contacts: opts.contacts,
      autoContinue: opts.autoContinue,
    },
  });
  expectOk(created, 201);
  const body = created.json<{ id: string }>();

  if (opts.start === false) {
    return body.id;
  }

  const started = await app.inject({
    method: "POST",
    url: `/sessions/${body.id}/start`,
  });
  expectOk(started, 200);

  if (orch) {
    await orch.ensure(body.id);
    orch.scheduleReconcile(body.id);
  }

  return body.id;
}

export async function simulateStatus(
  orch: TestClientOrchestrator,
  callAttemptId: string,
  status: CallAttemptStatus,
) {
  return orch.reportStatus(callAttemptId, status);
}

export function expectOk(
  response: { statusCode: number; body: string },
  status = 200,
): void {
  if (response.statusCode !== status) {
    throw new Error(
      `Expected ${status} but got ${response.statusCode}: ${response.body}`,
    );
  }
}

export function registerDbHooks(): void {
  beforeAll(async () => {
    if (!hasSupabaseEnv()) {
      throw new Error(
        "Skip/require SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for integration hooks",
      );
    }
    resetEnvCache();
    const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const creds = resolveSupabaseCredentials(env);
    sharedDb = createDialerSupabase(creds.url, creds.serviceRoleKey);
  });

  beforeEach(async () => {
    if (sharedDb) await truncateDialerTables(sharedDb);
  });

  afterAll(async () => {
    sharedDb = undefined;
  });
}
