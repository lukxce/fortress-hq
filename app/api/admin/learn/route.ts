import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminOr404 } from "@/lib/admin";
import { body, failure } from "@/lib/api";
import { learn } from "@/lib/learning/run";
import { setSetting } from "@/lib/learning/settings";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Run a learning pass now, instead of waiting for Monday. */
export async function POST() {
  const admin = await adminOr404();
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json(await learn());
  } catch (err) {
    return failure(err);
  }
}

/** Whether drafted lessons apply themselves or wait for an admin. */
export async function PATCH(req: NextRequest) {
  const admin = await adminOr404();
  if (admin instanceof NextResponse) return admin;
  const parsed = z.object({ autoApply: z.boolean() }).safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: "Pass autoApply." }, { status: 400 });
  await setSetting("auto_apply_lessons", parsed.data.autoApply);
  return NextResponse.json({ ok: true });
}
