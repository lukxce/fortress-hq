import { q } from "@/lib/db";
import { fromMicros } from "@/lib/engine/metrics";
import { segment } from "@/lib/engine/segments";
import { testSegment, zeroConversionMultiple } from "@/lib/engine/stats";

/**
 * Reporting. Entirely deterministic — a report describes what happened, and
 * there is nothing for a model to add.
 *
 * Arrows always show the real direction of change. lowerIsBetter flips only the
 * colour, so a rising cost per conversion reads as ▲ in red, never ▼ in green.
 */

export type Metric = {
  key: string; label: string; current: number | null; previous: number | null;
  change: number | null; lowerIsBetter: boolean; format: "money" | "count" | "pct" | "decimal";
};

type Totals = { spend: number; clicks: number; impressions: number; conversions: number; value: number };

async function totals(clientId: number, from: string, to: string, campaignId?: string): Promise<Totals> {
  const [r] = await q<any>(`
    SELECT COALESCE(SUM(cost_micros),0) AS cost, COALESCE(SUM(clicks),0) AS clicks,
           COALESCE(SUM(impressions),0) AS imp, COALESCE(SUM(conversions),0) AS conv,
           COALESCE(SUM(conversion_value_micros),0) AS value
      FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign' AND date >= $2::date AND date < $3::date
       ${campaignId ? "AND entity_id = $4" : ""}
  `, campaignId ? [clientId, from, to, campaignId] : [clientId, from, to]);
  return {
    spend: fromMicros(r?.cost), clicks: Number(r?.clicks ?? 0), impressions: Number(r?.imp ?? 0),
    conversions: Number(r?.conv ?? 0), value: fromMicros(r?.value),
  };
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const change = (cur: number | null, prev: number | null) =>
  cur != null && prev != null && prev !== 0 ? (cur - prev) / prev : null;

export function metricsFrom(cur: Totals, prev: Totals): Metric[] {
  const m = (key: string, label: string, c: number | null, p: number | null, lowerIsBetter: boolean, format: Metric["format"]): Metric =>
    ({ key, label, current: c, previous: p, change: change(c, p), lowerIsBetter, format });
  return [
    m("spend", "Spend", cur.spend, prev.spend, false, "money"),
    m("conversions", "Conversions", cur.conversions, prev.conversions, false, "decimal"),
    m("cpa", "Cost per conversion", ratio(cur.spend, cur.conversions), ratio(prev.spend, prev.conversions), true, "money"),
    m("clicks", "Clicks", cur.clicks, prev.clicks, false, "count"),
    m("ctr", "Click-through rate", ratio(cur.clicks, cur.impressions), ratio(prev.clicks, prev.impressions), false, "pct"),
    m("cvr", "Conversion rate", ratio(cur.conversions, cur.clicks), ratio(prev.conversions, prev.clicks), false, "pct"),
    m("cpc", "Cost per click", ratio(cur.spend, cur.clicks), ratio(prev.spend, prev.clicks), true, "money"),
  ];
}

/** The two most recent complete Monday–Sunday weeks. Today is never included. */
export function completeWeeks(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;            // Monday = 0
  const thisMonday = new Date(d.getTime() - dow * 864e5);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 864e5);
  const prevMonday = new Date(thisMonday.getTime() - 14 * 864e5);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return {
    last: { from: iso(lastMonday), to: iso(thisMonday) },
    previous: { from: iso(prevMonday), to: iso(lastMonday) },
  };
}

export type HourCell = { hour: number; spend: number; conversions: number; cpa: number | null; tone: "good" | "mid" | "bad" | "none" };

export async function weeklyReport(clientId: number) {
  const weeks = completeWeeks();
  const [cur, prev] = await Promise.all([
    totals(clientId, weeks.last.from, weeks.last.to),
    totals(clientId, weeks.previous.from, weeks.previous.to),
  ]);

  const campaigns = await q<any>(`
    SELECT c.campaign_id, c.name, c.status, c.channel_type,
           COALESCE(SUM(m.cost_micros) FILTER (WHERE m.date >= $2::date AND m.date < $3::date),0) AS cur_cost,
           COALESCE(SUM(m.conversions) FILTER (WHERE m.date >= $2::date AND m.date < $3::date),0) AS cur_conv,
           COALESCE(SUM(m.cost_micros) FILTER (WHERE m.date >= $4::date AND m.date < $2::date),0) AS prev_cost,
           COALESCE(SUM(m.conversions) FILTER (WHERE m.date >= $4::date AND m.date < $2::date),0) AS prev_conv
      FROM campaigns c
      LEFT JOIN metrics_daily m ON m.entity_type = 'campaign' AND m.entity_id = c.campaign_id AND m.client_id = c.client_id
     WHERE c.client_id = $1
     GROUP BY c.campaign_id, c.name, c.status, c.channel_type
    HAVING COALESCE(SUM(m.cost_micros) FILTER (WHERE m.date >= $4::date AND m.date < $3::date),0) > 0
     ORDER BY 5 DESC
  `, [clientId, weeks.last.from, weeks.last.to, weeks.previous.from]);

  // The shape of a typical week over 90 days.
  const sched = await q<any>(`
    SELECT hour, day_of_week, SUM(cost_micros) AS cost, SUM(conversions) AS conv, SUM(clicks) AS clicks
      FROM schedule_metrics WHERE client_id = $1 GROUP BY hour, day_of_week
  `, [clientId]);
  const totalSpend = sched.reduce((n, r) => n + fromMicros(r.cost), 0);
  const totalConv = sched.reduce((n, r) => n + Number(r.conv), 0);
  const accountCpa = totalConv > 0 ? totalSpend / totalConv : null;

  const hours: HourCell[] = Array.from({ length: 24 }, (_, h) => {
    const rows = sched.filter((r) => Number(r.hour) === h);
    const spend = rows.reduce((n, r) => n + fromMicros(r.cost), 0);
    const conversions = rows.reduce((n, r) => n + Number(r.conv), 0);
    const cpa = conversions > 0 ? spend / conversions : null;
    // Green beats the account's own cost per conversion; red is double it or
    // converts nothing after spending a conversion's worth; amber is between.
    let tone: HourCell["tone"] = "none";
    if (spend > 0 && accountCpa) {
      if (cpa == null) tone = spend >= accountCpa ? "bad" : "mid";
      else if (cpa <= accountCpa) tone = "good";
      else if (cpa >= accountCpa * 2) tone = "bad";
      else tone = "mid";
    }
    return { hour: h, spend, conversions, cpa, tone };
  });

  const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
  const days = DAYS.map((day) => {
    const rows = sched.filter((r) => r.day_of_week === day);
    const spend = rows.reduce((n, r) => n + fromMicros(r.cost), 0);
    const conversions = rows.reduce((n, r) => n + Number(r.conv), 0);
    const clicks = rows.reduce((n, r) => n + Number(r.clicks), 0);
    return { day, spend, clicks, conversions, cpa: conversions > 0 ? spend / conversions : null };
  });

  const devices = await segment(clientId, "device");
  const series = await q<any>(`
    SELECT date::text AS date, COALESCE(SUM(cost_micros),0)/1e6 AS spend, COALESCE(SUM(conversions),0) AS conversions
      FROM metrics_daily WHERE client_id = $1 AND entity_type = 'campaign'
       AND date > CURRENT_DATE - 57 AND date <= CURRENT_DATE - 1
     GROUP BY date ORDER BY date
  `, [clientId]);

  return {
    weeks,
    metrics: metricsFrom(cur, prev),
    campaigns: campaigns.map((c) => {
      const cc = fromMicros(c.cur_cost), pc = fromMicros(c.prev_cost);
      const cv = Number(c.cur_conv), pv = Number(c.prev_conv);
      return {
        id: c.campaign_id, name: c.name, status: c.status, type: c.channel_type,
        spend: cc, spendPrev: pc, spendChange: change(cc, pc),
        conversions: cv, conversionsPrev: pv,
        cpa: ratio(cc, cv), cpaPrev: ratio(pc, pv), cpaChange: change(ratio(cc, cv), ratio(pc, pv)),
      };
    }),
    accountCpa90: accountCpa,
    hours,
    days,
    devices,
    series: series.map((s) => ({ date: s.date, spend: Number(s.spend), conversions: Number(s.conversions) })),
  };
}

// ---------------------------------------------------------------- overview --

export type Health = { level: "good" | "okay" | "poor" | "off"; reason: string };

export async function overview(clientId: number, days: number) {
  const now = new Date();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const to = iso(now);                                   // today excluded (end exclusive)
  const from = iso(new Date(now.getTime() - days * 864e5));
  const prevFrom = iso(new Date(now.getTime() - 2 * days * 864e5));
  const [cur, prev] = await Promise.all([totals(clientId, from, to), totals(clientId, prevFrom, from)]);

  const rows = await q<any>(`
    SELECT c.campaign_id, c.name, c.status, c.channel_type, c.bidding_strategy, c.budget_micros,
           c.primary_status_reasons, c.search_lost_is_budget,
           COALESCE(SUM(m.cost_micros) FILTER (WHERE m.date >= $2::date AND m.date < $3::date),0) AS cost,
           COALESCE(SUM(m.clicks) FILTER (WHERE m.date >= $2::date AND m.date < $3::date),0) AS clicks,
           COALESCE(SUM(m.impressions) FILTER (WHERE m.date >= $2::date AND m.date < $3::date),0) AS imp,
           COALESCE(SUM(m.conversions) FILTER (WHERE m.date >= $2::date AND m.date < $3::date),0) AS conv,
           COALESCE(SUM(m.cost_micros) FILTER (WHERE m.date >= $4::date AND m.date < $2::date),0) AS prev_cost,
           COALESCE(SUM(m.conversions) FILTER (WHERE m.date >= $4::date AND m.date < $2::date),0) AS prev_conv
      FROM campaigns c
      LEFT JOIN metrics_daily m ON m.entity_type = 'campaign' AND m.entity_id = c.campaign_id AND m.client_id = c.client_id
     WHERE c.client_id = $1 AND c.status <> 'REMOVED'
     GROUP BY c.campaign_id, c.name, c.status, c.channel_type, c.bidding_strategy, c.budget_micros,
              c.primary_status_reasons, c.search_lost_is_budget
     ORDER BY 9 DESC
  `, [clientId, from, to, prevFrom]);

  const live = rows.filter((r) => fromMicros(r.cost) > 0);
  const total = { spend: live.reduce((n, r) => n + fromMicros(r.cost), 0), conversions: live.reduce((n, r) => n + Number(r.conv), 0) };
  const accountCpa = total.conversions > 0 ? total.spend / total.conversions : null;
  const needed = zeroConversionMultiple(live.length);

  const campaigns = rows.map((r) => {
    const spend = fromMicros(r.cost), conversions = Number(r.conv), clicks = Number(r.clicks), impressions = Number(r.imp);
    const reasons: string[] = r.primary_status_reasons ?? [];
    let health: Health;
    if (r.status !== "ENABLED") health = { level: "off", reason: "Not running" };
    else if (reasons.some((x) => /DISAPPROVED|MISCONFIGURED|NO_ADS/.test(x))) health = { level: "poor", reason: "Google reports a serving problem" };
    else if (spend === 0) health = { level: "okay", reason: "No spend in this period" };
    else if (!accountCpa) health = { level: "okay", reason: "No conversions anywhere in the account to compare against" };
    else if (conversions === 0) {
      health = spend / accountCpa >= needed
        ? { level: "poor", reason: `Spent ${(spend / accountCpa).toFixed(1)}× the account's cost per conversion with none` }
        : { level: "okay", reason: "No conversions yet, but not enough spend to judge" };
    } else {
      const t = testSegment({ spend, conversions }, total, live.length, "worse");
      health = t.significant
        ? { level: "poor", reason: "Cost per conversion significantly worse than the rest of the account" }
        : t.signal
          ? { level: "okay", reason: "Looks more expensive, but not yet evidence" }
          : { level: "good", reason: "Converting in line with the account or better" };
    }
    return {
      id: r.campaign_id, name: r.name, status: r.status, type: r.channel_type, strategy: r.bidding_strategy,
      dailyBudget: r.budget_micros ? fromMicros(r.budget_micros) : null,
      spend, clicks, impressions, conversions,
      cpa: conversions > 0 ? spend / conversions : null,
      ctr: impressions > 0 ? clicks / impressions : null,
      spendChange: change(spend, fromMicros(r.prev_cost)),
      conversionsPrev: Number(r.prev_conv),
      lostToBudget: r.search_lost_is_budget != null ? Number(r.search_lost_is_budget) : null,
      health,
    };
  });

  const series = await q<any>(`
    SELECT date::text AS date, COALESCE(SUM(cost_micros),0)/1e6 AS spend, COALESCE(SUM(conversions),0) AS conversions
      FROM metrics_daily WHERE client_id = $1 AND entity_type = 'campaign' AND date >= $2::date AND date < $3::date
     GROUP BY date ORDER BY date
  `, [clientId, days < 30 ? iso(new Date(now.getTime() - 30 * 864e5)) : from, to]);

  const cpa = ratio(cur.spend, cur.conversions), prevCpa = ratio(prev.spend, prev.conversions);
  return {
    days, from, to,
    totals: cur, previous: prev,
    metrics: metricsFrom(cur, prev),
    cpa, prevCpa, cpaChange: change(cpa, prevCpa),
    clicksWithoutConversions: cur.clicks >= 50 && cur.conversions === 0,
    campaigns,
    series: series.map((s) => ({ date: s.date, spend: Number(s.spend), conversions: Number(s.conversions) })),
  };
}
