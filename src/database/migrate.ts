import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv } from "../config/env.js";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(databaseUrl?: string): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({ connectionString: databaseUrl ?? env.DATABASE_URL });

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
        // Migration files may include their own BEGIN/COMMIT.
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
