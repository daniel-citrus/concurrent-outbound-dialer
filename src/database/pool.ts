/**
 * Optional direct Postgres pool — only for `npm run db:migrate`.
 * Runtime API uses Supabase RPC via `@supabase/supabase-js` (see supabase.ts).
 */
import pg from "pg";

const { Pool } = pg;

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;

export function createPool(databaseUrl: string): DbPool {
  return new Pool({
    connectionString: databaseUrl,
    max: 5,
  });
}
