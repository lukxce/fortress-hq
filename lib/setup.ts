import { dbReady } from "@/lib/db";
import { encryptionReady } from "@/lib/crypto";
import { oauthConfigured, activeConnection, redirectUri } from "@/lib/google/auth";
import { productAccess, type ProductAccess } from "@/lib/google/scopes";
import { passwordConfigured } from "@/lib/session";

export type Check = {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
  fix?: string;
};

export type Setup = {
  checks: Check[];
  ready: boolean;          // env is configured
  connected: boolean;      // a live Google connection exists
  email: string | null;
  access: ProductAccess[]; // what that connection can actually reach
};

/** What the app needs before it can do anything, and what is missing. */
export async function setupStatus(): Promise<Setup> {
  const checks: Check[] = [];

  const db = await dbReady();
  checks.push({
    key: "db",
    label: "Database",
    ok: db.ok,
    detail: db.ok ? "connected" : db.error,
    fix: "Create a Vercel Postgres database and put its connection string in DATABASE_URL.",
  });

  const enc = encryptionReady();
  checks.push({
    key: "crypto",
    label: "Encryption key",
    ok: enc,
    detail: enc ? "32-byte key loaded" : "ENCRYPTION_KEY missing or wrong length",
    fix: "Generate one with: openssl rand -hex 32",
  });

  const oauth = oauthConfigured();
  checks.push({
    key: "oauth",
    label: "Google OAuth client",
    ok: oauth,
    detail: oauth ? "client configured" : "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing",
    fix: `Create a Web application client in Cloud Console with redirect URI exactly ${redirectUri()}`,
  });

  const pw = passwordConfigured();
  checks.push({
    key: "password",
    label: "App password",
    ok: pw,
    detail: pw ? "gate active" : "APP_PASSWORD missing or under 8 characters",
    fix: "A deployed URL with no lock is open to anyone who finds it. Set APP_PASSWORD.",
  });

  const ready = checks.every((c) => c.ok);

  let connected = false;
  let email: string | null = null;
  let access: ProductAccess[] = productAccess([]);
  if (ready) {
    const conn = await activeConnection();
    connected = Boolean(conn);
    email = conn?.google_email ?? null;
    if (conn) access = productAccess(conn.scopes ?? []);
  }

  return { checks, ready, connected, email, access };
}
