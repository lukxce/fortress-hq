import { q } from "@/lib/db";
import { fromMicros } from "./metrics";

/**
 * Statistical honesty at low volume.
 *
 * The accounts this engine reads do 10–40 conversions a month. At that volume
 * the old gates — 100 clicks, 50 of spend, 5 conversions — were not defensible:
 * a segment with 5 conversions has a true CPA anywhere from 0.43× to 3.1× what
 * it shows, and in simulation "≥5 conversions and CPA ≥1.3× average" flagged a
 * segment with no real difference 20–36% of the time. "50 of spend" was also
 * currency-blind — about €0.43 in a dinar account, so it filtered nothing.
 *
 * So every judgement here is relative to the account's own cost per conversion,
 * and every "this segment is worse" claim is an exact test corrected for how
 * many segments were looked at. The maths follows the research note of
 * 2026-09-16: conversions as Poisson with exposure proportional to spend; the
 * conditional binomial test for one segment against the rest (Przyborowski &
 * Wilenski 1940); e^(−m) for a zero-conversion segment that spent m CPAs.
 */

const ALPHA = 0.05;

/** ln Γ(x), Lanczos approximation. Accurate well beyond what these tests need. */
function lnGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61503916999185, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function lnChoose(n: number, k: number): number {
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

/** P(X ≤ k) for X ~ Binomial(n, p). Conversions can be fractional; they are rounded. */
export function binomCdf(k: number, n: number, p: number): number {
  n = Math.round(n);
  k = Math.floor(k);
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += Math.exp(lnChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  }
  return Math.min(1, sum);
}

/** P(X ≥ k). */
export function binomSf(k: number, n: number, p: number): number {
  return 1 - binomCdf(Math.ceil(k) - 1, n, p);
}

/**
 * How many CPAs a segment must spend with no conversions before that is
 * evidence rather than chance, when K segments were examined: −ln(α/K).
 * 3.0× for one, 4.1× across devices, 4.9× across weekdays, 6.2× across hours,
 * about 7× across fifty keywords.
 */
export function zeroConversionMultiple(k: number): number {
  return -Math.log(ALPHA / Math.max(1, k));
}

export type SegmentTest = {
  /** Conversions the segment would have had at the rest of the account's rate. */
  expected: number;
  /** One-sided exact p-value. */
  p: number;
  /** Passes the corrected test: a finding. */
  significant: boolean;
  /** Suggestive only: worth a "not yet evidence" note, never an action. */
  signal: boolean;
};

/**
 * Is this segment converting worse (or better) than its share of spend predicts?
 *
 * Under "same CPA as everywhere else", a segment holding share s of the spend
 * should hold share s of the N conversions, so its count is Binomial(N, s).
 * Below 3 expected conversions even zero cannot reach significance, so nothing
 * there is reported as a finding.
 */
export function testSegment(
  seg: { spend: number; conversions: number },
  total: { spend: number; conversions: number },
  k: number,
  direction: "worse" | "better" = "worse"
): SegmentTest {
  const n = Math.round(total.conversions);
  const s = total.spend > 0 ? seg.spend / total.spend : 0;
  const expected = n * s;
  if (n < 1 || s <= 0 || s >= 1) return { expected, p: 1, significant: false, signal: false };
  const count = Math.round(seg.conversions);
  const p = direction === "worse" ? binomCdf(count, n, s) : binomSf(count, n, s);
  return {
    expected,
    p,
    significant: p < ALPHA / Math.max(1, k) && expected >= 3,
    signal: p < 0.2 && expected >= 2,
  };
}

/**
 * Two periods: did cost per conversion genuinely move, or is it noise?
 * Same conditional test, with the periods' spend shares as exposure.
 */
export function testPeriods(
  current: { spend: number; conversions: number },
  previous: { spend: number; conversions: number },
  direction: "worse" | "better" = "worse"
): SegmentTest {
  return testSegment(
    current,
    { spend: current.spend + previous.spend, conversions: current.conversions + previous.conversions },
    1,
    direction
  );
}

/**
 * Upper bound of the exact 95% Poisson interval on a count (Garwood). Used to
 * ask "even on the most favourable reading, is cost per conversion above
 * target?" — the only form of that question that is honest at 8 conversions.
 */
export function poissonUpper(count: number, alpha = ALPHA): number {
  const k = Math.round(count);
  // Find λ with P(X ≤ k; λ) = α/2 by bisection.
  const cdf = (lambda: number) => {
    let term = Math.exp(-lambda), sum = term;
    for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term; }
    return sum;
  };
  let lo = k, hi = k + 10 + 10 * Math.sqrt(k + 1);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) > alpha / 2) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Lower bound of the same interval. */
export function poissonLower(count: number, alpha = ALPHA): number {
  const k = Math.round(count);
  if (k === 0) return 0;
  const sf = (lambda: number) => {
    let term = Math.exp(-lambda), sum = term;
    for (let i = 1; i < k; i++) { term *= lambda / i; sum += term; }
    return 1 - sum;
  };
  let lo = 0, hi = k;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (sf(mid) < alpha / 2) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A spend floor for checks that cannot be expressed in CPAs (an account with no
 * conversions has no CPA). Approximate euro rates are fine here: this decides
 * whether an account has spent enough to be worth a remark, not what anything
 * is worth.
 */
const PER_EURO: Record<string, number> = {
  EUR: 1, USD: 1.1, GBP: 0.85, CHF: 0.95, RSD: 117, BAM: 1.96, BGN: 1.96,
  MKD: 61.5, HUF: 400, RON: 5, PLN: 4.3, CZK: 25, SEK: 11.5, NOK: 11.7,
  DKK: 7.46, CAD: 1.5, AUD: 1.65,
};

export function fromEuros(amount: number, currency: string | null | undefined): number {
  return amount * (PER_EURO[(currency ?? "EUR").toUpperCase()] ?? 1);
}

export type Baseline = {
  spend: number; clicks: number; conversions: number;
  cpa: number | null; cpc: number | null;
};

/** The account's own rates over a window, from campaign-level daily metrics. */
export async function accountBaseline(clientId: number, days: number): Promise<Baseline> {
  const [r] = await q<{ cost_micros: string; clicks: string; conversions: string }>(`
    SELECT COALESCE(SUM(cost_micros),0) AS cost_micros,
           COALESCE(SUM(clicks),0) AS clicks,
           COALESCE(SUM(conversions),0) AS conversions
      FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign'
       AND date > CURRENT_DATE - ($2::int + 1) AND date <= CURRENT_DATE - 1
  `, [clientId, days]);
  const spend = fromMicros(r?.cost_micros);
  const clicks = Number(r?.clicks ?? 0);
  const conversions = Number(r?.conversions ?? 0);
  return {
    spend, clicks, conversions,
    cpa: conversions > 0 ? spend / conversions : null,
    cpc: clicks > 0 ? spend / clicks : null,
  };
}
