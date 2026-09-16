import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { q } from "@/lib/db";
import { adminOr404 } from "@/lib/admin";
import { body, failure } from "@/lib/api";

export const runtime = "nodejs";

const PRODUCT = z.enum(["all", "ads", "analytics", "search_console", "tag_manager"]);

export async function POST(req: NextRequest) {
  const admin = await adminOr404();
  if (admin instanceof NextResponse) return admin;
  const parsed = z.object({ text: z.string().trim().min(10).max(2000), product: PRODUCT }).safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: "Write the lesson as a full sentence (at least 10 characters)." }, { status: 400 });
  try {
    await q(`INSERT INTO brain_lessons (text, product, created_by) VALUES ($1,$2,$3)`, [parsed.data.text, parsed.data.product, admin.id]);
    return NextResponse.json({ ok: true });
  } catch (err) { return failure(err); }
}

export async function PATCH(req: NextRequest) {
  const admin = await adminOr404();
  if (admin instanceof NextResponse) return admin;
  const parsed = z.object({
    id: z.number().int(), active: z.boolean().optional(),
    text: z.string().trim().min(10).max(2000).optional(), product: PRODUCT.optional(),
  }).safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const l = parsed.data;
  try {
    await q(`UPDATE brain_lessons SET active = COALESCE($2, active), text = COALESCE($3, text),
               product = COALESCE($4, product), updated_at = now() WHERE id = $1`,
      [l.id, l.active ?? null, l.text ?? null, l.product ?? null]);
    return NextResponse.json({ ok: true });
  } catch (err) { return failure(err); }
}

export async function DELETE(req: NextRequest) {
  const admin = await adminOr404();
  if (admin instanceof NextResponse) return admin;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Pass an id." }, { status: 400 });
  await q(`DELETE FROM brain_lessons WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
