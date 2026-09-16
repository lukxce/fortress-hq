import { q } from "@/lib/db";
import { fromMicros } from "./metrics";
import type { Finding } from "./findings";
import { testSegment } from "./stats";

// The findings a good teardown makes and a dashboard cannot: where the traffic
// physically went, when the account changed, and what it is actually optimising
// toward. These are causes rather than symptoms.


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
  // "Cheap" is relative to this account's own cost per click. A fixed 0.15 was a
  // few cents in euros and could never fire in dinars, where no click costs 0.15.
  const avgCpc = totalSpend / totalClicks;
  const cheapCpc = avgCpc * 0.25;
  const cheap = mapped.filter((p) => p.clicks >= 200 && p.spend / Math.max(p.clicks, 1) < cheapCpc);
  const cheapClicks = cheap.reduce((n, p) => n + p.clicks, 0);
  if (cheapClicks / totalClicks > 0.25) {
    const cheapSpend = cheap.reduce((n, p) => n + p.spend, 0);
    const cheapConv = cheap.reduce((n, p) => n + p.conversions, 0);
    out.push({
      kind: "placement_cheap_click_flood",
      severity: cheapConv === 0 ? "critical" : "warning",
      title: `${((cheapClicks / totalClicks) * 100).toFixed(0)}% of clicks cost under a quarter of the account's average click`,
      detail: `${cheapClicks.toLocaleString()} clicks came from placements averaging under ${cheapCpc.toFixed(2)} a click (the account average is ${avgCpc.toFixed(2)}), for only ${((cheapSpend / Math.max(totalSpend, 1)) * 100).toFixed(0)}% of spend${cheapConv === 0 ? " and no conversions" : ""}. A click that cheap is not interest, it is an accidental tap on junk inventory. It distorts every blended click-through and conversion rate in the account, and teaches the bid algorithm the wrong thing.`,
      evidence: {
        cheapClicks, cheapSpend, cheapConversions: cheapConv, avgCpc, cheapCpc,
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
    (p) => p.conversions > 0 && p.clicks >= 100 && p.spend / Math.max(p.clicks, 1) < avgCpc * 0.5
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
 * "Cost per conversion is up" prompts nothing. "It doubled from May, when spend
 * tripled, and the campaign that changed is this one" prompts an action.
 */
export async function inflectionFindings(clientId: number): Promise<Finding[]> {
  // The current month is always incomplete and still filling in with lagged
  // conversions, so it always looks worse than it is. It is left out.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const months = (await monthlyShape(clientId)).filter(
    (m) => m.spend > 0 && m.month.slice(0, 7) !== thisMonth
  );
  if (months.length < 4) return [];

  // Find the month where cost per conversion shifted, rather than comparing the
  // best month with the latest one. "Best of twelve" is partly best by luck, and
  // a first month of data is often a partial one. Every split with at least two
  // complete months either side is tested; the correction is for the number of
  // splits tried.
  type Split = {
    at: number; before: { spend: number; conversions: number }; after: { spend: number; conversions: number };
    p: number; expected: number; significant: boolean;
  };
  const sum = (xs: MonthRow[]) => ({
    spend: xs.reduce((n, m) => n + m.spend, 0),
    conversions: xs.reduce((n, m) => n + m.conversions, 0),
  });
  const splits: Split[] = [];
  const looks = months.length - 3;
  for (let at = 2; at <= months.length - 2; at++) {
    const before = sum(months.slice(0, at));
    const after = sum(months.slice(at));
    if (before.conversions < 1 || after.conversions < 1) continue;
    const test = testSegment(
      after,
      { spend: before.spend + after.spend, conversions: before.conversions + after.conversions },
      looks,
      "worse"
    );
    splits.push({ at, before, after, p: test.p, expected: test.expected, significant: test.significant });
  }

  const found = splits.filter((x) => x.significant).sort((a, b) => a.p - b.p)[0];
  if (!found) return [];

  const beforeCpa = found.before.spend / found.before.conversions;
  const afterCpa = found.after.spend / found.after.conversions;
  const worse = ((afterCpa - beforeCpa) / beforeCpa) * 100;
  if (worse < 30) return [];

  const last = months[found.at - 1];
  const first = months[found.at];
  const beforeMonths = found.at;
  const afterMonths = months.length - found.at;
  const spendPerMonthBefore = found.before.spend / beforeMonths;
  const spendPerMonthAfter = found.after.spend / afterMonths;
  const spendChange = ((spendPerMonthAfter - spendPerMonthBefore) / spendPerMonthBefore) * 100;
  const convPerMonthBefore = found.before.conversions / beforeMonths;
  const convPerMonthAfter = found.after.conversions / afterMonths;
  // What each *additional* conversion cost once spend rose. The average hides
  // it: the first conversions were cheap and still are.
  const extraConv = convPerMonthAfter - convPerMonthBefore;
  const marginalCpa = extraConv > 0 ? (spendPerMonthAfter - spendPerMonthBefore) / extraConv : null;

  const movers = await q<any>(`
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
         ORDER BY ABS(COALESCE(a.cost_micros,0) - COALESCE(b.cost_micros,0)) DESC
         LIMIT 5
      `, [clientId, last.month, first.month]);

  const biggest = movers[0];
  const monthName = (m: string) =>
    new Date(m).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  // Spend rising sharply at the same moment is the commonest cause and the most
  // useful thing to say: the extra budget bought dearer conversions.
  const scaled = spendChange > 50;
  const title = scaled
    ? `Since ${monthName(first.month)} spend is up ${spendChange.toFixed(0)}% and each conversion costs ${worse.toFixed(0)}% more`
    : `Cost per conversion has run ${worse.toFixed(0)}% higher since ${monthName(first.month)}`;

  return [{
    kind: "performance_inflection",
    severity: worse > 80 ? "critical" : "warning",
    title,
    detail:
      `Through ${monthName(last.month)} the account converted at ${beforeCpa.toFixed(2)} (${found.before.conversions.toFixed(0)} conversions over ${beforeMonths} months, about ${spendPerMonthBefore.toFixed(0)} a month). From ${monthName(first.month)} it has converted at ${afterCpa.toFixed(2)} (${found.after.conversions.toFixed(0)} over ${afterMonths} complete months, about ${spendPerMonthAfter.toFixed(0)} a month) — ${found.after.conversions.toFixed(0)} conversions where the earlier rate predicts ${found.expected.toFixed(0)}, a gap chance does not explain.` +
      (scaled
        ? (marginalCpa !== null && spendPerMonthAfter > spendPerMonthBefore
            ? ` The extra ${(spendPerMonthAfter - spendPerMonthBefore).toFixed(0)} a month bought about ${extraConv.toFixed(1)} more conversions a month — roughly ${marginalCpa.toFixed(0)} for each additional one, against an average of ${afterCpa.toFixed(0)}. In a thin auction the cheap demand is usually already captured, and more money reaches weaker queries, placements and hours. Whether the extra budget is worth it depends on whether a lead is worth ${marginalCpa.toFixed(0)} to this business, not ${afterCpa.toFixed(0)}.`
            : ` Spend rose but conversions did not, so the additional budget bought nothing measurable.`)
        : ``) +
      (biggest
        ? ` The campaign that changed most between ${monthName(last.month)} and ${monthName(first.month)} was "${biggest.name}", from ${fromMicros(biggest.before_cost).toFixed(0)} to ${fromMicros(biggest.after_cost).toFixed(0)} of spend. That is where to look first.`
        : ``),
    evidence: {
      changedFrom: first.month, beforeCpa, afterCpa, worseByPct: worse,
      spendPerMonthBefore, spendPerMonthAfter, spendChangePct: spendChange,
      conversionsPerMonthBefore: convPerMonthBefore, conversionsPerMonthAfter: convPerMonthAfter, marginalCpa,
      expectedConversions: found.expected, p: found.p,
      months: months.map((m) => ({ month: m.month, spend: m.spend, clicks: m.clicks, conversions: m.conversions, cpa: m.cpa })),
      biggestMovers: movers.map((m) => ({
        campaign: m.name,
        clicksBefore: Number(m.before_clicks ?? 0), clicksAfter: Number(m.after_clicks ?? 0),
        spendBefore: fromMicros(m.before_cost), spendAfter: fromMicros(m.after_cost),
        conversionsBefore: Number(m.before_conv ?? 0), conversionsAfter: Number(m.after_conv ?? 0),
      })),
    },
    moneyAtStake: found.after.spend - found.after.conversions * beforeCpa,
    // The excess accrued over every month since the change, not one.
    windowDays: Math.round(afterMonths * 30.4),
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
 * Uncapped value bidding.
 *
 * This used to flag every maximise strategy without a target and recommend
 * adding one "as a ceiling". The research of 2026-09-16 reversed that: Google
 * lets Target CPA start with no history and itself suggests removing tCPA when
 * data is thin; the one large study (Optmyzr, 14,584 accounts) found setting a
 * target more likely to hurt than help; and since 17 August 2026 a
 * budget-limited campaign with a target spends *up to* it. Maximise Conversions
 * without a target is the recommended state for a small account, not a risk.
 *
 * What remains worth saying: Maximise Conversion Value with no target tries to
 * spend the whole budget chasing value, and if the values are not genuinely
 * different it is chasing noise.
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
    r.bidding_strategy === "MAXIMIZE_CONVERSION_VALUE" && !r.target_roas && fromMicros(r.spend) > 0
  );
  if (!uncapped.length) return [];

  const spend = uncapped.reduce((n, r) => n + fromMicros(r.spend), 0);
  return [{
    kind: "bidding_value_uncapped",
    severity: "info",
    title: `${uncapped.length} campaign${uncapped.length === 1 ? "" : "s"} maximise conversion value with no return target`,
    detail: `${uncapped.slice(0, 3).map((r) => `"${r.name}"`).join(", ")} ${uncapped.length === 1 ? "runs" : "run"} value bidding with no target, on ${spend.toFixed(0)} of spend. Google says that strategy tries to spend the full budget. That is fine when conversion values are real and different; if every conversion carries the same value, it is count bidding with a misleading column. Do not add a target merely as a ceiling on a low-volume account — targets there tend to cost volume.`,
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
  const accountCpa = totalSpend / totalConv;
  const total = { spend: totalSpend, conversions: totalConv };

  // "Better than average" must survive the same test as "worse": the campaign's
  // conversions have to exceed what its share of spend predicts by more than
  // chance, corrected for how many campaigns were compared.
  const winners = mapped.filter((r) =>
    r.limited && r.cpa < accountCpa * 0.8
    && testSegment(r, total, mapped.length, "better").significant
  );
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
    // underfundedFindings is superseded by budget_capped_winner (actionable.ts),
    // which reads lost impression share to budget rather than a status Google
    // sets by design on Maximise Conversions.
  ]);
  return groups.flat();
}
