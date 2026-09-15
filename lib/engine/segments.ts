import { q } from "@/lib/db";
import { fromMicros } from "./metrics";
import type { Finding } from "./findings";

// Where the money actually goes. Campaign totals say money left; these say
// which device, which hour, which network, which keyword — the difference
// between "CPA is up" and "mobile after 9pm is where it is going".

// Every comparison here needs enough volume behind it to mean anything. A
// segment with four clicks and no conversion is not underperforming, it is
// unmeasured.
const MIN_SEG_CLICKS = 60;
const MIN_SEG_SPEND = 40;

export type SegmentRow = {
  key: string;
  impressions: number; clicks: number; spend: number;
  conversions: number; value: number;
  cpa: number | null; cvr: number | null; share: number;
};

export async function segment(clientId: number, type: string): Promise<SegmentRow[]> {
  const rows = await q<any>(`
    SELECT segment_key,
           SUM(impressions) AS impressions, SUM(clicks) AS clicks,
           SUM(cost_micros) AS cost_micros, SUM(conversions) AS conversions,
           SUM(conversion_value_micros) AS value
      FROM segment_metrics
     WHERE client_id = $1 AND segment_type = $2
     GROUP BY segment_key
     ORDER BY SUM(cost_micros) DESC
  `, [clientId, type]);

  const total = rows.reduce((n, r) => n + fromMicros(r.cost_micros), 0);
  return rows.map((r) => {
    const spend = fromMicros(r.cost_micros);
    const conversions = Number(r.conversions ?? 0);
    const clicks = Number(r.clicks ?? 0);
    return {
      key: r.segment_key,
      impressions: Number(r.impressions ?? 0),
      clicks, spend, conversions,
      value: fromMicros(r.value),
      cpa: conversions > 0 ? spend / conversions : null,
      cvr: clicks > 0 ? conversions / clicks : null,
      share: total > 0 ? (spend / total) * 100 : 0,
    };
  });
}

const DEVICE_LABEL: Record<string, string> = {
  MOBILE: "mobile", DESKTOP: "desktop", TABLET: "tablet",
  CONNECTED_TV: "connected TV", OTHER: "other devices",
};

const NETWORK_LABEL: Record<string, string> = {
  SEARCH: "Google search", SEARCH_PARTNERS: "search partners",
  CONTENT: "the display network", YOUTUBE: "YouTube",
  YOUTUBE_SEARCH: "YouTube search", YOUTUBE_WATCH: "YouTube watch",
  MIXED: "mixed placements",
};

const DOW_LABEL: Record<string, string> = {
  MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday", FRIDAY: "Friday", SATURDAY: "Saturday", SUNDAY: "Sunday",
};

/** Findings that only exist because the account is segmented. */
export async function segmentFindings(clientId: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const [devices, hours, dow, networks, keywords] = await Promise.all([
    segment(clientId, "device"),
    segment(clientId, "hour"),
    segment(clientId, "day_of_week"),
    segment(clientId, "network"),
    keywordSplit(clientId),
  ]);

  out.push(...deviceFindings(devices));
  out.push(...hourFindings(hours));
  out.push(...dowFindings(dow));
  out.push(...networkFindings(networks));
  out.push(...keywordFindings(keywords));

  return out;
}

// --------------------------------------------------------------- device ----

function deviceFindings(rows: SegmentRow[]): Finding[] {
  const usable = rows.filter((r) => r.clicks >= MIN_SEG_CLICKS && r.spend >= MIN_SEG_SPEND);
  if (usable.length < 2) return [];

  const converting = usable.filter((r) => r.cpa !== null);
  if (!converting.length) return [];

  const best = converting.reduce((a, b) => (a.cpa! <= b.cpa! ? a : b));
  const out: Finding[] = [];

  for (const r of usable) {
    const label = DEVICE_LABEL[r.key] ?? r.key.toLowerCase();

    // Spending real money on a device that never converts.
    if (r.conversions === 0) {
      out.push({
        kind: "device_no_conversions",
        severity: "critical",
        title: `${cap(label)} spent ${r.spend.toFixed(0)} and converted nothing`,
        detail: `${r.clicks} clicks from ${label} over 90 days with no conversions, while ${DEVICE_LABEL[best.key] ?? best.key.toLowerCase()} converts at ${best.cpa!.toFixed(2)}. Either the experience on that device is broken, or the bid adjustment is buying traffic that will never convert.`,
        evidence: { device: r.key, spend: r.spend, clicks: r.clicks, share: r.share },
        moneyAtStake: r.spend,
      });
      continue;
    }

    // Converting, but far worse than the best device.
    if (r.cpa !== null && best.cpa !== null && r.key !== best.key) {
      const worse = ((r.cpa - best.cpa) / best.cpa) * 100;
      if (worse > 60) {
        const excess = r.spend - r.conversions * best.cpa;
        out.push({
          kind: "device_inefficient",
          severity: "warning",
          title: `${cap(label)} costs ${worse.toFixed(0)}% more per conversion than ${DEVICE_LABEL[best.key] ?? best.key.toLowerCase()}`,
          detail: `${cap(label)} converts at ${r.cpa.toFixed(2)} against ${best.cpa.toFixed(2)}, on ${r.share.toFixed(0)}% of spend. A negative bid adjustment there would move budget to where it already works.`,
          evidence: {
            device: r.key, cpa: r.cpa, bestDevice: best.key, bestCpa: best.cpa,
            spend: r.spend, share: r.share, excessSpend: excess,
          },
          moneyAtStake: Math.max(0, excess),
        });
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------- hour ----

function hourFindings(rows: SegmentRow[]): Finding[] {
  if (rows.length < 6) return [];
  const total = rows.reduce((n, r) => n + r.spend, 0);
  if (total < MIN_SEG_SPEND * 3) return [];

  // Hours that take real money and return nothing, aggregated across 90 days —
  // a single bad day proves nothing, a repeated pattern does.
  const dead = rows.filter(
    (r) => r.conversions === 0 && r.spend >= total * 0.02 && r.clicks >= 25
  );
  if (!dead.length) return [];

  const wasted = dead.reduce((n, r) => n + r.spend, 0);
  if (wasted < MIN_SEG_SPEND) return [];

  const blocks = groupHours(dead.map((d) => Number(d.key)));
  return [{
    kind: "hours_bleeding",
    severity: wasted > total * 0.15 ? "critical" : "warning",
    title: `${wasted.toFixed(0)} spent in hours that never convert`,
    detail: `Across 90 days, ${blocks} took ${((wasted / total) * 100).toFixed(0)}% of spend and produced no conversions at all. An ad schedule that reduces or excludes those hours moves that money to hours that already work.`,
    evidence: {
      wasted, shareOfSpend: (wasted / total) * 100,
      hours: dead.map((d) => ({
        hour: Number(d.key), spend: d.spend, clicks: d.clicks,
      })).sort((a, b) => a.hour - b.hour),
    },
    moneyAtStake: wasted,
  }];
}

/** "02:00–05:00 and 23:00" reads better than a list of numbers. */
function groupHours(hours: number[]): string {
  const sorted = [...hours].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const h of sorted) {
    const last = runs[runs.length - 1];
    if (last && h === last[last.length - 1] + 1) last.push(h);
    else runs.push([h]);
  }
  const parts = runs.map((r) =>
    r.length === 1 ? `${pad(r[0])}:00` : `${pad(r[0])}:00–${pad(r[r.length - 1] + 1)}:00`
  );
  return parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
const pad = (n: number) => String(n).padStart(2, "0");

// ------------------------------------------------------------------ dow ----

function dowFindings(rows: SegmentRow[]): Finding[] {
  const usable = rows.filter((r) => r.clicks >= MIN_SEG_CLICKS);
  if (usable.length < 4) return [];
  const converting = usable.filter((r) => r.cpa !== null);
  if (converting.length < 2) return [];

  const best = converting.reduce((a, b) => (a.cpa! <= b.cpa! ? a : b));
  const worst = converting.reduce((a, b) => (a.cpa! >= b.cpa! ? a : b));
  const gap = ((worst.cpa! - best.cpa!) / best.cpa!) * 100;
  if (gap < 80) return [];

  return [{
    kind: "day_of_week_gap",
    severity: "info",
    title: `${DOW_LABEL[worst.key] ?? worst.key} costs ${gap.toFixed(0)}% more per conversion than ${DOW_LABEL[best.key] ?? best.key}`,
    detail: `Across 90 days ${DOW_LABEL[worst.key] ?? worst.key} converts at ${worst.cpa!.toFixed(2)} against ${best.cpa!.toFixed(2)} on ${DOW_LABEL[best.key] ?? best.key}. If that holds for this business, the weekly schedule is worth weighting.`,
    evidence: {
      worst: worst.key, worstCpa: worst.cpa, best: best.key, bestCpa: best.cpa,
      days: rows.map((r) => ({ day: r.key, spend: r.spend, cpa: r.cpa })),
    },
  }];
}

// -------------------------------------------------------------- network ----

function networkFindings(rows: SegmentRow[]): Finding[] {
  const out: Finding[] = [];
  const core = rows.find((r) => r.key === "SEARCH");

  for (const r of rows) {
    if (r.key === "SEARCH") continue;
    if (r.spend < MIN_SEG_SPEND || r.clicks < MIN_SEG_CLICKS) continue;
    const label = NETWORK_LABEL[r.key] ?? r.key.toLowerCase().replace(/_/g, " ");

    if (r.conversions === 0) {
      out.push({
        kind: "network_no_conversions",
        severity: "warning",
        title: `${r.spend.toFixed(0)} went to ${label} with no conversions`,
        detail: `${r.clicks} clicks and nothing to show, on ${r.share.toFixed(0)}% of spend. ${r.key === "SEARCH_PARTNERS" ? "Search partners can be turned off per campaign without touching anything else." : "This placement can be excluded."}`,
        evidence: { network: r.key, spend: r.spend, clicks: r.clicks, share: r.share },
        moneyAtStake: r.spend,
      });
    } else if (core?.cpa != null && r.cpa != null) {
      const worse = ((r.cpa - core.cpa) / core.cpa) * 100;
      if (worse > 80) {
        out.push({
          kind: "network_inefficient",
          severity: "info",
          title: `${cap(label)} costs ${worse.toFixed(0)}% more per conversion than Google search`,
          detail: `${r.cpa.toFixed(2)} against ${core.cpa.toFixed(2)} on core search, across ${r.share.toFixed(0)}% of spend.`,
          evidence: { network: r.key, cpa: r.cpa, searchCpa: core.cpa, spend: r.spend },
          moneyAtStake: Math.max(0, r.spend - r.conversions * core.cpa),
        });
      }
    }
  }
  return out;
}

// -------------------------------------------------------------- keywords ---

export type KeywordSplit = {
  workers: any[];
  spenders: any[];
  lowQuality: any[];
  totalSpend: number;
  spenderSpend: number;
};

/** The split that matters: keywords that earn, versus keywords that only cost. */
export async function keywordSplit(clientId: number): Promise<KeywordSplit> {
  const rows = await q<any>(`
    SELECT text, match_type, quality_score,
           expected_ctr, ad_relevance, landing_page_experience,
           SUM(impressions) AS impressions, SUM(clicks) AS clicks,
           SUM(cost_micros) AS cost_micros, SUM(conversions) AS conversions
      FROM keywords
     WHERE client_id = $1 AND status = 'ENABLED'
     GROUP BY text, match_type, quality_score, expected_ctr,
              ad_relevance, landing_page_experience
     ORDER BY SUM(cost_micros) DESC
  `, [clientId]);

  const mapped = rows.map((r) => {
    const spend = fromMicros(r.cost_micros);
    const conversions = Number(r.conversions ?? 0);
    const clicks = Number(r.clicks ?? 0);
    return {
      text: r.text, matchType: r.match_type, qualityScore: r.quality_score,
      expectedCtr: r.expected_ctr, adRelevance: r.ad_relevance,
      landingPage: r.landing_page_experience,
      clicks, spend, conversions,
      cpa: conversions > 0 ? spend / conversions : null,
    };
  });

  const totalSpend = mapped.reduce((n, k) => n + k.spend, 0);
  const spenders = mapped.filter(
    (k) => k.conversions === 0 && k.clicks >= 25 && k.spend >= 15
  );
  const workers = mapped.filter((k) => k.conversions > 0).sort((a, b) => a.cpa! - b.cpa!);
  const lowQuality = mapped.filter(
    (k) => k.qualityScore != null && k.qualityScore <= 4 && k.spend >= 15
  );

  return {
    workers, spenders, lowQuality, totalSpend,
    spenderSpend: spenders.reduce((n, k) => n + k.spend, 0),
  };
}

function keywordFindings(split: KeywordSplit): Finding[] {
  const out: Finding[] = [];

  if (split.spenders.length && split.spenderSpend >= MIN_SEG_SPEND) {
    const share = split.totalSpend > 0 ? (split.spenderSpend / split.totalSpend) * 100 : 0;
    const top = split.spenders.slice(0, 8);
    out.push({
      kind: "keyword_spenders",
      severity: share > 25 ? "critical" : "warning",
      title: `${split.spenders.length} keywords took ${split.spenderSpend.toFixed(0)} and converted nothing`,
      detail: `That is ${share.toFixed(0)}% of keyword spend over 90 days, each with at least 25 clicks — enough traffic that "not enough data" does not explain it. The largest is "${top[0]?.text}" at ${top[0]?.spend.toFixed(0)} across ${top[0]?.clicks} clicks.`,
      evidence: {
        wasted: split.spenderSpend, count: split.spenders.length, shareOfSpend: share,
        topTerms: top.map((k) => ({
          term: k.text, cost: k.spend, clicks: k.clicks, match: k.matchType,
        })),
      },
      moneyAtStake: split.spenderSpend,
    });
  }

  if (split.lowQuality.length) {
    const spend = split.lowQuality.reduce((n, k) => n + k.spend, 0);
    // Google names the component that is dragging the score, which turns a
    // vague number into a specific thing to fix.
    const reasons = new Map<string, number>();
    for (const k of split.lowQuality) {
      for (const [label, val] of [
        ["ad relevance", k.adRelevance],
        ["landing page experience", k.landingPage],
        ["expected click-through rate", k.expectedCtr],
      ] as const) {
        if (val === "BELOW_AVERAGE") reasons.set(label, (reasons.get(label) ?? 0) + 1);
      }
    }
    const worst = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];

    out.push({
      kind: "keyword_low_quality",
      severity: "warning",
      title: `${split.lowQuality.length} keywords have a quality score of 4 or below`,
      detail: worst
        ? `They account for ${spend.toFixed(0)} of spend, and Google rates ${worst[0]} below average on ${worst[1]} of them. Low quality means paying more per click for a worse position — fixing ${worst[0]} lifts the score and lowers the cost of the same traffic.`
        : `They account for ${spend.toFixed(0)} of spend. Low quality means paying more per click for a worse position.`,
      evidence: {
        spend, count: split.lowQuality.length,
        worstComponent: worst?.[0] ?? null,
        keywords: split.lowQuality.slice(0, 8).map((k) => ({
          term: k.text, qs: k.qualityScore, cost: k.spend,
          adRelevance: k.adRelevance, landingPage: k.landingPage,
        })),
      },
      moneyAtStake: spend * 0.15,
    });
  }

  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
