import { NextResponse, type NextRequest } from "next/server";
import { q } from "@/lib/db";
import { readDraft, problems } from "@/lib/builder/draft";
import { body, clientParam, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const client = await scopedClient(clientParam(req));
  if (client instanceof NextResponse) return client;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (id) {
    const [d] = await q<any>(`SELECT * FROM drafts WHERE id = $1 AND client_id = $2`, [id, client.id]);
    if (!d) return NextResponse.json({ error: "No such draft." }, { status: 404 });
    const steps = await q<any>(`SELECT step, status, error, created_at FROM launch_steps WHERE draft_id = $1 ORDER BY id`, [id]);
    const state = readDraft(d.state);
    return NextResponse.json({ draft: { ...d, state }, problems: problems(state), launchSteps: steps });
  }
  const drafts = await q<any>(`SELECT id, name, source, step, status, updated_at FROM drafts
                                WHERE client_id = $1 ORDER BY updated_at DESC LIMIT 30`, [client.id]);
  return NextResponse.json({ drafts });
}

/**
 * A new draft: blank, or from a campaign the brain proposed. A brain draft
 * fills landing pages from URLs the account's existing ads already use where
 * the plan has none, and leaves headlines as visibly empty fields — a draft
 * that quietly fabricates ad copy is worse than one that shows a gap.
 */
export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  try {
    let state: any = {};
    let source = "wizard";
    let name = "New campaign";
    if (b?.fromRecommendation) {
      const [rec] = await q<any>(`SELECT campaign_plan FROM recommendations WHERE id = $1 AND client_id = $2`, [Number(b.fromRecommendation), client.id]);
      const plan = rec?.campaign_plan;
      if (!plan) return NextResponse.json({ error: "That recommendation has no campaign plan." }, { status: 400 });
      const [url] = await q<any>(`SELECT unnest(final_urls) AS url, count(*) FROM ads WHERE client_id = $1 AND status = 'ENABLED'
                                   GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [client.id]);
      const [site] = await q<any>(`SELECT url, summary FROM site_summaries WHERE client_id = $1`, [client.id]);
      name = plan.name;
      source = "brain";
      state = {
        name: plan.name,
        business: site ? { url: site.url, summary: site.summary } : { url: client.website ?? "", summary: null },
        groups: (plan.ad_groups ?? []).map((g: any) => ({
          name: g.name,
          finalUrl: plan.landing_url || url?.url || "",
          keywords: (g.keywords ?? []).map((text: string) => ({ text, match: "EXACT", source: "converting" })),
          headlines: [], descriptions: [],
        })),
      };
    }
    const [d] = await q<{ id: number }>(`INSERT INTO drafts (client_id, name, source, state) VALUES ($1,$2,$3,$4) RETURNING id`,
      [client.id, name, source, JSON.stringify(readDraft(state))]);
    return NextResponse.json({ id: d.id });
  } catch (err) {
    return failure(err);
  }
}

export async function PATCH(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  try {
    const state = readDraft(b?.state);
    await q(`UPDATE drafts SET state = $3, name = $4, step = COALESCE($5, step), updated_at = now()
              WHERE id = $1 AND client_id = $2 AND status IN ('draft','failed')`,
      [Number(b.id), client.id, JSON.stringify(state), state.name || "New campaign", b.step ?? null]);
    return NextResponse.json({ ok: true, problems: problems(state) });
  } catch (err) {
    return failure(err);
  }
}

export async function DELETE(req: NextRequest) {
  const client = await scopedClient(clientParam(req));
  if (client instanceof NextResponse) return client;
  const id = Number(new URL(req.url).searchParams.get("id"));
  await q(`DELETE FROM drafts WHERE id = $1 AND client_id = $2 AND status <> 'launched'`, [id, client.id]);
  return NextResponse.json({ ok: true });
}
