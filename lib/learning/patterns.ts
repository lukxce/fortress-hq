import { q, tx } from "@/lib/db";
import { fromMicros } from "@/lib/engine/metrics";
import { normalise, deriveBrandTerms } from "@/lib/engine/brand";

/**
 * Patterns across every project, computed by code and never by a model.
 *
 *   change_effect       what each kind of change was followed by, by volume
 *   waste_theme         words in searches that fail to convert on several accounts
 *   converting_theme    words in searches that convert unusually well on several accounts
 *   benchmark           the portfolio's own spread for a rate (CTR, conversion rate, …)
 *   finding_prevalence  how many projects have each measured problem
 *
 * Search themes are only ever words seen on at least MIN_PROJECTS accounts, with
 * every project's brand words removed, so nothing specific to one client can
 * reach another client's analysis.
 */

export const MIN_PROJECTS = 3;
const STOP = new Set(["the", "and", "for", "with", "near", "from", "that", "this", "your", "you", "kod", "ili", "koji", "koja", "koje", "sta", "kako", "gde", "za", "na", "od", "do", "sa", "iz", "po", "cena", "cene"]);

type Row = { kind: string; industry: string; key: string; stats: unknown; projects: number; significant: boolean };

// Poisson tails, for "fewer conversions than the accounts' own rates predict".
function poissonCdf(k: number, lambda: number) {
  let term = Math.exp(-lambda), sum = term;
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term; }
  return Math.min(1, sum);
}
const poissonSf = (k: number, lambda: number) => (k <= 0 ? 1 : 1 - poissonCdf(k - 1, lambda));

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};

export async function computePatterns(): Promise<{ patterns: number; projects: number }> {
  const projects = await q<any>(`
    SELECT c.id, c.name, c.website, COALESCE(c.industry, 'unknown') AS industry, c.brand_terms,
           (SELECT i.domain FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id
             WHERE cp.client_id = c.id AND cp.provider = 'ads') AS domain
      FROM clients c WHERE NOT c.archived`);
  const industryOf = new Map<number, string>(projects.map((p) => [p.id, p.industry]));
  const scopes = (ids: number[]) => ["all", ...new Set(ids.map((id) => industryOf.get(id)!).filter((x) => x !== "unknown"))];
  const rows: Row[] = [];

  // ---------------------------------------------------------- change effects --
  const outcomes = await q<any>(`SELECT client_id, kind, volume_band, verdict, result FROM change_outcomes WHERE status = 'judged'`);
  for (const scope of scopes(outcomes.map((o) => o.client_id))) {
    const inScope = outcomes.filter((o) => scope === "all" || industryOf.get(o.client_id) === scope);
    const groups = new Map<string, any[]>();
    for (const o of inScope) {
      for (const key of [`${o.kind}|any volume`, `${o.kind}|${o.volume_band}`]) groups.set(key, [...(groups.get(key) ?? []), o]);
    }
    for (const [key, os] of groups) {
      const count = (v: string) => os.filter((o) => o.verdict === v).length;
      const judged = os.filter((o) => ["better", "worse", "no_clear_change", "moved_with_account"].includes(o.verdict));
      const changes = judged.map((o) => o.result?.cpaChange).filter((x: unknown): x is number => typeof x === "number");
      const pids = new Set(judged.map((o) => o.client_id));
      rows.push({
        kind: "change_effect", industry: scope, key,
        stats: {
          better: count("better"), worse: count("worse"), noClearChange: count("no_clear_change"),
          movedWithAccount: count("moved_with_account"), tooLittleData: count("too_little_data"), confounded: count("confounded"),
          medianCpaChange: median(changes),
        },
        projects: pids.size,
        // Consistent enough to lean on: several accounts, and one direction dominates.
        significant: pids.size >= MIN_PROJECTS && Math.max(count("better"), count("worse")) >= 3 &&
          Math.max(count("better"), count("worse")) >= 2 * Math.min(count("better"), count("worse")) + 1,
      });
    }
  }

  // ----------------------------------------------------------- search themes --
  const terms = await q<any>(`
    SELECT client_id, term, SUM(clicks)::float AS clicks, SUM(conversions)::float AS conv, SUM(cost_micros) AS cost
      FROM search_terms GROUP BY client_id, term HAVING SUM(clicks) > 0`);
  const blocked = new Set<string>();
  for (const p of projects) {
    for (const b of [...(p.brand_terms ?? []), ...deriveBrandTerms([p.name], p.domain ?? p.website)]) {
      for (const t of normalise(b).split(/\s+/)) if (t) blocked.add(t);
    }
  }
  const rate = new Map<number, number>();
  for (const p of projects) {
    const mine = terms.filter((t) => t.client_id === p.id);
    const clicks = mine.reduce((n, t) => n + t.clicks, 0), conv = mine.reduce((n, t) => n + t.conv, 0);
    if (clicks >= 50 && conv > 0) rate.set(p.id, conv / clicks);
  }
  const tokens = new Map<string, Map<number, { clicks: number; conv: number; cost: number; terms: number }>>();
  for (const t of terms) {
    if (!rate.has(t.client_id)) continue;
    const words = normalise(t.term).split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w) && !blocked.has(w));
    const grams = new Set([...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)]);
    for (const g of grams) {
      const byProject = tokens.get(g) ?? new Map();
      const cur = byProject.get(t.client_id) ?? { clicks: 0, conv: 0, cost: 0, terms: 0 };
      cur.clicks += t.clicks; cur.conv += t.conv; cur.cost += fromMicros(t.cost); cur.terms++;
      byProject.set(t.client_id, cur);
      tokens.set(g, byProject);
    }
  }
  for (const scope of scopes([...rate.keys()])) {
    const candidates = [...tokens.entries()]
      .map(([token, byProject]) => {
        const ps = [...byProject.entries()].filter(([id]) => scope === "all" || industryOf.get(id) === scope);
        const clicks = ps.reduce((n, [, v]) => n + v.clicks, 0), conv = ps.reduce((n, [, v]) => n + v.conv, 0);
        const expected = ps.reduce((n, [id, v]) => n + v.clicks * rate.get(id)!, 0);
        return { token, projects: ps.length, clicks, conv, expected, searches: ps.reduce((n, [, v]) => n + v.terms, 0) };
      })
      .filter((c) => c.projects >= MIN_PROJECTS && c.expected >= 3);
    const K = Math.max(1, candidates.length);
    for (const c of candidates) {
      const pLow = poissonCdf(Math.round(c.conv), c.expected);
      const pHigh = poissonSf(Math.round(c.conv), c.expected);
      const stats = { clicks: c.clicks, conversions: c.conv, expectedAtAccountsOwnRates: Math.round(c.expected * 10) / 10, searches: c.searches };
      if (pLow < 0.05 / K && c.conv <= c.expected * 0.4) rows.push({ kind: "waste_theme", industry: scope, key: c.token, stats: { ...stats, p: pLow }, projects: c.projects, significant: true });
      else if (pHigh < 0.05 / K && c.conv >= c.expected * 1.8) rows.push({ kind: "converting_theme", industry: scope, key: c.token, stats: { ...stats, p: pHigh }, projects: c.projects, significant: true });
    }
  }

  // -------------------------------------------------------------- benchmarks --
  const metric = async (name: string, sql: string) => {
    const vals = await q<{ client_id: number; v: number; n: number }>(sql);
    for (const scope of scopes(vals.map((v) => v.client_id))) {
      const xs = vals.filter((v) => scope === "all" || industryOf.get(v.client_id) === scope).map((v) => Number(v.v));
      if (!xs.length) continue;
      rows.push({ kind: "benchmark", industry: scope, key: name, stats: { median: median(xs), p25: quantile(xs, 0.25), p75: quantile(xs, 0.75) }, projects: xs.length, significant: xs.length >= MIN_PROJECTS });
    }
  };
  const last90 = "date > CURRENT_DATE - 91";
  await metric("ads: search click-through rate", `
    SELECT m.client_id, SUM(m.clicks)::float / NULLIF(SUM(m.impressions),0) AS v FROM metrics_daily m
      JOIN campaigns c ON c.client_id = m.client_id AND c.campaign_id = m.entity_id AND c.channel_type = 'SEARCH'
     WHERE m.entity_type = 'campaign' AND m.${last90} GROUP BY m.client_id HAVING SUM(m.impressions) >= 1000`);
  await metric("ads: search conversion rate per click", `
    SELECT m.client_id, SUM(m.conversions)::float / NULLIF(SUM(m.clicks),0) AS v FROM metrics_daily m
      JOIN campaigns c ON c.client_id = m.client_id AND c.campaign_id = m.entity_id AND c.channel_type = 'SEARCH'
     WHERE m.entity_type = 'campaign' AND m.${last90} GROUP BY m.client_id HAVING SUM(m.clicks) >= 200`);
  await metric("ads: performance max conversion rate per click", `
    SELECT m.client_id, SUM(m.conversions)::float / NULLIF(SUM(m.clicks),0) AS v FROM metrics_daily m
      JOIN campaigns c ON c.client_id = m.client_id AND c.campaign_id = m.entity_id AND c.channel_type = 'PERFORMANCE_MAX'
     WHERE m.entity_type = 'campaign' AND m.${last90} GROUP BY m.client_id HAVING SUM(m.clicks) >= 200`);
  await metric("ads: share of conversions from mobile", `
    SELECT client_id, SUM(conversions) FILTER (WHERE segment_key = 'MOBILE')::float / NULLIF(SUM(conversions),0) AS v
      FROM segment_metrics WHERE segment_type = 'device' AND campaign_id = '' GROUP BY client_id HAVING SUM(conversions) >= 10`);
  await metric("ads: share of spend on search terms that never converted", `
    SELECT client_id, SUM(cost_micros) FILTER (WHERE conversions = 0)::float / NULLIF(SUM(cost_micros),0) AS v
      FROM search_terms GROUP BY client_id HAVING SUM(cost_micros) > 0`);
  await metric("ads: search impression share lost to budget", `
    SELECT client_id, AVG(search_lost_is_budget)::float AS v FROM campaigns
     WHERE status = 'ENABLED' AND search_lost_is_budget IS NOT NULL GROUP BY client_id`);
  await metric("analytics: key events per session", `
    SELECT client_id, SUM(key_events)::float / NULLIF(SUM(sessions),0) AS v FROM ga4_daily WHERE ${last90} GROUP BY client_id HAVING SUM(sessions) >= 500`);
  await metric("analytics: key events per session, paid search", `
    SELECT client_id, SUM(key_events)::float / NULLIF(SUM(sessions),0) AS v FROM ga4_daily WHERE ${last90} AND channel = 'Paid Search' GROUP BY client_id HAVING SUM(sessions) >= 200`);
  await metric("analytics: key events per session, organic search", `
    SELECT client_id, SUM(key_events)::float / NULLIF(SUM(sessions),0) AS v FROM ga4_daily WHERE ${last90} AND channel = 'Organic Search' GROUP BY client_id HAVING SUM(sessions) >= 200`);
  await metric("analytics: engaged session rate", `
    SELECT client_id, SUM(engaged_sessions)::float / NULLIF(SUM(sessions),0) AS v FROM ga4_daily WHERE ${last90} GROUP BY client_id HAVING SUM(sessions) >= 500`);
  for (const [label, lo, hi] of [["1-2", 0, 2], ["2-3", 2, 3], ["3-5", 3, 5], ["5-10", 5, 10]] as const) {
    await metric(`search console: click-through at position ${label}`, `
      SELECT client_id, SUM(clicks)::float / NULLIF(SUM(impressions),0) AS v FROM gsc_query_pages
       WHERE position > ${lo} AND position <= ${hi} GROUP BY client_id HAVING SUM(impressions) >= 500`);
  }

  // ------------------------------------------------------- finding prevalence --
  const [{ total }] = await q<{ total: number }>(`SELECT count(*)::int AS total FROM clients WHERE NOT archived`);
  const prevalence = await q<any>(`
    SELECT CASE WHEN f.kind LIKE 'ga4_key_event_stopped_%' THEN 'ga4_key_event_stopped'
                WHEN f.kind LIKE 'gtm_duplicate_google_tag_%' THEN 'gtm_duplicate_google_tag' ELSE f.kind END AS kind, count(DISTINCT f.client_id)::int AS n
      FROM findings f JOIN clients c ON c.id = f.client_id AND NOT c.archived
     WHERE f.status = 'open' AND f.last_seen > now() - interval '14 days' GROUP BY 1`);
  for (const p of prevalence) {
    rows.push({ kind: "finding_prevalence", industry: "all", key: p.kind, stats: { projectsWithIt: p.n, projectsTotal: total }, projects: p.n, significant: p.n >= MIN_PROJECTS });
  }

  await tx(async (run) => {
    await run(`DELETE FROM portfolio_patterns`);
    for (const r of rows) {
      await run(`INSERT INTO portfolio_patterns (kind, industry, key, stats, projects, significant) VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (kind, industry, key) DO NOTHING`, [r.kind, r.industry, r.key, JSON.stringify(r.stats), r.projects, r.significant]);
    }
  });
  return { patterns: rows.length, projects: projects.length };
}
