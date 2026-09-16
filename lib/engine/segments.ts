import { q } from "@/lib/db";
import { fromMicros } from "./metrics";
import type { Finding } from "./findings";
import { testSegment, zeroConversionMultiple } from "./stats";
import { brandTerms, containsBrand } from "./brand";

// Where the money actually goes. Campaign totals say money left; these say
// which device, which hour, which network, which keyword — the difference
// between "CPA is up" and "mobile after 9pm is where it is going".

// Every comparison here is judged against the account's own cost per
// conversion and tested for chance, corrected for how many segments were looked
// at (see stats.ts). Absolute gates like "60 clicks, 40 of spend" were blind to
// currency and to volume: in a dinar account 40 is about €0.35, and at 20
// conversions a quarter a segment "30% worse" is usually noise.

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
  const brands = await brandTerms(clientId);
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
  // Brand keywords never count as spenders, whatever their numbers.
  const unbranded = { ...keywords, spenders: keywords.spenders.filter((k: any) => !containsBrand(k.text, brands)),
    proven: keywords.proven.filter((k: any) => !containsBrand(k.text, brands)) };
  unbranded.spenderSpend = unbranded.spenders.reduce((n: number, k: any) => n + k.spend, 0);
  unbranded.provenSpend = unbranded.proven.reduce((n: number, k: any) => n + k.spend, 0);
  out.push(...keywordFindings(unbranded));

  return out;
}

// --------------------------------------------------------------- device ----

type Totals = { spend: number; conversions: number };
const totals = (rows: { spend: number; conversions: number }[]): Totals => ({
  spend: rows.reduce((n, r) => n + r.spend, 0),
  conversions: rows.reduce((n, r) => n + r.conversions, 0),
});
const rest = (t: Totals, r: Totals): Totals => ({
  spend: t.spend - r.spend, conversions: t.conversions - r.conversions,
});

/**
 * A zero-conversion segment is evidence only once it has spent enough CPAs
 * that chance cannot explain it across K segments. Below that, but past two
 * CPAs, it is worth a note that says plainly it is not yet evidence.
 */
function zeroVerdict(spend: number, accountCpa: number, k: number) {
  const cpas = spend / accountCpa;
  const needed = zeroConversionMultiple(k);
  return { cpas, needed, proven: cpas >= needed, early: cpas >= 2 && cpas < needed };
}

function deviceFindings(rows: SegmentRow[]): Finding[] {
  const live = rows.filter((r) => r.spend > 0);
  const t = totals(live);
  if (live.length < 2 || t.conversions < 1) return [];
  const accountCpa = t.spend / t.conversions;
  const k = live.length;
  const out: Finding[] = [];

  for (const r of live) {
    const label = DEVICE_LABEL[r.key] ?? r.key.toLowerCase();

    if (r.conversions === 0) {
      const v = zeroVerdict(r.spend, accountCpa, k);
      if (v.proven) {
        out.push({
          kind: "device_no_conversions",
          severity: "critical",
          title: `${cap(label)} spent ${r.spend.toFixed(0)} and converted nothing`,
          detail: `That is ${v.cpas.toFixed(1)} times the account's cost per conversion (${accountCpa.toFixed(2)}) with nothing to show, over 90 days — past the ${v.needed.toFixed(1)}× at which chance stops being a plausible explanation across ${k} devices. Either the experience on that device is broken or the traffic will not convert; a −100% device adjustment works under every bid strategy.`,
          evidence: { device: r.key, spend: r.spend, clicks: r.clicks, share: r.share, cpasSpent: v.cpas, cpasNeeded: v.needed },
          moneyAtStake: r.spend,
        });
      } else if (v.early) {
        out.push({
          kind: "device_no_conversions_early",
          severity: "info",
          title: `${cap(label)} has no conversions yet, but that is not evidence`,
          detail: `${r.spend.toFixed(0)} spent, ${v.cpas.toFixed(1)} times the account's cost per conversion. Across ${k} devices it takes about ${v.needed.toFixed(1)}× before zero means something. Do not act on it; look again when spend there reaches ${(v.needed * accountCpa).toFixed(0)}.`,
          evidence: { device: r.key, spend: r.spend, cpasSpent: v.cpas, cpasNeeded: v.needed },
        });
      }
      continue;
    }

    const others = rest(t, r);
    if (others.conversions < 1) continue;
    const test = testSegment(r, t, k, "worse");
    if (!test.significant) continue;

    const restCpa = others.spend / others.conversions;
    const worse = ((r.cpa! - restCpa) / restCpa) * 100;
    const excess = r.spend - r.conversions * restCpa;
    out.push({
      kind: "device_inefficient",
      severity: "warning",
      title: `${cap(label)} costs ${worse.toFixed(0)}% more per conversion than the other devices`,
      detail: `${cap(label)} converts at ${r.cpa!.toFixed(2)} against ${restCpa.toFixed(2)} everywhere else, on ${r.share.toFixed(0)}% of spend. At the account's rate it would have produced about ${test.expected.toFixed(0)} conversions and produced ${r.conversions.toFixed(0)} — a gap chance explains less than ${Math.max(1, Math.ceil(test.p * 100))}% of the time. Under Manual CPC, Maximise Clicks or Target CPA a device adjustment can express this; under other Smart Bidding strategies only a −100% opt-out is honoured.`,
      evidence: {
        device: r.key, cpa: r.cpa, restCpa, spend: r.spend, share: r.share,
        expectedConversions: test.expected, p: test.p, excessSpend: excess,
      },
      moneyAtStake: Math.max(0, excess),
    });
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
 * Individual hours are also too thin to judge, so the search is over contiguous
 * bands. Searching many overlapping bands and keeping the worst is itself a
 * multiple comparison; the bands are strongly correlated, so the correction
 * treats the search as 24 independent looks — one per hour — rather than the
 * ~240 bands, which would be far too strict.
 */
const HOUR_LOOKS = 24;

function hourFindings(rows: SegmentRow[]): Finding[] {
  if (rows.length < 8) return [];

  const byHour = new Map(rows.map((r) => [Number(r.key), r]));
  const hours = Array.from({ length: 24 }, (_, h) => byHour.get(h) ?? null);
  const t = totals(rows);
  if (t.conversions < 1) return [];
  const accountCpa = t.spend / t.conversions;

  type Band = {
    start: number; end: number;          // end is exclusive
    spend: number; clicks: number; conversions: number;
    cpa: number | null; restCpa: number;
    excess: number; p: number; expected: number;
    significant: boolean; signal: boolean;
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
      const others = rest(t, { spend, conversions });
      if (spend <= 0 || others.conversions < 1) continue;

      const restCpa = others.spend / others.conversions;
      const cpa = conversions > 0 ? spend / conversions : null;
      const excess = cpa === null ? spend : spend - conversions * restCpa;
      const test = testSegment({ spend, conversions }, t, HOUR_LOOKS, "worse");
      bands.push({
        start, end: (start + len) % 24, spend, clicks, conversions, cpa, restCpa,
        excess, p: test.p, expected: test.expected,
        significant: test.significant, signal: test.signal,
      });
    }
  }

  const hourly = hours.map((r, h) => ({
    hour: h, spend: r?.spend ?? 0, clicks: r?.clicks ?? 0,
    conversions: r?.conversions ?? 0, cpa: r?.cpa ?? null,
  }));

  const proven = bands.filter((b) => b.significant && b.excess > 0);
  if (proven.length) {
    const worst = proven.reduce((a, b) => (b.excess > a.excess ? b : a));
    const label = `${pad(worst.start)}:00 and ${pad(worst.end)}:00`;
    const shareOfSpend = (worst.spend / t.spend) * 100;

    if (worst.cpa === null) {
      return [{
        kind: "hours_bleeding",
        severity: shareOfSpend > 15 ? "critical" : "warning",
        title: `Nothing converts between ${label}`,
        detail: `That band took ${worst.spend.toFixed(0)} across ${worst.clicks} clicks over 90 days — about ${worst.expected.toFixed(1)} conversions' worth at the rest of the day's rate — and produced none. It is ${shareOfSpend.toFixed(0)}% of spend, and chance explains a gap that size less than ${Math.max(1, Math.ceil(worst.p * 100))}% of the time. Before excluding those hours, confirm nobody could take the lead then anyway; if so, an ad schedule moves the money into hours that already work.`,
        evidence: {
          band: [worst.start, worst.end], spend: worst.spend, clicks: worst.clicks,
          conversions: 0, restOfDayCpa: worst.restCpa, shareOfSpend,
          expectedConversions: worst.expected, p: worst.p, hourly,
        },
        moneyAtStake: worst.spend,
      }];
    }

    const worsePct = ((worst.cpa - worst.restCpa) / worst.restCpa) * 100;
    if (worsePct >= 35) {
      return [{
        kind: "hours_expensive",
        severity: worsePct > 100 ? "warning" : "info",
        title: `Conversions cost ${worsePct.toFixed(0)}% more between ${label}`,
        detail: `In that band a conversion costs ${worst.cpa.toFixed(2)} against ${worst.restCpa.toFixed(2)} across the rest of the day, on ${shareOfSpend.toFixed(0)}% of spend — ${worst.conversions.toFixed(0)} conversions where the rest of the day's rate predicts ${worst.expected.toFixed(1)}. Roughly ${worst.excess.toFixed(0)} over 90 days is the premium for buying those hours at the same bid as every other hour. Under Manual CPC, Maximise Clicks or Target CPA an ad-schedule adjustment can close most of it; under Maximise Conversions and Target ROAS schedule adjustments are ignored, and only excluding the hours works.`,
        evidence: {
          band: [worst.start, worst.end], cpa: worst.cpa, restOfDayCpa: worst.restCpa,
          worseByPct: worsePct, spend: worst.spend, conversions: worst.conversions,
          expectedConversions: worst.expected, p: worst.p,
          excessSpend: worst.excess, shareOfSpend, hourly,
        },
        moneyAtStake: worst.excess,
      }];
    }
  }

  // Nothing proven. Say so once if something looks suggestive, so the operator
  // does not act on it and does not see a silent dashboard either.
  const suggestive = bands.filter((b) => b.signal && b.excess > accountCpa);
  if (suggestive.length) {
    const b = suggestive.reduce((a, c) => (c.excess > a.excess ? c : a));
    return [{
      kind: "hours_signal",
      severity: "info",
      title: `${pad(b.start)}:00–${pad(b.end)}:00 looks weaker, but it is not yet evidence`,
      detail: `${b.conversions.toFixed(0)} conversions on ${b.spend.toFixed(0)} of spend where about ${b.expected.toFixed(1)} would be expected. With this little volume a gap like that turns up by chance too often to act on. Leave the schedule alone and look again in a month.`,
      evidence: { band: [b.start, b.end], spend: b.spend, conversions: b.conversions, expectedConversions: b.expected, p: b.p, hourly },
    }];
  }
  return [];
}

const pad = (n: number) => String(n).padStart(2, "0");

// ------------------------------------------------------------------ dow ----

/**
 * Each day against the rest of the week, not worst day against best day —
 * picking the extremes out of seven noisy numbers manufactures a gap.
 */
function dowFindings(rows: SegmentRow[]): Finding[] {
  const live = rows.filter((r) => r.spend > 0);
  const t = totals(live);
  if (live.length < 4 || t.conversions < 1) return [];
  const k = live.length;

  const tested = live
    .map((r) => ({ r, test: testSegment(r, t, k, "worse"), others: rest(t, r) }))
    .filter((x) => x.test.significant && x.others.conversions >= 1)
    .sort((a, b) => a.test.p - b.test.p);
  if (!tested.length) return [];

  const { r, test, others } = tested[0];
  const restCpa = others.spend / others.conversions;
  const day = DOW_LABEL[r.key] ?? r.key;
  const title = r.conversions === 0
    ? `${day} spends without converting`
    : `${day} costs ${(((r.cpa! - restCpa) / restCpa) * 100).toFixed(0)}% more per conversion than the rest of the week`;

  return [{
    kind: "day_of_week_gap",
    severity: "info",
    title,
    detail: `Across 90 days ${day} took ${r.spend.toFixed(0)} and produced ${r.conversions.toFixed(0)} conversions, where the rest of the week's rate (${restCpa.toFixed(2)} per conversion) predicts about ${test.expected.toFixed(1)}. If that fits how this business actually takes work, the weekly schedule is worth weighting.`,
    evidence: {
      day: r.key, spend: r.spend, conversions: r.conversions, restCpa,
      expectedConversions: test.expected, p: test.p,
      days: rows.map((x) => ({ day: x.key, spend: x.spend, conversions: x.conversions, cpa: x.cpa })),
    },
  }];
}

// -------------------------------------------------------------- network ----

function networkFindings(rows: SegmentRow[]): Finding[] {
  const out: Finding[] = [];
  const live = rows.filter((r) => r.spend > 0);
  const t = totals(live);
  if (live.length < 2 || t.conversions < 1) return out;
  const accountCpa = t.spend / t.conversions;
  const k = live.length;

  for (const r of live) {
    if (r.key === "SEARCH") continue;
    const label = NETWORK_LABEL[r.key] ?? r.key.toLowerCase().replace(/_/g, " ");
    // Performance Max cannot switch off Search Partners or Display (a closed
    // alpha only), so the remedy offered has to hold for both campaign types.
    const remedy = r.key === "SEARCH_PARTNERS"
      ? "On a Search campaign, search partners can be turned off without touching anything else. Performance Max has no such switch for most advertisers."
      : "Individual placements can be excluded at account level, which also reaches Performance Max; the channel as a whole cannot be switched off in Performance Max.";

    if (r.conversions === 0) {
      const v = zeroVerdict(r.spend, accountCpa, k);
      if (!v.proven) continue;
      out.push({
        kind: "network_no_conversions",
        severity: "warning",
        title: `${r.spend.toFixed(0)} went to ${label} with no conversions`,
        detail: `${r.clicks} clicks and nothing to show — ${v.cpas.toFixed(1)} times the account's cost per conversion, on ${r.share.toFixed(0)}% of spend. ${remedy}`,
        evidence: { network: r.key, spend: r.spend, clicks: r.clicks, share: r.share, cpasSpent: v.cpas, cpasNeeded: v.needed },
        moneyAtStake: r.spend,
      });
      continue;
    }

    const others = rest(t, r);
    if (others.conversions < 1) continue;
    const test = testSegment(r, t, k, "worse");
    if (!test.significant) continue;
    const restCpa = others.spend / others.conversions;
    const worse = ((r.cpa! - restCpa) / restCpa) * 100;
    if (worse < 50) continue;
    out.push({
      kind: "network_inefficient",
      severity: "info",
      title: `${cap(label)} costs ${worse.toFixed(0)}% more per conversion than the rest of the account`,
      detail: `${r.cpa!.toFixed(2)} against ${restCpa.toFixed(2)} elsewhere, across ${r.share.toFixed(0)}% of spend — ${r.conversions.toFixed(0)} conversions where about ${test.expected.toFixed(1)} would be expected. ${remedy}`,
      evidence: { network: r.key, cpa: r.cpa, restCpa, spend: r.spend, expectedConversions: test.expected, p: test.p },
      moneyAtStake: Math.max(0, r.spend - r.conversions * restCpa),
    });
  }
  return out;
}

// -------------------------------------------------------------- keywords ---

export type KeywordSplit = {
  workers: any[];
  /** Non-converting keywords that have spent at least one account CPA. */
  spenders: any[];
  /** The subset of spenders whose zero is evidence, not chance. */
  proven: any[];
  lowQuality: any[];
  totalSpend: number;
  spenderSpend: number;
  provenSpend: number;
  baselineCpa: number | null;
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
  const totalConv = mapped.reduce((n, k) => n + k.conversions, 0);
  const baselineCpa = totalConv > 0 ? totalSpend / totalConv : null;
  const looks = mapped.filter((k) => k.spend > 0).length;
  const needed = zeroConversionMultiple(looks);

  // Spend is measured in the account's own conversions, never in currency: a
  // fixed "15 spent" meant nothing in dinars and everything in dollars.
  const spenders = baselineCpa
    ? mapped
        .filter((k) => k.conversions === 0 && k.spend >= baselineCpa)
        .map((k) => ({ ...k, cpasSpent: k.spend / baselineCpa, proven: k.spend / baselineCpa >= needed }))
    : [];
  const proven = spenders.filter((k) => k.proven);
  const workers = mapped.filter((k) => k.conversions > 0).sort((a, b) => a.cpa! - b.cpa!);
  const lowQuality = mapped.filter(
    (k) => k.qualityScore != null && k.qualityScore <= 4 && totalSpend > 0 && k.spend / totalSpend >= 0.01
  );

  return {
    workers, spenders, proven, lowQuality, totalSpend, baselineCpa,
    spenderSpend: spenders.reduce((n, k) => n + k.spend, 0),
    provenSpend: proven.reduce((n, k) => n + k.spend, 0),
  };
}

function keywordFindings(split: KeywordSplit): Finding[] {
  const out: Finding[] = [];

  if (split.baselineCpa && split.spenders.length) {
    const share = split.totalSpend > 0 ? (split.spenderSpend / split.totalSpend) * 100 : 0;
    const top = split.spenders.slice(0, 8);
    const topTerms = top.map((k: any) => ({
      term: k.text, cost: k.spend, clicks: k.clicks, match: k.matchType,
      cpasSpent: k.cpasSpent, proven: k.proven,
    }));

    if (split.proven.length) {
      const first = split.proven[0];
      out.push({
        kind: "keyword_spenders",
        severity: split.provenSpend / Math.max(split.totalSpend, 1) > 0.15 ? "critical" : "warning",
        title: `${split.proven.length} keyword${split.proven.length === 1 ? "" : "s"} took ${split.provenSpend.toFixed(0)} and converted nothing`,
        detail: `Each has spent enough — several times the account's cost per conversion of ${split.baselineCpa.toFixed(2)} — that zero is evidence rather than bad luck, even allowing for how many keywords were checked. The largest is "${first.text}" at ${first.spend.toFixed(0)}, ${first.cpasSpent.toFixed(1)} conversions' worth. ${split.spenders.length > split.proven.length ? `Another ${split.spenders.length - split.proven.length} keyword${split.spenders.length - split.proven.length === 1 ? " has" : "s have"} no conversions yet but not enough spend to judge.` : ""}`,
        evidence: { wasted: split.provenSpend, count: split.proven.length, shareOfSpend: share, baselineCpa: split.baselineCpa, topTerms },
        moneyAtStake: split.provenSpend,
      });
    } else {
      out.push({
        kind: "keyword_spenders_early",
        severity: "info",
        title: `${split.spenders.length} keyword${split.spenders.length === 1 ? " has" : "s have"} spent without converting — not yet evidence`,
        detail: `Together ${split.spenderSpend.toFixed(0)}, ${share.toFixed(0)}% of keyword spend. None has spent enough for its zero to rule out chance: with this many keywords, one needs roughly ${(zeroConversionMultiple(split.spenders.length + split.workers.length)).toFixed(1)} times the account's cost per conversion (${split.baselineCpa.toFixed(2)}) before pausing it is justified. Watch the search terms behind them rather than pausing.`,
        evidence: { wasted: split.spenderSpend, count: split.spenders.length, shareOfSpend: share, baselineCpa: split.baselineCpa, topTerms },
      });
    }
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
