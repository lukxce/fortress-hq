import { createHmac, timingSafeEqual } from "node:crypto";
import { q1 } from "@/lib/db";

/**
 * Who a request acts as.
 *
 * Fortress has two gates stacked on each other, and they answer different
 * questions. The shared password answers "may this browser reach the app at
 * all". Identity answers "which person is this, and whose data may they see".
 *
 * Until an identity provider is configured there is only the password, so
 * every request acts as the installation's first user — which is exactly how
 * the app behaved before users existed. Nothing changes for a single operator;
 * the seam simply exists, so that adding a second person is a configuration
 * change rather than a rewrite.
 */

// Clerk runs when its keys are set. In local development it can also run
// without keys ("keyless" mode, a temporary development instance), switched on
// with FORTRESS_CLERK_KEYLESS=1 — so sign-in can be exercised before a real
// Clerk application exists.
export const identityConfigured =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) ||
  (process.env.NODE_ENV === "development" && process.env.FORTRESS_CLERK_KEYLESS === "1");

export type AppUser = {
  id: number;
  email: string | null;
  name: string | null;
  role: "owner" | "member" | "viewer";
  /** Set when an admin is viewing the app as this person. Everything is read-only then. */
  viewedBy?: { id: number; email: string | null };
};

// ------------------------------------------------------------------ view as --

export const VIEW_AS_COOKIE = "fortress_view_as";

/** The cookie is bound to the admin who set it: copied to another browser it means nothing. */
export function viewAsToken(adminId: number, userId: number): string {
  const key = process.env.ENCRYPTION_KEY?.trim() ?? "";
  return `${userId}.${createHmac("sha256", key).update(`view-as:${adminId}:${userId}`).digest("base64url")}`;
}

async function viewingAs(real: AppUser): Promise<AppUser | null> {
  if (real.role !== "owner") return null;
  const { cookies } = await import("next/headers");
  const raw = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!raw) return null;
  const userId = Number(raw.split(".")[0]);
  if (!Number.isInteger(userId) || userId === real.id) return null;
  const expected = Buffer.from(viewAsToken(real.id, userId));
  const given = Buffer.from(raw);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const target = await q1<AppUser>(`SELECT id, email, name, role FROM users WHERE id = $1`, [userId]);
  return target ? { ...target, viewedBy: { id: real.id, email: real.email } } : null;
}

/**
 * Null has a specific meaning: this installation has no users at all, which is
 * a fresh install before the first Google connection. Callers treat it as
 * "unscoped" rather than "forbidden" — a brand new install must be able to see
 * its own empty state and connect something.
 */
export async function currentUser(): Promise<AppUser | null> {
  const real = await realUser();
  if (!real) return null;
  return (await viewingAs(real).catch(() => null)) ?? real;
}

/** The person actually signed in, ignoring "view as". Admin checks use this. */
export async function realUser(): Promise<AppUser | null> {
  if (identityConfigured) {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) return null;
    return upsertFromIdentity(userId);
  }

  return q1<AppUser>(
    `SELECT id, email, name, role FROM users ORDER BY id LIMIT 1`
  );
}

/**
 * Map an identity-provider subject onto a local row.
 *
 * The local id is what every foreign key points at, so it has to be stable
 * across provider changes. Matching on email first means a user who signed in
 * under the shared password and later arrives through Clerk lands on the row
 * that already owns their clients, rather than a fresh empty one.
 */
async function upsertFromIdentity(externalId: string): Promise<AppUser | null> {
  const existing = await q1<AppUser>(
    `SELECT id, email, name, role FROM users WHERE external_id = $1`,
    [externalId]
  );
  if (existing) {
    await q1(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [existing.id]);
    return existing;
  }

  const { currentUser: clerkUser } = await import("@clerk/nextjs/server");
  const who = await clerkUser();
  const email = who?.emailAddresses?.[0]?.emailAddress ?? null;
  const name = [who?.firstName, who?.lastName].filter(Boolean).join(" ") || email;

  if (email) {
    const byEmail = await q1<AppUser>(
      `UPDATE users SET external_id = $1, last_seen_at = now(), name = COALESCE(name, $3)
        WHERE email = $2 AND external_id IS NULL
        RETURNING id, email, name, role`,
      [externalId, email, name]
    );
    if (byEmail) return byEmail;
  }

  return q1<AppUser>(
    `INSERT INTO users (email, name, external_id, role, last_seen_at)
     VALUES ($1, $2, $3, 'member', now())
     ON CONFLICT (external_id) DO UPDATE SET last_seen_at = now()
     RETURNING id, email, name, role`,
    [email, name, externalId]
  );
}

/**
 * The SQL fragment that limits a clients query to what a user may see: their
 * own, plus anything explicitly shared with them.
 *
 * Returned as a fragment rather than applied, because the queries it guards
 * differ too much to share a builder — and a filter that is easy to forget is
 * worse than one that is visible at every call site. The caller says which
 * parameter position the user id will occupy, since that depends on what else
 * the query already binds.
 *
 * `owner_id IS NULL` is included deliberately: rows that predate ownership
 * belong to the installation, and hiding them would make an upgrade look like
 * data loss.
 */
export function visibleClients(
  userId: number | null,
  paramIndex: number,
  alias = "c"
): string {
  if (userId == null) return "TRUE";
  // Projects with no owner predate separate logins; only an admin sees them,
  // so a new teammate is never handed the installation's old projects.
  return `(${alias}.owner_id = $${paramIndex}
        OR (${alias}.owner_id IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = $${paramIndex} AND u.role = 'owner'))
        OR EXISTS (SELECT 1 FROM client_access ca
                    WHERE ca.client_id = ${alias}.id AND ca.user_id = $${paramIndex}))`;
}

/**
 * The same idea for Google connections and everything discovered through them.
 * A person sees the accounts their own Google sign-in can reach — never
 * another person's, even when both can reach the same client's account.
 */
export function visibleConnections(userId: number | null, paramIndex: number, column = "connection_id"): string {
  if (userId == null) return "TRUE";
  return `${column} IN (SELECT co.id FROM connections co WHERE co.user_id = $${paramIndex}
            OR (co.user_id IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = $${paramIndex} AND u.role = 'owner')))`;
}

/**
 * Admins run the installation: the brain, its lessons, users and sharing.
 * The first person to connect Google is the owner; people who arrive through
 * sign-in later are members until an admin says otherwise.
 */
export const isAdmin = (u: AppUser | null) => u?.role === "owner";

/** For admin-only pages: 404 for everyone else, so the page is not even known to exist. */
export async function requireAdmin(): Promise<AppUser> {
  const u = await realUser();
  if (!isAdmin(u)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  return u!;
}
