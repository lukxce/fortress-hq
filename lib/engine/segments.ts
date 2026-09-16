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

// The v25 AdNetworkType values. For Performance Max, SEARCH includes Shopping.
const NETWORK_LABEL: Record<string, string> = {
  SEARCH: "Google search", SEARCH_PARTNERS: "search partners",
  CONTENT: "the display network", YOUTUBE: "YouTube",
  GMAIL: "Gmail", DISCOVER: "Discover", MAPS: "Google Maps",
  GOOGLE_TV: "Google TV", GOOGLE_OWNED_CHANNELS: "Google-owned channels",
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

/**
 * Find the time band that costs more, and say so as a comparison.
 *
 * A list of individual hours is not an insight — nobody acts on "03:00, 04:00
 * and 22:00". What is actionable is "conversions cost 60% more between 06:00
 * and 12:00", because that maps directly onto an ad schedule.
 *
 * Individual hours are also too thin to judge: an account doing 40 conversions
 * a quarter has under two per hour. So the search is over contiguous *bands*,
 * which pools enough volume for the comparison to mean anything.
 */
function hourFindings(rows: SegmentRow[]): Finding[] {
  if (rows.length < 8) return [];

  const byHour = new Map(rows.map((r) => [Number(r.key), r]));
  const hours = Array.from({ length: 24 }, (_, h) => byHour.get(h) ?? null);

  const totalSpend = rows.reduce((n, r) => n + r.spend, 0);
  const totalConv = rows.reduce((n, r) => n + r.conversions, 0);
  const totalClicks = rows.reduce((n, r) => n + r.clicks, 0);
  if (totalSpend < MIN_SEG_SPEND * 3 || totalClicks < MIN_SEG_CLICKS * 3) return [];

  type Band = {
    start: number; end: number;          // end is exclusive
    spend: number; clicks: number; conversions: number;
    cpa: number | null;
    restCpa: number | null;
    excess: number;                       // money above what the rest would have cost
  };

  const bands: Band[] = [];
  // Bands of 3 to 12 hours, wrapping past midnight — the quiet stretch usually
  // straddles it, and a band that cannot wrap would never find it.
  for (let len = 3; len <= 12; len++) {
    for (let start = 0; start < 24; start++) {
      let spend = 0, clicks = 0, conversions = 0;
      for (let i = 0; i < len; i++) {
        const r = hours[(start + i) % 24];
        if (!r) continue;
        spend += r.spend; clicks += r.clicks; conversions += r.conversions;
      }
      if (clicks < MIN_SEG_CLICKS || spend < MIN_SEG_SPEND) continue;

      const restSpend = totalSpend - spend;
      const restConv = totalConv - conversions;
      const restClicks = totalClicks - clicks;
      if (restClicks < MIN_SEG_CLICKS || restConv < 1) continue;

      const cpa = conversions > 0 ? spend / conversions : null;
      const restCpa = restConv > 0 ? restSpend / restConv : null;
      if (restCpa === null) continue;

      // What this band's traffic would have cost at the rest of the day's rate.
      const excess = cpa === null ? spend : spend - conversions * restCpa;
      bands.push({ start, end: (start + len) % 24, spend, clicks, conversions, cpa, restCpa, excess });
    }
  }

  if (!bands.length) return [];

  const worst = bands.reduce((a, b) => (b.excess > a.excess ? b : a));
  if (worst.excess < MIN_SEG_SPEND) return [];

  const label = `${pad(worst.start)}:00 and ${pad(worst.end)}:00`;
  const shareOfSpend = (worst.spend / totalSpend) * 100;

  // Never converted at all in this band.
  if (worst.cpa === null) {
    return [{
      kind: "hours_bleeding",
      severity: worst.spend > totalSpend * 0.15 ? "critical" : "warning",
      title: `Nothing converts between ${label}`,
      detail: `That band took ${worst.spend.toFixed(0)} across ${worst.clicks} clicks over 90 days and produced no conversions, while the rest of the day converts at ${worst.restCpa!.toFixed(2)}. It is ${shareOfSpend.toFixed(0)}% of spend. An ad schedule excluding those hours moves the money into hours that already work.`,
      evidence: {
        band: [worst.start, worst.end], spend: worst.spend, clicks: worst.clicks,
        conversions: 0, restOfDayCpa: worst.restCpa, shareOfSpend,
        hourly: hours.map((r, h) => ({
          hour: h, spend: r?.spend ?? 0, clicks: r?.clicks ?? 0,
          conversions: r?.conversions ?? 0, cpa: r?.cpa ?? null,
        })),
      },
      moneyAtStake: worst.spend,
    }];
  }

  const worsePct = ((worst.cpa - worst.restCpa!) / worst.restCpa!) * 100;
  if (worsePct < 35) return [];

  return [{
    kind: "hours_expensive",
    severity: worsePct > 100 ? "warning" : "info",
    title: `Conversions cost ${worsePct.toFixed(0)}% more between ${label}`,
    detail: `In that band a conversion costs ${worst.cpa.toFixed(2)} against ${worst.restCpa!.toFixed(2)} across the rest of the day, on ${shareOfSpend.toFixed(0)}% of spend. Roughly ${worst.excess.toFixed(0)} over 90 days is the premium for buying those hours at the same bid as every other hour — a negative bid adjustment on that window closes most of it.`,
    evidence: {
      band: [worst.start, worst.end], cpa: worst.cpa, restOfDayCpa: worst.restCpa,
      worseByPct: worsePct, spend: worst.spend, conversions: worst.conversions,
      excessSpend: worst.excess, shareOfSpend,
      hourly: hours.map((r, h) => ({
        hour: h, spend: r?.spend ?? 0, clicks: r?.clicks ?? 0,
        conversions: r?.conversions ?? 0, cpa: r?.cpa ?? null,
      })),
    },
    moneyAtStake: worst.excess,
  }];
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
        // Performance Max cannot switch off Search Partners or Display (a closed
        // alpha only), so the remedy offered has to hold for both campaign types.
        detail: `${r.clicks} clicks and nothing to show, on ${r.share.toFixed(0)}% of spend. ${r.key === "SEARCH_PARTNERS" ? "On a Search campaign, search partners can be turned off without touching anything else. Performance Max has no such switch for most advertisers." : "Individual placements can be excluded at account level, which also reaches Performance Max; the channel as a whole cannot be switched off in Performance Max."}`,
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
