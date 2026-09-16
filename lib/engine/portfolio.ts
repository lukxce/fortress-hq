import { q } from "@/lib/db";
import type { Finding } from "./findings";
import { fromMicros } from "./metrics";
import { brandTerms, containsBrand, normalise } from "./brand";
import { MIN_PROJECTS } from "@/lib/learning/patterns";

/**
 * Findings that exist only because other accounts were read.
 *
 * A waste word counts here only if it failed on at least MIN_PROJECTS accounts
 * AND at least two of them are not this one, so an account can never confirm
 * its own pattern. It still has to be failing here: a search that converted on
 * this account is never listed, whatever other accounts say.
 */
export async function portfolioFindings(clientId: number): Promise<Finding[]> {
  const [me] = await q<any>(`SELECT COALESCE(industry, 'unknown') AS industry, currency FROM clients WHERE id = $1`, [clientId]);
  if (!me) return [];
  const scopes = me.industry !== "unknown" ? ["all", me.industry] : ["all"];
  const themes = await q<any>(`SELECT kind, industry, key, stats, projects FROM portfolio_patterns
                                WHERE kind IN ('waste_theme', 'converting_theme') AND industry = ANY($1) AND projects >= $2`,
    [scopes, MIN_PROJECTS]);
  if (!themes.length) return [];

  const [terms, keywords, negatives, brands] = await Promise.all([
    q<any>(`SELECT term, SUM(clicks)::float AS clicks, SUM(conversions)::float AS conv, SUM(cost_micros) AS cost
              FROM search_terms WHERE client_id = $1 GROUP BY term`, [clientId]),
    q<any>(`SELECT DISTINCT lower(text) AS t FROM keywords WHERE client_id = $1 AND status = 'ENABLED'`, [clientId]),
    q<any>(`SELECT DISTINCT lower(text) AS t FROM negatives WHERE client_id = $1`, [clientId]),
    brandTerms(clientId),
  ]);
  const own = new Set(terms.filter((t) => t.clicks > 0).flatMap((t) => grams(t.term)));
  // Other accounts must carry the pattern on their own.
  const others = (t: any) => t.projects - (own.has(t.key) ? 1 : 0) >= 2;
  const negated = new Set(negatives.flatMap((n) => grams(n.t)));
  const out: Finding[] = [];

  const waste = new Map<string, any>(themes.filter((t) => t.kind === "waste_theme" && others(t)).map((t) => [t.key, t]));
  const hits = terms
    .filter((t) => t.conv === 0 && t.clicks > 0 && !containsBrand(t.term, brands))
    .map((t) => ({ ...t, spend: fromMicros(t.cost), words: grams(t.term).filter((g) => waste.has(g) && !negated.has(g)) }))
    .filter((t) => t.words.length);
  if (hits.length) {
    const spend = hits.reduce((n, t) => n + t.spend, 0);
    const byWord = new Map<string, { spend: number; clicks: number; searches: number }>();
    for (const h of hits) for (const w of h.words) {
      const cur = byWord.get(w) ?? { spend: 0, clicks: 0, searches: 0 };
      cur.spend += h.spend; cur.clicks += h.clicks; cur.searches++;
      byWord.set(w, cur);
    }
    const words = [...byWord.entries()].sort((a, b) => b[1].spend - a[1].spend);
    out.push({
      kind: "portfolio_waste_words", product: "ads", area: "waste",
      severity: spend > 0 && hits.length >= 3 ? "warning" : "info",
      title: `${words.length} word${words.length === 1 ? "" : "s"} that fail on other accounts ${words.length === 1 ? "is" : "are"} costing money here too`,
      detail: `Searches containing "${words[0][0]}" failed to convert on ${waste.get(words[0][0]).projects} accounts Fortress runs — fewer conversions than those accounts' own rates predict, beyond chance. On this account they have not converted either: ${hits.length} search${hits.length === 1 ? "" : "es"} with these words cost ${Math.round(spend).toLocaleString()} ${me.currency ?? ""} over 90 days with nothing back. These are candidates for negative keywords; check each word means the same thing for this business before adding it.`,
      evidence: { words: words.map(([w, v]) => ({ word: w, ...v, acrossAccounts: waste.get(w).stats, accounts: waste.get(w).projects })) },
      moneyAtStake: spend, windowDays: 90,
      table: { columns: ["Word", "Accounts it failed on", "Searches here", "Clicks here", "Spend here"], rows: words.slice(0, 25).map(([w, v]) => [w, waste.get(w).projects, v.searches, v.clicks, Math.round(v.spend)]) },
    });
  }

  const converting = themes.filter((t) => t.kind === "converting_theme" && others(t));
  const covered = new Set(keywords.flatMap((k) => grams(normalise(k.t))));
  const gaps = converting.filter((t) => !covered.has(t.key));
  if (gaps.length) {
    const seenHere = gaps.filter((g) => own.has(g.key));
    out.push({
      kind: "portfolio_converting_words", product: "ads", area: "opportunity", severity: "info",
      title: `${gaps.length} word${gaps.length === 1 ? "" : "s"} that convert well on other accounts ${gaps.length === 1 ? "is" : "are"} not in any keyword here`,
      detail: `Searches containing these words converted clearly better than expected on several accounts Fortress runs${me.industry !== "unknown" ? " — the industry-scoped ones come from businesses in the same trade" : ""}. None is in an active keyword on this account${seenHere.length ? `, though ${seenHere.length} already appear${seenHere.length === 1 ? "s" : ""} in its own searches` : ""}. Only worth a keyword where the word fits what this business sells.`,
      evidence: { words: gaps.map((g) => ({ word: g.key, scope: g.industry, accounts: g.projects, stats: g.stats, alreadySearchedHere: own.has(g.key) })) },
      table: { columns: ["Word", "Scope", "Accounts", "Already searched here"], rows: gaps.slice(0, 25).map((g) => [g.key, g.industry === "all" ? "All accounts" : "Same industry", g.projects, own.has(g.key) ? "yes" : "no"]) },
    });
  }
  return out;
}

function grams(text: string): string[] {
  const ws = normalise(text).split(/\s+/).filter(Boolean);
  return [...ws, ...ws.slice(1).map((w, i) => `${ws[i]} ${w}`)];
}
