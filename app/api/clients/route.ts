import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, suggestBindings, clientsWithProperties } from "@/lib/binding";
import { q } from "@/lib/db";
import { currentUser, isAdmin } from "@/lib/user";
import { scopedClient } from "@/lib/api";

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

/**
 * Delete a project and everything pulled into it. Only its owner or an admin
 * may, and the request must repeat the project's name, so a stray call cannot.
 * The Google accounts themselves are untouched.
 */
export async function DELETE(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const client = await scopedClient(params.get("id"));
  if (client instanceof NextResponse) return client;
  const me = await currentUser();
  if (me && !isAdmin(me) && client.owner_id !== me.id) {
    return NextResponse.json({ error: "Only the project's owner or an admin can delete it." }, { status: 403 });
  }
  if ((params.get("confirm") ?? "").trim() !== client.name.trim()) {
    return NextResponse.json({ error: "Type the project's name exactly to delete it." }, { status: 400 });
  }
  try {
    const inv = await q<{ inventory_id: number }>(`SELECT inventory_id FROM client_properties WHERE client_id = $1`, [client.id]);
    await q(`DELETE FROM clients WHERE id = $1`, [client.id]);
    // Accounts no other project reads go back to plain "connected".
    if (inv.length) {
      await q(`UPDATE inventory SET status = 'selected' WHERE id = ANY($1::int[]) AND status <> 'revoked'`, [inv.map((i) => i.inventory_id)]);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
