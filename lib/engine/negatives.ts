import { q } from "@/lib/db";
import type { Finding } from "./findings";
import { fromMicros } from "./metrics";
import { brandTerms, containsBrand, normalise } from "./brand";

/**
 * Negative keywords, judged in their own right.
 *
 *   conflicts      a negative that blocks one of the account's own keywords, or
 *                  a search that converts in the same campaign
 *   gaps           a search negated in one campaign that still spends, without
 *                  converting, in another
 *   waste words    a word that fails across many searches, each too small to
 *                  judge on its own — the within-account version of the
 *                  portfolio test, with the same correction for how many words
 *                  were looked at
 */

type Row = any;
const STOP = new Set(["the", "and", "for", "with", "near", "from", "your", "you", "kod", "ili", "koji", "koja", "koje", "za", "na", "od", "do", "sa", "iz", "po", "u", "i"]);

function poissonCdf(k: number, lambda: number) {
  let term = Math.exp(-lambda), sum = term;
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term; }
  return Math.min(1, sum);
}

export type NegativeReport = {
  conflicts: { negative: string; level: string; campaign: string | null; blocks: string; what: "keyword" | "converting search" }[];
  gaps: { term: string; negatedIn: string; spendingIn: string; spend: number; clicks: number }[];
  words: { word: string; searches: number; clicks: number; spend: number; expected: number; conversions: number }[];
};

export async function negativeReport(clientId: number): Promise<NegativeReport> {
  const [negs, kws, terms, brands, camps] = await Promise.all([
    q<Row>(`SELECT DISTINCT text, match_type, level, campaign_id, ad_group_id FROM negatives WHERE client_id = $1`, [clientId]),
    q<Row>(`SELECT DISTINCT k.text, k.campaign_id, k.ad_group_id FROM keywords k WHERE k.client_id = $1 AND k.status = 'ENABLED' AND k.text <> ''
             AND NOT EXISTS (SELECT 1 FROM negatives n WHERE n.client_id = k.client_id AND n.level = 'ad_group'
                              AND n.ad_group_id = k.ad_group_id AND lower(n.text) = lower(k.text))`, [clientId]),
    q<Row>(`SELECT term, campaign_id, SUM(clicks)::float AS clicks, SUM(cost_micros) AS cost, SUM(conversions)::float AS conv
              FROM search_terms WHERE client_id = $1 GROUP BY term, campaign_id`, [clientId]),
    brandTerms(clientId),
    q<Row>(`SELECT campaign_id, name FROM campaigns WHERE client_id = $1`, [clientId]),
  ]);
  const name = new Map(camps.map((c) => [c.campaign_id, c.name]));
  // A shared list reaches only the campaigns it is attached to, which is the campaign on its row.
  const inScope = (n: Row, campaign: string, adGroup?: string) =>
    (n.level === "shared" && (!n.campaign_id || n.campaign_id === campaign)) ||
    (n.level === "campaign" && n.campaign_id === campaign) || (n.level === "ad_group" && n.ad_group_id === adGroup);
  // An exact negative blocks only its own text; phrase and broad block anything containing their words.
  // (Negatives also catch misspellings since Google's June 2024 change, which blocksOrVariant's edit distance covers.)
  // Phrase and broad negatives block a search containing all their words (plurals and word order aside).
  const tokens = (s: string) => normalise(s).split(" ").filter(Boolean).map((w) => w.replace(/(es|s)$/, ""));
  const blocks = (n: Row, text: string) => {
    if (n.match_type === "EXACT") return normalise(n.text) === normalise(text);
    const have = new Set(tokens(text));
    return tokens(n.text).every((w) => have.has(w));
  };

  // Compare each negative only with what sits in its own campaign.
  const kwByCampaign = new Map<string, Row[]>(), convByCampaign = new Map<string, Row[]>();
  for (const k of kws) kwByCampaign.set(k.campaign_id, [...(kwByCampaign.get(k.campaign_id) ?? []), k]);
  for (const t of terms) if (t.conv > 0) convByCampaign.set(t.campaign_id, [...(convByCampaign.get(t.campaign_id) ?? []), t]);
  const conflicts: NegativeReport["conflicts"] = [];
  const seen = new Set<string>();
  for (const n of negs) {
    const pool = n.campaign_id ? [n.campaign_id] : [...kwByCampaign.keys()];
    for (const cid of pool) {
      const kw = (kwByCampaign.get(cid) ?? []).find((k) => inScope(n, k.campaign_id, k.ad_group_id) && blocks(n, k.text));
      const conv = kw ? null : (convByCampaign.get(cid) ?? []).find((t) => inScope(n, t.campaign_id) && blocks(n, t.term));
      const hit = kw ? { blocks: kw.text, what: "keyword" as const } : conv ? { blocks: conv.term, what: "converting search" as const } : null;
      if (!hit) continue;
      const key = `${n.text}|${cid}|${hit.blocks}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({ negative: n.text, level: n.level, campaign: name.get(cid) ?? null, ...hit });
    }
  }

  const gaps: NegativeReport["gaps"] = [];
  const campaignNegs = negs.filter((n) => n.level === "campaign");
  for (const t of terms) {
    if (t.conv > 0 || fromMicros(t.cost) <= 0) continue;
    const elsewhere = campaignNegs.find((n) => n.campaign_id !== t.campaign_id && normalise(n.text) === normalise(t.term));
    const here = negs.some((n) => inScope(n, t.campaign_id) && blocks(n, t.term));
    if (elsewhere && !here) gaps.push({ term: t.term, negatedIn: name.get(elsewhere.campaign_id) ?? elsewhere.campaign_id, spendingIn: name.get(t.campaign_id) ?? t.campaign_id, spend: fromMicros(t.cost), clicks: t.clicks });
  }
  gaps.sort((a, b) => b.spend - a.spend);

  // Words: the account's own rate per click as the yardstick.
  const clicks = terms.reduce((n, t) => n + t.clicks, 0), conv = terms.reduce((n, t) => n + t.conv, 0);
  const words: NegativeReport["words"] = [];
  if (clicks >= 200 && conv >= 3) {
    const rate = conv / clicks;
    const keywordWords = new Set(kws.flatMap((k) => normalise(k.text).split(" ")));
    const by = new Map<string, { searches: number; clicks: number; spend: number; conv: number }>();
    for (const t of terms) {
      if (containsBrand(t.term, brands)) continue;
      for (const w of new Set(normalise(t.term).split(" "))) {
        if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w) || keywordWords.has(w)) continue;
        const cur = by.get(w) ?? { searches: 0, clicks: 0, spend: 0, conv: 0 };
        cur.searches++; cur.clicks += t.clicks; cur.spend += fromMicros(t.cost); cur.conv += t.conv;
        by.set(w, cur);
      }
    }
    const tested = [...by.entries()].filter(([, v]) => v.searches >= 3 && v.clicks * rate >= 3);
    const K = Math.max(1, tested.length);
    for (const [word, v] of tested) {
      const expected = v.clicks * rate;
      if (poissonCdf(Math.round(v.conv), expected) < 0.05 / K && v.conv <= expected * 0.3) {
        words.push({ word, searches: v.searches, clicks: v.clicks, spend: v.spend, expected, conversions: v.conv });
      }
    }
    words.sort((a, b) => b.spend - a.spend);
  }
  return { conflicts, gaps: gaps.slice(0, 50), words: words.slice(0, 40) };
}

export async function negativeFindings(clientId: number): Promise<Finding[]> {
  const r = await negativeReport(clientId);
  const out: Finding[] = [];
  if (r.conflicts.length) {
    out.push({
      kind: "negatives_conflict", product: "ads", area: "structure", severity: "warning",
      title: `${r.conflicts.length} negative keyword${r.conflicts.length === 1 ? " blocks" : "s block"} something you want`,
      detail: `The negative "${r.conflicts[0].negative}" blocks ${r.conflicts[0].what === "keyword" ? "the keyword" : "the converting search"} "${r.conflicts[0].blocks}". A negative always wins over a keyword, so those searches cannot show your ad at all. Remove or narrow the negative.`,
      evidence: { conflicts: r.conflicts },
      table: { columns: ["Negative", "Level", "Campaign", "Blocks", "Which is a"], rows: r.conflicts.slice(0, 30).map((c) => [c.negative, c.level, c.campaign ?? "all", c.blocks, c.what]) },
    });
  }
  if (r.gaps.length) {
    const spend = r.gaps.reduce((n, g) => n + g.spend, 0);
    out.push({
      kind: "negatives_gap_across_campaigns", product: "ads", area: "waste", severity: r.gaps.length >= 3 ? "warning" : "info",
      title: `${r.gaps.length} search${r.gaps.length === 1 ? " is" : "es are"} excluded in one campaign but still spending in another`,
      detail: `"${r.gaps[0].term}" is a negative in "${r.gaps[0].negatedIn}" but spent without converting in "${r.gaps[0].spendingIn}". Someone already decided it is not wanted; a shared negative list applies that decision everywhere at once.`,
      evidence: { gaps: r.gaps }, moneyAtStake: spend, windowDays: 90,
      table: { columns: ["Search", "Excluded in", "Still spending in", "Spend", "Clicks"], rows: r.gaps.slice(0, 30).map((g) => [g.term, g.negatedIn, g.spendingIn, Math.round(g.spend), g.clicks]) },
    });
  }
  if (r.words.length) {
    const spend = r.words.reduce((n, w) => n + w.spend, 0);
    out.push({
      kind: "account_waste_words", product: "ads", area: "waste", severity: "warning",
      title: `${r.words.length} word${r.words.length === 1 ? "" : "s"} waste money across many small searches`,
      detail: `Searches containing "${r.words[0].word}" — ${r.words[0].searches} different ones, each too small to judge alone — got ${r.words[0].clicks} clicks and ${r.words[0].conversions.toFixed(0)} conversions where this account's own rate predicts about ${r.words[0].expected.toFixed(1)}. That gap is beyond chance across every word tested. None of these words is in an active keyword, so a phrase negative on them blocks nothing you bid on.`,
      evidence: { words: r.words }, moneyAtStake: spend, windowDays: 90,
      table: { columns: ["Word", "Searches", "Clicks", "Spend", "Conv.", "Expected"], rows: r.words.slice(0, 30).map((w) => [w.word, w.searches, w.clicks, Math.round(w.spend), w.conversions, Math.round(w.expected * 10) / 10]) },
    });
  }
  return out;
}
