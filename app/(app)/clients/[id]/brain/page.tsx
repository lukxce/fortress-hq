import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { lastRun, MODEL } from "@/lib/brain/recommend";
import { brandTerms } from "@/lib/engine/brand";
import { ago, count, AREA_LABEL } from "@/lib/format";
import { ClientSettings } from "@/components/brain/ClientSettings";

export const dynamic = "force-dynamic";

export default async function Brain({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const id = client.id;

  const one = async (sql: string) => (await q<any>(sql, [id]))[0] ?? {};
  const [record, focus, run, derived, sources] = await Promise.all([
    q<any>(`SELECT verdict, count(*)::int AS n FROM experiments WHERE client_id = $1 AND status = 'finished' GROUP BY verdict`, [id]),
    q<any>(`SELECT area, count(*)::int AS n FROM recommendations WHERE client_id = $1 AND status = 'open' GROUP BY area ORDER BY 2 DESC`, [id]),
    lastRun(id),
    brandTerms(id),
    Promise.all([
      one(`SELECT count(*)::int AS n, max(last_synced_at) AS at FROM campaigns WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM ad_groups WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM ads WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM keywords WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM search_terms WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(date) AS at FROM metrics_daily WHERE client_id = $1 AND entity_type = 'campaign'`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM schedule_metrics WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM segment_metrics WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM negatives WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM conversion_actions WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(date) AS at FROM ga4_daily WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(date) AS at FROM gsc_daily WHERE client_id = $1`),
      one(`SELECT count(*)::int AS n, max(synced_at) AS at FROM gtm_tags WHERE client_id = $1`),
    ]),
  ]);

  const rows: [string, string, any, boolean][] = [
    ["Campaigns", "Google Ads", sources[0], true],
    ["Ad groups", "Google Ads", sources[1], true],
    ["Ads and headlines", "Google Ads", sources[2], true],
    ["Keywords with quality score", "Google Ads · 90 days", sources[3], true],
    ["Search terms", "Google Ads · 90 days", sources[4], true],
    ["Daily metrics", "Google Ads · 365 days", sources[5], true],
    ["Hour × day of week", "Google Ads · 90 days", sources[6], true],
    ["Device, network, country", "Google Ads · 90 days", sources[7], true],
    ["Existing negatives", "Google Ads", sources[8], true],
    ["Conversion actions", "Google Ads", sources[9], true],
    ["Sessions and key events", "Analytics · 90 days", sources[10], Boolean(client.ga4_property_id)],
    ["Organic searches", "Search Console · 90 days", sources[11], Boolean(client.gsc_site_url)],
    ["Tags", "Tag Manager", sources[12], Boolean(client.gtm_container_id)],
  ];

  const n = (v: string) => record.find((r) => r.verdict === v)?.n ?? 0;
  const judged = n("confirmed") + n("refuted") + n("inconclusive");

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Brain</div>
          <h1>How it thinks, and whether it has been right</h1>
        </div>
      </header>

      <div className="grid-3">
        {[
          ["1 · Measured", "Every figure is computed from this account's data in SQL: cost per conversion, which hours and searches lose money, which campaigns are capped while winning. Differences are tested for chance before anything is called worse."],
          ["2 · Written", `${MODEL} receives those findings, already computed, and writes what to change around them: the mechanism, the order, the exact clicks. It is never asked to find or produce a number.`],
          ["3 · Checked", "Anything that predicts a change becomes a test. When it is started, a baseline is taken; when enough conversions have arrived, the result is judged with the same test. Being wrong is recorded."],
        ].map(([h, p]) => (
          <div key={h} className="card card-pad">
            <h3 style={{ marginBottom: 6 }}>{h}</h3>
            <p className="meta" style={{ fontSize: 13.5 }}>{p}</p>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <h2 style={{ marginBottom: 10 }}>Track record</h2>
          {judged === 0 ? (
            <p className="lede" style={{ fontSize: 14 }}>
              No prediction has reached its check date yet, so the tool has <span className="mark">no track record on this account</span>.
              Treat its confidence accordingly until it does.
            </p>
          ) : (
            <>
              <div className="row" style={{ gap: 20 }}>
                <div><div className="stat-value ok-text">{n("confirmed")}</div><div className="meta">confirmed</div></div>
                <div><div className="stat-value bad-text">{n("refuted")}</div><div className="meta">refuted</div></div>
                <div><div className="stat-value">{n("inconclusive")}</div><div className="meta">inconclusive</div></div>
              </div>
              <p className="meta" style={{ marginTop: 10 }}>
                Only tests that were actually started count. &ldquo;Inconclusive&rdquo; means the change was within what chance produces at this volume.
              </p>
            </>
          )}
        </div>
        <div className="card card-pad">
          <h2 style={{ marginBottom: 10 }}>Current focus</h2>
          {focus.length ? (
            <div className="row" style={{ gap: 8 }}>
              {focus.map((f) => <span key={f.area} className="pill pill-blue">{AREA_LABEL[f.area] ?? f.area} · {f.n}</span>)}
            </div>
          ) : <p className="meta">No open recommendations.</p>}
          {run && <p className="meta" style={{ marginTop: 12 }}>Last analysis {ago(run.created_at)}{run.actions_dropped ? ` · ${run.actions_dropped} proposed button${run.actions_dropped === 1 ? "" : "s"} refused by the guards` : ""}.</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>What it can see</h2>
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
        <ul className="audit" style={{ borderTop: "1px solid var(--line)" }}>
          <li className="info"><span className="mark">i</span><div className="body"><h4>What happens after a conversion</h4><p className="meta">No CRM is connected and no lead outcomes are imported, so it cannot tell a spam enquiry from a paying job.</p></div></li>
          <li className="info"><span className="mark">i</span><div className="body"><h4>Phone calls</h4><p className="meta">Google cannot record calls from ads in Serbia. Only taps on the phone number are visible, where a goal tracks them.</p></div></li>
          <li className="info"><span className="mark">i</span><div className="body"><h4>Performance Max placements</h4><p className="meta">Google reports where Performance Max showed ads, but never what any placement cost.</p></div></li>
        </ul>
      </div>

      <div className="card card-pad">
        <h2 style={{ marginBottom: 12 }}>Settings for this client</h2>
        <ClientSettings
          clientId={id} brandTerms={client.brand_terms ?? []} derived={derived} website={client.website}
          targetCpa={client.target_cpa ? Number(client.target_cpa) : null}
          monthlyBudget={client.monthly_budget ? Number(client.monthly_budget) : null}
          currency={client.currency}
        />
      </div>
    </div>
  );
}
