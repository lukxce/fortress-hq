import { q, tx } from "@/lib/db";
import { clientWithProperties, type ClientWithProps } from "@/lib/binding";
import { campaignPerformance, periodTotals, pacing, fromMicros } from "./metrics";
import { segmentFindings } from "./segments";
import { forensicFindings } from "./forensics";
import { biddingHealthFindings } from "./bidding";
import { actionableFindings } from "./actionable";
import { brandTerms, containsBrand } from "./brand";
import {
  accountBaseline, fromEuros, poissonUpper, testPeriods, zeroConversionMultiple,
} from "./stats";

export type Area =
  | "tracking" | "waste" | "targeting" | "budget" | "bidding"
  | "structure" | "creative" | "opportunity" | "schedule";

export type EvidenceTable = { columns: string[]; rows: (string | number | null)[][] };

export type Finding = {
  kind: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  /** Money recoverable over the finding's window: spend above what its conversions were worth. */
  moneyAtStake?: number;
  /** The window moneyAtStake covers, so it can be turned into a monthly figure. Defaults to 30. */
  windowDays?: number;
  area?: Area;
  /** The rows behind the finding, for the collapsible table under a recommendation. */
  table?: EvidenceTable;
  entityType?: string;
  entityId?: string;
};

/** What a finding is worth per month: its recoverable money over its window, scaled to 30.4 days. */
export const monthlyImpact = (f: Finding) =>
  f.moneyAtStake ? Math.max(0, f.moneyAtStake) / (f.windowDays ?? 30) * 30.4 : 0;

// Volume gates. Below these, a ratio is noise dressed as a signal. They used to
// be fixed amounts — 100 clicks, 50 of spend, 5 conversions — which were blind
// to currency (50 dinars is about €0.43) and to volume (5 conversions leave a
// true CPA anywhere from 0.43× to 3.1× what it shows). Judgements are now made
// in the account's own conversions and tested for chance; see stats.ts. The one
// fixed floor left is for checks with no CPA to measure against, and it is
// converted into the account's currency.
const floor = (client: ClientWithProps, eur = 50) => fromEuros(eur, client.currency);

export async function computeFindings(clientId: number): Promise<Finding[]> {
  const client = await clientWithProperties(clientId);
  if (!client) return [];

  const out: Finding[] = [];
  const campaigns = await campaignPerformance(clientId, 30);
  const { current, previous } = await periodTotals(clientId, 30);
  const pace = await pacing(client);

  out.push(...budgetFindings(pace, client));
  out.push(...healthFindings(campaigns));
  out.push(...(await wasteFindings(clientId, client)));
  out.push(...efficiencyFindings(campaigns, client, current));
  out.push(...trendFindings(current, previous));
  out.push(...(await trackingFindings(clientId, client, current)));
  out.push(...(await overlapFindings(clientId, client)));
  out.push(...(await gtmFindings(clientId, client)));
  // Everything above works from campaign totals. These work from the
  // segmentation, and are where the actionable detail lives.
  out.push(...(await segmentFindings(clientId)));
  // Causes rather than symptoms: where traffic physically went, when the
  // account changed, and what it is actually optimising toward.
  out.push(...(await forensicFindings(clientId)));
  // Google's own verdict on why a bid strategy is constrained, plus the volume
  // floors below which any target-related judgement is noise.
  out.push(...(await biddingHealthFindings(clientId)));
  // The findings that turn directly into an action, and the ones that need
  // Analytics, Search Console or Tag Manager alongside Ads.
  out.push(...(await actionableFindings(clientId)));

  for (const f of out) {
    f.area ??= areaOf(f.kind);
    f.windowDays ??= WINDOW_BY_KIND.find(([re]) => re.test(f.kind))?.[1] ?? 30;
  }

  return out.sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 };
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return (b.moneyAtStake ?? 0) - (a.moneyAtStake ?? 0);
  });
}

// Which part of the account a finding is about, so recommendations can be
// grouped the way an operator thinks: tracking first, then waste, then the rest.
const AREA_RULES: [RegExp, Area][] = [
  [/^(conversion_|micro_conversion|tracking_|gtm_|auto_tagging|call_reporting|ads_tracking|value_bidding|conversion_value)/, "tracking"],
  [/^(search_term_waste|keyword_spenders|device_no_conversions|network_no_conversions|placement_|campaign_no_conversions)/, "waste"],
  [/^(hours_|day_of_week)/, "schedule"],
  [/^(budget_|underfunded|campaign_overpriced|performance_inflection|cpa_|roas_)/, "budget"],
  [/^(target_below|bid_|bidding_|ai_max|keywords_overpriced|device_inefficient|network_inefficient)/, "bidding"],
  [/^(searches_to_promote|search_console|paid_organic)/, "opportunity"],
  [/^(ads_thin|landing_page|keyword_low_quality)/, "creative"],
];
const areaOf = (kind: string): Area => AREA_RULES.find(([re]) => re.test(kind))?.[1] ?? "structure";

// The window each finding's money covers. Segment, keyword and search-term
// findings read 90 days; campaign totals read 30.
const WINDOW_BY_KIND: [RegExp, number][] = [
  [/^(device_|hours_|day_of_week|network_|keyword|search_term|placement_|keywords_|searches_|campaign_overpriced|budget_capped|landing_page)/, 90],
];

// --------------------------------------------------------------- budget ----

function budgetFindings(p: ReturnType<typeof pacing> extends Promise<infer T> ? T : never, c: ClientWithProps): Finding[] {
  const out: Finding[] = [];
  if (p.monthlyBudget && p.variancePct !== null && p.daysElapsed >= 5) {
    const over = p.variancePct > 12;
    const under = p.variancePct < -12;
    if (over || under) {
      const diff = Math.abs(p.projected - p.monthlyBudget);
      out.push({
        kind: over ? "pacing_over" : "pacing_under",
        severity: over ? "warning" : "info",
        title: over
          ? `Projected to overspend by ${money(diff, c.currency)}`
          : `Projected to underspend by ${money(diff, c.currency)}`,
        detail: over
          ? `At the current daily rate of ${money(p.dailyAverage, c.currency)} the month lands at ${money(p.projected, c.currency)} against a budget of ${money(p.monthlyBudget, c.currency)}.`
          : `Spend is running below plan. At ${money(p.dailyAverage, c.currency)} a day the month lands at ${money(p.projected, c.currency)} against ${money(p.monthlyBudget, c.currency)}, so there is room to buy more volume.`,
        evidence: {
          monthSpend: p.monthSpend, projected: p.projected,
          budget: p.monthlyBudget, dailyAverage: p.dailyAverage,
          daysElapsed: p.daysElapsed, daysInMonth: p.daysInMonth,
        },
        moneyAtStake: diff,
      });
    }
  }
  return out;
}

// --------------------------------------------------------------- health ----

function healthFindings(campaigns: Awaited<ReturnType<typeof campaignPerformance>>): Finding[] {
  const out: Finding[] = [];
  for (const c of campaigns) {
    const reasons = c.primary_status_reasons ?? [];
    if (!reasons.length) continue;

    // Google's own diagnosis, which is the cheapest and most reliable signal
    // available and costs nothing extra to read.
    const serious = reasons.filter((r) =>
      /REMOVED|PAUSED_BY|MISCONFIGURED|PENDING|ENDED|BUDGET_CONSTRAINED|LIMITED_BY_BUDGET|AD_GROUPS_PAUSED|NO_ADS|ADS_DISAPPROVED|KEYWORDS_PAUSED|LOW_QUALITY/i.test(r)
    );
    if (!serious.length) continue;

    const budgetLimited = serious.some((r) => /BUDGET/i.test(r));
    const disapproved = serious.some((r) => /DISAPPROVED/i.test(r));

    out.push({
      kind: budgetLimited ? "budget_limited" : disapproved ? "ads_disapproved" : "campaign_misconfigured",
      // Budget-limited is information, not a fault: Google says Maximise
      // Conversions and Maximise Conversion Value — the only strategies
      // Performance Max has — are limited by budget by design, and its lost
      // impression share to budget is not meaningful for them.
      severity: disapproved ? "critical" : budgetLimited ? "info" : "warning",
      title: disapproved
        ? `Ads disapproved in ${c.name}`
        : budgetLimited
          ? `${c.name} is limited by budget`
          : `${c.name} needs attention`,
      detail: disapproved
        ? "Disapproved ads do not serve. Everything spent on this campaign is buying less reach than it should."
        : budgetLimited
          ? `Google reports this campaign is constrained by its budget (${c.spend.toFixed(0)} spent in the last 30 days). On Maximise Conversions and Performance Max that is expected rather than a problem. It is only a reason to add budget if the extra conversions would be worth their marginal cost, which is higher than the average — never on the status alone.`
          : `Google reports: ${serious.join(", ").toLowerCase().replace(/_/g, " ")}.`,
      evidence: { primaryStatus: c.primary_status, reasons: serious, spend30d: c.spend },
      entityType: "campaign",
      entityId: c.campaign_id,
    });
  }
  return out;
}

// ---------------------------------------------------------------- waste ----

async function wasteFindings(clientId: number, client: ClientWithProps): Promise<Finding[]> {
  // Search terms cover 90 days, so the baseline does too.
  const base = await accountBaseline(clientId, 90);
  if (!base.cpa) return [];

  const terms = await q<{ term: string; cost_micros: string; clicks: string; conversions: string }>(`
    SELECT term, cost_micros, clicks, conversions FROM search_terms
     WHERE client_id = $1 AND cost_micros > 0
  `, [clientId]);
  const looks = terms.length;
  const needed = zeroConversionMultiple(looks);

  // Brand searches are never waste: they are the cheapest traffic in most
  // accounts, and excluding them cannot be undone by spending more.
  const brands = await brandTerms(clientId);
  const zero = terms
    .filter((t) => Number(t.conversions) === 0 && !containsBrand(t.term, brands))
    .map((t) => ({ term: t.term, cost: fromMicros(t.cost_micros), clicks: Number(t.clicks) }))
    .filter((t) => t.cost >= base.cpa! * 0.5)
    .sort((a, b) => b.cost - a.cost);
  if (!zero.length) return [];

  const proven = zero.filter((t) => t.cost / base.cpa! >= needed);
  const ceiling = zero.reduce((n, t) => n + t.cost, 0);
  const provenSpend = proven.reduce((n, t) => n + t.cost, 0);
  const share = base.spend > 0 ? (ceiling / base.spend) * 100 : 0;
  if (ceiling < floor(client)) return [];

  const top = zero.slice(0, 8).map((t) => ({
    term: t.term, cost: t.cost, clicks: t.clicks, cpasSpent: t.cost / base.cpa!,
    proven: t.cost / base.cpa! >= needed,
  }));

  return [{
    kind: "search_term_waste",
    severity: proven.length ? (provenSpend / base.spend > 0.1 ? "critical" : "warning") : "info",
    title: proven.length
      ? `${proven.length} search term${proven.length === 1 ? "" : "s"} spent ${provenSpend.toFixed(0)} with nothing to show`
      : `${ceiling.toFixed(0)} went to search terms with no conversions — mostly too thin to judge`,
    detail: `Over 90 days, ${zero.length} search terms each spent at least half the account's cost per conversion (${base.cpa.toFixed(2)}) and converted nothing: ${share.toFixed(0)}% of spend. That total is a ceiling on waste, not money that would have been saved — some of it is prospecting that assists. ${proven.length ? `${proven.length} of them spent enough (about ${needed.toFixed(1)}× the cost per conversion, allowing for ${looks} terms checked) that zero is evidence: those are negative keyword candidates, starting with "${proven[0].term}".` : `None has spent enough for its zero to rule out chance, so treat them as terms to read, not to exclude. The largest is "${zero[0].term}".`}`,
    evidence: { wasted: ceiling, provenWaste: provenSpend, termCount: zero.length, provenCount: proven.length, shareOfSpend: share, baselineCpa: base.cpa, cpasNeeded: needed, topTerms: top },
    moneyAtStake: provenSpend,
  }];
}

// ----------------------------------------------------------- efficiency ----

function efficiencyFindings(
  campaigns: Awaited<ReturnType<typeof campaignPerformance>>,
  client: ClientWithProps,
  overall: { cpa: number | null; roas: number | null; spend: number; conversions: number }
): Finding[] {
  const out: Finding[] = [];
  const goal = client.goal_type;
  const targetCpa = client.target_cpa ? Number(client.target_cpa) : null;
  const targetRoas = client.target_roas ? Number(client.target_roas) : null;

  // Account level against the operator's own target. No target means no
  // judgement is possible, and inventing a benchmark would be worse than
  // staying quiet.
  // "Above target" is only said when even the most favourable reading of the
  // conversion count — the top of its exact 95% interval — still misses. At
  // eight conversions a month the observed CPA alone cannot carry that claim.
  if (goal === "cpa" && targetCpa && overall.cpa !== null && overall.conversions > 0) {
    const over = ((overall.cpa - targetCpa) / targetCpa) * 100;
    const bestCaseCpa = overall.spend / poissonUpper(overall.conversions);
    if (over > 15 && bestCaseCpa > targetCpa) {
      out.push({
        kind: "cpa_above_target",
        severity: over > 50 ? "critical" : "warning",
        title: `Cost per conversion is ${over.toFixed(0)}% above target`,
        detail: `Thirty-day cost per conversion is ${overall.cpa.toFixed(2)} against a target of ${targetCpa.toFixed(2)} — and even on the most favourable reading of ${overall.conversions.toFixed(0)} conversions it would be ${bestCaseCpa.toFixed(2)}, still above target.`,
        evidence: { cpa: overall.cpa, target: targetCpa, overBy: over, bestCaseCpa, conversions: overall.conversions },
        moneyAtStake: overall.spend * (over / 100) / (1 + over / 100),
      });
    }
  }
  if (goal === "roas" && targetRoas && overall.roas !== null && overall.conversions > 0) {
    const under = ((targetRoas - overall.roas) / targetRoas) * 100;
    const bestCaseRoas = overall.roas * (poissonUpper(overall.conversions) / overall.conversions);
    if (under > 15 && bestCaseRoas < targetRoas) {
      out.push({
        kind: "roas_below_target",
        severity: under > 40 ? "critical" : "warning",
        title: `Return on ad spend is ${under.toFixed(0)}% below target`,
        detail: `Thirty-day return is ${overall.roas.toFixed(2)}x against a target of ${targetRoas.toFixed(2)}x.`,
        evidence: { roas: overall.roas, target: targetRoas, underBy: under, bestCaseRoas, conversions: overall.conversions },
        moneyAtStake: overall.spend * (under / 100),
      });
    }
  }

  // Campaign level: spending with nothing to show for it. Measured in the
  // account's own conversions, corrected for how many campaigns were checked.
  const live = campaigns.filter((c) => c.spend > 0);
  const needed = zeroConversionMultiple(live.length);
  for (const c of live) {
    if (c.conversions !== 0) continue;
    const cpas = overall.cpa ? c.spend / overall.cpa : null;
    // No account CPA means the whole account recorded nothing; fall back to a
    // currency-converted floor rather than staying silent.
    const proven = cpas !== null ? cpas >= needed : c.spend >= floor(client, 150);
    if (!proven) continue;
    out.push({
      kind: "campaign_no_conversions",
      severity: "critical",
      title: `${c.name} spent ${c.spend.toFixed(0)} with no conversions`,
      detail: `${c.clicks} clicks over 30 days and nothing recorded${cpas !== null ? ` — ${cpas.toFixed(1)} times the account's cost per conversion, past the point where chance explains it` : ""}. Either the campaign genuinely is not working, or its conversion tracking is broken — check tracking before pausing.`,
      evidence: { spend: c.spend, clicks: c.clicks, impressions: c.impressions, cpasSpent: cpas, cpasNeeded: needed },
      moneyAtStake: c.spend,
      entityType: "campaign",
      entityId: c.campaign_id,
    });
  }

  return out;
}

// ---------------------------------------------------------------- trend ----

function trendFindings(cur: any, prev: any): Finding[] {
  const out: Finding[] = [];
  if (cur.cpa === null || prev.cpa === null) return out;

  // A month-on-month CPA move is only reported when the split of conversions
  // between the two periods is unlikely under "nothing changed". At 20
  // conversions a month, a 40% swing is routine.
  const change = ((cur.cpa - prev.cpa) / prev.cpa) * 100;
  const test = testPeriods(cur, prev, "worse");
  {
    if (change > 25 && test.significant) {
      out.push({
        kind: "cpa_rising",
        severity: "warning",
        title: `Cost per conversion rose ${change.toFixed(0)}% versus the previous 30 days`,
        detail: `It moved from ${prev.cpa.toFixed(2)} to ${cur.cpa.toFixed(2)} while spend went from ${prev.spend.toFixed(0)} to ${cur.spend.toFixed(0)} — ${cur.conversions.toFixed(0)} conversions where the previous rate predicts about ${test.expected.toFixed(0)}, a gap chance rarely produces.`,
        evidence: { current: cur.cpa, previous: prev.cpa, changePct: change, expectedConversions: test.expected, p: test.p },
        moneyAtStake: (cur.cpa - prev.cpa) * cur.conversions,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------- tracking ----

async function trackingFindings(
  clientId: number, client: ClientWithProps, cur: any
): Promise<Finding[]> {
  const out: Finding[] = [];

  // Conversion-action hygiene. These distort the number everything else is
  // judged on, so they matter more than anything downstream of them.
  const actions = await q<any>(
    `SELECT * FROM conversion_actions WHERE client_id = $1 AND status = 'ENABLED'`,
    [clientId]
  );

  const LEAD = /SUBMIT_LEAD_FORM|SIGNUP|BOOK_APPOINTMENT|REQUEST_QUOTE|CONTACT|PHONE_CALL/i;
  for (const a of actions) {
    if (!a.include_in_conversions) continue;
    // Imports are exempt: uploads carrying gbraid/wbraid are rejected by
    // one-per-click actions, so "every" is the required setting there.
    if (LEAD.test(a.category ?? "") && a.counting_type === "MANY_PER_CLICK" && a.type !== "UPLOAD_CLICKS") {
      out.push({
        kind: "conversion_multi_counting",
        severity: "critical",
        title: `"${a.name}" counts every submission from the same click`,
        detail: `A lead action set to count many per click inflates the conversion number: one person submitting twice reads as two leads. Set it to one per click, or every cost-per-conversion figure above is understated.`,
        evidence: { action: a.name, category: a.category, counting: a.counting_type },
        entityType: "conversion_action",
        entityId: a.action_id,
      });
    }
    // DEFAULT is Google's "Other" category, where plenty of real lead forms
    // live because nobody picked a category — flagging it produced false alarms.
    if (/^(PAGE_VIEW|ENGAGEMENT|OUTBOUND_CLICK|GET_DIRECTIONS)$/i.test(a.category ?? "")) {
      out.push({
        kind: "micro_conversion_counted",
        severity: "warning",
        title: `"${a.name}" is counted as a conversion`,
        detail: `This is a page view, engagement, outbound click or directions request rather than a submitted lead. Counting it in Conversions makes bidding optimise toward it and flatters every efficiency figure. (For a business customers visit in person, directions can be a genuine signal — confirm before demoting it.)`,
        evidence: { action: a.name, category: a.category },
        entityType: "conversion_action",
        entityId: a.action_id,
      });
    }
    if (a.include_in_conversions && Number(a.conversions_30d) === 0) {
      out.push({
        kind: "conversion_action_silent",
        severity: "warning",
        title: `"${a.name}" has recorded nothing in 30 days`,
        detail: `The action is enabled and counted but has no volume. Either it is genuinely unused, or the tag stopped firing.`,
        evidence: { action: a.name, volume30d: 0 },
        entityType: "conversion_action",
        entityId: a.action_id,
      });
    }
  }

  // The same lead counted twice. A GA4-imported key event and a Google Ads tag
  // both counted in Conversions for one category is the classic double count:
  // bidding sees every enquiry as two. Matching on category is a heuristic, so
  // this asks for confirmation rather than asserting.
  const counted = actions.filter((a: any) => a.include_in_conversions && LEAD.test(a.category ?? ""));
  const byCategory = new Map<string, any[]>();
  for (const a of counted) byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);
  for (const [category, group] of byCategory) {
    const ga4 = group.filter((a) => /^GOOGLE_ANALYTICS_4/.test(a.type ?? ""));
    const tag = group.filter((a) => /^WEBPAGE/.test(a.type ?? ""));
    if (ga4.length && tag.length) {
      out.push({
        kind: "conversion_double_counted",
        severity: "critical",
        title: `"${ga4[0].name}" and "${tag[0].name}" may be counting the same lead`,
        detail: `Both are counted in Conversions under ${category.toLowerCase().replace(/_/g, " ")}: one imported from Analytics, one from a Google Ads tag. If they fire on the same submission, every lead is counted twice and bidding believes the account converts twice as well as it does. Google's rule is one primary action per lead. Check whether their daily counts move together; if so, make the Analytics import secondary.`,
        evidence: { category, analytics: ga4.map((a) => a.name), tags: tag.map((a) => a.name) },
        entityType: "conversion_action",
        entityId: ga4[0].action_id,
      });
    }
  }

  // The cross-product check that is the whole reason for pulling Analytics.
  if (client.ga4_property_id) {
    const [ga] = await q<{ key_events: string; sessions: string }>(`
      SELECT COALESCE(SUM(key_events),0) AS key_events,
             COALESCE(SUM(sessions),0) AS sessions
        FROM ga4_daily
       WHERE client_id = $1 AND date > CURRENT_DATE - 31 AND date <= CURRENT_DATE - 1
    `, [clientId]);

    const keyEvents = Number(ga?.key_events ?? 0);
    const sessions = Number(ga?.sessions ?? 0);

    if (cur.spend >= floor(client) && cur.conversions === 0 && keyEvents > 0) {
      out.push({
        kind: "ads_tracking_broken",
        severity: "critical",
        title: "Analytics records conversions but Google Ads does not",
        detail: `Analytics logged ${keyEvents.toFixed(0)} key events over 30 days while Ads recorded none, on ${cur.spend.toFixed(0)} of spend. Demand is there; the Ads conversion tag or the import is broken. Every efficiency number is meaningless until this is fixed.`,
        evidence: { adsConversions: 0, ga4KeyEvents: keyEvents, spend: cur.spend },
        moneyAtStake: cur.spend,
      });
    } else if (cur.spend >= floor(client) && cur.conversions === 0 && keyEvents === 0 && sessions > 0) {
      out.push({
        kind: "tracking_silent_everywhere",
        severity: "critical",
        title: "Neither Ads nor Analytics recorded a single conversion",
        detail: `${sessions.toFixed(0)} sessions and ${cur.spend.toFixed(0)} spent over 30 days with nothing recorded anywhere. Traffic is arriving, so this is measurement, not demand.`,
        evidence: { sessions, spend: cur.spend },
        moneyAtStake: cur.spend,
      });
    }
  }

  return out;
}

// --------------------------------------------------------------- overlap ---

async function overlapFindings(clientId: number, client: ClientWithProps): Promise<Finding[]> {
  if (!client.gsc_site_url) return [];

  // Queries the site already wins organically, that Ads is also paying for.
  // Correlational, not proof — position and paid clicks are measured
  // separately — so it is surfaced as information, never as an instruction.
  const rows = await q<any>(`
    WITH organic AS (
      SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
        FROM gsc_daily
       WHERE client_id = $1 AND date > CURRENT_DATE - 31
       GROUP BY query
      HAVING AVG(position) <= 3.5 AND SUM(clicks) >= 10
    )
    SELECT o.query, o.pos, o.clicks AS organic_clicks,
           s.cost_micros, s.conversions
      FROM organic o
      JOIN search_terms s ON lower(s.term) = lower(o.query) AND s.client_id = $1
     WHERE s.cost_micros > 1000000
     ORDER BY s.cost_micros DESC
     LIMIT 15
  `, [clientId]);

  if (!rows.length) return [];
  const spend = rows.reduce((n, r) => n + fromMicros(r.cost_micros), 0);
  if (spend < floor(client)) return [];

  return [{
    kind: "paid_organic_overlap",
    severity: "info",
    title: `${spend.toFixed(0)} spent on queries you already rank top-three for`,
    detail: `${rows.length} queries take paid clicks while the site sits in the top three organically. Sometimes that is deliberate — owning the page, or defending against a competitor — but it is worth deciding rather than inheriting.`,
    evidence: {
      spend,
      queries: rows.slice(0, 10).map((r) => ({
        query: r.query,
        position: Number(r.pos).toFixed(1),
        organicClicks: Number(r.organic_clicks),
        paidSpend: fromMicros(r.cost_micros),
        conversions: Number(r.conversions),
      })),
    },
    moneyAtStake: spend,
  }];
}

// ----------------------------------------------------------------- store ---

export async function storeFindings(clientId: number, findings: Finding[]): Promise<void> {
  await tx(async (run) => {
    for (const f of findings) {
      await run(
        `INSERT INTO findings (client_id, kind, severity, title, detail, evidence,
            money_at_stake_micros, entity_type, entity_id, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (client_id, kind, entity_type, entity_id) DO UPDATE SET
           severity = EXCLUDED.severity, title = EXCLUDED.title,
           detail = EXCLUDED.detail, evidence = EXCLUDED.evidence,
           money_at_stake_micros = EXCLUDED.money_at_stake_micros,
           last_seen = now(),
           status = CASE WHEN findings.status = 'resolved' THEN 'open' ELSE findings.status END`,
        [clientId, f.kind, f.severity, f.title, f.detail, JSON.stringify(f.evidence),
         f.moneyAtStake != null ? String(Math.round(f.moneyAtStake * 1e6)) : null,
         f.entityType ?? "", f.entityId ?? ""]
      );
    }
    // Anything that stopped being true is resolved, not deleted, so the history
    // of what was wrong survives.
    await run(
      `UPDATE findings SET status = 'resolved'
        WHERE client_id = $1 AND status = 'open' AND last_seen < now() - interval '1 minute'`,
      [clientId]
    );
  });
}

// ------------------------------------------------------------ tag manager ---

/**
 * Whether measurement is actually wired, not merely connected.
 *
 * Only live tags are considered. A container accumulates paused tags the way a
 * drawer accumulates cables — old experiments, replaced vendors, seasonal
 * promos — and reporting them is noise that buries the one thing that matters:
 * whether the conversion that is supposed to fire, fires correctly.
 */
async function gtmFindings(clientId: number, client: ClientWithProps): Promise<Finding[]> {
  if (!client.gtm_container_id) return [];

  const all = await q<any>(
    `SELECT name, type, paused, consent_status FROM gtm_tags WHERE client_id = $1`,
    [clientId]
  );
  if (!all.length) return [];

  const live = all.filter((t) => !t.paused);
  const out: Finding[] = [];

  // awct = Google Ads conversion, gclidw = Conversion Linker.
  const adsConversion = live.filter((t) => t.type === "awct");
  const linker = live.some((t) => t.type === "gclidw");

  if (adsConversion.length > 0 && !linker) {
    out.push({
      kind: "gtm_no_conversion_linker",
      severity: "critical",
      title: "Live Ads conversion tags are firing without a Conversion Linker",
      detail: `${adsConversion.length} Google Ads conversion tag${adsConversion.length === 1 ? " is" : "s are"} live in this container, but no Conversion Linker is. Without it the click identifier is never stored, so conversions cannot be attributed back to the click that caused them and under-report — often severely, while the dashboard looks fine.`,
      evidence: {
        liveConversionTags: adsConversion.map((t) => t.name),
        linkerPresent: false,
      },
    });
  }

  // A container with no live conversion tag at all, on an account that spends,
  // is worth saying out loud.
  if (adsConversion.length === 0) {
    const [spend] = await q<{ cost_micros: string }>(
      `SELECT COALESCE(SUM(cost_micros),0) AS cost_micros FROM metrics_daily
        WHERE client_id = $1 AND date > CURRENT_DATE - 31`,
      [clientId]
    );
    if (fromMicros(spend?.cost_micros) >= floor(client)) {
      out.push({
        kind: "gtm_no_conversion_tag",
        severity: "warning",
        title: "No live Google Ads conversion tag in this container",
        detail: `The account is spending but the container has no active Ads conversion tag. Conversions may be tracked another way — a global site tag, or imported from Analytics — but if they are not, nothing is being recorded.`,
        evidence: { liveTagCount: live.length },
      });
    }
  }

  return out;
}

function money(n: number, currency: string | null): string {
  return `${n.toFixed(0)} ${currency ?? ""}`.trim();
}
