import { q } from "@/lib/db";
import { fromMicros } from "./metrics";
import type { Finding } from "./findings";

// The findings a good teardown makes and a dashboard cannot: where the traffic
// physically went, when the account changed, and what it is actually optimising
// toward. These are causes rather than symptoms.

const MIN_SPEND = 40;

// ------------------------------------------------------------ placements ---

/**
 * Junk placement detection.
 *
 * The pattern that matters is not expensive placements — it is cheap ones. A
 * flood of five-cent clicks from mobile apps costs little and poisons the bid
 * algorithm, because the algorithm cannot tell junk traffic that registers from
 * real traffic that registers. Money damage and signal damage are different
 * things, and the second is usually the larger.
 */
export async function placementFindings(clientId: number): Promise<Finding[]> {
  const rows = await q<any>(`
    SELECT placement, display_name, placement_type, target_url,
           SUM(clicks) AS clicks, SUM(cost_micros) AS cost_micros,
           SUM(conversions) AS conversions, SUM(impressions) AS impressions
      FROM placements WHERE client_id = $1
     GROUP BY placement, display_name, placement_type, target_url
  `, [clientId]);
  if (!rows.length) return [];

  const mapped = rows.map((r) => ({
    placement: r.placement,
    name: r.display_name || r.placement,
    type: r.placement_type as string | null,
    clicks: Number(r.clicks ?? 0),
    spend: fromMicros(r.cost_micros),
    conversions: Number(r.conversions ?? 0),
  }));

  const totalClicks = mapped.reduce((n, p) => n + p.clicks, 0);
  const totalSpend = mapped.reduce((n, p) => n + p.spend, 0);
  if (totalClicks < 500) return [];

  const out: Finding[] = [];

  // Mobile app inventory, which is where the junk overwhelmingly lives.
  const apps = mapped.filter((p) => p.type === "MOBILE_APPLICATION");
  const appClicks = apps.reduce((n, p) => n + p.clicks, 0);
  const appConv = apps.reduce((n, p) => n + p.conversions, 0);
  const appSpend = apps.reduce((n, p) => n + p.spend, 0);

  if (appClicks > 0 && appClicks / totalClicks > 0.15 && appConv === 0) {
    const top = [...apps].sort((a, b) => b.clicks - a.clicks).slice(0, 6);
    out.push({
      kind: "placement_mobile_app_flood",
      severity: "critical",
      title: `Mobile apps took ${((appClicks / totalClicks) * 100).toFixed(0)}% of all clicks and converted nothing`,
      detail: `${appClicks.toLocaleString()} clicks from app inventory for ${appSpend.toFixed(0)}, with no conversions. The money is small; the damage is that Smart Bidding treats this as the traffic you want and buys more of it. ${top[0].name} alone accounts for ${top[0].clicks.toLocaleString()} clicks. Exclude app inventory at account level — Performance Max serves the same placements and can only be excluded there.`,
      evidence: {
        appClicks, appSpend, shareOfClicks: (appClicks / totalClicks) * 100,
        shareOfSpend: totalSpend > 0 ? (appSpend / totalSpend) * 100 : 0,
        topApps: top.map((p) => ({ name: p.name, clicks: p.clicks, spend: p.spend, conversions: p.conversions })),
      },
      moneyAtStake: appSpend,
    });
  }

  // The cheap-click flood, whatever its type. A placement buying a large share
  // of clicks for a trivial share of spend is the signature.
  const cheap = mapped.filter((p) => p.clicks >= 200 && p.spend / Math.max(p.clicks, 1) < 0.15);
  const cheapClicks = cheap.reduce((n, p) => n + p.clicks, 0);
  if (cheapClicks / totalClicks > 0.25) {
    const cheapSpend = cheap.reduce((n, p) => n + p.spend, 0);
    const cheapConv = cheap.reduce((n, p) => n + p.conversions, 0);
    out.push({
      kind: "placement_cheap_click_flood",
      severity: cheapConv === 0 ? "critical" : "warning",
      title: `${((cheapClicks / totalClicks) * 100).toFixed(0)}% of clicks cost under 0.15 each`,
      detail: `${cheapClicks.toLocaleString()} clicks came from placements averaging a few cents, for only ${((cheapSpend / Math.max(totalSpend, 1)) * 100).toFixed(0)}% of spend${cheapConv === 0 ? " and no conversions" : ""}. A click that cheap is not interest, it is an accidental tap on junk inventory. It distorts every blended click-through and conversion rate in the account, and teaches the bid algorithm the wrong thing.`,
      evidence: {
        cheapClicks, cheapSpend, cheapConversions: cheapConv,
        shareOfClicks: (cheapClicks / totalClicks) * 100,
        shareOfSpend: totalSpend > 0 ? (cheapSpend / totalSpend) * 100 : 0,
        placements: [...cheap].sort((a, b) => b.clicks - a.clicks).slice(0, 8)
          .map((p) => ({ name: p.name, type: p.type, clicks: p.clicks, spend: p.spend, conversions: p.conversions })),
      },
      moneyAtStake: cheapSpend,
    });
  }

  // A placement that converts suspiciously well for junk inventory is worse than
  // one that never converts: it manufactures a success signal.
  const suspicious = mapped.filter(
    (p) => p.conversions > 0 && p.clicks >= 100 && p.spend / Math.max(p.clicks, 1) < 0.5
      && (p.type === "MOBILE_APPLICATION" || /job|quiz|cleaner|search[a-z]*\.(com|net)/i.test(p.name))
  );
  if (suspicious.length) {
    out.push({
      kind: "placement_false_signal",
      severity: "critical",
      title: `Junk placements are producing conversions, which is worse than producing none`,
      detail: `${suspicious.map((p) => `"${p.name}"`).slice(0, 3).join(", ")} converted on very cheap traffic. A bid strategy optimising for conversions reads that as success and buys more of it. If a free signup or a low-intent action counts as a conversion, junk inventory can manufacture the signal — the placement problem and the conversion-counting problem are the same problem.`,
      evidence: {
        placements: suspicious.slice(0, 6).map((p) => ({
          name: p.name, type: p.type, clicks: p.clicks,
          spend: p.spend, conversions: p.conversions,
          cpc: p.spend / Math.max(p.clicks, 1),
        })),
      },
    });
  }

  return out;
}

// -------------------------------------------------------------- when -------

export type MonthRow = {
  month: string; spend: number; clicks: number; conversions: number;
  cpa: number | null; cpc: number | null;
};

export async function monthlyShape(clientId: number): Promise<MonthRow[]> {
  const rows = await q<any>(`
    SELECT month::text AS month,
           SUM(cost_micros) AS cost_micros, SUM(clicks) AS clicks,
           SUM(conversions) AS conversions
      FROM monthly_metrics WHERE client_id = $1
     GROUP BY month ORDER BY month
  `, [clientId]);

  return rows.map((r) => {
    const spend = fromMicros(r.cost_micros);
    const conversions = Number(r.conversions ?? 0);
    const clicks = Number(r.clicks ?? 0);
    return {
      month: r.month, spend, clicks, conversions,
      cpa: conversions > 0 ? spend / conversions : null,
      cpc: clicks > 0 ? spend / clicks : null,
    };
  });
}

/**
 * When did it change, and what changed with it.
 *
 * "Cost per conversion is up" prompts nothing. "It doubled in July, and the
 * campaign that changed is this one, which went from 7,000 clicks to 61,000"
 * prompts an action.
 */
export async function inflectionFindings(clientId: number): Promise<Finding[]> {
  const months = await monthlyShape(clientId);
  const usable = months.filter((m) => m.spend >= MIN_SPEND && m.conversions >= 3);
  if (usable.length < 3) return [];

  const best = usable.reduce((a, b) => (a.cpa! <= b.cpa! ? a : b));
  const recent = usable[usable.length - 1];
  if (best.month === recent.month) return [];

  const worse = ((recent.cpa! - best.cpa!) / best.cpa!) * 100;
  if (worse < 30) return [];

  // The month immediately after the best one is where the change began.
  const bestIdx = months.findIndex((m) => m.month === best.month);
  const after = months[bestIdx + 1];

  const movers = after
    ? await q<any>(`
        SELECT c.name, c.campaign_id,
               b.clicks AS before_clicks, a.clicks AS after_clicks,
               b.cost_micros AS before_cost, a.cost_micros AS after_cost,
               b.conversions AS before_conv, a.conversions AS after_conv
          FROM monthly_metrics b
          JOIN monthly_metrics a
            ON a.campaign_id = b.campaign_id AND a.client_id = b.client_id
           AND a.month = $3::date
          JOIN campaigns c ON c.campaign_id = b.campaign_id AND c.client_id = b.client_id
         WHERE b.client_id = $1 AND b.month = $2::date
         ORDER BY ABS(COALESCE(a.clicks,0) - COALESCE(b.clicks,0)) DESC
         LIMIT 5
      `, [clientId, best.month, after.month])
    : [];

  const biggest = movers[0];
  const clickSwing = biggest
    ? Number(biggest.after_clicks ?? 0) - Number(biggest.before_clicks ?? 0)
    : 0;

  const monthName = (m: string) =>
    new Date(m).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return [{
    kind: "performance_inflection",
    severity: worse > 80 ? "critical" : "warning",
    title: `${monthName(best.month)} was the best month — cost per conversion is now ${worse.toFixed(0)}% higher`,
    detail: `${monthName(best.month)} converted at ${best.cpa!.toFixed(2)} on ${best.spend.toFixed(0)} of spend. ${monthName(recent.month)} is running at ${recent.cpa!.toFixed(2)}.` +
      (biggest && Math.abs(clickSwing) > 500
        ? ` The largest change between ${monthName(best.month)} and ${monthName(after!.month)} was "${biggest.name}", which went from ${Number(biggest.before_clicks).toLocaleString()} clicks to ${Number(biggest.after_clicks).toLocaleString()}. That is where to look first.`
        : ` Compare the months rather than the last thirty days — the change has a date.`),
    evidence: {
      bestMonth: best, recentMonth: recent, worseByPct: worse,
      months: months.map((m) => ({ month: m.month, spend: m.spend, clicks: m.clicks, conversions: m.conversions, cpa: m.cpa })),
      biggestMovers: movers.map((m) => ({
        campaign: m.name,
        clicksBefore: Number(m.before_clicks ?? 0), clicksAfter: Number(m.after_clicks ?? 0),
        spendBefore: fromMicros(m.before_cost), spendAfter: fromMicros(m.after_cost),
        conversionsBefore: Number(m.before_conv ?? 0), conversionsAfter: Number(m.after_conv ?? 0),
      })),
    },
    moneyAtStake: recent.conversions * (recent.cpa! - best.cpa!),
  }];
}

// ------------------------------------------------ conversion composition ---

/**
 * What the account is actually optimising toward.
 *
 * A healthy-looking conversion total can be one worthless action repeated. The
 * bid algorithm buys whatever is in that column, so composition is the setting
 * that decides what the whole account becomes.
 */
export async function compositionFindings(clientId: number): Promise<Finding[]> {
  const rows = await q<any>(`
    SELECT cb.action_name, cb.action_id, SUM(cb.conversions) AS conversions,
           ca.category, ca.include_in_conversions, ca.counting_type
      FROM conversion_breakdown cb
      LEFT JOIN conversion_actions ca
        ON ca.action_id = cb.action_id AND ca.client_id = cb.client_id
     WHERE cb.client_id = $1 AND cb.month >= date_trunc('month', CURRENT_DATE) - interval '12 months'
     GROUP BY cb.action_name, cb.action_id, ca.category, ca.include_in_conversions, ca.counting_type
     ORDER BY SUM(cb.conversions) DESC
  `, [clientId]);
  if (rows.length < 2) return [];

  const counted = rows.filter((r) => r.include_in_conversions !== false);
  const total = counted.reduce((n, r) => n + Number(r.conversions ?? 0), 0);
  if (total < 50) return [];

  const out: Finding[] = [];
  const top = counted[0];
  const topShare = (Number(top.conversions) / total) * 100;

  if (topShare > 85 && counted.length > 1) {
    const rest = counted.slice(1, 5).map((r) => `${r.action_name} (${Number(r.conversions).toFixed(0)})`);
    out.push({
      kind: "conversion_composition_skewed",
      severity: "critical",
      title: `${topShare.toFixed(0)}% of conversions are a single action: "${top.action_name}"`,
      detail: `Of ${total.toFixed(0)} conversions over twelve months, ${Number(top.conversions).toFixed(0)} are "${top.action_name}". Smart Bidding buys whatever sits in the Conversions column, so the account is optimising almost entirely toward that one action — and it will find the cheapest possible source of it. ${rest.length ? `Everything else is marginal: ${rest.join(", ")}.` : ""} If that action is not what the business is actually worth, the whole account is pointed at the wrong target.`,
      evidence: {
        total,
        breakdown: counted.slice(0, 8).map((r) => ({
          action: r.action_name, conversions: Number(r.conversions),
          share: (Number(r.conversions) / total) * 100,
          category: r.category, counting: r.counting_type,
        })),
      },
    });
  }

  // Actions that are enabled and counted but have recorded almost nothing over a
  // year are broken tags far more often than they are unused features.
  const silent = counted.filter((r) => Number(r.conversions) <= 2 && r.include_in_conversions);
  if (silent.length && total > 200) {
    out.push({
      kind: "conversion_action_likely_broken",
      severity: "warning",
      title: `${silent.length} counted conversion action${silent.length === 1 ? " has" : "s have"} recorded almost nothing in a year`,
      detail: `${silent.slice(0, 4).map((r) => `"${r.action_name}"`).join(", ")} ${silent.length === 1 ? "is" : "are"} enabled and included in Conversions but effectively silent, while the account recorded ${total.toFixed(0)} conversions overall. A high-intent action that never fires is usually a broken tag rather than an unpopular one — and it is often the action that would actually match the business outcome.`,
      evidence: {
        actions: silent.slice(0, 6).map((r) => ({
          action: r.action_name, conversions: Number(r.conversions), category: r.category,
        })),
        accountTotal: total,
      },
    });
  }

  return out;
}

// ------------------------------------------------------ bid strategy risk --

/**
 * A bid strategy with no ceiling, on an account whose conversion signal is
 * suspect, is how a junk-traffic flood turns into a month of ruined spend.
 */
export async function biddingFindings(clientId: number): Promise<Finding[]> {
  const rows = await q<any>(`
    SELECT c.name, c.campaign_id, c.bidding_strategy, c.target_cpa_micros, c.target_roas,
           COALESCE(SUM(m.cost_micros),0) AS spend,
           COALESCE(SUM(m.conversions),0) AS conversions
      FROM campaigns c
      LEFT JOIN metrics_daily m
        ON m.entity_id = c.campaign_id AND m.entity_type = 'campaign'
       AND m.date > CURRENT_DATE - 31
     WHERE c.client_id = $1 AND c.status = 'ENABLED'
     GROUP BY c.name, c.campaign_id, c.bidding_strategy, c.target_cpa_micros, c.target_roas
  `, [clientId]);

  const uncapped = rows.filter((r) =>
    /MAXIMIZE_CONVERSIONS|MAXIMIZE_CONVERSION_VALUE|TARGET_SPEND|MAXIMIZE_CLICKS/.test(r.bidding_strategy ?? "")
    && !r.target_cpa_micros && !r.target_roas
    && fromMicros(r.spend) >= MIN_SPEND
  );
  if (!uncapped.length) return [];

  const spend = uncapped.reduce((n, r) => n + fromMicros(r.spend), 0);
  return [{
    kind: "bidding_no_ceiling",
    severity: "warning",
    title: `${uncapped.length} campaign${uncapped.length === 1 ? "" : "s"} bid without any cost ceiling`,
    detail: `${uncapped.slice(0, 3).map((r) => `"${r.name}"`).join(", ")} ${uncapped.length === 1 ? "runs" : "run"} a maximise strategy with no target cost per conversion or target return, on ${spend.toFixed(0)} of spend. Maximise will spend the full budget on whatever converts most cheaply, which is exactly how a flood of junk traffic becomes a month of wasted spend. A target gives the algorithm a ceiling it cannot spend past.`,
    evidence: {
      campaigns: uncapped.map((r) => ({
        campaign: r.name, strategy: r.bidding_strategy,
        spend: fromMicros(r.spend), conversions: Number(r.conversions),
      })),
    },
  }];
}

// ------------------------------------------------- underfunded winners -----

/**
 * The counter-intuitive one. A campaign constrained by budget while performing
 * better than the account average is the cheapest available improvement, and it
 * looks like a problem campaign in every default report.
 */
export async function underfundedFindings(clientId: number): Promise<Finding[]> {
  const rows = await q<any>(`
    SELECT c.name, c.campaign_id, c.budget_micros, c.primary_status_reasons,
           COALESCE(SUM(m.cost_micros),0) AS spend,
           COALESCE(SUM(m.conversions),0) AS conversions
      FROM campaigns c
      JOIN metrics_daily m
        ON m.entity_id = c.campaign_id AND m.entity_type = 'campaign'
       AND m.date > CURRENT_DATE - 31
     WHERE c.client_id = $1 AND c.status = 'ENABLED'
     GROUP BY c.name, c.campaign_id, c.budget_micros, c.primary_status_reasons
    HAVING SUM(m.conversions) > 0
  `, [clientId]);
  if (rows.length < 2) return [];

  const mapped = rows.map((r) => {
    const spend = fromMicros(r.spend);
    const conversions = Number(r.conversions);
    return {
      name: r.name, campaignId: r.campaign_id,
      spend, conversions, cpa: spend / conversions,
      limited: (r.primary_status_reasons ?? []).some((x: string) => /BUDGET/i.test(x)),
    };
  });

  const totalSpend = mapped.reduce((n, r) => n + r.spend, 0);
  const totalConv = mapped.reduce((n, r) => n + r.conversions, 0);
  if (totalConv < 5) return [];
  const accountCpa = totalSpend / totalConv;

  const winners = mapped.filter((r) => r.limited && r.cpa < accountCpa * 0.8);
  if (!winners.length) return [];

  return [{
    kind: "underfunded_winner",
    severity: "warning",
    title: `${winners.length === 1 ? "A campaign that beats the account average is" : `${winners.length} campaigns that beat the account average are`} capped by budget`,
    detail: `${winners.map((r) => `"${r.name}" converts at ${r.cpa.toFixed(2)}`).slice(0, 3).join(", ")}, against an account average of ${accountCpa.toFixed(2)} — and Google reports ${winners.length === 1 ? "it is" : "they are"} limited by budget. This is the cheapest improvement available: the money is already working, it is just being rationed.`,
    evidence: {
      accountCpa,
      campaigns: winners.map((r) => ({
        campaign: r.name, cpa: r.cpa, spend: r.spend, conversions: r.conversions,
        betterThanAverageBy: ((accountCpa - r.cpa) / accountCpa) * 100,
      })),
    },
  }];
}

export async function forensicFindings(clientId: number): Promise<Finding[]> {
  const groups = await Promise.all([
    placementFindings(clientId),
    inflectionFindings(clientId),
    compositionFindings(clientId),
    biddingFindings(clientId),
    underfundedFindings(clientId),
  ]);
  return groups.flat();
}
