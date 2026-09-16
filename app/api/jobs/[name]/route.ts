import { NextResponse, type NextRequest } from "next/server";
import { q } from "@/lib/db";
import { syncClient } from "@/lib/jobs/sync";
import { computeFindings, storeFindings } from "@/lib/engine/findings";
import { evaluateDue } from "@/lib/jobs/evaluate";

export const runtime = "nodejs";
// 300 is the ceiling on this Vercel plan; a value above it fails the deployment.
export const maxDuration = 300;

/**
 * Scheduled jobs, run over HTTP so the same code serves Vercel Cron and a
 * manual trigger. Guarded by CRON_SECRET: Vercel sends it as a bearer token.
 *
 *   /api/jobs/daily     sync every client, recompute findings, evaluate due experiments
 *   /api/jobs/evaluate  evaluate due experiments only
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  const { name } = await ctx.params;

  if (name === "evaluate") return NextResponse.json(await evaluateDue());

  if (name === "daily") {
    // Background jobs run for nobody in particular, so they read every client.
    const clients = await q<{ id: number }>(`SELECT id FROM clients WHERE NOT archived ORDER BY id`);
    const out: unknown[] = [];
    for (const c of clients) {
      try {
        const report = await syncClient(c.id);
        await storeFindings(c.id, await computeFindings(c.id));
        out.push({ client: c.id, ok: report.ok });
      } catch (err) {
        out.push({ client: c.id, ok: false, error: (err as Error).message });
      }
    }
    return NextResponse.json({ synced: out, evaluated: await evaluateDue() });
  }

  return NextResponse.json({ error: `Unknown job "${name}".` }, { status: 404 });
}
