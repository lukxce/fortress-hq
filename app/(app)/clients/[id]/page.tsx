import Link from "next/link";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { overview } from "@/lib/report";
import { lastSync } from "@/lib/engine/metrics";
import { money, count, ago, SEVERITY_LABEL, SEVERITY_PILL } from "@/lib/format";
import { StatCard, SpendBars, Delta } from "@/components/ui/bits";
import { CampaignTable } from "@/components/overview/CampaignTable";
import { JobButton } from "@/components/ui/JobButtons";

export const dynamic = "force-dynamic";

const RANGES = [7, 14, 30, 90] as const;

export default async function ClientOverview({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }>;
}) {
  const client = await pageClient(params);
  const { days: raw } = await searchParams;
  const days = RANGES.includes(Number(raw) as never) ? Number(raw) : 30;
  const cur = client.currency;

  const [o, sync, attention, beyond] = await Promise.all([
    overview(client.id, days),
    lastSync(client.id),
    q<any>(`SELECT id, title, severity, monthly_impact FROM recommendations
             WHERE client_id = $1 AND status = 'open'
             ORDER BY CASE severity WHEN 'do_first' THEN 0 WHEN 'worth_doing' THEN 1 ELSE 2 END,
                      monthly_impact DESC NULLS LAST
             LIMIT 3`, [client.id]),
    q<any>(`SELECT
       (SELECT COALESCE(SUM(sessions) FILTER (WHERE date > CURRENT_DATE - 29),0)::float FROM ga4_daily WHERE client_id = $1) AS sessions,
       (SELECT COALESCE(SUM(sessions) FILTER (WHERE date <= CURRENT_DATE - 29 AND date > CURRENT_DATE - 57),0)::float FROM ga4_daily WHERE client_id = $1) AS sessions_prev,
       (SELECT COALESCE(SUM(key_events) FILTER (WHERE date > CURRENT_DATE - 29),0)::float FROM ga4_daily WHERE client_id = $1) AS key_events,
       (SELECT COALESCE(SUM(key_events) FILTER (WHERE date <= CURRENT_DATE - 29 AND date > CURRENT_DATE - 57),0)::float FROM ga4_daily WHERE client_id = $1) AS key_events_prev,
       (SELECT COALESCE(SUM(clicks) FILTER (WHERE date > CURRENT_DATE - 31),0)::float FROM gsc_totals WHERE client_id = $1) AS organic,
       (SELECT COALESCE(SUM(clicks) FILTER (WHERE date <= CURRENT_DATE - 31 AND date > CURRENT_DATE - 59),0)::float FROM gsc_totals WHERE client_id = $1) AS organic_prev,
       (SELECT count(*)::int FROM gtm_tags WHERE client_id = $1 AND NOT paused) AS tags,
       (SELECT count(*)::int FROM findings WHERE client_id = $1 AND status = 'open' AND product = 'tag_manager' AND severity <> 'info') AS tag_problems`, [client.id]),
  ]);
  const b = beyond[0];
  const ch = (a: number, p: number) => (p > 0 ? a / p - 1 : null);
  const productCards = [
    client.ga4_property_id && { href: "analytics", label: "Analytics · 28 days", value: `${count(b.sessions)} sessions`, sub: `${count(b.key_events, 1)} key events`, change: ch(b.sessions, b.sessions_prev) },
    client.gsc_site_url && { href: "search-console", label: "Organic search · 28 days", value: `${count(b.organic)} clicks`, sub: "from Google without ads", change: ch(b.organic, b.organic_prev) },
    client.gtm_container_id && { href: "tag-manager", label: "Tag Manager", value: `${b.tags} live tags`, sub: b.tag_problems ? `${b.tag_problems} problem${b.tag_problems === 1 ? "" : "s"} found` : "no problems found", change: null },
  ].filter(Boolean) as { href: string; label: string; value: string; sub: string; change: number | null }[];
  const missing = [!client.ga4_property_id && "Analytics", !client.gsc_site_url && "Search Console", !client.gtm_container_id && "Tag Manager"].filter(Boolean) as string[];
  // One lone card in a three-column grid reads as a broken page, so a single
  // product is a line, and the other products' absence is said in the same breath.
  const productStrip = productCards.length >= 2 ? (
    <div className="grid-3" style={{ gridTemplateColumns: `repeat(${productCards.length}, minmax(0, 1fr))` }}>
      {productCards.map((x) => (
        <Link key={x.href} href={`/clients/${client.id}/${x.href}` as never} className="card stat" style={{ color: "inherit", textDecoration: "none" }}>
          <span className="label">{x.label}</span>
          <div className="stat-value" style={{ fontSize: 24 }}>{x.value}</div>
          <div className="stat-foot">{x.change != null && <Delta change={x.change} />}<span>{x.sub}</span></div>
        </Link>
      ))}
    </div>
  ) : (
    <p className="meta" style={{ margin: 0 }}>
      {productCards[0] && <><Link href={`/clients/${client.id}/${productCards[0].href}` as never}>{productCards[0].label.replace(/ · .*$/, "")}</Link>: {productCards[0].value}, {productCards[0].sub}. </>}
      {missing.length > 0 && <>{missing.join(missing.length === 2 ? " and " : ", ")} {missing.length === 1 ? "is" : "are"} not connected — <Link href={`/clients/${client.id}/settings` as never}>connect in project settings</Link>.</>}
    </p>
  );

  const t = o.totals;
  const noData = t.spend === 0 && o.previous.spend === 0;

  // The opening sentence is assembled from the same figures rendered below it,
  // so it can never disagree with them.
  const sentence = noData ? null : (
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
  );

  const pick = (k: string) => o.metrics.find((m) => m.key === k)!;

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Overview · Google Ads last {days} days</div>
          <h1>{client.name}</h1>
          <p className="meta">Synced {ago(sync?.finished_at)}</p>
        </div>
        <div className="row">
          <div className="tabs">
            {RANGES.map((r) => (
              <Link key={r} href={`/clients/${client.id}?days=${r}` as never} className={`tab${r === days ? " active" : ""}`}>{r} days</Link>
            ))}
          </div>
          <JobButton clientId={client.id} job="sync" label="Sync now" busyLabel="Pulling…" />
        </div>
      </header>

      {noData ? (
        <div className="card card-pad">
          <div className="empty">
            <h3>Nothing pulled yet</h3>
            <p style={{ maxWidth: 460, margin: "0 auto 16px" }}>
              Sync reads a year of daily performance, 90 days of search terms, keywords, ads, the hour-by-hour shape,
              and whatever Analytics, Search Console and Tag Manager are connected.
            </p>
            <JobButton clientId={client.id} job="sync" label="Sync now" busyLabel="Pulling…" primary />
          </div>
        </div>
      ) : (
        <>
          {sentence}

          {o.clicksWithoutConversions && (
            <div className="notice notice-bad">
              <div>
                <strong>{count(t.clicks)} clicks and no conversions.</strong> That combination almost always means tracking is
                broken, not that the ads failed. <Link href={`/clients/${client.id}/tracking` as never}>Check conversion tracking →</Link>
              </div>
            </div>
          )}

          <div className="stats">
            <StatCard metric={pick("spend")} currency={cur} versus={`vs previous ${days} days`} />
            <StatCard metric={pick("conversions")} currency={cur} versus={`vs previous ${days} days`} />
            <StatCard metric={pick("cpa")} currency={cur} versus={`vs previous ${days} days`} />
            <StatCard metric={pick("clicks")} currency={cur} versus={`vs previous ${days} days`} />
          </div>

          {productStrip}

          <div className="grid-2" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)" }}>
            <div className="card card-pad">
              <div className="spread" style={{ marginBottom: 14 }}>
                <h2>Spend per day</h2>
                <span className="meta">{days < 30 ? "last 30 days" : `last ${days} days`}</span>
              </div>
              <SpendBars series={o.series} currency={cur} />
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Needs attention</h2>
                <Link href={`/clients/${client.id}/insights` as never} className="btn btn-sm">All changes</Link>
              </div>
              {attention.length ? (
                <ul className="audit">
                  {attention.map((a) => (
                    <li key={a.id}>
                      <div className="body">
                        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                          <span className={`pill ${SEVERITY_PILL[a.severity as keyof typeof SEVERITY_PILL]}`}>{SEVERITY_LABEL[a.severity as keyof typeof SEVERITY_LABEL]}</span>
                          {Number(a.monthly_impact) > 0 && <span className="meta num">≈ {money(Number(a.monthly_impact), cur)}/mo</span>}
                        </div>
                        <Link href={`/clients/${client.id}/insights#rec-${a.id}` as never} style={{ color: "var(--ink)", fontWeight: 550 }}>{a.title}</Link>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="card-pad">
                  <p className="meta" style={{ marginBottom: 12 }}>No recommendations yet. The analysis reads every finding and writes what to change, with the exact steps.</p>
                  <JobButton clientId={client.id} job="analyse" label="Work out what to change" busyLabel="Thinking… (about a minute)" primary />
                </div>
              )}
            </div>
          </div>

          <section>
            <div className="spread" style={{ marginBottom: 12 }}>
              <h2>Campaigns</h2>
              <span className="meta">Health is judged against this account&rsquo;s own cost per conversion, and only when the difference is more than chance.</span>
            </div>
            <CampaignTable rows={o.campaigns} currency={cur} />
          </section>
        </>
      )}
    </div>
  );
}
