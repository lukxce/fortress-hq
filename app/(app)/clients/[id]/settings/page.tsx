import Link from "next/link";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { currentUser, visibleConnections } from "@/lib/user";
import { brandTerms } from "@/lib/engine/brand";
import { ago, count } from "@/lib/format";
import { ClientSettings } from "@/components/brain/ClientSettings";
import { Bindings } from "@/components/settings/Bindings";
import { IndustrySelect } from "@/components/settings/Industry";
import { INDUSTRIES } from "@/lib/learning/industry";
import { q1 } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProjectSettings({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const id = client.id;
  const me = await currentUser();
  const trade = await q1<{ industry: string | null; industry_source: string | null }>(`SELECT industry, industry_source FROM clients WHERE id = $1`, [id]);

  const one = async (sql: string) => (await q<any>(sql, [id]))[0] ?? {};
  const [inventory, bound, derived, sources] = await Promise.all([
    q<any>(`SELECT id, provider, provider_id, display_name, domain, parent_name, is_manager FROM inventory
             WHERE status <> 'revoked' AND ${visibleConnections(me?.id ?? null, 1)}
             ORDER BY provider, display_name`, me ? [me.id] : []),
    q<any>(`SELECT provider, inventory_id FROM client_properties WHERE client_id = $1`, [id]),
    brandTerms(id),
    Promise.all([
      one(`SELECT count(*)::int AS n, max(last_synced_at) AS at FROM campaigns WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM keywords WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM search_terms WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(date)::text AS at FROM metrics_daily WHERE client_id = $1 AND entity_type = 'campaign'`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM conversion_actions WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(date)::text AS at FROM ga4_daily WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(date)::text AS at FROM ga4_events WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM ga4_pages WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(date)::text AS at FROM gsc_totals WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM gsc_query_pages WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM gtm_tags WHERE client_id = $1`),
    ]),
  ]);

  const current = (p: string) => bound.find((b) => b.provider === p)?.inventory_id ?? null;
  const options = (p: string) => inventory
    .filter((i) => i.provider === p && !(p === "ads" && i.is_manager))
    .map((i) => ({ id: i.id, label: i.display_name || i.provider_id, sub: i.domain ?? i.parent_name ?? i.provider_id }));

  const rows: [string, string, any, boolean][] = [
    ["Campaigns", "Google Ads", sources[0], Boolean(client.ads_customer_id)],
    ["Keywords with quality score", "Google Ads · 90 days", sources[1], Boolean(client.ads_customer_id)],
    ["Search terms", "Google Ads · 90 days", sources[2], Boolean(client.ads_customer_id)],
    ["Daily metrics", "Google Ads · 365 days", sources[3], Boolean(client.ads_customer_id)],
    ["Conversion actions", "Google Ads", sources[4], Boolean(client.ads_customer_id)],
    ["Sessions by channel", "Analytics · 90 days", sources[5], Boolean(client.ga4_property_id)],
    ["Events by day", "Analytics · 90 days", sources[6], Boolean(client.ga4_property_id)],
    ["Landing pages", "Analytics · 90 days", sources[7], Boolean(client.ga4_property_id)],
    ["Site totals", "Search Console · 90 days", sources[8], Boolean(client.gsc_site_url)],
    ["Searches × pages", "Search Console · 90 days", sources[9], Boolean(client.gsc_site_url)],
    ["Tags and triggers", "Tag Manager", sources[10], Boolean(client.gtm_container_id)],
  ];

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Project settings</div>
          <h1>{client.name}</h1>
        </div>
      </header>

      <div className="card card-pad">
        <div className="spread" style={{ marginBottom: 6 }}>
          <h2>Google products</h2>
          <Link href="/connect" className="btn btn-sm">Connect another Google account</Link>
        </div>
        <p className="meta" style={{ marginBottom: 8 }}>Only what your own Google sign-in can reach is listed.</p>
        <Bindings clientId={id} slots={[
          { provider: "ads", label: "Google Ads account", current: current("ads"), options: options("ads"), adds: "Campaigns, keywords, search terms and conversions." },
          { provider: "ga4", label: "Analytics property", current: current("ga4"), options: options("ga4"), adds: "Every visit and event, all channels." },
          { provider: "gsc", label: "Search Console site", current: current("gsc"), options: options("gsc"), adds: "Organic searches and pages." },
          { provider: "gtm", label: "Tag Manager container", current: current("gtm"), options: options("gtm"), adds: "The tags that do the tracking." },
        ]} />
      </div>

      <div className="card card-pad">
        <h2 style={{ marginBottom: 12 }}>Business details</h2>
        <div className="field" style={{ marginBottom: 16 }}>
          <label className="label">Industry</label>
          <IndustrySelect clientId={id} value={trade?.industry ?? null} source={trade?.industry_source ?? null} options={INDUSTRIES} />
          <p className="meta" style={{ marginTop: 4 }}>Patterns from other accounts in the same trade weigh more for this project.</p>
        </div>
        <ClientSettings
          clientId={id} brandTerms={client.brand_terms ?? []} derived={derived} website={client.website}
          targetCpa={client.target_cpa ? Number(client.target_cpa) : null}
          monthlyBudget={client.monthly_budget ? Number(client.monthly_budget) : null}
          currency={client.currency}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>What the analysis can see</h2>
          <span className="meta">Anything missing here is a blind spot.</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Source</th><th className="r">Rows</th><th>Last updated</th></tr></thead>
            <tbody>
              {rows.map(([name, source, s, connected]) => (
                <tr key={name}>
                  <td className="cell-name">{name}</td>
                  <td className="meta">{source}</td>
                  <td className="num r">{connected ? count(s.n ?? 0) : "—"}</td>
                  <td>
                    {!connected ? <span className="pill pill-warn">Not connected</span>
                      : !s.n ? <span className="pill pill-warn">Nothing yet — sync</span>
                      : <span className="meta">{typeof s.at === "string" && s.at.length === 10 ? `data to ${s.at}` : ago(s.at)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
