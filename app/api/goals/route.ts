import { NextResponse, type NextRequest } from "next/server";
import { createGoal, preflight, CATEGORIES, type GoalSpec } from "@/lib/google/goals";
import { AuthExpiredError } from "@/lib/google/auth";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/** What the composer needs to render: bindings, categories, what already exists. */
export async function GET(req: NextRequest) {
  const clientId = Number(new URL(req.url).searchParams.get("client"));
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: "Pass ?client=<id>" }, { status: 400 });
  }
  try {
    const pre = await preflight(clientId);
    const created = await q(
      `SELECT id, name, category, is_primary, conversion_id, conversion_label,
              gtm_tag_id, gtm_published, created_at
         FROM conversion_goals WHERE client_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [clientId]
    );
    return NextResponse.json({
      canWriteAds: pre.canWriteAds,
      canWriteGtm: pre.canWriteGtm,
      categories: CATEGORIES,
      existing: pre.existing,
      created,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const clientId = Number(new URL(req.url).searchParams.get("client"));
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: "Pass ?client=<id>" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Partial<GoalSpec> | null;
  if (!body?.name || !body.category || !body.trigger) {
    return NextResponse.json({ error: "name, category and trigger are required." }, { status: 400 });
  }

  const spec: GoalSpec = {
    name: String(body.name),
    category: String(body.category),
    isPrimary: Boolean(body.isPrimary),
    countingType: body.countingType === "MANY_PER_CLICK" ? "MANY_PER_CLICK" : "ONE_PER_CLICK",
    defaultValue:
      body.defaultValue == null || body.defaultValue === ("" as unknown)
        ? null
        : Number(body.defaultValue),
    clickWindowDays: body.clickWindowDays ? Number(body.clickWindowDays) : 30,
    viewWindowDays: body.viewWindowDays ? Number(body.viewWindowDays) : 1,
    trigger: body.trigger,
    createGtmTag: body.createGtmTag !== false,
  };

  try {
    const result = await createGoal(clientId, spec);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      return NextResponse.json(
        { error: "reconnect", message: "Google authorisation is no longer valid." },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
