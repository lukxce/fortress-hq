import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, suggestBindings, clientsWithProperties } from "@/lib/binding";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const suggest = Number(new URL(req.url).searchParams.get("suggest"));
  if (Number.isFinite(suggest) && suggest > 0) {
    return NextResponse.json({ suggestions: await suggestBindings(suggest) });
  }
  return NextResponse.json({ clients: await clientsWithProperties() });
}

const Body = z.object({
  name: z.string().min(1).max(120),
  adsInventoryId: z.number().int(),
  goalType: z.enum(["cpa", "roas"]),
  targetCpa: z.number().positive().nullable().optional(),
  targetRoas: z.number().positive().nullable().optional(),
  monthlyBudget: z.number().positive().nullable().optional(),
  bindings: z.array(z.object({
    provider: z.enum(["ga4", "gsc", "gtm"]),
    inventory_id: z.number().int(),
    bound_by: z.enum(["auto", "confirmed", "manual"]).default("manual"),
  })).default([]),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bad request" },
      { status: 400 }
    );
  }
  try {
    const id = await createClient(parsed.data);
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
