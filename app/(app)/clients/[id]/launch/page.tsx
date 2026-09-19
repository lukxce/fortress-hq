import Link from "next/link";
import { q, q1 } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { ago } from "@/lib/format";
import { LaunchStart } from "@/components/launch/LaunchStart";

export const dynamic = "force-dynamic";

const COUNTRY_BY_CURRENCY: Record<string, string> = { RSD: "RS", USD: "US", GBP: "GB", CHF: "CH", BAM: "BA", MKD: "MK", EUR: "DE" };

export default async function LaunchCampaign({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const [site, recent] = await Promise.all([
    q1<{ d: string | null }>(`SELECT COALESCE(c.website,
      (SELECT i.domain FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = c.id AND cp.provider = 'ads')) AS d
      FROM clients c WHERE c.id = $1`, [client.id]),
    q<any>(`SELECT id, name, status, updated_at FROM drafts WHERE client_id = $1 AND guided IS NOT NULL ORDER BY updated_at DESC LIMIT 5`, [client.id]),
  ]);
  const website = site?.d ? (/^https?:\/\//.test(site.d) ? site.d : `https://${site.d}`) : "";

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Google Ads</div>
          <h1>Launch a campaign</h1>
          <p className="lede">Answer three questions. Fortress reads the site and what already works in this account, asks Google what people search, writes the campaign and forecasts it — then shows you everything before anything is built.</p>
        </div>
        <Link href={`/clients/${client.id}/builder` as never} className="btn btn-quiet">Build it step by step instead</Link>
      </header>
      {!client.ads_customer_id ? (
        <div className="card card-pad"><div className="empty"><h3>Connect a Google Ads account first</h3><p>Campaigns are created in the project&rsquo;s own Google Ads account.</p><Link href={`/clients/${client.id}/settings` as never} className="btn btn-primary">Project settings</Link></div></div>
      ) : (
        <LaunchStart clientId={client.id} currency={client.currency} website={website} country={COUNTRY_BY_CURRENCY[client.currency ?? ""] ?? "RS"} />
      )}
      {recent.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Earlier proposals</h2></div>
          <ul className="audit">
            {recent.map((d) => (
              <li key={d.id}>
                <div className="body spread" style={{ flex: 1 }}>
                  <Link href={`/clients/${client.id}/launch/${d.id}` as never} className="cell-name">{d.name}</Link>
                  <span className="meta">{d.status === "launched" ? "Live" : d.status === "paused" ? "Built, waiting to go live" : "Proposal"} · {ago(d.updated_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
