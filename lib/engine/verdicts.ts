import { q } from "@/lib/db";
import { fromMicros } from "./metrics";
import { testSegment, zeroConversionMultiple } from "./stats";
import { brandTerms, containsBrand, normalise, blocksOrVariant } from "./brand";

/**
 * A verdict per search term and per keyword: what to do with this line.
 *
 * Measured by code with the same tests as the findings, so a line is only
 * called waste when that is beyond chance for how many lines were looked at.
 * Anything short of that is "watch", never an action.
 */

export type Tone = "pill-bad" | "pill-warn" | "pill-good" | "pill-blue" | "pill";
export type Verdict = { verdict: string; tone: Tone; note: string; rank: number };

const V = {
  negative: (note: string): Verdict => ({ verdict: "Add as negative", tone: "pill-bad", note, rank: 0 }),
  pause: (note: string): Verdict => ({ verdict: "Pause", tone: "pill-bad", note, rank: 0 }),
  lower: (note: string): Verdict => ({ verdict: "Lower the bid", tone: "pill-warn", note, rank: 1 }),
  quality: (note: string): Verdict => ({ verdict: "Fix quality", tone: "pill-warn", note, rank: 2 }),
  promote: (note: string): Verdict => ({ verdict: "Add as keyword", tone: "pill-good", note, rank: 1 }),
  budget: (note: string): Verdict => ({ verdict: "Give more budget", tone: "pill-good", note, rank: 1 }),
  raise: (note: string): Verdict => ({ verdict: "Raise the bid", tone: "pill-good", note, rank: 1 }),
  strong: (note: string): Verdict => ({ verdict: "Working well", tone: "pill-good", note, rank: 4 }),
  working: (note: string): Verdict => ({ verdict: "Working", tone: "pill", note, rank: 5 }),
  watch: (note: string): Verdict => ({ verdict: "Watch", tone: "pill-warn", note, rank: 3 }),
  brand: (note: string): Verdict => ({ verdict: "Brand", tone: "pill-blue", note, rank: 6 }),
  keep: (note: string): Verdict => ({ verdict: "Keep", tone: "pill", note, rank: 6 }),
  none: (note: string): Verdict => ({ verdict: "Too early", tone: "pill", note, rank: 7 }),
  noVolume: (note: string): Verdict => ({ verdict: "No search volume", tone: "pill", note, rank: 6 }),
};

const x = (n: number) => `${n.toFixed(1)}×`;

export async function searchTermVerdicts(clientId: number, currency: string | null) {
  const [rows, keywords, negatives, brands, waste] = await Promise.all([
    q<any>(`SELECT s.term, c.name AS campaign, SUM(s.impressions)::float AS impressions, SUM(s.clicks)::float AS clicks,
                   SUM(s.cost_micros) AS cost, SUM(s.conversions)::float AS conv, MAX(v.avg_monthly)::float AS monthly
              FROM search_terms s
              LEFT JOIN campaigns c ON c.client_id = s.client_id AND c.campaign_id = s.campaign_id
              LEFT JOIN keyword_volumes v ON v.client_id = s.client_id AND v.keyword = lower(s.term)
             WHERE s.client_id = $1 GROUP BY s.term, c.name`, [clientId]),
    q<{ t: string }>(`SELECT DISTINCT lower(text) AS t FROM keywords WHERE client_id = $1 AND status <> 'REMOVED'`, [clientId]),
    q<{ t: string }>(`SELECT DISTINCT lower(text) AS t FROM negatives WHERE client_id = $1`, [clientId]),
    brandTerms(clientId),
    q<{ key: string; projects: number }>(`SELECT key, projects FROM portfolio_patterns WHERE kind = 'waste_theme' AND industry = 'all' AND significant`).catch(() => []),
  ]);
  const terms = rows.map((r) => ({ ...r, spend: fromMicros(r.cost) }));
  const total = { spend: terms.reduce((n, t) => n + t.spend, 0), conversions: terms.reduce((n, t) => n + t.conv, 0) };
  const cpa = total.conversions > 0 ? total.spend / total.conversions : null;
  const converting = terms.filter((t) => t.conv > 0).map((t) => t.term);
  const isKeyword = new Set(keywords.map((k) => normalise(k.t)));
  const isNegative = new Set(negatives.map((n) => normalise(n.t)));
  const wasteWords = new Map(waste.map((w) => [w.key, w.projects]));
  // Every zero-conversion term with spend is tested; the bar rises with how many.
  const tested = terms.filter((t) => t.conv === 0 && t.spend > 0).length;
  const bar = zeroConversionMultiple(tested);
  const money = (n: number) => `${Math.round(n).toLocaleString()}${currency ? ` ${currency}` : ""}`;

  const verdictFor = (t: any): Verdict => {
    const n = normalise(t.term);
    if (containsBrand(t.term, brands)) return V.brand("Your own name — never a negative");
    if (isNegative.has(n)) return V.keep("Already a negative");
    if (t.conv > 0) {
      if (!isKeyword.has(n)) return V.promote(`${t.conv.toFixed(0)} conversion${t.conv >= 1.5 ? "s" : ""}, but nothing bids on it directly — add as exact match`);
      if (cpa && total.conversions >= 5) {
        const worse = testSegment({ spend: t.spend, conversions: t.conv }, total, terms.length, "worse");
        if (worse.significant && t.spend / t.conv > cpa * 1.5) return V.lower(`${money(t.spend / t.conv)} per conversion against ${money(cpa)} overall — beyond chance`);
      }
      return V.working(`${t.conv.toFixed(0)} conversion${t.conv >= 1.5 ? "s" : ""}, already a keyword`);
    }
    if (!cpa || t.spend === 0) return V.none("No spend yet");
    const multiple = t.spend / cpa;
    const nearConverting = converting.some((c) => blocksOrVariant(t.term, c));
    const words = n.split(" ");
    const failsElsewhere = words.map((w) => wasteWords.get(w)).find(Boolean);
    if (multiple >= bar && !nearConverting) return V.negative(`Spent ${money(t.spend)} — ${x(multiple)} a conversion's cost — with nothing back; beyond chance across ${tested} searches`);
    if (failsElsewhere && t.spend >= cpa * 0.5 && !nearConverting) return V.negative(`No conversions here, and its wording fails on ${failsElsewhere} other accounts`);
    if (multiple >= 1 && nearConverting) return V.keep(`No conversions, but close to a search that converts — a negative could block it`);
    if (multiple >= 1) return V.watch(`Spent ${x(multiple)} a conversion's cost with none; not yet enough to call it waste (${x(bar)} is)`);
    return V.none(`Spent ${x(multiple)} a conversion's cost — too little to judge`);
  };

  const judged = terms.map((t) => ({ ...t, ...verdictFor(t) }));
  const shown = judged.filter((t) => t.clicks > 0 || t.conv > 0);
  return { cpa, bar, rows: shown, hidden: judged.length - shown.length };
}

const PART: Record<string, string> = { expected_ctr: "expected click-through", ad_relevance: "ad relevance", landing_page_experience: "landing page" };

export async function keywordVerdicts(clientId: number, currency: string | null) {
  const brands = await brandTerms(clientId);
  const rows = await q<any>(`
    SELECT k.text, k.match_type, k.status, c.name AS campaign, k.quality_score, k.expected_ctr, k.ad_relevance, k.landing_page_experience,
           k.clicks::float, k.impressions::float, k.cost_micros AS cost, k.conversions::float AS conv, v.avg_monthly::float AS monthly,
           c.search_lost_is_budget::float AS lost_budget, c.search_lost_is_rank::float AS lost_rank, c.status AS campaign_status
      FROM keywords k
      LEFT JOIN campaigns c ON c.client_id = k.client_id AND c.campaign_id = k.campaign_id
      LEFT JOIN keyword_volumes v ON v.client_id = k.client_id AND v.keyword = lower(k.text)
     WHERE k.client_id = $1 AND k.status <> 'REMOVED'`, [clientId]);
  const kws = rows.map((r) => ({ ...r, spend: fromMicros(r.cost) }));
  const live = kws.filter((k) => k.status === "ENABLED" && k.spend > 0 && !containsBrand(k.text, brands));
  const total = { spend: live.reduce((n, k) => n + k.spend, 0), conversions: live.reduce((n, k) => n + k.conv, 0) };
  const cpa = total.conversions > 0 ? total.spend / total.conversions : null;
  const tested = live.filter((k) => k.conv === 0).length;
  const bar = zeroConversionMultiple(tested);
  const money = (n: number) => `${Math.round(n).toLocaleString()}${currency ? ` ${currency}` : ""}`;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const verdictFor = (k: any): Verdict => {
    if (k.status !== "ENABLED") return { verdict: "Paused", tone: "pill", note: "Not running", rank: 8 };
    // Your own name is always cheap; judging it against the rest would call it a star.
    if (containsBrand(k.text, brands)) {
      const own = k.conv > 0 ? `${money(k.spend / k.conv)} per conversion` : k.spend > 0 ? `${money(k.spend)} spent, no conversions yet` : "no spend yet";
      return V.brand(`Your own name — ${own}${(k.lost_budget ?? 0) >= 0.1 ? `; its campaign misses ${pct(k.lost_budget)} of searches for lack of budget` : ""}`);
    }
    const weak = Object.keys(PART).filter((p) => k[p] === "BELOW_AVERAGE").map((p) => PART[p]);
    if (k.spend > 0 && cpa && k.conv === 0) {
      const multiple = k.spend / cpa;
      if (multiple >= bar) return V.pause(`Spent ${money(k.spend)} — ${x(multiple)} a conversion's cost — with nothing back; beyond chance across ${tested} keywords`);
      if (k.quality_score != null && k.quality_score <= 3 && weak.length) return V.quality(`Quality ${k.quality_score}/10 — below average on ${weak.join(" and ")}`);
      if (multiple >= 1) return V.watch(`Spent ${x(multiple)} a conversion's cost with none; not yet enough to pause (${x(bar)} is)`);
    }
    if (k.conv > 0 && cpa && total.conversions >= 5) {
      const rest = { spend: total.spend - k.spend, conversions: total.conversions - k.conv };
      const restCpa = rest.conversions > 0 ? rest.spend / rest.conversions : cpa;
      const own = k.spend / k.conv;
      const worse = testSegment({ spend: k.spend, conversions: k.conv }, total, live.length, "worse");
      const better = testSegment({ spend: k.spend, conversions: k.conv }, total, live.length, "better");
      if (worse.significant && own > restCpa * 1.5) return V.lower(`${money(own)} per conversion against ${money(restCpa)} for the rest — worth keeping, not at this price`);
      if (better.significant && own < restCpa * 0.75) {
        if ((k.lost_budget ?? 0) >= 0.1) return V.budget(`${money(own)} per conversion against ${money(restCpa)}, and its campaign misses ${pct(k.lost_budget)} of searches for lack of budget`);
        if ((k.lost_rank ?? 0) >= 0.2) return V.raise(`${money(own)} per conversion against ${money(restCpa)}, and its campaign misses ${pct(k.lost_rank)} of searches on ad rank`);
        return V.strong(`${money(own)} per conversion against ${money(restCpa)} for the rest — beyond chance`);
      }
    }
    if (k.quality_score != null && k.quality_score <= 3 && weak.length && k.clicks > 0) return V.quality(`Quality ${k.quality_score}/10 — below average on ${weak.join(" and ")}`);
    if (k.monthly === 0 && k.impressions === 0) return V.noVolume("Keyword Planner shows no searches where you target; Google marks it low search volume");
    if (k.conv > 0) return V.working(`${k.conv.toFixed(0)} conversion${k.conv >= 1.5 ? "s" : ""}, in line with the account`);
    return V.none(k.spend > 0 ? "Too little spend to judge" : "No spend in 90 days");
  };

  // Lines that never got a click say nothing and only weigh the page down.
  const judged = kws.map((k) => ({ ...k, ...verdictFor(k) }));
  const shown = judged.filter((k) => k.clicks > 0 || k.conv > 0 || k.verdict === "No search volume");
  return { cpa, bar, rows: shown, hidden: judged.length - shown.length };
}
