import { q } from "@/lib/db";
import { fromMicros } from "@/lib/engine/metrics";
import { testSegment } from "@/lib/engine/stats";

/**
 * The learning loop.
 *
 * A recommendation with a prediction becomes an experiment with no clock. The
 * clock starts only when the operator starts it — by the button, or by saying
 * they made the change themselves. At that moment the baseline is snapshotted.
 *
 * The check date is not a fixed fortnight. At 20 conversions a month a 14-day
 * "CPA moved 10%" verdict is a coin flip, so the post-change window is sized to
 * collect about 20 conversions at the baseline rate (between 14 and 90 days),
 * then a week is added for conversion lag. The verdict uses the same exact test
 * as every finding: "confirmed" and "refuted" require the change to be unlikely
 * under chance; everything else is honestly "inconclusive".
 */

const BASELINE_DAYS = 60;
const TARGET_CONVERSIONS = 20;
const LAG_DAYS = 7;

type Window = { days: number; spend: number; clicks: number; conversions: number };

async function measure(clientId: number, campaignIds: string[], from: string, to: string): Promise<Window> {
  const scoped = campaignIds.length > 0;
  const [r] = await q<any>(`
    SELECT COALESCE(SUM(cost_micros),0) AS cost, COALESCE(SUM(clicks),0) AS clicks,
           COALESCE(SUM(conversions),0) AS conv
      FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign'
       AND date >= $2::date AND date < $3::date
       ${scoped ? "AND entity_id = ANY($4)" : ""}
  `, scoped ? [clientId, from, to, campaignIds] : [clientId, from, to]);
  const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 864e5));
  return { days, spend: fromMicros(r?.cost), clicks: Number(r?.clicks ?? 0), conversions: Number(r?.conv ?? 0) };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function startExperiment(
  clientId: number, experimentId: number, via: "button" | "manual", campaignIds?: string[]
) {
  const [exp] = await q<any>(`SELECT * FROM experiments WHERE id = $1 AND client_id = $2`, [experimentId, clientId]);
  if (!exp) throw new Error("No such experiment.");
  if (exp.status !== "proposed") throw new Error("This experiment has already started.");

  const scope = campaignIds?.length ? campaignIds : (exp.scope?.campaignIds ?? []);
  const today = new Date();
  const from = new Date(today.getTime() - BASELINE_DAYS * 864e5);
  // Leave out the last few days: their conversions have not all arrived yet.
  const baselineEnd = new Date(today.getTime() - 3 * 864e5);
  const base = await measure(clientId, scope, iso(from), iso(baselineEnd));

  const perDay = base.conversions / base.days;
  const postDays = perDay > 0 ? Math.min(90, Math.max(14, Math.ceil(TARGET_CONVERSIONS / perDay))) : 30;
  const due = new Date(today.getTime() + (postDays + LAG_DAYS) * 864e5);

  await q(`
    UPDATE experiments
       SET status = 'running', applied_at = now(), applied_via = $3, due_at = $4,
           scope = $5, baseline = $6
     WHERE id = $1 AND client_id = $2`,
    [experimentId, clientId, via, due.toISOString(), JSON.stringify({ campaignIds: scope }),
     JSON.stringify({ ...base, from: iso(from), to: iso(baselineEnd), postDays })]);
}

export async function evaluateDue(): Promise<{ evaluated: number }> {
  const due = await q<any>(`SELECT * FROM experiments WHERE status = 'running' AND due_at <= now()`);
  for (const exp of due) await evaluate(exp);
  return { evaluated: due.length };
}

async function evaluate(exp: any) {
  const base = exp.baseline as Window & { postDays: number };
  const start = new Date(exp.applied_at);
  const end = new Date(start.getTime() + base.postDays * 864e5);
  const post = await measure(exp.client_id, exp.scope?.campaignIds ?? [], iso(start), iso(end));

  const cpa = (w: Window) => (w.conversions > 0 ? w.spend / w.conversions : null);
  let verdict: "confirmed" | "refuted" | "inconclusive" = "inconclusive";
  let p: number | null = null;
  let explanation = "";

  const up = exp.direction === "up";
  switch (exp.metric) {
    case "cpa": {
      // Lower CPA means more conversions per unit of spend: exposure is spend.
      const better = testSegment(post, { spend: post.spend + base.spend, conversions: post.conversions + base.conversions }, 1, "better");
      const worse = testSegment(post, { spend: post.spend + base.spend, conversions: post.conversions + base.conversions }, 1, "worse");
      const before = cpa(base), after = cpa(post);
      const change = before && after ? (after - before) / before : null;
      const wantedDown = !up;
      if (better.significant && change != null && change <= -0.1) verdict = wantedDown ? "confirmed" : "refuted";
      else if (worse.significant && change != null && change >= 0.1) verdict = wantedDown ? "refuted" : "confirmed";
      p = Math.min(better.p, worse.p);
      explanation = before && after
        ? `Cost per conversion went from ${before.toFixed(2)} to ${after.toFixed(2)} (${(change! * 100).toFixed(0)}%) on ${post.conversions.toFixed(0)} conversions after the change.`
        : `Too few conversions on one side to compare cost per conversion.`;
      break;
    }
    case "spend": {
      const before = base.spend / base.days, after = post.spend / post.days;
      const ratio = before > 0 ? after / before : null;
      if (ratio != null) {
        if (!up && ratio < 0.2) verdict = "confirmed";
        else if (up && ratio > 1.2) verdict = "confirmed";
        else if ((!up && ratio > 1.2) || (up && ratio < 0.8)) verdict = "refuted";
      }
      explanation = `Daily spend went from ${before.toFixed(2)} to ${after.toFixed(2)}.`;
      break;
    }
    case "conversions": {
      // Exposure is time: conversions per day before and after.
      const pair = { spend: post.days + base.days, conversions: post.conversions + base.conversions };
      const t = testSegment({ spend: post.days, conversions: post.conversions }, pair, 1, up ? "better" : "worse");
      const o = testSegment({ spend: post.days, conversions: post.conversions }, pair, 1, up ? "worse" : "better");
      if (t.significant) verdict = "confirmed"; else if (o.significant) verdict = "refuted";
      p = Math.min(t.p, o.p);
      explanation = `Conversions per day went from ${(base.conversions / base.days).toFixed(2)} to ${(post.conversions / post.days).toFixed(2)}.`;
      break;
    }
    case "cvr": {
      const pair = { spend: post.clicks + base.clicks, conversions: post.conversions + base.conversions };
      const t = testSegment({ spend: post.clicks, conversions: post.conversions }, pair, 1, up ? "better" : "worse");
      const o = testSegment({ spend: post.clicks, conversions: post.conversions }, pair, 1, up ? "worse" : "better");
      if (t.significant) verdict = "confirmed"; else if (o.significant) verdict = "refuted";
      p = Math.min(t.p, o.p);
      const r = (w: Window) => (w.clicks > 0 ? (w.conversions / w.clicks) * 100 : 0);
      explanation = `Conversion rate went from ${r(base).toFixed(1)}% to ${r(post).toFixed(1)}%.`;
      break;
    }
  }

  if (verdict === "inconclusive") {
    explanation += " The difference is within what chance produces at this volume, so this test neither confirms nor refutes the prediction.";
  }

  await q(`
    UPDATE experiments SET status = 'finished', verdict = $2, evaluated_at = now(), result = $3
     WHERE id = $1`,
    [exp.id, verdict, JSON.stringify({ before: base, after: post, p, explanation })]);
}
