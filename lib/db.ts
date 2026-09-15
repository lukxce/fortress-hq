import { Pool, type QueryResultRow } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Cached on globalThis, not module scope: Next's dev-mode module reloading
// would otherwise open a new pool on every hot reload until the DB refuses.
declare global {
  var __fortressPool: Pool | undefined;
  var __fortressMigrated: Promise<void> | undefined;
}

function pool(): Pool {
  if (!globalThis.__fortressPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local and add your Vercel Postgres connection string."
      );
    }
    globalThis.__fortressPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      // Let the connection string's own sslmode drive verification. Neon and
      // Vercel Postgres present valid public certificates, so there is no
      // reason to pass rejectUnauthorized:false and turn verification off.
      ssl: /[?&]sslmode=/.test(connectionString)
        ? undefined
        : connectionString.includes("localhost")
          ? undefined
          : { rejectUnauthorized: true },
    });
  }
  return globalThis.__fortressPool;
}

/** Applies any migration files not yet recorded. Runs at most once per process. */
export function migrate(): Promise<void> {
  globalThis.__fortressMigrated ??= (async () => {
    const p = pool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const dir = path.join(process.cwd(), "lib", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    const { rows } = await p.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), "utf8");
      const client = await p.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[db] applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
  })();
  return globalThis.__fortressMigrated;
}

/** Parameterised query. Always migrates first so a cold start is self-healing. */
export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  await migrate();
  const { rows } = await pool().query<T>(text, params);
  return rows;
}

/** Single row, or null. */
export async function q1<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/** Runs a function inside a transaction. */
export async function tx<T>(fn: (run: typeof q) => Promise<T>): Promise<T> {
  await migrate();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const scoped = (async <R extends QueryResultRow>(text: string, params: unknown[] = []) => {
      const { rows } = await client.query<R>(text, params);
      return rows;
    }) as typeof q;
    const out = await fn(scoped);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** True if a DATABASE_URL is configured and reachable. */
export async function dbReady(): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.DATABASE_URL) return { ok: false, error: "DATABASE_URL is not set" };
  try {
    await q("SELECT 1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
