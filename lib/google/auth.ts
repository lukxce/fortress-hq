import { OAuth2Client } from "google-auth-library";
import { q, q1 } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { SCOPES } from "./scopes";

export type Connection = {
  id: number;
  kind: "user_oauth" | "service_account";
  google_email: string | null;
  refresh_token_enc: string | null;
  scopes: string[];
  status: "active" | "invalid" | "revoked";
  last_error: string | null;
  last_used_at: string | null;
};

export function redirectUri(): string {
  // Server-side only, deliberately not NEXT_PUBLIC_: nothing in the browser
  // needs it, and a plain server variable is read at runtime rather than baked
  // in at build time.
  //
  // ?? only catches undefined, and an env var declared-but-empty is "" — which
  // silently produced a redirect URI with no origin at all.
  const configured = process.env.APP_URL?.trim();
  const base = configured || "http://localhost:3020";
  return `${base.replace(/\/+$/, "")}/api/auth/google/callback`;
}

/**
 * Credentials, whitespace-stripped.
 *
 * Pasting a value into a hosting dashboard very easily carries a trailing
 * newline, and Google then reports "OAuth client was not found" — an error that
 * points at the client rather than at the invisible character actually causing
 * it. Nothing legitimate in these values has surrounding whitespace, so strip it.
 */
function clientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
}

function clientSecret(): string | undefined {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined;
}

export function oauthConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

function baseClient(): OAuth2Client {
  if (!oauthConfigured()) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Create a Web application OAuth client in Cloud Console."
    );
  }
  return new OAuth2Client({
    clientId: clientId(),
    clientSecret: clientSecret(),
    redirectUri: redirectUri(),
  });
}

/** Consent URL. offline + consent are both required to get a refresh token. */
export function authUrl(state: string): string {
  return baseClient().generateAuthUrl({
    access_type: "offline",
    // Both matter, and for different reasons. "consent" forces the consent
    // screen, which is what makes Google return a refresh token rather than
    // only an access token. "select_account" forces the account chooser —
    // without it, anyone already signed in to one Google account is taken
    // straight into it, with no way to authorise a different one.
    prompt: "select_account consent",
    include_granted_scopes: true,
    scope: [...SCOPES],
    state,
  });
}

/** Exchanges the callback code and stores the connection. Returns its id. */
export async function completeAuth(code: string): Promise<number> {
  const client = baseClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google returned no refresh token. Revoke this app at myaccount.google.com/permissions and try again."
    );
  }

  let email: string | null = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId(),
    });
    email = ticket.getPayload()?.email ?? null;
  }

  const granted = (tokens.scope ?? "").split(" ").filter(Boolean);

  // One connection per Google account: re-authorising replaces the token.
  const existing = email
    ? await q1<{ id: number }>(
        "SELECT id FROM connections WHERE google_email = $1 AND kind = 'user_oauth'",
        [email]
      )
    : null;

  // Whose consent this is. With an identity provider that is the signed-in
  // person; without one, the Google address itself is the only identity the
  // installation has, so it seeds a user. Either way the connection ends up
  // owned, which is what keeps a second operator from inheriting it.
  const userId = await ownerFor(email);

  if (existing) {
    await q(
      `UPDATE connections
          SET refresh_token_enc = $2, scopes = $3, status = 'active',
              last_error = NULL, last_used_at = now(),
              user_id = COALESCE(user_id, $4)
        WHERE id = $1`,
      [existing.id, encrypt(tokens.refresh_token), granted, userId]
    );
    return existing.id;
  }

  const row = await q1<{ id: number }>(
    `INSERT INTO connections (kind, google_email, refresh_token_enc, scopes, user_id, last_used_at)
     VALUES ('user_oauth', $1, $2, $3, $4, now())
     RETURNING id`,
    [email, encrypt(tokens.refresh_token), granted, userId]
  );
  return row!.id;
}

/**
 * The user a new connection belongs to.
 *
 * Prefers the signed-in identity. Falling back to the Google address matters
 * on a fresh single-operator install, where nobody has signed in as anybody
 * and the first authorisation is what creates user one.
 */
async function ownerFor(email: string | null): Promise<number | null> {
  const { currentUser } = await import("@/lib/user");
  const who = await currentUser();
  if (who) return who.id;
  if (!email) return null;
  const seeded = await q1<{ id: number }>(
    `INSERT INTO users (email, name, role) VALUES ($1, $1, 'owner')
     ON CONFLICT (email) DO UPDATE SET last_seen_at = now()
     RETURNING id`,
    [email]
  );
  return seeded?.id ?? null;
}

/** An authorised client for a stored connection. Throws AuthExpiredError if dead. */
export class AuthExpiredError extends Error {
  constructor(public connectionId: number, message: string) {
    super(message);
    this.name = "AuthExpiredError";
  }
}

export async function clientFor(connectionId: number): Promise<OAuth2Client> {
  const conn = await q1<Connection>("SELECT * FROM connections WHERE id = $1", [connectionId]);
  if (!conn) throw new Error(`No connection ${connectionId}`);
  if (!conn.refresh_token_enc) throw new Error(`Connection ${connectionId} has no stored token`);

  const client = baseClient();
  client.setCredentials({ refresh_token: decrypt(conn.refresh_token_enc) });

  try {
    await client.getAccessToken();
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // invalid_grant means the token is genuinely dead: revoked, password
    // changed, or unused for six months. This is a first-class state, not a
    // sync failure — the UI must say "reconnect", not "something went wrong".
    const dead = /invalid_grant/i.test(msg);
    await q(
      "UPDATE connections SET status = $2, last_error = $3 WHERE id = $1",
      [connectionId, dead ? "invalid" : "active", msg]
    );
    if (dead) throw new AuthExpiredError(connectionId, msg);
    throw err;
  }

  await q("UPDATE connections SET last_used_at = now(), last_error = NULL WHERE id = $1", [
    connectionId,
  ]);
  return client;
}

/**
 * The signed-in user's most recently authorised connection.
 *
 * A refresh token is one person's consent, so this is scoped: without the
 * filter, a second operator signing in would be handed the first one's Google
 * credential and could act on their accounts. Connections with no owner
 * predate ownership and belong to the installation, so they stay visible.
 */
export async function activeConnection(): Promise<Connection | null> {
  const { currentUser } = await import("@/lib/user");
  const userId = (await currentUser())?.id ?? null;
  if (userId == null) {
    return q1<Connection>(
      `SELECT * FROM connections
        WHERE status = 'active' AND refresh_token_enc IS NOT NULL
        ORDER BY last_used_at DESC NULLS LAST, id DESC
        LIMIT 1`
    );
  }
  return q1<Connection>(
    `SELECT * FROM connections
      WHERE status = 'active' AND refresh_token_enc IS NOT NULL
        AND (user_id = $1 OR user_id IS NULL)
      ORDER BY (user_id = $1) DESC, last_used_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [userId]
  );
}

/**
 * The connection that owns a given client's data.
 *
 * Every inventory row remembers which authorisation discovered it, so a client
 * resolves to a credential through its own bindings rather than through
 * whatever was authorised most recently. Without this, connecting a second
 * Google account silently repoints every existing client at it — the sync
 * would run, and quietly read the wrong account or none at all.
 */
export async function connectionForClient(clientId: number): Promise<Connection | null> {
  const own = await q1<Connection>(
    `SELECT c.* FROM connections c
       JOIN inventory i ON i.connection_id = c.id
       JOIN client_properties cp ON cp.inventory_id = i.id
      WHERE cp.client_id = $1 AND c.status = 'active' AND c.refresh_token_enc IS NOT NULL
      ORDER BY (i.provider = 'ads') DESC, c.id
      LIMIT 1`,
    [clientId]
  );
  // A client with no bindings yet (mid-setup) still has to come from somewhere.
  return own ?? activeConnection();
}

export async function allConnections(): Promise<Connection[]> {
  return q<Connection>("SELECT * FROM connections ORDER BY id");
}
