import type { OAuth2Client } from "google-auth-library";
import { q, q1, tx } from "@/lib/db";
import { searchStream, adsPost, digits } from "@/lib/google/ads";
import { countOps } from "@/lib/google/quota";
import { normalise } from "@/lib/engine/brand";
import type { ClientWithProps } from "@/lib/binding";

/**
 * Keyword Planner, through the Google Ads API.
 *
 * Two uses. Volumes for what the project already has — its keywords, the
 * searches that converted, the queries it ranks for organically — so every
 * list can say how much demand sits behind each line. And ideas, seeded from
 * the converting searches and the website, for demand it does not cover yet.
 *
 * Volumes are measured where the account's campaigns target and in their
 * language; with no targeting set, everywhere and in the site's language
 * guess. Google rounds volumes into buckets and averages them over 12 months:
 * they are for comparing and ordering, not forecasting.
 *
 * Refreshed weekly: search volume does not change faster than that.
 */

const REFRESH_DAYS = 6;

async function targeting(auth: OAuth2Client, c: ClientWithProps) {
  const rows = await searchStream(auth, digits(c.ads_customer_id!), `
    SELECT campaign_criterion.type, campaign_criterion.location.geo_target_constant,
           campaign_criterion.language.language_constant, campaign_criterion.negative
      FROM campaign_criterion
     WHERE campaign.status = 'ENABLED' AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE')`);
  await countOps("ads", 1);
  const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([x]) => x);
  const geo = count(rows.filter((r) => !r.campaignCriterion?.negative).map((r) => r.campaignCriterion?.location?.geoTargetConstant).filter(Boolean)).slice(0, 10);
  const languages = count(rows.map((r) => r.campaignCriterion?.language?.languageConstant).filter(Boolean));
  // No language set in any campaign: Serbian-currency accounts are Serbian, otherwise English.
  const language = languages[0] ?? (c.currency === "RSD" ? "languageConstants/1035" : "languageConstants/1000");
  return { geo, language, languageGuessed: !languages.length };
}

const metrics = (m: any) => ({
  avg: m?.avgMonthlySearches != null ? Number(m.avgMonthlySearches) : null,
  competition: m?.competition ?? null,
  index: m?.competitionIndex != null ? Number(m.competitionIndex) : null,
  low: m?.lowTopOfPageBidMicros != null ? Number(m.lowTopOfPageBidMicros) : null,
  high: m?.highTopOfPageBidMicros != null ? Number(m.highTopOfPageBidMicros) : null,
  monthly: m?.monthlySearchVolumes ?? null,
});

export async function syncKeywordPlanner(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const fresh = await q1(`SELECT 1 FROM keyword_volumes WHERE client_id = $1 AND fetched_at > now() - make_interval(days => $2) LIMIT 1`, [c.id, REFRESH_DAYS]);
  if (fresh) return 0;

  const cid = digits(c.ads_customer_id!);
  const target = await targeting(auth, c);
  const base = { language: target.language, geoTargetConstants: target.geo, keywordPlanNetwork: "GOOGLE_SEARCH", includeAdultKeywords: false };

  const [keywords, converting, organic, site] = await Promise.all([
    q<{ t: string }>(`SELECT DISTINCT lower(text) AS t FROM keywords WHERE client_id = $1 AND status = 'ENABLED' AND text <> ''`, [c.id]),
    q<{ t: string; conv: number }>(`SELECT lower(term) AS t, SUM(conversions)::float AS conv FROM search_terms WHERE client_id = $1 GROUP BY 1 HAVING SUM(conversions) > 0 ORDER BY 2 DESC LIMIT 200`, [c.id]),
    q<{ t: string }>(`SELECT lower(query) AS t FROM gsc_query_pages WHERE client_id = $1 AND query <> '' GROUP BY 1 ORDER BY SUM(impressions) DESC LIMIT 300`, [c.id]),
    q1<{ d: string | null }>(`SELECT COALESCE(c.website, (SELECT i.domain FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = c.id AND cp.provider = 'ads')) AS d FROM clients c WHERE c.id = $1`, [c.id]),
  ]);

  // Keyword Planner rejects over-long or symbol-heavy text; those are skipped, not fatal.
  const ok = (t: string) => t.length <= 80 && t.split(/\s+/).length <= 10 && !/[!@%,*=]/.test(t);
  const sources = new Map<string, Set<string>>();
  const add = (list: { t: string }[], src: string) => { for (const { t } of list) { const k = t.replace(/^[+"[]|["\]]$/g, "").trim(); if (k && ok(k)) sources.set(k, (sources.get(k) ?? new Set()).add(src)); } };
  add(keywords, "keyword"); add(converting, "converting search"); add(organic, "organic query");

  const volumes: { text: string; m: ReturnType<typeof metrics> }[] = [];
  const all = [...sources.keys()];
  for (let i = 0; i < all.length; i += 1000) {
    const res = await adsPost(auth, `customers/${cid}:generateKeywordHistoricalMetrics`, { ...base, keywords: all.slice(i, i + 1000) });
    await countOps("ads", 1);
    for (const r of res?.results ?? []) {
      const m = metrics(r.keywordMetrics);
      volumes.push({ text: String(r.text).toLowerCase(), m });
      for (const v of r.closeVariants ?? []) if (sources.has(String(v).toLowerCase())) volumes.push({ text: String(v).toLowerCase(), m });
    }
  }

  // Ideas from what already converts and from the website itself.
  const seeds = [...converting.map((x) => x.t), ...keywords.map((x) => x.t)].filter(ok).slice(0, 10);
  const url = site?.d ? (/^https?:\/\//.test(site.d) ? site.d : `https://${site.d.replace(/^sc-domain:/, "")}`) : null;
  const ideas: { text: string; m: ReturnType<typeof metrics> }[] = [];
  if (seeds.length || url) {
    const seed = seeds.length && url ? { keywordAndUrlSeed: { url, keywords: seeds } } : seeds.length ? { keywordSeed: { keywords: seeds } } : { urlSeed: { url } };
    const res = await adsPost(auth, `customers/${cid}:generateKeywordIdeas`, { ...base, ...seed, pageSize: 1000 });
    await countOps("ads", 1);
    for (const r of res?.results ?? []) ideas.push({ text: String(r.text).toLowerCase(), m: metrics(r.keywordIdeaMetrics) });
  }
  const have = new Set(all.map(normalise));
  const newIdeas = ideas.filter((i) => !have.has(normalise(i.text)) && (i.m.avg ?? 0) > 0)
    .sort((a, b) => (b.m.avg ?? 0) - (a.m.avg ?? 0)).slice(0, 400);

  await tx(async (run) => {
    await run(`DELETE FROM keyword_volumes WHERE client_id = $1`, [c.id]);
    const seen = new Set<string>();
    for (const v of volumes) {
      if (seen.has(v.text)) continue;
      seen.add(v.text);
      await run(`INSERT INTO keyword_volumes (client_id, keyword, sources, avg_monthly, competition, competition_index, low_bid_micros, high_bid_micros, monthly)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [c.id, v.text, [...(sources.get(v.text) ?? [])], v.m.avg, v.m.competition, v.m.index, v.m.low, v.m.high, v.m.monthly ? JSON.stringify(v.m.monthly) : null]);
    }
    // Keywords Google returned nothing for have no measurable volume: record that too.
    for (const k of all) {
      if (seen.has(k)) continue;
      await run(`INSERT INTO keyword_volumes (client_id, keyword, sources, avg_monthly) VALUES ($1,$2,$3,0) ON CONFLICT DO NOTHING`, [c.id, k, [...sources.get(k)!]]);
    }
    await run(`DELETE FROM keyword_ideas WHERE client_id = $1`, [c.id]);
    for (const i of newIdeas) {
      await run(`INSERT INTO keyword_ideas (client_id, keyword, avg_monthly, competition, competition_index, low_bid_micros, high_bid_micros)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [c.id, i.text, i.m.avg, i.m.competition, i.m.index, i.m.low, i.m.high]);
    }
    await run(`UPDATE clients SET keyword_targeting = $2 WHERE id = $1`, [c.id, JSON.stringify(target)]);
  });
  return volumes.length + newIdeas.length;
}
