import Anthropic from "@anthropic-ai/sdk";
import { q } from "@/lib/db";
import { brandTerms, normalise } from "@/lib/engine/brand";
import { adsPost, digits } from "@/lib/google/ads";
import { clientFor, connectionForClient } from "@/lib/google/auth";
import { clientWithProperties } from "@/lib/binding";
import type { DraftGroup } from "./draft";

/**
 * The creative steps of the builder: grouping searches into themes, and
 * suggesting ad text. Both are clearly labelled suggestions the operator edits.
 *
 * Keyword seeds come from demand this business demonstrably has before any
 * model guesses: queries Search Console shows the site already appearing for,
 * and searches that already converted in Ads. Every keyword carries its source.
 */

async function seeds(clientId: number) {
  const [gsc, converting, pages] = await Promise.all([
    q<any>(`SELECT query, SUM(impressions) AS imp, SUM(position * impressions) / NULLIF(SUM(impressions),0) AS pos
              FROM gsc_daily WHERE client_id = $1 AND query <> '' AND date > CURRENT_DATE - 91
             GROUP BY query ORDER BY SUM(impressions) DESC LIMIT 120`, [clientId]),
    q<any>(`SELECT term, SUM(conversions) AS conv FROM search_terms WHERE client_id = $1 AND conversions > 0
             GROUP BY term ORDER BY SUM(conversions) DESC LIMIT 60`, [clientId]),
    q<any>(`SELECT page, SUM(key_events) AS key_events FROM ga4_pages WHERE client_id = $1
             GROUP BY page ORDER BY SUM(key_events) DESC LIMIT 15`, [clientId]),
  ]);
  return {
    searchConsole: gsc.map((g) => ({ query: g.query, impressions: Number(g.imp), position: Math.round(Number(g.pos) * 10) / 10 })),
    converting: converting.map((c) => ({ term: c.term, conversions: Number(c.conv) })),
    convertingPages: pages.map((p) => ({ page: p.page, keyEvents: Number(p.key_events) })),
  };
}

export async function suggestGroups(clientId: number, summary: unknown, places: string[], extra: { ideas?: { text: string; monthly: number | null }[]; goal?: string } = {}): Promise<DraftGroup[]> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const s = await seeds(clientId);
  const brands = await brandTerms(clientId);

  const schema = {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            finalUrl: { type: "string" },
            keywords: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  match: { type: "string", enum: ["EXACT", "PHRASE", "BROAD"] },
                  source: { type: "string", enum: ["search_console", "converting", "site", "planner", "suggested"] },
                },
                required: ["text", "match", "source"], additionalProperties: false,
              },
            },
          },
          required: ["name", "finalUrl", "keywords"], additionalProperties: false,
        },
      },
    },
    required: ["groups"], additionalProperties: false,
  };

  const anthropic = new Anthropic({ apiKey: key });
  const res = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    thinking: { type: "disabled" },
    system: `You group search keywords for a new Google Search campaign for a small local business.

Rules:
- One group per distinct service the business offers, named plainly ("AC repair", "AC installation"). Two to six groups. Low-volume accounts cannot feed many.
- Prefer keywords from the evidence, and label their source: "converting" (it already produced conversions in Ads), "search_console" (the site already appears for it), "planner" (Keyword Planner shows people search it where the ads will run; its monthly volume is given), "site" (the service is named on the site). Among planner ideas prefer the ones with volume that match a service on the site. Only add "suggested" keywords where the evidence is thin, and keep them close to what the site says it does.
- 5 to 15 keywords per group. Include the service with and without the place names given, in the language the site uses — for Serbian, include the Latin spelling with diacritics (č, ć, š, ž, đ); close variants cover spelling without them.
- match: EXACT for the core search that already converts, PHRASE for most, BROAD sparingly.
- Never include a keyword containing these brand words: ${JSON.stringify(brands)}. Never include jobs, free, DIY or how-to searches.
- finalUrl: the page on the site that best matches the group, taken from the business summary's offers. Never invent a URL.`,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: JSON.stringify({ business: summary, places, goal: extra.goal ?? null, evidence: { ...s, plannerIdeas: extra.ideas ?? [] } }) }],
  } as any);
  const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const parsed = JSON.parse(text) as { groups: DraftGroup[] };

  // Keep the evidence labels honest: a keyword only keeps "search_console" or
  // "converting" if it is actually in that list.
  const gscSet = new Set(s.searchConsole.map((g) => normalise(g.query)));
  const convSet = new Set(s.converting.map((c) => normalise(c.term)));
  const plannerSet = new Set((extra.ideas ?? []).map((i) => normalise(i.text)));
  return parsed.groups.map((g) => ({
    name: g.name, finalUrl: g.finalUrl, headlines: [], descriptions: [], path1: "", path2: "",
    keywords: g.keywords.slice(0, 20).map((k) => {
      const n = normalise(k.text);
      const source = convSet.has(n) ? "converting" : gscSet.has(n) ? "search_console" : plannerSet.has(n) ? "planner"
        : ["search_console", "converting", "planner"].includes(k.source) ? "suggested" : k.source;
      return { text: k.text.slice(0, 80), match: k.match, source: source as any };
    }),
  }));
}

export async function suggestAdText(summary: unknown, group: { name: string; keywords: string[]; finalUrl: string; keep?: string[] }, competitors: unknown = null) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const schema = {
    type: "object",
    properties: {
      headlines: { type: "array", items: { type: "string" } },
      descriptions: { type: "array", items: { type: "string" } },
      path1: { type: "string" }, path2: { type: "string" },
    },
    required: ["headlines", "descriptions", "path1", "path2"], additionalProperties: false,
  };
  const anthropic = new Anthropic({ apiKey: key });
  const res = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1500,
    thinking: { type: "disabled" },
    system: `You write responsive search ad text for one ad group of a small local business, in the language of its website.

- Up to 15 headlines, each at most 30 characters including spaces. Up to 4 descriptions, each at most 90 characters.
- Only claim what the business summary says: never invent prices, discounts, years in business, guarantees, ratings or response times.
- Vary them: the service, the place, a reason to choose them from the summary, a call to action. Do not repeat the same words across headlines.
- path1 and path2: at most 15 characters each, lowercase, no spaces.
- If competitors are given: do not echo their claims or wording. Lead with what this business offers that they do not show (their "gaps"), and never use a competitor's name or trademark.
- If lines to keep are given, they already perform well: write different ones that complement them.`,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: JSON.stringify({ business: summary, adGroup: group, competitors }) }],
  } as any);
  const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const out = JSON.parse(text);
  return {
    headlines: (out.headlines as string[]).filter((h) => h.length <= 30).slice(0, 15),
    descriptions: (out.descriptions as string[]).filter((d) => d.length <= 90).slice(0, 4),
    path1: String(out.path1 ?? "").slice(0, 15), path2: String(out.path2 ?? "").slice(0, 15),
  };
}

/** Location search through Google's own geo target suggestions. */
export async function suggestLocations(clientId: number, query: string, countryCode = "RS") {
  const client = await clientWithProperties(clientId);
  const conn = await connectionForClient(clientId);
  if (!client || !conn) return [];
  const auth = await clientFor(conn.id);
  const res = await adsPost(auth, "geoTargetConstants:suggest", {
    locale: countryCode === "RS" ? "sr" : "en",
    countryCode,
    locationNames: { names: [query] },
  }).catch(() => null);
  return ((res?.geoTargetConstantSuggestions ?? []) as any[]).slice(0, 10).map((s) => ({
    id: digits(s.geoTargetConstant?.id ?? s.geoTargetConstant?.resourceName ?? ""),
    name: s.geoTargetConstant?.canonicalName ?? s.geoTargetConstant?.name ?? query,
    type: s.geoTargetConstant?.targetType ?? null,
    reach: s.reach ? Number(s.reach) : null,
  }));
}
