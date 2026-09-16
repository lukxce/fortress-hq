import type { OAuth2Client } from "google-auth-library";
import { q, tx } from "@/lib/db";
import { searchStream, digits } from "@/lib/google/ads";
import { countOps } from "@/lib/google/quota";
import type { ClientWithProps } from "@/lib/binding";

/**
 * Every change made in the Google Ads account, whoever made it.
 *
 * Google keeps 29 days of change history and the query must stay inside that,
 * so this runs on every sync and the rows accumulate here. It is what lets the
 * brain learn from changes nobody asked Fortress about: the operator adjusting a
 * budget by hand, a colleague switching a bid strategy, a script adding
 * negatives.
 */
export async function syncChangeEvents(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const from = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const rows = await searchStream(auth, cid, `
    SELECT change_event.change_date_time, change_event.change_resource_type,
           change_event.change_resource_name, change_event.resource_change_operation,
           change_event.changed_fields, change_event.old_resource, change_event.new_resource,
           change_event.client_type, change_event.campaign
      FROM change_event
     WHERE change_event.change_date_time >= '${from}' AND change_event.change_date_time <= '${to}'
       AND change_event.change_resource_type IN ('CAMPAIGN', 'CAMPAIGN_BUDGET', 'CAMPAIGN_CRITERION', 'AD_GROUP_CRITERION', 'AD_GROUP_AD', 'AD_GROUP')
     ORDER BY change_event.change_date_time DESC
     LIMIT 10000
  `);
  await countOps("ads", 1);

  await tx(async (run) => {
    for (const r of rows) {
      const e = r.changeEvent ?? {};
      await run(
        `INSERT INTO change_events (client_id, resource_name, changed_at, resource_type, operation, campaign_id,
            changed_fields, old_resource, new_resource, client_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [c.id, e.changeResourceName ?? "", toTimestamp(e.changeDateTime), e.changeResourceType ?? "", e.resourceChangeOperation ?? null,
         e.campaign ? String(e.campaign).split("/").pop() : null, e.changedFields ?? null,
         e.oldResource ? JSON.stringify(e.oldResource) : null, e.newResource ? JSON.stringify(e.newResource) : null,
         e.clientType ?? null]
      );
    }
  });
  await registerChanges(c.id);
  return rows.length;
}

// Google reports "2026-09-10 14:03:22.123456" in the account's time zone. A
// day of precision is all the outcome windows need.
const toTimestamp = (s: string | undefined) => (s ? `${s.slice(0, 19).replace(" ", "T")}Z` : new Date().toISOString());

export type ChangeKind =
  | "budget_increase" | "budget_decrease" | "bid_strategy_change" | "target_cpa_raised" | "target_cpa_lowered"
  | "target_roas_raised" | "target_roas_lowered" | "campaign_paused" | "campaign_enabled"
  | "negatives_added" | "keywords_added" | "keywords_removed" | "ads_added" | "ads_paused_or_removed"
  | "schedule_changed" | "locations_changed";

/** How long bidding needs to settle after each kind of change before "after" is measured. */
export const SETTLE_DAYS: Record<string, number> = {
  bid_strategy_change: 14, target_cpa_raised: 14, target_cpa_lowered: 14, target_roas_raised: 14, target_roas_lowered: 14,
  budget_increase: 7, budget_decrease: 7, campaign_paused: 3, campaign_enabled: 7,
};
export const WINDOW_DAYS = 28;
const LAG_DAYS = 3;

const num = (v: unknown) => (v == null ? null : Number(v));

/** One raw event → zero or more (kind, detail) classifications. */
function classify(e: any): { kind: ChangeKind; detail: Record<string, unknown> }[] {
  const oldR = e.old_resource ?? {}, newR = e.new_resource ?? {};
  const fields = String(e.changed_fields ?? "");
  const out: { kind: ChangeKind; detail: Record<string, unknown> }[] = [];

  switch (e.resource_type) {
    case "CAMPAIGN_BUDGET": {
      const before = num(oldR.campaignBudget?.amountMicros), after = num(newR.campaignBudget?.amountMicros);
      if (e.operation === "UPDATE" && before && after && Math.abs(after / before - 1) >= 0.05) {
        out.push({ kind: after > before ? "budget_increase" : "budget_decrease", detail: { from: before / 1e6, to: after / 1e6, pct: Math.round((after / before - 1) * 100) } });
      }
      break;
    }
    case "CAMPAIGN": {
      if (e.operation !== "UPDATE") break;
      const o = oldR.campaign ?? {}, n = newR.campaign ?? {};
      if (/status/.test(fields) && o.status !== n.status) {
        if (n.status === "PAUSED") out.push({ kind: "campaign_paused", detail: {} });
        if (n.status === "ENABLED" && o.status === "PAUSED") out.push({ kind: "campaign_enabled", detail: {} });
      }
      if (o.biddingStrategyType && n.biddingStrategyType && o.biddingStrategyType !== n.biddingStrategyType) {
        out.push({ kind: "bid_strategy_change", detail: { from: o.biddingStrategyType, to: n.biddingStrategyType } });
      }
      const cpa = (x: any) => num(x.targetCpa?.targetCpaMicros ?? x.maximizeConversions?.targetCpaMicros);
      const roas = (x: any) => num(x.targetRoas?.targetRoas ?? x.maximizeConversionValue?.targetRoas);
      if (cpa(o) && cpa(n) && Math.abs(cpa(n)! / cpa(o)! - 1) >= 0.05) {
        out.push({ kind: cpa(n)! > cpa(o)! ? "target_cpa_raised" : "target_cpa_lowered", detail: { from: cpa(o)! / 1e6, to: cpa(n)! / 1e6, pct: Math.round((cpa(n)! / cpa(o)! - 1) * 100) } });
      }
      if (roas(o) && roas(n) && Math.abs(roas(n)! / roas(o)! - 1) >= 0.05) {
        out.push({ kind: roas(n)! > roas(o)! ? "target_roas_raised" : "target_roas_lowered", detail: { from: roas(o), to: roas(n), pct: Math.round((roas(n)! / roas(o)! - 1) * 100) } });
      }
      break;
    }
    case "CAMPAIGN_CRITERION": {
      const cc = newR.campaignCriterion ?? oldR.campaignCriterion ?? {};
      if (cc.keyword && cc.negative && e.operation === "CREATE") out.push({ kind: "negatives_added", detail: { text: cc.keyword.text } });
      else if (cc.adSchedule) out.push({ kind: "schedule_changed", detail: {} });
      else if (cc.location || cc.proximity) out.push({ kind: "locations_changed", detail: {} });
      break;
    }
    case "AD_GROUP_CRITERION": {
      const ac = newR.adGroupCriterion ?? oldR.adGroupCriterion ?? {};
      if (!ac.keyword) break;
      if (ac.negative && e.operation === "CREATE") out.push({ kind: "negatives_added", detail: { text: ac.keyword.text } });
      else if (!ac.negative && e.operation === "CREATE") out.push({ kind: "keywords_added", detail: { text: ac.keyword.text } });
      else if (!ac.negative && (e.operation === "REMOVE" || (newR.adGroupCriterion?.status === "PAUSED" && oldR.adGroupCriterion?.status === "ENABLED"))) {
        out.push({ kind: "keywords_removed", detail: { text: ac.keyword.text } });
      }
      break;
    }
    case "AD_GROUP_AD": {
      if (e.operation === "CREATE") out.push({ kind: "ads_added", detail: {} });
      else if (e.operation === "REMOVE" || (newR.adGroupAd?.status === "PAUSED" && oldR.adGroupAd?.status === "ENABLED")) out.push({ kind: "ads_paused_or_removed", detail: {} });
      break;
    }
  }
  return out;
}

/**
 * Group raw events into changes — one campaign, one day, one kind — and queue
 * each for judging once its after-window has closed.
 */
export async function registerChanges(clientId: number) {
  const events = await q<any>(`
    SELECT e.*, (e.changed_at AT TIME ZONE 'UTC')::date AS day,
           COALESCE(e.campaign_id, c.campaign_id) AS campaign
      FROM change_events e
      LEFT JOIN campaigns c ON c.client_id = e.client_id AND c.budget_resource_name = e.resource_name
     WHERE e.client_id = $1 AND e.changed_at > now() - interval '35 days'
     ORDER BY e.changed_at DESC`, [clientId]);

  const groups = new Map<string, { kind: string; campaign: string | null; day: string; details: Record<string, unknown>[]; clientTypes: Set<string> }>();
  for (const e of events) {
    for (const c of classify(e)) {
      const day = new Date(e.day).toISOString().slice(0, 10);
      const key = `${c.kind}:${e.campaign ?? "account"}:${day}`;
      const g = groups.get(key) ?? { kind: c.kind, campaign: e.campaign ?? null, day, details: [] as Record<string, unknown>[], clientTypes: new Set<string>() };
      g.details.push(c.detail);
      if (e.client_type) g.clientTypes.add(e.client_type);
      groups.set(key, g);
    }
  }
  if (!groups.size) return;

  const campaigns = await q<any>(`SELECT campaign_id, channel_type, bidding_strategy FROM campaigns WHERE client_id = $1`, [clientId]);
  await tx(async (run) => {
    for (const [key, g] of groups) {
      const settle = SETTLE_DAYS[g.kind] ?? 3;
      const after = new Date(new Date(g.day).getTime() + (settle + WINDOW_DAYS + LAG_DAYS) * 864e5).toISOString().slice(0, 10);
      const camp = campaigns.find((x) => x.campaign_id === g.campaign);
      // Budget and target changes keep only the day's first "from" and last "to".
      const first = g.details[g.details.length - 1] ?? {}, last = g.details[0] ?? {};
      const detail = "from" in first
        ? { from: first.from, to: last.to, pct: typeof first.from === "number" && typeof last.to === "number" ? Math.round((last.to / first.from - 1) * 100) : last.pct, by: [...g.clientTypes] }
        : { count: g.details.length, examples: g.details.map((d) => d.text).filter(Boolean).slice(0, 10), by: [...g.clientTypes] };
      await run(
        `INSERT INTO change_outcomes (client_id, source, ref, kind, detail, campaign_id, changed_on, channel_type, bid_strategy, evaluate_after)
         VALUES ($1, 'account_change', $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (client_id, source, ref) DO UPDATE SET detail = EXCLUDED.detail
           WHERE change_outcomes.status = 'waiting'`,
        [clientId, key, g.kind, JSON.stringify(detail), g.campaign, g.day, camp?.channel_type ?? null,
         g.kind === "bid_strategy_change" ? (first as any).from ?? camp?.bidding_strategy : camp?.bidding_strategy ?? null, after]
      );
    }
  });
}
