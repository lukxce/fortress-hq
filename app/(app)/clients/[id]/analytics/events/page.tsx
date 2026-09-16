import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { DataTable } from "@/components/ui/DataTable";
import { ProductHead, NotConnected, NoDataYet } from "@/components/product/Product";

export const dynamic = "force-dynamic";

export default async function AnalyticsEvents({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  if (!client.ga4_property_id) {
    return (
      <div className="stack rise">
        <ProductHead product="analytics" title="Events and key events" clientId={client.id} />
        <NotConnected product="analytics" clientId={client.id} adds="Every event by day, so one that stops firing shows up the week it stops." />
      </div>
    );
  }
  const rows = await q<any>(`
    SELECT event_name,
           SUM(event_count)::float AS count90,
           SUM(key_events)::float AS key90,
           COALESCE(SUM(event_count) FILTER (WHERE date > CURRENT_DATE - 29),0)::float AS now28,
           COALESCE(SUM(event_count) FILTER (WHERE date <= CURRENT_DATE - 29 AND date > CURRENT_DATE - 57),0)::float AS prev28,
           max(date) FILTER (WHERE event_count > 0) AS last_seen
      FROM ga4_events WHERE client_id = $1 GROUP BY event_name`, [client.id]);
  if (!rows.length) {
    return (
      <div className="stack rise">
        <ProductHead product="analytics" title="Events and key events" clientId={client.id} />
        <NoDataYet clientId={client.id} what="Sync reads every event by name and day for 90 days." />
      </div>
    );
  }
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);
  const latest = rows.reduce((d, r) => { const x = iso(r.last_seen); return x && x > d ? x : d; }, "");
  return (
    <div className="stack rise">
      <ProductHead product="analytics" title="Events and key events" clientId={client.id} meta="90 days, by event name" />
      <p className="lede" style={{ margin: 0 }}>
        A key event is one Analytics counts as a conversion. An event whose last day is well before the others has stopped firing — check its tag first.
      </p>
      <DataTable
        search="Search events…"
        filter={{ key: "kind", label: "Kind" }}
        columns={[
          { key: "event_name", label: "Event" },
          { key: "kind", label: "Kind" },
          { key: "count90", label: "Count · 90 days", format: "count" },
          { key: "key90", label: "As key events", format: "decimal" },
          { key: "now28", label: "Last 28 days", format: "count" },
          { key: "prev28", label: "28 days before", format: "count" },
          { key: "change", label: "Change", format: "pct" },
          { key: "last", label: "Last recorded" },
        ]}
        rows={rows.map((r) => {
          const last = iso(r.last_seen);
          return {
            event_name: r.event_name, kind: r.key90 > 0 ? "Key event" : "Event",
            count90: r.count90, key90: r.key90 || null, now28: r.now28, prev28: r.prev28,
            change: r.prev28 > 0 ? r.now28 / r.prev28 - 1 : null,
            last: last && latest && last < new Date(new Date(latest).getTime() - 3 * 864e5).toISOString().slice(0, 10) ? `${last} — stopped?` : last,
          };
        })}
        initialSort={{ key: "count90", dir: -1 }}
      />
    </div>
  );
}
