import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { DataTable } from "@/components/ui/DataTable";
import { ProductHead, NotConnected, NoDataYet, syncedMeta } from "@/components/product/Product";

export const dynamic = "force-dynamic";

export default async function AnalyticsPages({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ channel?: string }>;
}) {
  const client = await pageClient(params);
  const { channel } = await searchParams;
  if (!client.ga4_property_id) {
    return (
      <div className="stack rise">
        <ProductHead product="analytics" title="Landing pages" clientId={client.id} />
        <NotConnected product="analytics" clientId={client.id} adds="See which pages visitors arrive on, from which channel, and which ones they leave without doing anything." />
      </div>
    );
  }
  const rows = await q<any>(`
    SELECT page, channel, sessions::float, engaged_sessions::float AS engaged, key_events::float, synced_at
      FROM ga4_pages WHERE client_id = $1`, [client.id]);
  if (!rows.length) {
    return (
      <div className="stack rise">
        <ProductHead product="analytics" title="Landing pages" clientId={client.id} />
        <NoDataYet clientId={client.id} what="Sync reads 90 days of landing pages by channel." />
      </div>
    );
  }

  // One row per page across channels, plus the paid and organic split side by side.
  const byPage = new Map<string, any>();
  for (const r of rows) {
    const p = byPage.get(r.page) ?? { page: r.page, sessions: 0, engaged: 0, key_events: 0, paid: 0, paidKey: 0, organic: 0, organicKey: 0 };
    p.sessions += r.sessions; p.engaged += r.engaged; p.key_events += r.key_events;
    if (/paid/i.test(r.channel)) { p.paid += r.sessions; p.paidKey += r.key_events; }
    if (/organic search/i.test(r.channel)) { p.organic += r.sessions; p.organicKey += r.key_events; }
    byPage.set(r.page, p);
  }
  const all = [...byPage.values()].map((p) => ({
    page: p.page, sessions: p.sessions, engagedRate: p.sessions ? p.engaged / p.sessions : null, key_events: p.key_events,
    keyRate: p.sessions ? p.key_events / p.sessions : null,
    paid: p.paid, paidRate: p.paid >= 30 ? p.paidKey / p.paid : null,
    organic: p.organic, organicRate: p.organic >= 30 ? p.organicKey / p.organic : null,
  }));
  const channelRows = channel
    ? rows.filter((r) => r.channel === channel).map((r) => ({ page: r.page, channel: r.channel, sessions: r.sessions, engagedRate: r.sessions ? r.engaged / r.sessions : null, key_events: r.key_events, keyRate: r.sessions ? r.key_events / r.sessions : null }))
    : null;

  return (
    <div className="stack rise">
      <ProductHead product="analytics" title="Landing pages" clientId={client.id} meta={syncedMeta(rows[0]?.synced_at, "90 days, every channel")} />
      <p className="lede" style={{ margin: 0 }}>
        The paid and organic columns show the same page judged by two kinds of visitor. A page that converts organic visitors but not paid ones usually points at the ad, not the page.
      </p>
      {channelRows ? (
        <DataTable search="Search pages…" filter={{ key: "channel", label: "Channel" }}
          columns={[
            { key: "page", label: "Page", format: "url" }, { key: "channel", label: "Channel" },
            { key: "sessions", label: "Sessions", format: "count" }, { key: "engagedRate", label: "Engaged", format: "pct" },
            { key: "key_events", label: "Key events", format: "decimal" }, { key: "keyRate", label: "Key events / session", format: "pct" },
          ]}
          rows={channelRows} initialSort={{ key: "sessions", dir: -1 }} />
      ) : (
        <DataTable search="Search pages…"
          columns={[
            { key: "page", label: "Page", format: "url" },
            { key: "sessions", label: "Sessions", format: "count" },
            { key: "engagedRate", label: "Engaged", format: "pct" },
            { key: "key_events", label: "Key events", format: "decimal" },
            { key: "keyRate", label: "Key events / session", format: "pct" },
            { key: "paid", label: "Paid sessions", format: "count" },
            { key: "paidRate", label: "Paid rate", format: "pct", hint: "Shown from 30 paid sessions" },
            { key: "organic", label: "Organic sessions", format: "count" },
            { key: "organicRate", label: "Organic rate", format: "pct", hint: "Shown from 30 organic sessions" },
          ]}
          rows={all} initialSort={{ key: "sessions", dir: -1 }} />
      )}
    </div>
  );
}
