import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { q, q1, tx } from "@/lib/db";
import { currentUser, visibleConnections } from "@/lib/user";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";

const Binding = z.object({
  client: z.number().int(),
  provider: z.enum(["ads", "ga4", "gsc", "gtm"]),
  inventoryId: z.number().int().nullable(),
});

/**
 * Change which Google account, property, site or container a project reads.
 * Only something the signed-in person's own Google connection can reach may be
 * bound, and the old data for that product is dropped so two sources never mix.
 */
export async function PUT(req: NextRequest) {
  const parsed = Binding.safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { provider, inventoryId } = parsed.data;
  const client = await scopedClient(parsed.data.client);
  if (client instanceof NextResponse) return client;

  try {
    const me = await currentUser();
    if (inventoryId != null) {
      const item = await q1<{ provider: string }>(
        `SELECT provider FROM inventory WHERE id = $1 AND status <> 'revoked' AND ${visibleConnections(me?.id ?? null, 2)}`,
        me ? [inventoryId, me.id] : [inventoryId]
      );
      if (!item) return NextResponse.json({ error: "That is not reachable from your Google connection." }, { status: 404 });
      if (item.provider !== provider) return NextResponse.json({ error: "Wrong kind of account for this slot." }, { status: 400 });
    } else if (provider === "ads") {
      return NextResponse.json({ error: "A project needs its Google Ads account. Pick a different one instead." }, { status: 400 });
    }

    const clearing: Record<string, string[]> = {
      ga4: ["ga4_daily", "ga4_pages", "ga4_events", "ga4_dims"],
      gsc: ["gsc_daily", "gsc_totals", "gsc_pages", "gsc_query_pages"],
      gtm: ["gtm_tags", "gtm_triggers", "gtm_snapshots"],
      ads: ["campaigns", "ad_groups", "ads", "keywords", "search_terms", "metrics_daily", "schedule_metrics", "segment_metrics", "negatives", "conversion_actions", "landing_pages", "placements", "monthly_metrics", "conversion_breakdown"],
    };

    await tx(async (run) => {
      const [current] = await run<{ inventory_id: number }>(
        `SELECT inventory_id FROM client_properties WHERE client_id = $1 AND provider = $2`, [client.id, provider]);
      if (current?.inventory_id === inventoryId) return;
      for (const table of clearing[provider]) await run(`DELETE FROM ${table} WHERE client_id = $1`, [client.id]);
      await run(`DELETE FROM findings WHERE client_id = $1 AND product = $2`,
        [client.id, { ga4: "analytics", gsc: "search_console", gtm: "tag_manager", ads: "ads" }[provider]]);
      if (inventoryId == null) {
        await run(`DELETE FROM client_properties WHERE client_id = $1 AND provider = $2`, [client.id, provider]);
      } else {
        await run(
          `INSERT INTO client_properties (client_id, provider, inventory_id, bound_by) VALUES ($1,$2,$3,'manual')
           ON CONFLICT (client_id, provider) DO UPDATE SET inventory_id = EXCLUDED.inventory_id, bound_by = 'manual'`,
          [client.id, provider, inventoryId]);
        await run(`UPDATE inventory SET status = 'selected' WHERE id = $1`, [inventoryId]);
      }
    });
    await q(`UPDATE clients SET updated_at = now() WHERE id = $1`, [client.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
