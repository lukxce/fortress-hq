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

export const identityConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export type AppUser = {
  id: number;
  email: string | null;
  name: string | null;
  role: "owner" | "member" | "viewer";
};

/**
 * Null has a specific meaning: this installation has no users at all, which is
 * a fresh install before the first Google connection. Callers treat it as
 * "unscoped" rather than "forbidden" — a brand new install must be able to see
 * its own empty state and connect something.
 */
export async function currentUser(): Promise<AppUser | null> {
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
  return `(${alias}.owner_id = $${paramIndex} OR ${alias}.owner_id IS NULL
        OR EXISTS (SELECT 1 FROM client_access ca
                    WHERE ca.client_id = ${alias}.id AND ca.user_id = $${paramIndex}))`;
}
