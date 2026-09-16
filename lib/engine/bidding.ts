import { q } from "@/lib/db";
import { fromMicros } from "./metrics";
import type { Finding } from "./findings";

// Findings built on what Google itself reports about a bid strategy's health.
// These replace guesswork with the platform's own verdict, and they are free:
// every field is already on a query the sync runs.

// Two different floors, routinely conflated. Fifteen a month is what Google
// *permits*; around fifty is what makes the result *trustworthy*. Below thirty,
// measured target attainment on Performance Max swings between −100% and +400%,
// so any judgement about whether a target is met is noise.
const FLOOR_PERMITTED = 15;
const FLOOR_TRUSTWORTHY = 30;

/** Google's own diagnosis of why a bid strategy is constrained. */
const STATUS_MEANING: Record<string, { severity: Finding["severity"]; title: string; detail: string }> = {
  LIMITED_BY_DATA: {
    severity: "warning",
    title: "Not enough conversions for the bid strategy to learn",
    detail:
      "Google reports this strategy has had too little conversion traffic in recent weeks. Smart Bidding cannot converge on a target it has no evidence for, so it behaves unpredictably rather than badly. Either consolidate campaigns so the signal pools, or move to a strategy that does not need conversion volume.",
  },
  LIMITED_BY_LOW_QUALITY: {
    severity: "warning",
    title: "Low quality scores are constraining the bidding",
    detail:
      "Google reports a significant share of this campaign's keywords carry a low quality score. Unlike the score itself, which is only diagnostic, this is a real bidding constraint: the campaign is paying more per click for a worse position than its bids should buy.",
  },
  LIMITED_BY_INVENTORY: {
    severity: "warning",
    title: "Targeting is too narrow to spend the budget",
    detail:
      "Google reports this campaign cannot spend its budget because targeting is too restrictive. In a thin auction that is common and often correct, but it means budget increases will do nothing until targeting widens.",
  },
  LIMITED_BY_CPC_BID_CEILING: {
    severity: "warning",
    title: "A maximum bid limit is holding the strategy back",
    detail:
      "The bid ceiling is binding, so the strategy is declining auctions it would otherwise enter. Google advises against bid limits on target-based strategies precisely because they prevent the optimisation they sit on top of.",
  },
  MISCONFIGURED_CONVERSION_SETTINGS: {
    severity: "critical",
    title: "The bid strategy's conversion settings are misconfigured",
    detail:
      "Google reports the conversion configuration behind this bid strategy is wrong. Everything the strategy does is downstream of that, so no performance figure for this campaign can be trusted until it is fixed.",
  },
  MISCONFIGURED_CONVERSION_TYPES: {
    severity: "critical",
    title: "The bid strategy's conversion types are misconfigured",
    detail:
      "Google reports a problem with which conversion types feed this strategy. It is optimising toward something other than what was intended.",
  },
  MISCONFIGURED_ZERO_ELIGIBILITY: {
    severity: "critical",
    title: "This campaign is not eligible to serve",
    detail: "Google reports zero eligibility. It cannot enter an auction at all.",
  },
};

export async function biddingHealthFindings(clientId: number): Promise<Finding[]> {
  const rows = await q<any>(`
    SELECT c.name, c.campaign_id, c.bidding_strategy, c.bid_strategy_status,
           c.avg_target_cpa_micros, c.avg_target_roas,
           c.budget_micros, c.recommended_budget_micros,
           COALESCE(SUM(m.cost_micros),0) AS spend,
           COALESCE(SUM(m.conversions),0) AS conversions
      FROM campaigns c
      LEFT JOIN metrics_daily m
        ON m.entity_id = c.campaign_id AND m.entity_type = 'campaign'
       AND m.date > CURRENT_DATE - 31 AND m.date <= CURRENT_DATE - 1
     WHERE c.client_id = $1 AND c.status = 'ENABLED'
     GROUP BY c.name, c.campaign_id, c.bidding_strategy, c.bid_strategy_status,
              c.avg_target_cpa_micros, c.avg_target_roas,
              c.budget_micros, c.recommended_budget_micros
  `, [clientId]);
  if (!rows.length) return [];

  const out: Finding[] = [];

  for (const r of rows) {
    const spend = fromMicros(r.spend);
    const conversions = Number(r.conversions ?? 0);
    const targetCpa = r.avg_target_cpa_micros ? fromMicros(r.avg_target_cpa_micros) : null;
    const targetRoas = r.avg_target_roas ? Number(r.avg_target_roas) : null;
    const hasTarget = Boolean(targetCpa || targetRoas);

    // Google's own verdict, where it has one worth surfacing.
    const meaning = STATUS_MEANING[r.bid_strategy_status ?? ""];
    if (meaning && spend > 0) {
      out.push({
        kind: `bid_${(r.bid_strategy_status as string).toLowerCase()}`,
        severity: meaning.severity,
        title: `${r.name}: ${meaning.title.toLowerCase()}`,
        detail: meaning.detail,
        evidence: { status: r.bid_strategy_status, spend, conversions },
        entityType: "campaign",
        entityId: r.campaign_id,
      });
    }

    // A target on a campaign with too little volume to satisfy it. This is the
    // most common structural mistake on a small account, and it is invisible in
    // every default report.
    if (hasTarget && spend >= 40 && conversions < FLOOR_TRUSTWORTHY) {
      const belowPermitted = conversions < FLOOR_PERMITTED;
      out.push({
        kind: "target_below_volume_floor",
        severity: belowPermitted ? "warning" : "info",
        title: `${r.name} has a ${targetCpa ? "cost" : "return"} target but only ${conversions.toFixed(0)} conversions a month`,
        detail: belowPermitted
          ? `A target needs roughly 30 conversions a month before the algorithm can converge on it, and around 15 before conversion-based bidding works at all. At ${conversions.toFixed(0)} the target is an instruction the strategy cannot satisfy, so it behaves unpredictably rather than efficiently. Either consolidate campaigns so the signal pools, or drop to maximising clicks with a cost ceiling until volume supports a target.`
          : `Between 15 and 30 conversions a month, a target works but its results are not yet trustworthy — measured attainment swings widely at this volume. Treat this campaign's cost per conversion as indicative rather than as evidence.`,
        evidence: {
          conversions, spend,
          targetCpa, targetRoas,
          strategy: r.bidding_strategy,
          floorPermitted: FLOOR_PERMITTED, floorTrustworthy: FLOOR_TRUSTWORTHY,
        },
        entityType: "campaign",
        entityId: r.campaign_id,
      });
    }

    // Google's own estimate of the budget at which no impressions are lost to
    // budget. A better constraint signal than any threshold we could invent.
    const budget = fromMicros(r.budget_micros);
    const recommended = r.recommended_budget_micros ? fromMicros(r.recommended_budget_micros) : null;
    if (recommended && budget > 0 && recommended > budget * 1.25 && conversions > 0) {
      const cpa = spend / conversions;
      out.push({
        kind: "budget_below_google_recommendation",
        severity: "info",
        title: `${r.name} would need ${recommended.toFixed(0)} a day to stop losing impressions to budget`,
        detail: `Google estimates the budget at which this campaign loses nothing to budget constraints is ${recommended.toFixed(0)}, against ${budget.toFixed(0)} set. It is currently converting at ${cpa.toFixed(2)}. Whether that gap is worth funding depends on whether the extra traffic converts at the same rate, which it usually does not — but this is Google's own arithmetic rather than a guess.`,
        evidence: { budget, recommended, ratio: recommended / budget, cpa, conversions },
        entityType: "campaign",
        entityId: r.campaign_id,
      });
    }
  }

  out.push(...(await valueBiddingFindings(clientId)));
  out.push(...(await aiMaxFindings(clientId)));
  return out;
}

/**
 * Value bidding on constant values is count bidding in disguise.
 *
 * If every conversion carries the same value, maximising value is algebraically
 * identical to maximising count, and a target return is just a target cost per
 * conversion divided by that value. The account looks like it is optimising for
 * business value and is not.
 */
async function valueBiddingFindings(clientId: number): Promise<Finding[]> {
  const [campaigns, actions, values] = await Promise.all([
    q<any>(`SELECT name, campaign_id, bidding_strategy FROM campaigns
             WHERE client_id = $1 AND status = 'ENABLED'
               AND bidding_strategy IN ('TARGET_ROAS','MAXIMIZE_CONVERSION_VALUE')`, [clientId]),
    q<any>(`SELECT name, always_use_default_value, default_value
              FROM conversion_actions
             WHERE client_id = $1 AND status = 'ENABLED' AND include_in_conversions`, [clientId]),
    q<any>(`SELECT COALESCE(SUM(conversion_value_micros),0) AS adjusted,
                   COALESCE(SUM(original_conversion_value_micros),0) AS original
              FROM metrics_daily
             WHERE client_id = $1 AND date > CURRENT_DATE - 31`, [clientId]),
  ]);

  const out: Finding[] = [];

  if (campaigns.length) {
    const constant = actions.filter((a) => a.always_use_default_value === true);
    if (constant.length && constant.length === actions.length) {
      out.push({
        kind: "value_bidding_on_constant",
        severity: "warning",
        title: "Value bidding is running on a fixed value, which makes it count bidding",
        detail: `${campaigns.length} campaign${campaigns.length === 1 ? " bids" : "s bid"} on conversion value, but every conversion action substitutes one fixed number instead of reporting a real value. When all values are identical, maximising value is mathematically the same as maximising count — so this is cost-per-conversion bidding with a misleading column on top. Either report genuinely different values per action, or switch to a cost target and stop implying the account optimises for business value.`,
        evidence: {
          campaigns: campaigns.map((c: any) => c.name),
          actions: constant.map((a: any) => ({ action: a.name, fixedValue: Number(a.default_value ?? 0) })),
        },
      });
    }
  }

  // Value rules and lifecycle adjustments inflate the reported value. The
  // original figure is the ground truth, and the gap is the manufactured part.
  const adjusted = fromMicros(values[0]?.adjusted);
  const original = fromMicros(values[0]?.original);
  if (original > 0 && adjusted > original * 1.05) {
    const inflation = ((adjusted - original) / original) * 100;
    out.push({
      kind: "conversion_value_inflated",
      severity: "info",
      title: `Reported conversion value is ${inflation.toFixed(0)}% above the raw figure`,
      detail: `Value rules or new-customer adjustments are adding ${(adjusted - original).toFixed(0)} on top of ${original.toFixed(0)} of actual recorded value. That is deliberate and it does feed bidding, but it means the value column is no longer revenue. Any return figure quoted from it is not a revenue multiple.`,
      evidence: { adjustedValue: adjusted, originalValue: original, inflationPct: inflation },
    });
  }

  return out;
}

/**
 * AI Max migration state.
 *
 * Migration is happening through September 2026 with no opt-out, and the two
 * source cohorts land with different defaults — so an account contains a mix
 * and cannot be judged uniformly. The finding that earns its place here is the
 * ratchet: once a campaign has used AI Max, switching it off also disables
 * brand inclusions and exclusions, which means the obvious remediation removes
 * the guardrails rather than the feature.
 */
export async function aiMaxFindings(clientId: number): Promise<Finding[]> {
  const rows = await q<any>(`
    SELECT c.name, c.campaign_id, c.channel_type, c.status,
           c.ai_max_enabled, c.ai_max_bundling_required,
           c.aca_migrated_at, c.broad_match_migrated_at,
           COALESCE(SUM(m.cost_micros),0) AS spend,
           COALESCE(SUM(m.conversions),0) AS conversions
      FROM campaigns c
      LEFT JOIN metrics_daily m
        ON m.entity_id = c.campaign_id AND m.entity_type = 'campaign'
       AND m.date > CURRENT_DATE - 31 AND m.date <= CURRENT_DATE - 1
     WHERE c.client_id = $1 AND c.channel_type = 'SEARCH'
     GROUP BY c.name, c.campaign_id, c.channel_type, c.status,
              c.ai_max_enabled, c.ai_max_bundling_required,
              c.aca_migrated_at, c.broad_match_migrated_at
  `, [clientId]);

  const migrated = rows.filter((r) => r.aca_migrated_at || r.broad_match_migrated_at);
  const active = rows.filter((r) => r.ai_max_enabled === true && r.status === 'ENABLED');
  if (!migrated.length && !active.length) return [];

  const out: Finding[] = [];

  if (migrated.length) {
    // The cohort determines which features arrived switched on, so it decides
    // what to check first. Text customisation only comes with one of them.
    const aca = migrated.filter((r) => r.aca_migrated_at);
    const broad = migrated.filter((r) => r.broad_match_migrated_at);
    out.push({
      kind: "ai_max_migrated",
      severity: "info",
      title: `${migrated.length} search campaign${migrated.length === 1 ? " was" : "s were"} migrated to AI Max`,
      detail:
        (aca.length
          ? `${aca.length} came from automatically created assets, which arrive with both search term matching and text customisation switched on — Google is now generating ad copy for ${aca.length === 1 ? "it" : "them"}. `
          : "") +
        (broad.length
          ? `${broad.length} came from campaign-level broad match, which arrives with search term matching only. `
          : "") +
        `Check the generated assets and the search terms report segmented by source. Keywords now act as hints rather than constraints on anything but a literally identical query, and roughly a third of what still reports as exact match is AI Max expansion.`,
      evidence: {
        acaCohort: aca.map((r) => r.name),
        broadMatchCohort: broad.map((r) => r.name),
      },
    });
  }

  const ratcheted = active.filter((r) => r.ai_max_bundling_required === true);
  if (ratcheted.length) {
    out.push({
      kind: "ai_max_bundling_ratchet",
      severity: "warning",
      title: "Turning AI Max off on these campaigns would also disable their brand controls",
      detail: `${ratcheted.map((r) => `"${r.name}"`).join(", ")} ${ratcheted.length === 1 ? "has" : "have"} used AI Max, which permanently ties brand inclusions and exclusions to it being enabled. Switching the master toggle off removes those guardrails and causes URL inclusions and exclusions to be ignored — the opposite of what switching it off is meant to achieve. To contain it, leave the toggle on and disable search term matching per ad group instead.`,
      evidence: { campaigns: ratcheted.map((r) => r.name) },
    });
  }

  // Below the volume floor AI Max behaves erratically, and Google states it is
  // ineffective on a budget-limited campaign because it spends what is left
  // after keywords serve. On a small local account the realistic outcome is
  // that it barely participates rather than that it does damage.
  const thin = active.filter(
    (r) => fromMicros(r.spend) > 0 && Number(r.conversions) < FLOOR_TRUSTWORTHY
  );
  if (thin.length) {
    out.push({
      kind: "ai_max_below_volume_floor",
      severity: "info",
      title: "AI Max is running on campaigns with too little volume to use it",
      detail: `Below roughly 30 conversions a month AI Max behaves erratically, and Google states it is ineffective on a budget-limited campaign because it only spends what is left after existing keywords serve. On a small account the usual outcome is that it takes a trivial share of spend rather than that it causes harm — one documented fourteen-month test saw it take $158 of $10,457. Watch what share of spend it actually takes before doing anything drastic.`,
      evidence: {
        campaigns: thin.map((r) => ({
          campaign: r.name,
          spend: fromMicros(r.spend),
          conversions: Number(r.conversions),
        })),
        floor: FLOOR_TRUSTWORTHY,
      },
    });
  }

  return out;
}
