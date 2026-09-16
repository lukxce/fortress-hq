import { q } from "@/lib/db";
import { fromMicros } from "@/lib/engine/metrics";
import { testSegment } from "@/lib/engine/stats";
import { SETTLE_DAYS, WINDOW_DAYS } from "@/lib/jobs/changes";

/**
 * What followed each change.
 *
 * Every change is judged the same way, whether someone did it in Google Ads by
 * hand or followed a Fortress recommendation:
 *
 *   before  = the 28 days up to the change
 *   after   = 28 days, starting once bidding has had time to settle
 *   control = the rest of the same account over the same two windows
 *
 * These are observations, not controlled experiments. Three guards keep them
 * honest: a change with another budget, bidding or status change on the same
 * campaign inside its windows is "confounded" and not counted; a change whose
 * campaign moved no differently from the rest of the account is "moved with
 * account"; and a difference has to pass the same exact test every finding
 * uses before it is called better or worse.
 */

type W = { spend: number; clicks: number; conversions: number };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const add = (day: string, n: number) => iso(new Date(new Date(day).getTime() + n * 864e5));

async function measure(clientId: number, from: string, to: string, campaign: string | null, exclude = false): Promise<W> {
  const filter = campaign ? (exclude ? "AND entity_id <> $4" : "AND entity_id = $4") : "";
  const [r] = await q<any>(`
    SELECT COALESCE(SUM(cost_micros),0) AS cost, COALESCE(SUM(clicks),0)::float AS clicks, COALESCE(SUM(conversions),0)::float AS conv
      FROM metrics_daily WHERE client_id = $1 AND entity_type = 'campaign' AND date >= $2::date AND date < $3::date ${filter}`,
    campaign ? [clientId, from, to, campaign] : [clientId, from, to]);
  return { spend: fromMicros(r?.cost), clicks: Number(r?.clicks ?? 0), conversions: Number(r?.conv ?? 0) };
}

const CONFOUNDING = ["budget_increase", "budget_decrease", "bid_strategy_change", "target_cpa_raised", "target_cpa_lowered",
  "target_roas_raised", "target_roas_lowered", "campaign_paused", "campaign_enabled"];

/** Queue done recommendations as changes too, so following advice is judged exactly like acting alone. */
async function registerRecommendations() {
  const done = await q<any>(`
    SELECT r.id, r.client_id, r.area, r.action, r.finding_kinds, r.updated_at::date AS day, e.scope
      FROM recommendations r LEFT JOIN experiments e ON e.recommendation_id = r.id
     WHERE r.status = 'done' AND r.updated_at > now() - interval '120 days'`);
  for (const r of done) {
    const kind = `recommendation:${r.action?.kind ?? r.area}`;
    const campaign = r.action?.params?.campaign_id ?? r.scope?.campaignIds?.[0] ?? null;
    const day = new Date(r.day).toISOString().slice(0, 10);
    await q(`INSERT INTO change_outcomes (client_id, source, ref, kind, detail, campaign_id, changed_on, evaluate_after)
             VALUES ($1, 'recommendation', $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [r.client_id, String(r.id), kind, JSON.stringify({ findings: r.finding_kinds, action: r.action?.kind ?? null }), campaign, day,
       add(day, 7 + WINDOW_DAYS + 3)]);
  }
}

export async function judgeOutcomes(): Promise<{ judged: number; waiting: number }> {
  await registerRecommendations();
  const due = await q<any>(`SELECT * FROM change_outcomes WHERE status = 'waiting' AND evaluate_after <= CURRENT_DATE ORDER BY changed_on LIMIT 400`);

  for (const o of due) {
    const day = new Date(o.changed_on).toISOString().slice(0, 10);
    const settle = SETTLE_DAYS[o.kind] ?? (o.source === "recommendation" ? 7 : 3);
    // Pausing a campaign is judged on the whole account: the campaign itself has nothing after.
    const campaign = o.kind === "campaign_paused" ? null : o.campaign_id;
    const beforeFrom = add(day, -WINDOW_DAYS), afterFrom = add(day, settle), afterTo = add(day, settle + WINDOW_DAYS);

    const [before, after, ctlBefore, ctlAfter, others] = await Promise.all([
      measure(o.client_id, beforeFrom, day, campaign),
      measure(o.client_id, afterFrom, afterTo, campaign),
      campaign ? measure(o.client_id, beforeFrom, day, campaign, true) : Promise.resolve(null),
      campaign ? measure(o.client_id, afterFrom, afterTo, campaign, true) : Promise.resolve(null),
      campaign ? q<any>(`SELECT kind, changed_on FROM change_outcomes
                          WHERE client_id = $1 AND campaign_id = $2 AND id <> $3 AND kind = ANY($4)
                            AND changed_on > $5::date AND changed_on < $6::date`,
        [o.client_id, campaign, o.id, CONFOUNDING, add(day, -14), afterTo]) : Promise.resolve([]),
    ]);

    const monthly = before.conversions * (30.4 / WINDOW_DAYS);
    const band = monthly < 10 ? "under 10 conversions a month" : monthly < 30 ? "10 to 30 a month" : "over 30 a month";
    const cpa = (w: W) => (w.conversions > 0 ? w.spend / w.conversions : null);
    const pair = { spend: before.spend + after.spend, conversions: before.conversions + after.conversions };
    const better = testSegment(after, pair, 1, "better");
    const worse = testSegment(after, pair, 1, "worse");
    const cpaChange = cpa(before) && cpa(after) ? cpa(after)! / cpa(before)! - 1 : null;
    const ctlChange = ctlBefore && ctlAfter && cpa(ctlBefore) && cpa(ctlAfter) ? cpa(ctlAfter)! / cpa(ctlBefore)! - 1 : null;
    const perDay = (w: W) => w.conversions / WINDOW_DAYS;

    let verdict: string;
    if (CONFOUNDING.includes(o.kind) && others.length) verdict = "confounded";
    else if (before.conversions + after.conversions < 6 || before.spend === 0) verdict = "too_little_data";
    else if ((better.significant && cpaChange != null && cpaChange <= -0.1) || (worse.significant && cpaChange != null && cpaChange >= 0.1)) {
      const dir = cpaChange! < 0 ? "better" : "worse";
      // The whole account moved the same way by a similar amount: seasonality or tracking, not this change.
      verdict = ctlChange != null && Math.sign(ctlChange) === Math.sign(cpaChange!) && Math.abs(ctlChange) >= Math.abs(cpaChange!) * 0.7
        ? "moved_with_account" : dir;
    } else verdict = "no_clear_change";

    await q(`UPDATE change_outcomes SET status = 'judged', verdict = $2, volume_band = $3, evaluated_at = now(), result = $4 WHERE id = $1`,
      [o.id, verdict, band, JSON.stringify({
        before, after, windows: { before: [beforeFrom, day], after: [afterFrom, afterTo] },
        cpaBefore: cpa(before), cpaAfter: cpa(after), cpaChange,
        conversionsPerDayBefore: perDay(before), conversionsPerDayAfter: perDay(after),
        spendChange: before.spend > 0 ? after.spend / before.spend - 1 : null,
        restOfAccountCpaChange: ctlChange, p: Math.min(better.p, worse.p),
        confoundedBy: others.map((x) => x.kind),
      })]);
  }
  const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM change_outcomes WHERE status = 'waiting'`);
  return { judged: due.length, waiting: n };
}
