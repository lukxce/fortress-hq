import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { DataTable } from "@/components/ui/DataTable";
import { ProductHead, NotConnected, NoDataYet, syncedMeta } from "@/components/product/Product";

export const dynamic = "force-dynamic";

export default async function SearchPages({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  if (!client.gsc_site_url) {
    return (
      <div className="stack rise">
        <ProductHead product="search_console" title="Pages in search" clientId={client.id} />
        <NotConnected product="search_console" clientId={client.id} adds="Every page Google shows, this four weeks against the last, so a page losing its ranking is visible." />
      </div>
    );
  }
  const rows = await q<any>(`SELECT page, clicks::float, prev_clicks::float, impressions::float, prev_impressions::float,
                                    position::float, prev_position::float, synced_at
                               FROM gsc_pages WHERE client_id = $1`, [client.id]);
  if (!rows.length) {
    return (
      <div className="stack rise">
        <ProductHead product="search_console" title="Pages in search" clientId={client.id} />
        <NoDataYet clientId={client.id} what="Sync reads every page Google showed, this four weeks and the four before." />
      </div>
    );
  }
  return (
    <div className="stack rise">
      <ProductHead product="search_console" title="Pages in search" clientId={client.id} meta={syncedMeta(rows[0]?.synced_at, "Last 28 days against the 28 before")} />
      <p className="lede" style={{ margin: 0 }}>
        When clicks fall, the columns say why: a worse position is ranking, fewer impressions at the same position is demand, and neither is the result losing the click.
      </p>
      <DataTable
        search="Search pages…"
        filter={{ key: "trend", label: "Trend" }}
        columns={[
          { key: "page", label: "Page", format: "url" },
          { key: "trend", label: "Trend" },
          { key: "clicks", label: "Clicks", format: "count" },
          { key: "prev_clicks", label: "Before", format: "count" },
          { key: "impressions", label: "Impressions", format: "count" },
          { key: "prev_impressions", label: "Before", format: "count" },
          { key: "position", label: "Position", format: "position" },
          { key: "prev_position", label: "Before", format: "position" },
        ]}
        rows={rows.map((r) => ({
          ...r,
          trend: r.prev_clicks < 10 && r.clicks < 10 ? "Too little to say" : r.clicks >= r.prev_clicks * 1.2 ? "Growing" : r.clicks <= r.prev_clicks * 0.8 ? "Losing clicks" : "Steady",
        }))}
        initialSort={{ key: "clicks", dir: -1 }}
      />
    </div>
  );
}
