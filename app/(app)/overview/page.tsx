import Link from "next/link";
import { q } from "@/lib/db";
import { setupStatus } from "@/lib/setup";
import { clientsWithProperties } from "@/lib/binding";
import { overview } from "@/lib/report";
import { money, count, ago } from "@/lib/format";
import { SetupChecklist } from "@/components/SetupChecklist";
import { Delta } from "@/components/ui/bits";
import { CampaignTable, type CampaignRow } from "@/components/overview/CampaignTable";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;

export default async function Portfolio({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const setup = await setupStatus();

  if (!setup.ready) {
    return (
      <div className="stack rise">
        <header className="page-head"><div><h1>Nearly there.</h1><p className="lede">A few things need to be in place before Fortress HQ can reach your accounts.</p></div></header>
        <SetupChecklist checks={setup.checks} />
      </div>
    );
  }
  if (!setup.connected) {
    return (
      <div className="card card-pad rise" style={{ maxWidth: 620 }}>
        <span className="beacon">Not connected</span>
        <h1 style={{ margin: "16px 0 10px" }}>Sign in to Google.</h1>
        <p className="lede" style={{ marginBottom: 18 }}>One consent screen covers Google Ads, Analytics, Search Console and Tag Manager. Nothing is read or changed until you choose which accounts to import.</p>
        <Link href="/api/auth/google" className="btn btn-primary">Connect Google</Link>
      </div>
    );
  }

  const { days: raw } = await searchParams;
  const days = RANGES.includes(Number(raw) as never) ? Number(raw) : 30;
  const clients = await clientsWithProperties();

  if (!clients.length) {
    return (
      <div className="stack rise">
        <header className="page-head"><div><h1>All clients</h1><p className="lede">Signed in as {setup.email ?? "your Google account"}.</p></div></header>
        <div className="card card-pad"><div className="empty"><h3>No clients yet</h3><p style={{ maxWidth: 440, margin: "0 auto 16px" }}>A client is one Google Ads account plus the Analytics property, Search Console site and Tag Manager container that belong with it.</p><Link href="/clients" className="btn btn-primary">Add a client</Link></div></div>
      </div>
    );
  }

  const ids = clients.map((c) => c.id);
  const [views, urgent, syncs] = await Promise.all([
    Promise.all(clients.map((c) => overview(c.id, days).catch(() => null))),
    q<any>(`SELECT client_id, count(*) FILTER (WHERE severity = 'do_first')::int AS first, count(*)::int AS open
              FROM recommendations WHERE status = 'open' AND client_id = ANY($1) GROUP BY client_id`, [ids]),
    q<any>(`SELECT client_id, max(finished_at) AS at FROM job_runs WHERE job = 'sync' AND client_id = ANY($1) GROUP BY client_id`, [ids]),
  ]);

  const rows: CampaignRow[] = [];
  clients.forEach((c, i) => {
    for (const r of views[i]?.campaigns ?? []) rows.push({ ...r, client: c.name, clientId: c.id, currency: c.currency });
  });
  const currencies = new Set(clients.map((c) => c.currency));

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Portfolio · last {days} days</div>
          <h1>All clients</h1>
          <p className="meta">Signed in as {setup.email ?? "your Google account"}</p>
        </div>
        <div className="tabs">
          {RANGES.map((r) => <Link key={r} href={`/overview?days=${r}` as never} className={`tab${r === days ? " active" : ""}`}>{r} days</Link>)}
        </div>
      </header>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Client</th><th className="r">Spend</th><th className="r">Conversions</th><th className="r">Cost / conv.</th><th>To do</th><th>Synced</th></tr>
            </thead>
            <tbody>
              {clients.map((c, i) => {
                const v = views[i];
                const u = urgent.find((x) => x.client_id === c.id);
                const s = syncs.find((x) => x.client_id === c.id);
                const cpaMetric = v?.metrics.find((m) => m.key === "cpa");
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/clients/${c.id}` as never} className="cell-name" style={{ color: "var(--ink)" }}>{c.name}</Link>
                      <div className="cell-sub">{[c.ga4_property_id && "Analytics", c.gsc_site_url && "Search Console", c.gtm_container_id && "Tag Manager"].filter(Boolean).join(" · ") || "Google Ads only"}</div>
                    </td>
                    <td className="num r">{money(v?.totals.spend, c.currency)}<div><Delta change={v?.metrics.find((m) => m.key === "spend")?.change} /></div></td>
                    <td className="num r">{count(v?.totals.conversions, 1)}<div><Delta change={v?.metrics.find((m) => m.key === "conversions")?.change} /></div></td>
                    <td className="num r">{money(v?.cpa, c.currency)}<div><Delta change={cpaMetric?.change} lowerIsBetter /></div></td>
                    <td>
                      {u?.first ? <Link href={`/clients/${c.id}/insights` as never} className="pill pill-bad">{u.first} to do first</Link>
                        : u?.open ? <Link href={`/clients/${c.id}/insights` as never} className="pill pill-warn">{u.open} open</Link>
                        : <span className="pill">None open</span>}
                    </td>
                    <td className="meta">{ago(s?.at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <section>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2>Every campaign</h2>
          {currencies.size > 1 && <span className="meta">Figures are in each client&rsquo;s own currency.</span>}
        </div>
        <CampaignTable rows={rows} currency={null} showClient />
      </section>
    </div>
  );
}
