import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { createPool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Apply SQL files in migrations/ using a direct Postgres connection.
 * Requires DATABASE_URL (not used by the Fastify runtime).
 *
 * For hosted Supabase: paste migrations into the SQL editor, or:
 *   DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-....pooler.supabase.com:5432/postgres npm run db:migrate
 */
export async function migrate(databaseUrl?: string): Promise<void> {
  const env = loadEnv();
  const url = databaseUrl ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for db:migrate (runtime API uses SUPABASE_URL + service role instead)",
    );
  }
  const pool = createPool(url);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.resolve(__dirname, "../../migrations");
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const existing = await pool.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [file]);
      if ((existing.rowCount ?? 0) > 0) {
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [file]);
      } finally {
        client.release();
      }
      console.log(`Applied migration ${file}`);
    }
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  migrate().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
