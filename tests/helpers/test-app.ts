import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { loadEnv, resetEnvCache } from "../../src/config/env.js";
import { createPool, type DbPool } from "../../src/database/pool.js";
import { migrate } from "../../src/database/migrate.js";
import { buildApp } from "../../src/app.js";
import { MockVoiceProvider } from "../../src/providers/mock-voice-provider.js";

export type TestContext = {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: DbPool;
  provider: MockVoiceProvider;
};

let sharedDb: DbPool | undefined;

export async function setupTestApp(): Promise<TestContext> {
  resetEnvCache();
  const env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MOCK_PROVIDER_DELAY_MS: "0",
    MOCK_PROVIDER_FAILURE_RATE: "0",
    SERVICE_API_KEY: "",
  });

  if (!sharedDb) {
    sharedDb = createPool(env.DATABASE_URL);
    await migrate(env.DATABASE_URL);
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

  return { app, db: sharedDb, provider };
}

export async function truncateDialerTables(db: DbPool): Promise<void> {
  await db.query(`
    TRUNCATE dial_events, call_attempts, dialing_contacts, dialing_sessions
    RESTART IDENTITY CASCADE
  `);
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
  },
) {
  const created = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      clientId: opts.clientId,
      agentId: opts.agentId ?? "agent-1",
      concurrencyLimit: opts.concurrencyLimit,
      contacts: opts.contacts,
    },
  });
  expectOk(created, 201);
  const body = created.json<{ id: string }>();

  const started = await app.inject({
    method: "POST",
    url: `/sessions/${body.id}/start`,
  });
  expectOk(started, 200);
  return body.id;
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
    resetEnvCache();
    const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    sharedDb = createPool(env.DATABASE_URL);
    await migrate(env.DATABASE_URL);
  });

  beforeEach(async () => {
    if (sharedDb) await truncateDialerTables(sharedDb);
  });

  afterAll(async () => {
    if (sharedDb) {
      await sharedDb.end();
      sharedDb = undefined;
    }
  });
}
