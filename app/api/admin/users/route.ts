import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { q, q1 } from "@/lib/db";
import { adminOr404 } from "@/lib/admin";
import { body, failure } from "@/lib/api";

export const runtime = "nodejs";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("role"), userId: z.number().int(), role: z.enum(["owner", "member", "viewer"]) }),
  z.object({ action: z.literal("share"), userId: z.number().int(), clientId: z.number().int(), access: z.enum(["view", "manage"]) }),
  z.object({ action: z.literal("unshare"), userId: z.number().int(), clientId: z.number().int() }),
  z.object({ action: z.literal("transfer"), userId: z.number().int(), clientId: z.number().int() }),
]);

/**
 * Roles and sharing. Sign-in itself — invitations, passwords, two-factor,
 * removing someone — is handled in the Clerk dashboard, not here.
 */
export async function POST(req: NextRequest) {
  const admin = await adminOr404();
  if (admin instanceof NextResponse) return admin;
  const parsed = Action.safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const a = parsed.data;
  try {
    const user = await q1<{ id: number; role: string }>(`SELECT id, role FROM users WHERE id = $1`, [a.userId]);
    if (!user) return NextResponse.json({ error: "No such user." }, { status: 404 });

    if (a.action === "role") {
      if (user.role === "owner" && a.role !== "owner") {
        const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE role = 'owner'`);
        if (n <= 1) return NextResponse.json({ error: "There must always be at least one admin." }, { status: 400 });
      }
      await q(`UPDATE users SET role = $2 WHERE id = $1`, [a.userId, a.role]);
    } else if (a.action === "share") {
      await q(`INSERT INTO client_access (client_id, user_id, access) VALUES ($1,$2,$3)
               ON CONFLICT (client_id, user_id) DO UPDATE SET access = EXCLUDED.access`, [a.clientId, a.userId, a.access]);
    } else if (a.action === "unshare") {
      await q(`DELETE FROM client_access WHERE client_id = $1 AND user_id = $2`, [a.clientId, a.userId]);
    } else {
      await q(`UPDATE clients SET owner_id = $2, updated_at = now() WHERE id = $1`, [a.clientId, a.userId]);
      await q(`DELETE FROM client_access WHERE client_id = $1 AND user_id = $2`, [a.clientId, a.userId]);
    }
    return NextResponse.json({ ok: true });
  } catch (err) { return failure(err); }
}
