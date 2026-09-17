import { q, tx } from "@/lib/db";
import { countOps } from "@/lib/google/quota";

/**
 * Page speed for the pages that matter to each project: the home page, the
 * pages paid clicks land on, and the pages organic search sends people to.
 *
 * PageSpeed Insights returns two different things and they are kept apart:
 *   lab   — one Lighthouse run from Google's servers, now. Repeatable, but a
 *           simulation on a throttled phone.
 *   field — what real Chrome visitors experienced over 28 days, at the 75th
 *           percentile (the Chrome UX Report). This is what Google's page
 *           experience signals use, but it exists only for pages or sites
 *           with enough traffic; small sites often have none, and then the
 *           site-wide (origin) figure is shown and labelled as such.
 *
 * The API is free. A key (PAGESPEED_API_KEY) raises the quota; without one it
 * still works for a handful of pages a day.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

type Target = { url: string; role: string };

function clean(u: string, base: string | null): string | null {
  if (!u || /[{}]|%7B/i.test(u.split("?")[0])) return null;
  try { const x = new URL(u, base ?? undefined); x.search = ""; x.hash = ""; return x.toString(); } catch { return null; }
}

async function targets(clientId: number): Promise<Target[]> {
  const [site] = await q<{ d: string | null }>(`
    SELECT COALESCE(c.website,
      (SELECT i.domain FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = c.id AND cp.provider = 'ads'),
      (SELECT i.domain FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = c.id AND cp.provider = 'gsc')) AS d
      FROM clients c WHERE c.id = $1`, [clientId]);
  const home = site?.d ? clean(/^https?:\/\//.test(site.d) ? site.d : `https://${site.d.replace(/^sc-domain:/, "")}`, null) : null;
  const [paid, organic] = await Promise.all([
    q<{ url: string }>(`SELECT url FROM landing_pages WHERE client_id = $1 ORDER BY clicks DESC LIMIT 6`, [clientId]),
    q<{ page: string }>(`SELECT page FROM gsc_pages WHERE client_id = $1 ORDER BY clicks DESC LIMIT 4`, [clientId]),
  ]);
  const out = new Map<string, string>();
  if (home) out.set(home, "Home page");
  for (const p of paid) { const u = clean(p.url, home); if (u && !out.has(u) && [...out.values()].filter((r) => r === "Paid landing page").length < 3) out.set(u, "Paid landing page"); }
  for (const p of organic) { const u = clean(p.page, home); if (u && !out.has(u) && [...out.values()].filter((r) => r === "Organic landing page").length < 2) out.set(u, "Organic landing page"); }
  return [...out.entries()].map(([url, role]) => ({ url, role }));
}

const FIELD_KEYS = {
  LARGEST_CONTENTFUL_PAINT_MS: "lcpMs",
  CUMULATIVE_LAYOUT_SHIFT_SCORE: "cls",
  INTERACTION_TO_NEXT_PAINT: "inpMs",
  FIRST_CONTENTFUL_PAINT_MS: "fcpMs",
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: "ttfbMs",
} as const;

function field(exp: any) {
  if (!exp?.metrics) return null;
  const out: Record<string, unknown> = { overall: exp.overall_category ?? null };
  for (const [k, name] of Object.entries(FIELD_KEYS)) {
    const m = exp.metrics[k];
    if (!m) continue;
    // Google reports CLS multiplied by 100.
    out[name] = k === "CUMULATIVE_LAYOUT_SHIFT_SCORE" ? m.percentile / 100 : m.percentile;
    out[`${name}Category`] = m.category;
  }
  return out;
}

async function run(url: string, strategy: "mobile" | "desktop") {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  const key = process.env.PAGESPEED_API_KEY?.trim();
  if (key) params.set("key", key);
  const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(90_000) });
  await countOps("pagespeed", 1, !res.ok);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `PageSpeed answered ${res.status}`);

  const audits = body.lighthouseResult?.audits ?? {};
  const num = (id: string) => (typeof audits[id]?.numericValue === "number" ? audits[id].numericValue : null);
  const opportunities = Object.values(audits)
    .filter((a: any) => a?.details?.type === "opportunity" && (a.details.overallSavingsMs ?? 0) >= 300)
    .map((a: any) => ({ title: a.title, savingsMs: Math.round(a.details.overallSavingsMs), display: a.displayValue ?? null }))
    .sort((a, b) => b.savingsMs - a.savingsMs).slice(0, 6);
  const pageField = field(body.loadingExperience);
  const originField = field(body.originLoadingExperience);
  // PageSpeed falls back to origin data inside loadingExperience; its id says which it is.
  const pageLevel = pageField && body.loadingExperience?.origin_fallback !== true;

  return {
    score: body.lighthouseResult?.categories?.performance?.score != null ? Math.round(body.lighthouseResult.categories.performance.score * 100) : null,
    lab: { lcpMs: num("largest-contentful-paint"), cls: num("cumulative-layout-shift"), tbtMs: num("total-blocking-time"), fcpMs: num("first-contentful-paint"), speedIndexMs: num("speed-index") },
    field: pageLevel ? pageField : originField,
    fieldScope: pageLevel ? "page" : originField ? "site" : null,
    opportunities,
  };
}

export async function checkSpeed(clientId: number): Promise<number> {
  const list = await targets(clientId);
  if (!list.length) return 0;
  const jobs = [
    ...list.map((t) => ({ ...t, strategy: "mobile" as const })),
    ...list.filter((t) => t.role === "Home page").map((t) => ({ ...t, strategy: "desktop" as const })),
  ];
  // A few at a time: each run takes 10–30 seconds on Google's side.
  const results: any[] = [];
  for (let i = 0; i < jobs.length; i += 3) {
    results.push(...await Promise.all(jobs.slice(i, i + 3).map(async (j) => {
      try { return { ...j, ...(await run(j.url, j.strategy)), error: null }; }
      catch (err) { return { ...j, score: null, lab: {}, field: null, fieldScope: null, opportunities: [], error: (err as Error).message }; }
    })));
  }
  await tx(async (runSql) => {
    await runSql(`DELETE FROM page_speed WHERE client_id = $1`, [clientId]);
    for (const r of results) {
      await runSql(`INSERT INTO page_speed (client_id, url, strategy, role, score, lab, field, field_scope, opportunities, error)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [clientId, r.url, r.strategy, r.role, r.score, JSON.stringify(r.lab), r.field ? JSON.stringify(r.field) : null, r.fieldScope, JSON.stringify(r.opportunities), r.error]);
    }
  });
  return results.filter((r) => !r.error).length;
}
