import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { businessProfileFindings } from "@/lib/engine/extras";
import { count, dateShort } from "@/lib/format";
import { DataTable } from "@/components/ui/DataTable";
import { Delta } from "@/components/ui/bits";
import { ProductHead, NotConnected, NoDataYet, FindingList } from "@/components/product/Product";

export const dynamic = "force-dynamic";

const ACTIONS = [
  ["CALL_CLICKS", "Calls"],
  ["BUSINESS_DIRECTION_REQUESTS", "Direction requests"],
  ["WEBSITE_CLICKS", "Website clicks"],
] as const;

export default async function BusinessProfile({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  if (!client.gbp_location_id) {
    return (
      <div className="stack rise">
        <ProductHead product="business_profile" title="Business Profile" clientId={client.id} />
        <NotConnected product="business_profile" clientId={client.id} adds="For a local business the Business Profile is often where most enquiries start: calls, direction requests and website clicks from Google Search and Maps, what people searched to find it, and its reviews. Connect Business Profile on the Connections page first, then pick the location here." />
      </div>
    );
  }
  const [totals, weekly, keywords, reviews, findings] = await Promise.all([
    q<any>(`SELECT metric, COALESCE(SUM(value) FILTER (WHERE date > CURRENT_DATE - 32),0)::float AS now,
                   COALESCE(SUM(value) FILTER (WHERE date <= CURRENT_DATE - 32 AND date > CURRENT_DATE - 60),0)::float AS prev
              FROM gbp_daily WHERE client_id = $1 GROUP BY metric`, [client.id]),
    q<any>(`SELECT date_trunc('week', date)::date AS week,
                   SUM(value) FILTER (WHERE metric IN ('CALL_CLICKS','BUSINESS_DIRECTION_REQUESTS','WEBSITE_CLICKS'))::float AS actions,
                   SUM(value) FILTER (WHERE metric = 'CALL_CLICKS')::float AS calls
              FROM gbp_daily WHERE client_id = $1 GROUP BY 1 ORDER BY 1`, [client.id]),
    q<any>(`SELECT keyword, impressions::float, threshold::float, month FROM gbp_keywords WHERE client_id = $1`, [client.id]),
    q<any>(`SELECT rating, comment, replied, created_at FROM gbp_reviews WHERE client_id = $1 ORDER BY created_at DESC NULLS LAST`, [client.id]),
    businessProfileFindings(client.id),
  ]);
  if (!totals.length) {
    return (
      <div className="stack rise">
        <ProductHead product="business_profile" title="Business Profile" clientId={client.id} />
        <NoDataYet clientId={client.id} what="Sync reads 180 days of calls, direction requests, website clicks and views, the last three months of search keywords, and reviews." />
      </div>
    );
  }
  const get = (m: string) => totals.find((t) => t.metric === m) ?? { now: 0, prev: 0 };
  const sum = (ms: string[], k: "now" | "prev") => ms.reduce((n, m) => n + get(m)[k], 0);
  const ch = (a: number, b: number) => (b > 0 ? a / b - 1 : null);
  const views = ["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS"];
  const maps = ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS"];
  const max = Math.max(...weekly.map((w) => w.actions ?? 0), 1);
  const rated = reviews.filter((r) => r.rating != null);
  const avg = rated.length ? rated.reduce((n, r) => n + r.rating, 0) / rated.length : null;

  return (
    <div className="stack rise">
      <ProductHead product="business_profile" title="Business Profile" clientId={client.id} meta="Google Search and Maps · about three days behind" />

      <div className="stats">
        {ACTIONS.map(([m, label]) => (
          <div key={m} className="card stat">
            <span className="label">{label} · 28 days</span>
            <div className="stat-value">{count(get(m).now)}</div>
            <div className="stat-foot"><Delta change={ch(get(m).now, get(m).prev)} /><span>vs previous 28 days</span></div>
          </div>
        ))}
        <div className="card stat">
          <span className="label">Profile views · 28 days</span>
          <div className="stat-value">{count(sum(views, "now"))}</div>
          <div className="stat-foot"><Delta change={ch(sum(views, "now"), sum(views, "prev"))} /><span>{sum(views, "now") ? `${Math.round((sum(maps, "now") / sum(views, "now")) * 100)}% on Maps` : ""}</span></div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2>Calls, directions and website clicks per week</h2>
          <span className="meta">{weekly.length} weeks</span>
        </div>
        <div className="bars" role="img" aria-label="Actions per week">
          {weekly.map((w) => (
            <div key={String(w.week)} className="bar" style={{ height: `${Math.max(2, ((w.actions ?? 0) / max) * 100)}%` }}
              title={`Week of ${dateShort(w.week)}: ${count(w.actions)} actions, ${count(w.calls)} calls`} />
          ))}
        </div>
      </div>

      <FindingList findings={findings} none="Actions are steady and every recent review has a reply." />

      <div className="grid-2">
        <section className="stack" style={{ gap: 12 }}>
          <h2>What people searched · last 3 months</h2>
          <DataTable search="Search keywords…"
            columns={[{ key: "keyword", label: "Search" }, { key: "shown", label: "Times the profile appeared", format: "count", hint: "Small counts are reported by Google only as \"fewer than N\"" }, { key: "note", label: "" }]}
            rows={keywords.map((k) => ({ keyword: k.keyword, shown: k.impressions ?? k.threshold, note: k.impressions == null && k.threshold != null ? `fewer than ${k.threshold}` : null }))}
            initialSort={{ key: "shown", dir: -1 }} empty="No keyword data yet." />
        </section>
        <div className="card">
          <div className="card-head"><h2>Reviews</h2><span className="meta">{rated.length ? `${avg!.toFixed(1)} ★ from ${rated.length}` : "none synced"}</span></div>
          {reviews.length ? (
            <ul className="audit">
              {reviews.slice(0, 20).map((r, i) => (
                <li key={i} className={r.rating != null && r.rating <= 3 ? "warn" : "info"}>
                  <span className="mark">{r.rating ?? "–"}</span>
                  <div className="body" style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="meta">{dateShort(r.created_at)}</span>
                      {r.replied ? <span className="pill pill-good">Replied</span> : <span className="pill pill-warn">No reply</span>}
                    </div>
                    {r.comment && <p className="meta" style={{ margin: "4px 0 0" }}>{r.comment.length > 280 ? `${r.comment.slice(0, 280)}…` : r.comment}</p>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="card-pad"><p className="meta">Reviews come from an older Google API that needs its own approval; the rest of the profile works without it.</p></div>}
        </div>
      </div>
    </div>
  );
}
