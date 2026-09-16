import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { q, q1 } from "@/lib/db";
import { adminOr404 } from "@/lib/admin";
import { body } from "@/lib/api";
import { VIEW_AS_COOKIE, viewAsToken } from "@/lib/user";

export const runtime = "nodejs";

const cookie = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

/** Start viewing the app as another person. Read-only; logged. */
export async function POST(req: NextRequest) {
  const admin = await adminOr404();
  if (admin instanceof NextResponse) return admin;
  const parsed = z.object({ userId: z.number().int() }).safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: "Pass userId." }, { status: 400 });
  if (parsed.data.userId === admin.id) return NextResponse.json({ error: "That is you." }, { status: 400 });
  const user = await q1(`SELECT id FROM users WHERE id = $1`, [parsed.data.userId]);
  if (!user) return NextResponse.json({ error: "No such user." }, { status: 404 });
  await q(`INSERT INTO view_as_log (admin_id, user_id) VALUES ($1, $2)`, [admin.id, parsed.data.userId]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(VIEW_AS_COOKIE, viewAsToken(admin.id, parsed.data.userId), { ...cookie, maxAge: 8 * 3600 });
  return res;
}

/** Back to being yourself. Anyone may call this. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(VIEW_AS_COOKIE, "", { ...cookie, maxAge: 0 });
  return res;
}
