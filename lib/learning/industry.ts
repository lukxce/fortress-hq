import Anthropic from "@anthropic-ai/sdk";
import { q } from "@/lib/db";

// Trades, not marketing categories: patterns only transfer between businesses
// whose customers search the same way.
export const INDUSTRIES = {
  hvac: "Heating, air conditioning, heat pumps",
  electrical: "Electricians and electrical work",
  plumbing: "Plumbing, drains, water heaters",
  construction_renovation: "Construction, renovation, painting, flooring, bathrooms",
  cleaning: "Cleaning services",
  dental_medical: "Dental, medical and aesthetic clinics",
  legal_financial: "Legal, accounting, financial services",
  automotive: "Cars, repairs, parts, towing",
  logistics_transport: "Trucking, freight, logistics, moving",
  real_estate: "Real estate and property",
  hospitality_travel: "Hotels, restaurants, travel, boats and charters",
  education: "Schools, courses, training",
  saas_software: "Software and online services",
  b2b_services: "Other business-to-business services",
  ecommerce_home: "Online shops: home, furniture, ceramics, appliances",
  ecommerce_other: "Other online shops",
  local_services_other: "Other local services",
  other: "Anything else",
} as const;

/** Guess the industry of any project nobody has set, from what the account and site say it sells. */
export async function classifyIndustries(): Promise<number> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return 0;
  const todo = await q<any>(`
    SELECT c.id, c.name, c.website, s.summary,
           (SELECT array_agg(term ORDER BY conversions DESC) FROM (SELECT term, SUM(conversions) AS conversions FROM search_terms WHERE client_id = c.id GROUP BY term ORDER BY 2 DESC LIMIT 15) t) AS terms,
           (SELECT array_agg(text) FROM (SELECT DISTINCT text FROM keywords WHERE client_id = c.id AND status = 'ENABLED' LIMIT 15) k) AS keywords,
           (SELECT array_agg(query) FROM (SELECT query FROM gsc_query_pages WHERE client_id = c.id GROUP BY query ORDER BY SUM(impressions) DESC LIMIT 15) g) AS queries,
           (SELECT i.domain FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = c.id AND cp.provider = 'ads') AS domain
      FROM clients c LEFT JOIN site_summaries s ON s.client_id = c.id
     WHERE NOT c.archived AND c.industry IS NULL`);
  if (!todo.length) return 0;

  const anthropic = new Anthropic({ apiKey: key });
  let done = 0;
  for (const p of todo) {
    const res = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 200,
      thinking: { type: "disabled" },
      system: `Classify the business into exactly one industry key. Keys:\n${Object.entries(INDUSTRIES).map(([k, v]) => `${k}: ${v}`).join("\n")}\nIf the evidence is too thin to tell, answer "other".`,
      output_config: { format: { type: "json_schema", schema: { type: "object", properties: { industry: { type: "string", enum: Object.keys(INDUSTRIES) } }, required: ["industry"], additionalProperties: false } } },
      messages: [{ role: "user", content: JSON.stringify({ name: p.name, website: p.website ?? p.domain, site: p.summary, convertingSearches: p.terms, keywords: p.keywords, organicSearches: p.queries }) }],
    } as any);
    const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    try {
      const { industry } = JSON.parse(text);
      if (industry in INDUSTRIES) {
        await q(`UPDATE clients SET industry = $2, industry_source = 'auto' WHERE id = $1 AND industry IS NULL`, [p.id, industry]);
        done++;
      }
    } catch { /* leave it for the next run */ }
  }
  return done;
}
