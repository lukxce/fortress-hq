// The gate.
//
// Today: one shared password, one installation. Deliberately contained in this
// one module so that swapping it for a real identity provider (Auth.js, Clerk,
// Neon Auth) is a rewrite of this file and the login route, not of the app.
// The schema already carries users, connections.user_id, clients.owner_id and
// client_access (migration 002) — all nullable, so multi-user is a backfill
// rather than a restructure.
//
// Without this, anyone who finds the URL can connect a Google account, read
// every figure in the database and toggle what gets imported. Vercel gives a
// public URL by default, so the app locks its own front door.
//
// Web Crypto only: this runs in middleware (edge runtime) as well as in route
// handlers, and node:crypto is not available in the former.

const COOKIE = "fortress_session";
const MAX_AGE_DAYS = 30;

function secret(): string {
  // Reuses the encryption key rather than inventing a second secret to lose.
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY is not set");
  return k;
}

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Buffer.from(new Uint8Array(sig)).toString("base64url");
}

/** Constant-time string compare. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A token carrying its own issue time, so it can expire without a store. */
export async function issueToken(): Promise<string> {
  const ts = Date.now().toString(36);
  return `${ts}.${await hmac(`session:v1:${ts}`)}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [ts, sig] = token.split(".");
  if (!ts || !sig) return false;

  const issued = parseInt(ts, 36);
  if (!Number.isFinite(issued)) return false;
  if (Date.now() - issued > MAX_AGE_DAYS * 864e5) return false;

  return safeEqual(sig, await hmac(`session:v1:${ts}`));
}

export async function checkPassword(given: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  // Hash both sides so the comparison length never leaks the real length.
  return safeEqual(await hmac(`pw:${given}`), await hmac(`pw:${expected}`));
}

/** True when no password is configured — the app then refuses to serve. */
export function passwordConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.APP_PASSWORD.length >= 8);
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = MAX_AGE_DAYS * 24 * 60 * 60;
