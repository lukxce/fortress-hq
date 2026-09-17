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
    // pg treats prefer/require/verify-ca as verify-full today and warns about it
    // on every start; say verify-full outright so the warning does not mask real errors.
    const connectionString = process.env.DATABASE_URL?.trim()?.replace(/sslmode=(prefer|require|verify-ca)\b/, "sslmode=verify-full");
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

/**
 * Runs a function inside a transaction.
 *
 * Single-row INSERT … VALUES statements are buffered and sent as one multi-row
 * statement. Sync jobs insert thousands of rows one statement at a time, and
 * against a hosted database every statement is a network round trip: a Search
 * Console pull of 10,000 rows took the whole 300-second function budget. The
 * buffer is flushed before any other statement and before COMMIT, so ordering
 * is preserved. INSERTs with RETURNING are never buffered, because their caller
 * needs the result. If a batch is rejected — two rows updating the same key in
 * one statement is the realistic case — that batch is replayed row by row.
 */
export async function tx<T>(fn: (run: typeof q) => Promise<T>): Promise<T> {
  await migrate();
  const client = await pool().connect();
  let buffer: { template: string; head: string; tail: string; rows: unknown[][] } | null = null;

  const exec = async <R extends QueryResultRow>(text: string, params: unknown[] = []) =>
    (await client.query<R>(text, params)).rows;

  const flush = async () => {
    if (!buffer || !buffer.rows.length) { buffer = null; return; }
    const { head, template, tail, rows } = buffer;
    buffer = null;
    const width = rows[0].length;
    const per = Math.max(1, Math.min(1000, Math.floor(60000 / Math.max(1, width))));
    for (let i = 0; i < rows.length; i += per) {
      const chunk = rows.slice(i, i + per);
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((r, j) => {
        values.push(`(${template.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + j * width}`)})`);
        params.push(...r);
      });
      await client.query("SAVEPOINT bulk");
      try {
        await client.query(`${head} VALUES ${values.join(",")} ${tail}`, params);
        await client.query("RELEASE SAVEPOINT bulk");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT bulk");
        for (const r of chunk) await client.query(`${head} VALUES (${template}) ${tail}`, r);
      }
    }
  };

  try {
    await client.query("BEGIN");
    const scoped = (async <R extends QueryResultRow>(text: string, params: unknown[] = []) => {
      const parts = splitInsert(text);
      if (parts && params.length) {
        const key = `${parts.head}|${parts.template}|${parts.tail}`;
        if (buffer && `${buffer.head}|${buffer.template}|${buffer.tail}` !== key) await flush();
        buffer ??= { ...parts, rows: [] };
        buffer.rows.push(params);
        if (buffer.rows.length >= 2000) await flush();
        return [] as R[];
      }
      await flush();
      return exec<R>(text, params);
    }) as typeof q;
    const out = await fn(scoped);
    await flush();
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Splits a single-row INSERT … VALUES (…) … into its parts, or null if it is not one. */
function splitInsert(text: string): { head: string; template: string; tail: string } | null {
  if (!/^\s*INSERT\s+INTO\b/i.test(text) || /\bRETURNING\b/i.test(text)) return null;
  const m = /\bVALUES\s*\(/i.exec(text);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0, close = -1, quoted = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'") quoted = !quoted;
    if (quoted) continue;
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) { close = i; break; }
  }
  if (close < 0) return null;
  const tail = text.slice(close + 1);
  if (/\bVALUES\b/i.test(tail) || tail.includes(";")) return null;
  return { head: text.slice(0, m.index).trimEnd(), template: text.slice(open + 1, close), tail };
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
