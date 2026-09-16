import { NextResponse, type NextRequest } from "next/server";
import { createGoal, preflight, CATEGORIES, type GoalSpec } from "@/lib/google/goals";
import { q } from "@/lib/db";
import { body, clientParam, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

/** What the composer needs to render: bindings, categories, what already exists. */
export async function GET(req: NextRequest) {
  const client = await scopedClient(clientParam(req));
  if (client instanceof NextResponse) return client;
  try {
    const pre = await preflight(client.id);
    const created = await q(
      `SELECT id, name, category, is_primary, conversion_id, conversion_label,
              gtm_tag_id, gtm_published, created_at
         FROM conversion_goals WHERE client_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [client.id]
    );
    return NextResponse.json({ canWriteAds: pre.canWriteAds, canWriteGtm: pre.canWriteGtm, categories: CATEGORIES, existing: pre.existing, created });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(req: NextRequest) {
  const client = await scopedClient(clientParam(req));
  if (client instanceof NextResponse) return client;
  const b = await body<Partial<GoalSpec>>(req);
  if (!b?.name || !b.category || !b.trigger) {
    return NextResponse.json({ error: "name, category and trigger are required." }, { status: 400 });
  }
  const category = CATEGORIES.find((c) => c.value === b.category);
  if (!category) return NextResponse.json({ error: "Unknown category." }, { status: 400 });
  const kind = (b.trigger as any).kind;
  if (!["url", "event", "phone"].includes(kind)) return NextResponse.json({ error: "Unknown trigger." }, { status: 400 });
  if (kind !== "phone" && !String((b.trigger as any).value ?? "").trim()) {
    return NextResponse.json({ error: "Say when it should fire." }, { status: 400 });
  }

  const spec: GoalSpec = {
    name: String(b.name),
    category: category.value,
    isPrimary: Boolean(b.isPrimary),
    // Locked to the category, never taken from the browser: one lead per click
    // for leads, every time for sales.
    countingType: category.counting as GoalSpec["countingType"],
    defaultValue: b.defaultValue == null || (b.defaultValue as unknown) === "" ? null : Number(b.defaultValue),
    clickWindowDays: 30,
    viewWindowDays: 1,
    trigger: b.trigger as GoalSpec["trigger"],
    createGtmTag: b.createGtmTag !== false,
  };

  try {
    return NextResponse.json(await createGoal(client.id, spec));
  } catch (err) {
    return failure(err, 400);
  }
}
