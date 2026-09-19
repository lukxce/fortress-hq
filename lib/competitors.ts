import Anthropic from "@anthropic-ai/sdk";
import { q, q1 } from "@/lib/db";
import { adsPost, digits } from "@/lib/google/ads";
import { countOps } from "@/lib/google/quota";
import { clientFor, connectionForClient } from "@/lib/google/auth";
import { clientWithProperties } from "@/lib/binding";
import { readSite } from "@/lib/builder/site";
import { normalise, brandTerms } from "@/lib/engine/brand";

/**
 * Competitors, from sources that are allowed to be read:
 *
 *   their own website    what they sell, prices, offers, claims, areas
 *   Keyword Planner      what their site is relevant for, where the project
 *                        advertises, and how many people search their name
 *   SERP data provider   the paid ads actually shown on the project's
 *                        searches (DataForSEO, only when its key is set)
 *   the operator         ads they saw in the Ads Transparency Center, pasted in
 *
 * Google Search, Maps and the Transparency Center are never fetched directly:
 * Google's terms forbid it, and there is no API for another advertiser's ads.
 */

export const cleanDomain = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

/** Candidates from the account itself: competitor campaigns and other brands in searches. */
export async function suggestCompetitors(clientId: number): Promise<{ name: string; why: string }[]> {
  const [camp, known] = await Promise.all([
    q<{ text: string; clicks: number }>(`
      SELECT k.text, SUM(k.clicks)::float AS clicks FROM keywords k JOIN campaigns c ON c.client_id = k.client_id AND c.campaign_id = k.campaign_id
       WHERE k.client_id = $1 AND c.name ~* '(competit|konkurenc|comp[-_ ])' AND k.status = 'ENABLED'
       GROUP BY k.text ORDER BY 2 DESC LIMIT 60`, [clientId]),
    q<{ name: string }>(`SELECT lower(name) AS name FROM competitors WHERE client_id = $1`, [clientId]),
  ]);
  const seen = new Set(known.map((k) => k.name));
  const own = await brandTerms(clientId);
  const STOP = new Set(["the", "best", "top", "free", "and", "for", "how", "what", "alternative", "alternatives", "vs", "cheap", "online", "app", "software", "tool", "tools", "platform"]);
  // The first word of a competitor keyword is usually the brand ("upfluence alternatives").
  const byBrand = new Map<string, number>();
  for (const k of camp) {
    const brand = normalise(k.text).split(" ")[0];
    // Not a common word, and not a piece of the project's own name ("hype" in "hypefy").
    if (brand.length < 3 || STOP.has(brand) || own.some((b) => normalise(b).startsWith(brand) || brand.startsWith(normalise(b)))) continue;
    byBrand.set(brand, (byBrand.get(brand) ?? 0) + k.clicks);
  }
  return [...byBrand.entries()].filter(([b]) => !seen.has(b)).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([name]) => ({ name, why: "You already bid on it in a competitor campaign" }));
}

type CompetitorSite = {
  business: string; offers: { name: string; price: string }[]; claims: string[]; areas: string[]; calls_to_action: string[]; weaknesses_or_gaps: string[];
};

async function readCompetitorSite(domain: string): Promise<CompetitorSite | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  const pages = await readSite(`https://${domain}`);
  if (!pages.length) return null;
  const anthropic = new Anthropic({ apiKey: key });
  const schema = {
    type: "object",
    properties: {
      business: { type: "string" },
      offers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, price: { type: "string" } }, required: ["name", "price"], additionalProperties: false } },
      claims: { type: "array", items: { type: "string" } },
      areas: { type: "array", items: { type: "string" } },
      calls_to_action: { type: "array", items: { type: "string" } },
      weaknesses_or_gaps: { type: "array", items: { type: "string" } },
    },
    required: ["business", "offers", "claims", "areas", "calls_to_action", "weaknesses_or_gaps"], additionalProperties: false,
  };
  const res = await anthropic.messages.create({
    model: "claude-sonnet-5", max_tokens: 2000, thinking: { type: "disabled" },
    system: "You read a competitor's website for an advertiser. Say only what the pages say. offers: each service or product with its price as written, or an empty string. claims: what they promise or boast (guarantees, speed, experience, awards, discounts). areas: places they serve. calls_to_action: what they ask visitors to do. weaknesses_or_gaps: things a customer would want that the site does not show (no prices, no reviews, no guarantee, slow response, no phone) — only what is visibly missing, never a guess about quality.",
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: JSON.stringify(pages) }],
  } as any);
  const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  try { return JSON.parse(text); } catch { return null; }
}

/** Read one competitor: site, keywords its site is relevant for, searches for its name. */
export async function analyseCompetitor(clientId: number, competitorId: number) {
  const comp = await q1<any>(`SELECT * FROM competitors WHERE id = $1 AND client_id = $2`, [competitorId, clientId]);
  if (!comp) throw new Error("No such competitor.");
  const client = await clientWithProperties(clientId, null);
  const conn = await connectionForClient(clientId);
  const errors: string[] = [];

  const site = comp.domain ? await readCompetitorSite(comp.domain).catch((e) => { errors.push(`Website: ${(e as Error).message}`); return null; }) : null;

  let keywords: { text: string; monthly: number | null; ours: boolean }[] | null = null;
  let brandVolume: number | null = null;
  if (client?.ads_customer_id && conn) {
    const auth = await clientFor(conn.id);
    const cid = digits(client.ads_customer_id);
    const target = (await q1<any>(`SELECT keyword_targeting FROM clients WHERE id = $1`, [clientId]))?.keyword_targeting ?? {};
    const base = { language: target.language ?? (client.currency === "RSD" ? "languageConstants/1035" : "languageConstants/1000"), geoTargetConstants: target.geo ?? [], keywordPlanNetwork: "GOOGLE_SEARCH" };
    const ours = new Set((await q<{ t: string }>(`SELECT DISTINCT lower(text) AS t FROM keywords WHERE client_id = $1 AND status = 'ENABLED'`, [clientId])).map((r) => normalise(r.t)));
    if (comp.domain) {
      try {
        const res = await adsPost(auth, `customers/${cid}:generateKeywordIdeas`, { ...base, urlSeed: { url: `https://${comp.domain}` }, pageSize: 200 });
        await countOps("ads", 1);
        keywords = (res?.results ?? []).map((r: any) => ({ text: String(r.text).toLowerCase(), monthly: r.keywordIdeaMetrics?.avgMonthlySearches != null ? Number(r.keywordIdeaMetrics.avgMonthlySearches) : null, ours: ours.has(normalise(String(r.text))) }))
          .filter((k: any) => (k.monthly ?? 0) > 0).sort((a: any, b: any) => (b.monthly ?? 0) - (a.monthly ?? 0)).slice(0, 100);
      } catch (e) { errors.push(`Keyword Planner: ${(e as Error).message.slice(0, 160)}`); }
    }
    try {
      const res = await adsPost(auth, `customers/${cid}:generateKeywordHistoricalMetrics`, { ...base, keywords: [comp.name.toLowerCase()] });
      await countOps("ads", 1);
      const m = res?.results?.[0]?.keywordMetrics;
      brandVolume = m?.avgMonthlySearches != null ? Number(m.avgMonthlySearches) : 0;
    } catch (e) { errors.push(`Brand searches: ${(e as Error).message.slice(0, 160)}`); }
  }

  await q(`UPDATE competitors SET site = COALESCE($3, site), keywords = COALESCE($4, keywords), brand_volume = COALESCE($5, brand_volume),
             analysed_at = now(), error = $6 WHERE id = $1 AND client_id = $2`,
    [competitorId, clientId, site ? JSON.stringify(site) : null, keywords ? JSON.stringify(keywords) : null, brandVolume, errors.length ? errors.join(" · ") : null]);
  return { site, keywords, brandVolume, errors };
}

export const serpConfigured = () => Boolean(process.env.DATAFORSEO_LOGIN?.trim() && process.env.DATAFORSEO_PASSWORD?.trim());

/**
 * The paid ads shown on the project's own top searches, in its own places,
 * from DataForSEO's live SERP endpoint (its location codes are Google's geo
 * target IDs). Paid per request, so a handful of keywords, on demand.
 */
export async function fetchSerpAds(clientId: number, maxKeywords = 8) {
  if (!serpConfigured()) throw new Error("Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to see competitors' live ads.");
  const [target, kws] = await Promise.all([
    q1<any>(`SELECT keyword_targeting, currency FROM clients WHERE id = $1`, [clientId]),
    q<{ text: string }>(`SELECT k.text FROM keywords k WHERE k.client_id = $1 AND k.status = 'ENABLED' GROUP BY k.text ORDER BY SUM(k.clicks) DESC LIMIT $2`, [clientId, maxKeywords]),
  ]);
  const geo = (target?.keyword_targeting?.geo ?? [])[0] as string | undefined;
  const locationCode = geo ? Number(digits(geo)) : target?.currency === "RSD" ? 2688 : 2840;
  const languageCode = target?.currency === "RSD" ? "sr" : "en";
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN!.trim()}:${process.env.DATAFORSEO_PASSWORD!.trim()}`).toString("base64");
  const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
    method: "POST", headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify(kws.map((k) => ({ keyword: k.text, location_code: locationCode, language_code: languageCode, device: "mobile" }))),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status_code >= 40000) throw new Error(body.status_message ?? `DataForSEO answered ${res.status}`);
  const rows: any[] = [];
  for (const task of body.tasks ?? []) {
    const keyword = task.data?.keyword ?? "";
    for (const item of task.result?.[0]?.items ?? []) {
      if (item.type !== "paid") continue;
      rows.push({ keyword, position: item.rank_absolute ?? null, domain: cleanDomain(item.domain ?? item.url ?? ""), title: item.title ?? "", description: item.description ?? "", url: item.url ?? "" });
    }
  }
  await q(`DELETE FROM serp_ads WHERE client_id = $1`, [clientId]);
  for (const r of rows) {
    await q(`INSERT INTO serp_ads (client_id, keyword, location, position, domain, title, description, url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [clientId, r.keyword, String(locationCode), r.position, r.domain, r.title, r.description, r.url]);
  }
  // Any advertiser seen here who is not yet a competitor becomes a suggestion.
  for (const d of [...new Set(rows.map((r) => r.domain).filter(Boolean))]) {
    await q(`INSERT INTO competitors (client_id, name, domain, source, status, why) VALUES ($1,$2,$2,'suggested','suggested','Advertises on your searches')
             ON CONFLICT (client_id, domain) DO NOTHING`, [clientId, d]);
  }
  return { ads: rows.length, keywords: kws.length };
}

/** What the ad writer and the analysis should know about the competition, compactly. */
export async function competitorBrief(clientId: number) {
  const [comps, serp] = await Promise.all([
    q<any>(`SELECT name, domain, site, brand_volume, observed_ads, keywords FROM competitors WHERE client_id = $1 AND status = 'confirmed'`, [clientId]),
    q<any>(`SELECT domain, title, description FROM serp_ads WHERE client_id = $1 ORDER BY position LIMIT 40`, [clientId]),
  ]);
  if (!comps.length && !serp.length) return null;
  return {
    note: "Competitors' own claims and ads. Write copy that differs from theirs and stands on what this business actually offers; never use a competitor's name or trademark in ad text.",
    competitors: comps.map((c) => ({
      name: c.name, domain: c.domain, brandSearchesPerMonth: c.brand_volume,
      sells: c.site?.offers ?? [], claims: c.site?.claims ?? [], gaps: c.site?.weaknesses_or_gaps ?? [],
      adsSeen: (c.observed_ads ?? []).slice(0, 5),
      topKeywordsNotOurs: (c.keywords ?? []).filter((k: any) => !k.ours).slice(0, 15).map((k: any) => `${k.text} (${k.monthly}/mo)`),
    })),
    liveAdsOnOurSearches: serp.map((s) => ({ domain: s.domain, headline: s.title, text: s.description })),
  };
}
