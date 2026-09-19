import Link from "next/link";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { overview } from "@/lib/report";
import { lastSync } from "@/lib/engine/metrics";
import { lastRun, brainConfigured } from "@/lib/brain/recommend";
import { money, count, ago, dateShort, AREA_LABEL, SEVERITY_LABEL, PRODUCT_LABEL } from "@/lib/format";
import { SpendBars, Delta, fmtMetric } from "@/components/ui/bits";
import { Sparkline } from "@/components/ui/Sparkline";
import { CampaignTable } from "@/components/overview/CampaignTable";
import { SetupCard } from "@/components/overview/SetupCard";
import { FollowUpDone } from "@/components/overview/FollowUpDone";

export const dynamic = "force-dynamic";

const RANGES = [7, 14, 30, 90] as const;
const BUCKETS = 7;

export default async function ClientOverview({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }>;
}) {
  const client = await pageClient(params);
  const { days: raw } = await searchParams;
  const days = RANGES.includes(Number(raw) as never) ? Number(raw) : 30;
  const cur = client.currency;

  const [o, sync, run, open, beyond, daily, due] = await Promise.all([
    overview(client.id, days),
    lastSync(client.id),
    lastRun(client.id),
    q<any>(`SELECT id, title, severity, area, product, monthly_impact, do_by FROM recommendations
             WHERE client_id = $1 AND status = 'open'
             ORDER BY CASE severity WHEN 'do_first' THEN 0 WHEN 'worth_doing' THEN 1 ELSE 2 END,
                      monthly_impact DESC NULLS LAST, id`, [client.id]),
    q<any>(`SELECT
       (SELECT COALESCE(SUM(sessions) FILTER (WHERE date > CURRENT_DATE - 29),0)::float FROM ga4_daily WHERE client_id = $1) AS sessions,
       (SELECT COALESCE(SUM(sessions) FILTER (WHERE date <= CURRENT_DATE - 29 AND date > CURRENT_DATE - 57),0)::float FROM ga4_daily WHERE client_id = $1) AS sessions_prev,
       (SELECT COALESCE(SUM(clicks) FILTER (WHERE date > CURRENT_DATE - 31),0)::float FROM gsc_totals WHERE client_id = $1) AS organic,
       (SELECT COALESCE(SUM(clicks) FILTER (WHERE date <= CURRENT_DATE - 31 AND date > CURRENT_DATE - 59),0)::float FROM gsc_totals WHERE client_id = $1) AS organic_prev,
       (SELECT count(*)::int FROM gtm_tags WHERE client_id = $1 AND NOT paused) AS tags,
       (SELECT count(*)::int FROM findings WHERE client_id = $1 AND status = 'open' AND severity <> 'info' AND last_seen > now() - interval '14 days'
           AND (product = 'tag_manager' OR kind ~ '^(conversion_|tracking_|site_)')) AS tracking_problems,
       (SELECT min(score)::int FROM page_speed WHERE client_id = $1 AND strategy = 'mobile' AND error IS NULL) AS speed`, [client.id]),
    q<any>(`SELECT date::text AS date, COALESCE(SUM(cost_micros),0)/1e6 AS spend, COALESCE(SUM(clicks),0)::float AS clicks,
                   COALESCE(SUM(conversions),0)::float AS conv
              FROM metrics_daily WHERE client_id = $1 AND entity_type = 'campaign'
               AND date >= CURRENT_DATE - $2::int AND date < CURRENT_DATE
             GROUP BY date`, [client.id, days * 2]),
    q<any>(`SELECT id, title, detail, href, due_on FROM follow_ups WHERE client_id = $1 AND status = 'open' AND due_on <= CURRENT_DATE + 2 ORDER BY due_on`, [client.id]),
  ]);

  const t = o.totals;
  const noData = t.spend === 0 && o.previous.spend === 0;

  // Seven buckets per window, so a 7-day and a 90-day view draw the same shape of line.
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const bucketed = (offsetDays: number) => {
    const out = Array.from({ length: BUCKETS }, () => ({ spend: 0, clicks: 0, conv: 0 }));
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - (offsetDays + days - i) * 864e5).toISOString().slice(0, 10);
      const row = byDate.get(d);
      if (!row) continue;
      const b = out[Math.min(BUCKETS - 1, Math.floor((i / days) * BUCKETS))];
      b.spend += Number(row.spend); b.clicks += row.clicks; b.conv += row.conv;
    }
    return out;
  };
  const now = bucketed(0), before = bucketed(days);
  const series = {
    spend: [now.map((b) => b.spend), before.map((b) => b.spend)],
    conversions: [now.map((b) => b.conv), before.map((b) => b.conv)],
    cpa: [now.map((b) => (b.conv ? b.spend / b.conv : null)), before.map((b) => (b.conv ? b.spend / b.conv : null))],
    clicks: [now.map((b) => b.clicks), before.map((b) => b.clicks)],
  } as Record<string, (number | null)[][]>;

  const pick = (k: string) => o.metrics.find((m) => m.key === k)!;
  const b = beyond[0];
  const ch = (a: number, p: number) => (p > 0 ? a / p - 1 : null);
  const top = open.slice(0, 3);
  const byArea = Object.entries(open.reduce((m: Record<string, number>, r: any) => ({ ...m, [r.area]: (m[r.area] ?? 0) + 1 }), {}))
    .sort((a, b) => (b[1] as number) - (a[1] as number));

  const header = (
    <header className="page-head">
      <div>
        <div className="label eyebrow">Overview</div>
        <h1>{client.name}</h1>
        <p className="meta">Google Ads, last {days} days · synced {ago(sync?.finished_at)}</p>
      </div>
      <div className="tabs">
        {RANGES.map((r) => (
          <Link key={r} href={`/clients/${client.id}?days=${r}` as never} className={`tab${r === days ? " active" : ""}`}>{r} days</Link>
        ))}
      </div>
    </header>
  );

  if (noData) {
    const [runRow] = await q<any>(`SELECT detail FROM job_runs WHERE job = 'sync' AND client_id = $1 ORDER BY finished_at DESC NULLS LAST LIMIT 1`, [client.id]);
    return (
      <div className="stack rise">
        {header}
        <SetupCard
          clientId={client.id}
          bound={[
            { label: "Google Ads", connected: Boolean(client.ads_customer_id) },
            { label: "Analytics", connected: Boolean(client.ga4_property_id) },
            { label: "Search Console", connected: Boolean(client.gsc_site_url) },
            { label: "Tag Manager", connected: Boolean(client.gtm_container_id) },
          ]}
          syncSteps={Array.isArray(runRow?.detail) ? runRow.detail : null}
          synced={Boolean(sync)} analysed={Boolean(run)} canAnalyse={brainConfigured()}
        />
        {client.ads_customer_id && !o.campaigns.length && (
          <div className="card card-pad spread">
            <div>
              <h2 style={{ marginBottom: 4 }}>No campaigns in this account yet</h2>
              <p className="meta" style={{ margin: 0 }}>Answer three questions and Fortress builds the whole campaign, forecasts it and checks it with Google before anything spends.</p>
            </div>
            <Link href={`/clients/${client.id}/launch` as never} className="btn btn-primary">Launch a campaign</Link>
          </div>
        )}
        <div className="stats ghost" aria-hidden>
          {["Spend", "Conversions", "Cost per conversion", "Clicks"].map((l) => (
            <div key={l} className="card stat"><span className="label">{l}</span><div className="stat-value">—</div><div className="stat-foot">vs previous {days} days</div></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="stack rise">
      {header}

      {/* The sentence is assembled from the same figures rendered below it, so it can never disagree with them. */}
      <p className="sentence">
        You spent <span className="num">{money(t.spend, cur)}</span> and got{" "}
        <span className="num">{count(t.conversions, 0)}</span> conversion{Math.round(t.conversions) === 1 ? "" : "s"}
        {o.cpa != null && <> — <span className="num">{money(o.cpa, cur)}</span> each</>}.{" "}
        {o.cpaChange != null && Math.abs(o.cpaChange) >= 0.02 && (
          <span className={o.cpaChange > 0 ? "mark" : undefined}>
            That&rsquo;s {Math.abs(o.cpaChange * 100).toFixed(0)}% {o.cpaChange > 0 ? "more expensive" : "cheaper"} than the {days} days before.
          </span>
        )}
      </p>

      {o.clicksWithoutConversions && (
        <div className="notice notice-bad">
          <div>
            <strong>{count(t.clicks)} clicks and no conversions.</strong> That almost always means tracking is broken, not that the ads failed.{" "}
            <Link href={`/clients/${client.id}/tracking` as never}>Check conversions →</Link>
          </div>
        </div>
      )}

      <div className="card dofirst">
        <div className="card-head">
          <h2>What to do</h2>
          {open.length > 0 && <Link href={`/clients/${client.id}/insights` as never} className="btn btn-sm">All {open.length} →</Link>}
        </div>
        {due.map((f: any) => (
          <div key={`f${f.id}`} className="row-item">
            <span className="dot warn" title="Follow-up" />
            <span className="pill pill-outline">Follow-up</span>
            <span className="title">{f.href ? <Link href={f.href as never} style={{ color: "var(--ink)" }}>{f.title}</Link> : f.title}<span className="cell-sub" style={{ display: "block", fontWeight: 400 }}>{f.detail}</span></span>
            <span className="right">{new Date(f.due_on) <= new Date() ? "due now" : `due ${dateShort(f.due_on)}`} <FollowUpDone clientId={client.id} id={f.id} /></span>
          </div>
        ))}
        {top.length || due.length ? top.map((r: any) => (
          <Link key={r.id} href={`/clients/${client.id}/insights#rec-${r.id}` as never} className="row-item">
            <span className={`dot ${r.severity}`} title={SEVERITY_LABEL[r.severity as keyof typeof SEVERITY_LABEL]} />
            <span className="pill pill-outline">{r.product && r.product !== "ads" ? PRODUCT_LABEL[r.product] : AREA_LABEL[r.area] ?? r.area}</span>
            <span className="title">{r.title}</span>
            <span className="right">
              {Number(r.monthly_impact) > 0 ? `≈ ${money(Number(r.monthly_impact), cur)}/mo` : r.do_by ? `by ${dateShort(r.do_by)}` : ""}
            </span>
          </Link>
        )) : (
          <div className="card-pad spread">
            <p className="meta" style={{ margin: 0 }}>{run ? "Nothing open. Everything from the last analysis is done or dismissed." : "Not analysed yet. The analysis measures everything first, then writes what to change with the exact steps."}</p>
            {brainConfigured()
              ? <Link href={`/clients/${client.id}/insights` as never} className="btn btn-primary btn-sm">{run ? "Analyse again" : "Work out what to change"}</Link>
              : <span className="meta">Analysis is not set up yet.</span>}
          </div>
        )}
      </div>

      <div>
        <div className="stats">
          {(["spend", "conversions", "cpa", "clicks"] as const).map((k) => {
            const m = pick(k);
            return (
              <div key={k} className="card stat">
                <span className="label">{m.label}</span>
                <div className="stat-value">{fmtMetric(m, m.current, cur)}</div>
                <div className="stat-foot"><Delta change={m.change} lowerIsBetter={m.lowerIsBetter} /><span>vs previous {days} days</span></div>
                <Sparkline current={series[k][0]} previous={series[k][1]} lowerIsBetter={m.lowerIsBetter} />
              </div>
            );
          })}
        </div>
        <p className="meta" style={{ margin: "8px 2px 0" }}>Solid line: this {days} days · dashed: the {days} before.</p>
      </div>

      <div className="sources card card-pad" style={{ padding: "12px 18px" }}>
        {client.ga4_property_id
          ? <Link href={`/clients/${client.id}/analytics` as never}><span className="dot ok" />Analytics <b>{count(b.sessions)}</b> sessions <Delta change={ch(b.sessions, b.sessions_prev)} /></Link>
          : <span className="src"><span className="dot hollow" />Analytics not connected · <Link href={`/clients/${client.id}/settings` as never}>Connect →</Link></span>}
        {client.gsc_site_url
          ? <Link href={`/clients/${client.id}/search-console` as never}><span className="dot ok" />Organic <b>{count(b.organic)}</b> clicks <Delta change={ch(b.organic, b.organic_prev)} /></Link>
          : <span className="src"><span className="dot hollow" />Search Console not connected · <Link href={`/clients/${client.id}/settings` as never}>Connect →</Link></span>}
        {client.gtm_container_id
          ? <Link href={`/clients/${client.id}/tag-manager` as never}><span className={`dot ${b.tracking_problems ? "bad" : "ok"}`} />Tags <b>{b.tags}</b> live{b.tracking_problems ? `, ${b.tracking_problems} problem${b.tracking_problems === 1 ? "" : "s"}` : ""}</Link>
          : <span className="src"><span className="dot hollow" />Tag Manager not connected · <Link href={`/clients/${client.id}/settings` as never}>Connect →</Link></span>}
        <Link href={`/clients/${client.id}/website` as never}>
          <span className={`dot ${b.speed == null ? "hollow" : b.speed < 50 ? "bad" : b.speed < 90 ? "warn" : "ok"}`} />
          Page speed {b.speed == null ? <span className="meta">not checked</span> : <><b>{b.speed}</b> lowest mobile score</>}
        </Link>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        <div className="card card-pad">
          <div className="spread" style={{ marginBottom: 14 }}>
            <h2>Spend per day</h2>
            <span className="meta">{days < 30 ? "last 30 days" : `last ${days} days`} · grey = no conversions</span>
          </div>
          <SpendBars series={o.series} currency={cur} legend={false} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Open by area</h2><span className="meta">{open.length} open</span></div>
          {byArea.length ? (
            <div className="area-counts">
              {byArea.map(([area, n]) => (
                <Link key={area} href={`/clients/${client.id}/insights?area=${area}` as never}>
                  <span>{AREA_LABEL[area] ?? area}</span><span className="badge">{n as number}</span>
                </Link>
              ))}
            </div>
          ) : <div className="card-pad"><p className="meta" style={{ margin: 0 }}>Nothing open.</p></div>}
        </div>
      </div>

      <section>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2>Campaigns</h2>
          {o.campaigns.length > 8 && <Link href={`/clients/${client.id}/ads` as never} className="btn btn-sm">All {o.campaigns.length} campaigns →</Link>}
        </div>
        <CampaignTable rows={[...o.campaigns].sort((a, b) => b.spend - a.spend).slice(0, 8)} currency={cur} />
      </section>
    </div>
  );
}
