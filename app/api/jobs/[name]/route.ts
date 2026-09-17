import { NextResponse, type NextRequest } from "next/server";
import { q } from "@/lib/db";
import { syncClient } from "@/lib/jobs/sync";
import { computeFindings, storeFindings } from "@/lib/engine/findings";
import { evaluateDue } from "@/lib/jobs/evaluate";
import { judgeOutcomes } from "@/lib/learning/outcomes";
import { learn } from "@/lib/learning/run";
import { checkSpeed } from "@/lib/jobs/speed";

export const runtime = "nodejs";
// 300 is the ceiling on this Vercel plan; a value above it fails the deployment.
export const maxDuration = 300;

/**
 * Scheduled jobs, run over HTTP so the same code serves Vercel Cron and a
 * manual trigger. Guarded by CRON_SECRET: Vercel sends it as a bearer token.
 *
 *   /api/jobs/daily     sync every client, recompute findings, evaluate due experiments
 *   /api/jobs/evaluate  evaluate due experiments only
 *   /api/jobs/sync-one  sync and recompute findings for one client (?client=)
 *   /api/jobs/learn     judge changes, recompute portfolio patterns, draft lessons
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  const { name } = await ctx.params;

  if (name === "evaluate") return NextResponse.json(await evaluateDue());

  if (name === "sync-one") {
    const id = Number(req.nextUrl.searchParams.get("client"));
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Pass ?client=" }, { status: 400 });
    try {
      const report = await syncClient(id);
      await storeFindings(id, await computeFindings(id));
      return NextResponse.json({ client: id, ok: report.ok });
    } catch (err) {
      return NextResponse.json({ client: id, ok: false, error: (err as Error).message });
    }
  }

  if (name === "speed-one") {
    const id = Number(req.nextUrl.searchParams.get("client"));
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Pass ?client=" }, { status: 400 });
    try { return NextResponse.json({ client: id, pages: await checkSpeed(id) }); }
    catch (err) { return NextResponse.json({ client: id, error: (err as Error).message }); }
  }

  if (name === "daily") {
    // Background jobs run for nobody in particular, so they read every client.
    // Each client syncs in its own invocation, so the portfolio can grow past
    // what one function's time limit allows. A few at a time spares the APIs.
    const clients = await q<{ id: number }>(`SELECT id FROM clients WHERE NOT archived ORDER BY id`);
    const out: unknown[] = [];
    for (let i = 0; i < clients.length; i += 4) {
      out.push(...await Promise.all(clients.slice(i, i + 4).map((c) =>
        fetch(`${req.nextUrl.origin}/api/jobs/sync-one?client=${c.id}`, { headers: { authorization: `Bearer ${secret}` } })
          .then((r) => r.json()).catch((err) => ({ client: c.id, ok: false, error: String(err) })))));
    }
    // Page speed weekly per project, each in its own invocation: a run takes minutes.
    const stale = await q<{ id: number }>(`
      SELECT c.id FROM clients c WHERE NOT c.archived
         AND NOT EXISTS (SELECT 1 FROM page_speed p WHERE p.client_id = c.id AND p.checked_at > now() - interval '6 days')`);
    const speed = await Promise.all(stale.map((c) =>
      fetch(`${req.nextUrl.origin}/api/jobs/speed-one?client=${c.id}`, { headers: { authorization: `Bearer ${secret}` } })
        .then((r) => r.json()).catch((err) => ({ client: c.id, error: String(err) }))));
    return NextResponse.json({ synced: out, speed, evaluated: await evaluateDue(), outcomes: await judgeOutcomes() });
  }

  if (name === "learn") return NextResponse.json(await learn());

  return NextResponse.json({ error: `Unknown job "${name}".` }, { status: 404 });
}
