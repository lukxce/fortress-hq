import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { searchConsole } from "@/lib/engine/products";
import { brandTerms, containsBrand } from "@/lib/engine/brand";
import { count, pct } from "@/lib/format";
import { DataTable } from "@/components/ui/DataTable";
import { Delta } from "@/components/ui/bits";
import { ProductHead, NotConnected, NoDataYet, FindingList } from "@/components/product/Product";

export const dynamic = "force-dynamic";

export default async function SearchQueries({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  if (!client.gsc_site_url) {
    return (
      <div className="stack rise">
        <ProductHead product="search_console" title="Organic searches" clientId={client.id} />
        <NotConnected product="search_console" clientId={client.id} adds="Search Console shows what people search on Google before they find the site without an ad: searches just off page one, results that rank but do not get clicked, and pages losing traffic." />
      </div>
    );
  }
  const [totals, weekly, rows, brands, findings] = await Promise.all([
    q<any>(`SELECT COALESCE(SUM(clicks) FILTER (WHERE date > CURRENT_DATE - 31),0)::float AS c,
                   COALESCE(SUM(impressions) FILTER (WHERE date > CURRENT_DATE - 31),0)::float AS i,
                   COALESCE(SUM(position * impressions) FILTER (WHERE date > CURRENT_DATE - 31),0)::float AS pw,
                   COALESCE(SUM(clicks) FILTER (WHERE date <= CURRENT_DATE - 31 AND date > CURRENT_DATE - 59),0)::float AS pc,
                   COALESCE(SUM(impressions) FILTER (WHERE date <= CURRENT_DATE - 31 AND date > CURRENT_DATE - 59),0)::float AS pi,
                   COALESCE(SUM(position * impressions) FILTER (WHERE date <= CURRENT_DATE - 31 AND date > CURRENT_DATE - 59),0)::float AS ppw
              FROM gsc_totals WHERE client_id = $1`, [client.id]),
    q<any>(`SELECT date_trunc('week', date)::date AS week, SUM(clicks)::float AS c, SUM(impressions)::float AS i
              FROM gsc_totals WHERE client_id = $1 GROUP BY 1 ORDER BY 1`, [client.id]),
    q<any>(`SELECT query, SUM(clicks)::float AS clicks, SUM(impressions)::float AS impressions,
                   (SUM(position * impressions) / NULLIF(SUM(impressions),0))::float AS position,
                   count(*)::int AS pages, (array_agg(page ORDER BY impressions DESC))[1] AS top_page
              FROM gsc_query_pages WHERE client_id = $1 AND query <> '' GROUP BY query`, [client.id]),
    brandTerms(client.id),
    searchConsole(client.id),
  ]);
  const t = totals[0];
  if (!weekly.length) {
    return (
      <div className="stack rise">
        <ProductHead product="search_console" title="Organic searches" clientId={client.id} />
        <NoDataYet clientId={client.id} what="Sync reads 90 days of searches, pages, and which page answers which search." />
      </div>
    );
  }
  const change = (a: number, b: number) => (b > 0 ? a / b - 1 : null);
  const stat = (label: string, value: string, ch: number | null, lowerIsBetter = false) => (
    <div className="card stat">
      <span className="label">{label}</span>
      <div className="stat-value">{value}</div>
      <div className="stat-foot"><Delta change={ch} lowerIsBetter={lowerIsBetter} /><span>vs previous 28 days</span></div>
    </div>
  );
  const pos = t.i ? t.pw / t.i : null, ppos = t.pi ? t.ppw / t.pi : null;
  const max = Math.max(...weekly.map((w) => w.c), 1);

  return (
    <div className="stack rise">
      <ProductHead product="search_console" title="Organic searches" clientId={client.id} meta="Google search without ads · Search Console lags about three days" />

      <div className="stats">
        {stat("Clicks · 28 days", count(t.c), change(t.c, t.pc))}
        {stat("Impressions", count(t.i), change(t.i, t.pi))}
        {stat("Click-through", pct(t.i ? t.c / t.i : null), change(t.i ? t.c / t.i : 0, t.pi ? t.pc / t.pi : 0))}
        {stat("Average position", pos ? pos.toFixed(1) : "—", pos && ppos ? pos / ppos - 1 : null, true)}
      </div>

      <div className="card card-pad">
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2>Organic clicks per week</h2>
          <span className="meta">{weekly.length} weeks</span>
        </div>
        <div className="bars" role="img" aria-label="Organic clicks per week">
          {weekly.map((w) => (
            <div key={String(w.week)} className="bar" style={{ height: `${Math.max(2, (w.c / max) * 100)}%` }}
              title={`${count(w.c)} clicks · ${count(w.i)} impressions`} />
          ))}
        </div>
      </div>

      <FindingList findings={findings} none="Nothing in Search Console is out of line with this site's own history right now." />

      <section className="stack" style={{ gap: 12 }}>
        <h2>Searches · 90 days</h2>
        <DataTable
          search="Search queries…"
          filter={{ key: "kind", label: "Brand" }}
          columns={[
            { key: "query", label: "Search", sub: "top_page" },
            { key: "kind", label: "Brand" },
            { key: "clicks", label: "Clicks", format: "count" },
            { key: "impressions", label: "Impressions", format: "count" },
            { key: "ctr", label: "Click-through", format: "pct" },
            { key: "position", label: "Position", format: "position" },
            { key: "pages", label: "Pages ranking", format: "count", hint: "More than one page for the same search can split its ranking" },
          ]}
          rows={rows.map((r) => ({ ...r, kind: containsBrand(r.query, brands) ? "Brand" : "Not brand", ctr: r.impressions ? r.clicks / r.impressions : null }))}
          initialSort={{ key: "clicks", dir: -1 }}
        />
      </section>
    </div>
  );
}
