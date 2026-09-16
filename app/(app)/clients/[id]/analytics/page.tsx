import Link from "next/link";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { analytics } from "@/lib/engine/products";
import { count, pct } from "@/lib/format";
import { DataTable } from "@/components/ui/DataTable";
import { Delta } from "@/components/ui/bits";
import { ProductHead, NotConnected, NoDataYet, FindingList, syncedMeta } from "@/components/product/Product";

export const dynamic = "force-dynamic";

const VIEWS = { channels: "Channels", source_medium: "Source / medium", device: "Devices", country: "Countries" } as const;
type View = keyof typeof VIEWS;

export default async function AnalyticsTraffic({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }>;
}) {
  const client = await pageClient(params);
  const { view: raw } = await searchParams;
  const view: View = raw && raw in VIEWS ? (raw as View) : "channels";
  if (!client.ga4_property_id) {
    return (
      <div className="stack rise">
        <ProductHead product="analytics" title="Traffic and channels" clientId={client.id} />
        <NotConnected product="analytics" clientId={client.id} adds="Analytics shows every visit, not only paid ones: which channels bring people who act, which events have stopped firing, and which pages lose visitors." />
      </div>
    );
  }

  const [totals, weekly, rows, synced, findings] = await Promise.all([
    q<any>(`SELECT COALESCE(SUM(sessions) FILTER (WHERE date > CURRENT_DATE - 29),0)::float AS s,
                   COALESCE(SUM(engaged_sessions) FILTER (WHERE date > CURRENT_DATE - 29),0)::float AS e,
                   COALESCE(SUM(key_events) FILTER (WHERE date > CURRENT_DATE - 29),0)::float AS k,
                   COALESCE(SUM(sessions) FILTER (WHERE date <= CURRENT_DATE - 29 AND date > CURRENT_DATE - 57),0)::float AS ps,
                   COALESCE(SUM(engaged_sessions) FILTER (WHERE date <= CURRENT_DATE - 29 AND date > CURRENT_DATE - 57),0)::float AS pe,
                   COALESCE(SUM(key_events) FILTER (WHERE date <= CURRENT_DATE - 29 AND date > CURRENT_DATE - 57),0)::float AS pk
              FROM ga4_daily WHERE client_id = $1`, [client.id]),
    q<any>(`SELECT date_trunc('week', date)::date AS week, SUM(sessions)::float AS s, SUM(key_events)::float AS k
              FROM ga4_daily WHERE client_id = $1 GROUP BY 1 ORDER BY 1`, [client.id]),
    view === "channels"
      ? q<any>(`SELECT channel AS key, SUM(sessions)::float AS sessions, SUM(engaged_sessions)::float AS engaged, SUM(key_events)::float AS key_events
                  FROM ga4_daily WHERE client_id = $1 AND date > CURRENT_DATE - 91 GROUP BY channel`, [client.id])
      : q<any>(`SELECT key, sessions::float, engaged_sessions::float AS engaged, key_events::float FROM ga4_dims WHERE client_id = $1 AND dim_type = $2`, [client.id, view]),
    q<any>(`SELECT max(synced_at) AS at FROM ga4_dims WHERE client_id = $1`, [client.id]),
    analytics(client.id),
  ]);

  const t = totals[0];
  if (!t || (t.s === 0 && t.ps === 0 && !weekly.length)) {
    return (
      <div className="stack rise">
        <ProductHead product="analytics" title="Traffic and channels" clientId={client.id} />
        <NoDataYet clientId={client.id} what="Sync reads 90 days of sessions by channel, every event by day, landing pages, devices, sources and countries." />
      </div>
    );
  }
  const change = (a: number, b: number) => (b > 0 ? a / b - 1 : null);
  const stat = (label: string, value: string, ch: number | null) => (
    <div className="card stat">
      <span className="label">{label}</span>
      <div className="stat-value">{value}</div>
      <div className="stat-foot"><Delta change={ch} /><span>vs previous 28 days</span></div>
    </div>
  );
  const max = Math.max(...weekly.map((w) => w.s), 1);

  return (
    <div className="stack rise">
      <ProductHead product="analytics" title="Traffic and channels" clientId={client.id} meta={syncedMeta(synced[0]?.at, "All visits, every channel")} />

      <div className="stats">
        {stat("Sessions · 28 days", count(t.s), change(t.s, t.ps))}
        {stat("Engaged", pct(t.s ? t.e / t.s : null), change(t.s ? t.e / t.s : 0, t.ps ? t.pe / t.ps : 0))}
        {stat("Key events", count(t.k, 1), change(t.k, t.pk))}
        {stat("Key events per session", pct(t.s ? t.k / t.s : null, 2), change(t.s ? t.k / t.s : 0, t.ps ? t.pk / t.ps : 0))}
      </div>

      <div className="card card-pad">
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2>Sessions per week</h2>
          <span className="meta">grey weeks had no key events</span>
        </div>
        <div className="bars" role="img" aria-label="Sessions per week">
          {weekly.map((w) => (
            <div key={w.week} className={`bar${w.k === 0 ? " zero" : ""}`} style={{ height: `${Math.max(2, (w.s / max) * 100)}%` }}
              title={`Week of ${String(w.week).slice(0, 10)}: ${count(w.s)} sessions · ${count(w.k, 1)} key events`} />
          ))}
        </div>
      </div>

      <FindingList findings={findings} none="Nothing in Analytics is out of line with this site's own history right now." />

      <section className="stack" style={{ gap: 12 }}>
        <div className="spread">
          <h2>Where visits come from · 90 days</h2>
          <div className="tabs">
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <Link key={v} href={`/clients/${client.id}/analytics?view=${v}` as never} className={`tab${v === view ? " active" : ""}`}>{VIEWS[v]}</Link>
            ))}
          </div>
        </div>
        <DataTable
          search={`Search ${VIEWS[view].toLowerCase()}…`}
          columns={[
            { key: "key", label: VIEWS[view].replace(/s$/, "") },
            { key: "sessions", label: "Sessions", format: "count" },
            { key: "engagedRate", label: "Engaged", format: "pct", hint: "Sessions longer than 10 seconds, with a conversion, or with two or more page views" },
            { key: "key_events", label: "Key events", format: "decimal" },
            { key: "keyRate", label: "Key events / session", format: "pct" },
          ]}
          rows={rows.map((r) => ({ ...r, engagedRate: r.sessions ? r.engaged / r.sessions : null, keyRate: r.sessions ? r.key_events / r.sessions : null }))}
          initialSort={{ key: "sessions", dir: -1 }}
        />
      </section>
    </div>
  );
}
