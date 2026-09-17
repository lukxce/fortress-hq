import Link from "next/link";
import { q } from "@/lib/db";
import { clientsWithProperties } from "@/lib/binding";
import { NewClient } from "@/components/NewClient";
import { INDUSTRIES } from "@/lib/learning/industry";
import { currentUser, visibleConnections } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function Clients() {
  const clients = await clientsWithProperties();

  // Selected Ads accounts not yet made into a client — the candidates.
  const me = await currentUser();
  const candidates = await q<any>(`
    SELECT i.id, i.provider_id, i.display_name, i.domain, i.currency
      FROM inventory i
     WHERE i.provider = 'ads' AND NOT i.is_manager AND i.status = 'selected'
       AND ${visibleConnections(me?.id ?? null, 1, "i.connection_id")}
       AND NOT EXISTS (
         SELECT 1 FROM client_properties cp
          WHERE cp.inventory_id = i.id AND cp.provider = 'ads')
     ORDER BY i.display_name
  `, me ? [me.id] : []);

  const options = await q<any>(`
    SELECT i.id, i.provider, i.display_name, i.provider_id, i.domain FROM inventory i
     WHERE i.provider <> 'ads' AND i.status <> 'revoked' AND ${visibleConnections(me?.id ?? null, 1, "i.connection_id")}
     ORDER BY i.provider, i.display_name`, me ? [me.id] : []);

  const stats = await q<any>(`
    SELECT client_id,
           COALESCE(SUM(cost_micros),0)/1e6 AS spend,
           COALESCE(SUM(conversions),0) AS conversions
      FROM metrics_daily
     WHERE date > CURRENT_DATE - 31 AND date <= CURRENT_DATE - 1
       AND entity_type = 'campaign' AND client_id = ANY($1)
     GROUP BY client_id
  `, [clients.map((c) => c.id)]);
  const byClient = new Map(stats.map((s) => [s.client_id, s]));

  const openFindings = await q<any>(`
    SELECT client_id, count(*) FILTER (WHERE severity = 'critical') AS critical,
           count(*) AS total
      FROM findings WHERE status = 'open' GROUP BY client_id
  `);
  const findingsBy = new Map(openFindings.map((f) => [f.client_id, f]));

  return (
    <div className="stack rise">
      <header className="page-head">
        <h1>Projects</h1>
        <p className="lede">
          {clients.length === 0
            ? "A project is one Ads account, plus whichever Analytics property, Search Console site and Tag Manager container belong with it."
            : `${clients.length} configured.`}
        </p>
      </header>

      {clients.length > 0 && (
        <div className="client-grid">
          {clients.map((c) => {
            const s = byClient.get(c.id);
            const f = findingsBy.get(c.id);
            return (
              <Link key={c.id} href={`/clients/${c.id}` as never} className="sheet client-card">
                <div className="spread">
                  <span className="name">{c.name}</span>
                  {f && Number(f.critical) > 0 ? (
                    <span className="pill pill-bad">{f.critical} critical</span>
                  ) : f && Number(f.total) > 0 ? (
                    <span className="pill pill-warn">{f.total}</span>
                  ) : (
                    <span className="pill pill-good">clear</span>
                  )}
                </div>
                <div className="client-stats">
                  <div className="client-stat">
                    <span className="v num">
                      {s ? Number(s.spend).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    </span>
                    <span className="meta">spend, 30d</span>
                  </div>
                  <div className="client-stat">
                    <span className="v num">{s ? Number(s.conversions).toFixed(0) : "—"}</span>
                    <span className="meta">conversions</span>
                  </div>
                </div>
                <span className="meta">
                  {[c.ga4_property_id && "Analytics", c.gsc_site_url && "Search Console",
                    c.gtm_container_id && "Tag Manager"].filter(Boolean).join(" · ") || "Ads only"}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {candidates.length > 0 ? (
        <NewClient candidates={candidates} options={options} industries={INDUSTRIES} />
      ) : clients.length === 0 ? (
        <div className="sheet sheet-pad">
          <div className="empty">
            <h3>No accounts selected yet</h3>
            <p style={{ maxWidth: 420, margin: "0 auto 20px" }}>
              Pick the Ads accounts you want on the Connect page first. Each one
              becomes a client here.
            </p>
            <Link href="/connect" className="btn btn-accent">Open the pick list</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
