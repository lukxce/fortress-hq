import Link from "next/link";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { brandTerms, containsBrand } from "@/lib/engine/brand";
import { DataTable } from "@/components/ui/DataTable";
import { ProductHead } from "@/components/product/Product";

export const dynamic = "force-dynamic";

export default async function SearchTermsAndKeywords({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }>;
}) {
  const client = await pageClient(params);
  const { view } = await searchParams;
  const keywordsView = view === "keywords";
  const cur = client.currency;

  const [terms, keywords, brands] = await Promise.all([
    keywordsView ? [] : q<any>(`
      SELECT s.term, c.name AS campaign, s.match_source, SUM(s.impressions)::float AS impressions, SUM(s.clicks)::float AS clicks,
             (SUM(s.cost_micros) / 1e6)::float AS spend, SUM(s.conversions)::float AS conversions
        FROM search_terms s LEFT JOIN campaigns c ON c.client_id = s.client_id AND c.campaign_id = s.campaign_id
       WHERE s.client_id = $1 GROUP BY s.term, c.name, s.match_source`, [client.id]),
    keywordsView ? q<any>(`
      SELECT k.text, k.match_type, k.status, c.name AS campaign, k.quality_score, k.expected_ctr, k.ad_relevance, k.landing_page_experience,
             k.clicks::float, (k.cost_micros / 1e6)::float AS spend, k.conversions::float
        FROM keywords k LEFT JOIN campaigns c ON c.client_id = k.client_id AND c.campaign_id = k.campaign_id
       WHERE k.client_id = $1`, [client.id]) : [],
    brandTerms(client.id),
  ]);

  const QS: Record<string, string> = { BELOW_AVERAGE: "Below", AVERAGE: "Average", ABOVE_AVERAGE: "Above" };

  return (
    <div className="stack rise">
      <ProductHead product="ads" title="Search terms and keywords" clientId={client.id} meta="90 days">
        <div className="tabs">
          <Link href={`/clients/${client.id}/ads/search-terms` as never} className={`tab${!keywordsView ? " active" : ""}`}>Search terms</Link>
          <Link href={`/clients/${client.id}/ads/search-terms?view=keywords` as never} className={`tab${keywordsView ? " active" : ""}`}>Keywords</Link>
        </div>
      </ProductHead>
      {keywordsView ? (
        <DataTable
          search="Search keywords…" currency={cur} filter={{ key: "campaign", label: "Campaign" }}
          columns={[
            { key: "text", label: "Keyword", sub: "match_type" },
            { key: "campaign", label: "Campaign" },
            { key: "quality_score", label: "Quality", format: "count" },
            { key: "why", label: "CTR · ad · page", hint: "Google's own reasons: expected click-through, ad relevance, landing page experience" },
            { key: "clicks", label: "Clicks", format: "count" },
            { key: "spend", label: "Spend", format: "money" },
            { key: "conversions", label: "Conv.", format: "decimal" },
            { key: "cpa", label: "Cost / conv.", format: "money" },
          ]}
          rows={keywords.map((k) => ({
            ...k,
            why: [k.expected_ctr, k.ad_relevance, k.landing_page_experience].some(Boolean)
              ? [k.expected_ctr, k.ad_relevance, k.landing_page_experience].map((x) => QS[x] ?? "—").join(" · ") : null,
            cpa: k.conversions > 0 ? k.spend / k.conversions : null,
          }))}
          initialSort={{ key: "spend", dir: -1 }}
        />
      ) : (
        <DataTable
          search="Search terms…" currency={cur} filter={{ key: "result", label: "Result" }}
          columns={[
            { key: "term", label: "Search term", sub: "campaign" },
            { key: "result", label: "Result" },
            { key: "impressions", label: "Impr.", format: "count" },
            { key: "clicks", label: "Clicks", format: "count" },
            { key: "spend", label: "Spend", format: "money" },
            { key: "conversions", label: "Conv.", format: "decimal" },
            { key: "cpa", label: "Cost / conv.", format: "money" },
          ]}
          rows={terms.map((t) => ({
            ...t,
            result: containsBrand(t.term, brands) ? "Brand" : t.conversions > 0 ? "Converted" : t.clicks > 0 ? "Clicked, no conversion" : "No clicks",
            cpa: t.conversions > 0 ? t.spend / t.conversions : null,
          }))}
          initialSort={{ key: "spend", dir: -1 }}
        />
      )}
    </div>
  );
}
