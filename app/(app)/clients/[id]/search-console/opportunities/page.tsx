import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { searchConsole } from "@/lib/engine/products";
import { brandTerms, containsBrand, normalise } from "@/lib/engine/brand";
import { DataTable } from "@/components/ui/DataTable";
import { ProductHead, NotConnected, NoDataYet, FindingList } from "@/components/product/Product";

export const dynamic = "force-dynamic";

/**
 * Where organic and paid meet: searches just off page one, and searches people
 * make that the Google Ads account does or does not cover.
 */
export default async function SearchOpportunities({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  if (!client.gsc_site_url) {
    return (
      <div className="stack rise">
        <ProductHead product="search_console" title="Opportunities" clientId={client.id} />
        <NotConnected product="search_console" clientId={client.id} adds="Organic searches read against the Ads account: what to improve on the site, and what to cover with ads." />
      </div>
    );
  }
  const [queries, keywords, terms, brands, findings] = await Promise.all([
    q<any>(`SELECT query, SUM(clicks)::float AS clicks, SUM(impressions)::float AS impressions,
                   (SUM(position * impressions) / NULLIF(SUM(impressions),0))::float AS position
              FROM gsc_query_pages WHERE client_id = $1 AND query <> '' GROUP BY query HAVING SUM(impressions) >= 30`, [client.id]),
    q<any>(`SELECT DISTINCT lower(text) AS t FROM keywords WHERE client_id = $1 AND status = 'ENABLED'`, [client.id]),
    q<any>(`SELECT lower(term) AS t, SUM(clicks)::float AS clicks, SUM(conversions)::float AS conversions FROM search_terms WHERE client_id = $1 GROUP BY 1`, [client.id]),
    brandTerms(client.id),
    searchConsole(client.id),
  ]);
  if (!queries.length) {
    return (
      <div className="stack rise">
        <ProductHead product="search_console" title="Opportunities" clientId={client.id} />
        <NoDataYet clientId={client.id} what="Sync reads 90 days of searches from Search Console." />
      </div>
    );
  }

  const kw = new Set(keywords.map((k) => normalise(k.t)));
  const paid = new Map(terms.map((t) => [normalise(t.t), t]));
  const rows = queries.map((r) => {
    const n = normalise(r.query);
    const term = paid.get(n);
    const coverage = kw.has(n) ? "Keyword" : term ? "Ads show on it" : "Not covered by ads";
    return {
      query: r.query, impressions: r.impressions, clicks: r.clicks, position: r.position,
      brand: containsBrand(r.query, brands) ? "Brand" : "Not brand",
      coverage, paidClicks: term?.clicks ?? null, paidConversions: term?.conversions ?? null,
      band: r.position <= 3 ? "Top 3" : r.position <= 7.5 ? "Page one" : r.position <= 20 ? "Just off page one" : "Deeper",
    };
  });
  const striking = findings.filter((f) => ["gsc_striking_distance", "gsc_cannibalisation", "gsc_low_ctr"].includes(f.kind));

  return (
    <div className="stack rise">
      <ProductHead product="search_console" title="Opportunities" clientId={client.id} meta="Organic searches, 90 days, read against the Google Ads account" />
      <FindingList findings={striking} title="Organic opportunities" none="No searches sit just off page one, lose clicks at a good position, or are split between pages." />
      <section className="stack" style={{ gap: 12 }}>
        <div>
          <h2>Organic and paid, search by search</h2>
          <p className="meta">
            A non-brand search that ranks in the top three and is also bought as a keyword may be paying for clicks the site would get anyway — test before cutting.
            A search that converts in Ads but ranks deep is a page worth building.
          </p>
        </div>
        <DataTable
          search="Search queries…"
          filter={{ key: "coverage", label: "Ads coverage" }}
          columns={[
            { key: "query", label: "Search" },
            { key: "brand", label: "Brand" },
            { key: "band", label: "Organic rank" },
            { key: "position", label: "Position", format: "position" },
            { key: "impressions", label: "Organic impressions", format: "count" },
            { key: "clicks", label: "Organic clicks", format: "count" },
            { key: "coverage", label: "In Google Ads" },
            { key: "paidClicks", label: "Paid clicks", format: "count" },
            { key: "paidConversions", label: "Paid conv.", format: "decimal" },
          ]}
          rows={rows}
          initialSort={{ key: "impressions", dir: -1 }}
        />
      </section>
    </div>
  );
}
