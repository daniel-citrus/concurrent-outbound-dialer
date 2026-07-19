import pg from "pg";
import type { Env } from "../config/env.js";

const { Pool } = pg;

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;

let pool: DbPool | undefined;

export function createPool(databaseUrl: string): DbPool {
  return new Pool({
    connectionString: databaseUrl,
    max: 20,
  });
}

export function getPool(env: Env): DbPool {
  if (!pool) {
    pool = createPool(env.DATABASE_URL);
  }
  return pool;
}

export function setPool(next: DbPool | undefined): void {
  pool = next;
}

export async function withTransaction<T>(
  db: DbPool,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
