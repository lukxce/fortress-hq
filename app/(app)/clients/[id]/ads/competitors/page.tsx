import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { ago } from "@/lib/format";
import { serpConfigured } from "@/lib/competitors";
import { ProductHead } from "@/components/product/Product";
import { AddCompetitor, CompetitorActions, ObserveAd, PageActions } from "@/components/competitors/CompetitorTools";

export const dynamic = "force-dynamic";

const REGION: Record<string, string> = { RSD: "RS", USD: "US", GBP: "GB", EUR: "anywhere" };

export default async function Competitors({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const [comps, serp] = await Promise.all([
    q<any>(`SELECT * FROM competitors WHERE client_id = $1 AND status <> 'ignored' ORDER BY status = 'confirmed' DESC, brand_volume DESC NULLS LAST, name`, [client.id]),
    q<any>(`SELECT keyword, position, domain, title, description, seen_at FROM serp_ads WHERE client_id = $1 ORDER BY keyword, position`, [client.id]),
  ]);
  const confirmed = comps.filter((c) => c.status === "confirmed"), suggested = comps.filter((c) => c.status === "suggested");
  const region = REGION[client.currency ?? ""] ?? "anywhere";
  const transparency = (c: any) => `https://adstransparency.google.com/?region=${region}${c.domain ? `&domain=${encodeURIComponent(c.domain)}` : ""}`;
  const byKeyword = serp.reduce((m: Record<string, any[]>, s) => ({ ...m, [s.keyword]: [...(m[s.keyword] ?? []), s] }), {});

  return (
    <div className="stack rise">
      <ProductHead product="ads" title="Competitors" clientId={client.id} meta="Their sites, their searches, their ads">
        <PageActions clientId={client.id} serp={serpConfigured()} />
      </ProductHead>

      <div className="card card-pad">
        <h2 style={{ marginBottom: 4 }}>Add a competitor</h2>
        <p className="meta" style={{ marginBottom: 10 }}>Fortress reads their website (what they sell, prices, promises, what is missing), asks Keyword Planner what their site is found for where you advertise, and how many people search their name. New campaigns and ad text are then written to stand apart from them.</p>
        <AddCompetitor clientId={client.id} />
      </div>

      {suggested.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Suggested</h2><span className="meta">from your account and your searches</span></div>
          <ul className="audit">
            {suggested.map((c) => (
              <li key={c.id}>
                <div className="body spread" style={{ flex: 1 }}>
                  <div><div className="cell-name">{c.name}</div><div className="cell-sub">{c.domain ?? ""}{c.why ? ` · ${c.why}` : ""}</div></div>
                  <CompetitorActions clientId={client.id} id={c.id} status={c.status} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmed.map((c) => {
        const theirs = (c.keywords ?? []) as { text: string; monthly: number; ours: boolean }[];
        const gaps = theirs.filter((k) => !k.ours).slice(0, 20), shared = theirs.filter((k) => k.ours);
        return (
          <div key={c.id} className="card">
            <div className="card-head">
              <div>
                <h2>{c.name}</h2>
                <p className="meta" style={{ margin: 0 }}>
                  {c.domain ?? "no website"}{c.brand_volume != null ? ` · ${c.brand_volume.toLocaleString()} searches a month for their name` : ""}{c.analysed_at ? ` · read ${ago(c.analysed_at)}` : ""}
                </p>
              </div>
              <CompetitorActions clientId={client.id} id={c.id} status={c.status} />
            </div>
            {c.error && <div className="card-pad" style={{ paddingBottom: 0 }}><p className="meta bad-text" style={{ margin: 0 }}>{c.error}</p></div>}
            <div className="grid-2" style={{ padding: 18 }}>
              <div className="stack-sm">
                <div className="label">What they sell and promise</div>
                {c.site ? (
                  <>
                    <p style={{ margin: 0 }}>{c.site.business}</p>
                    {c.site.offers?.length > 0 && <div className="chips">{c.site.offers.slice(0, 10).map((o: any) => <span key={o.name} className="chip">{o.name}{o.price ? ` · ${o.price}` : ""}</span>)}</div>}
                    {c.site.claims?.length > 0 && <p className="meta" style={{ margin: 0 }}><strong>They claim:</strong> {c.site.claims.slice(0, 6).join(" · ")}</p>}
                    {c.site.weaknesses_or_gaps?.length > 0 && <p className="meta" style={{ margin: 0 }}><strong>Missing on their site:</strong> {c.site.weaknesses_or_gaps.slice(0, 5).join(" · ")}</p>}
                  </>
                ) : <p className="meta" style={{ margin: 0 }}>{c.domain ? "Not read yet." : "Add their website to read it."}</p>}
              </div>
              <div className="stack-sm">
                <div className="label">Searches their site is found for</div>
                {theirs.length ? (
                  <>
                    <p className="meta" style={{ margin: 0 }}>{shared.length} you also bid on · {gaps.length ? `${theirs.length - shared.length} you do not` : "no gaps"}</p>
                    <div className="chips">{gaps.map((k) => <span key={k.text} className="chip">{k.text}<span className="badge">{k.monthly}/mo</span></span>)}</div>
                  </>
                ) : <p className="meta" style={{ margin: 0 }}>{c.domain ? "Keyword Planner returned nothing for their site here." : "Needs their website."}</p>}
              </div>
            </div>
            <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}>
              <div className="spread" style={{ marginBottom: 8 }}>
                <div className="label">Their ads</div>
                <a href={transparency(c)} target="_blank" rel="noreferrer" className="btn btn-sm">Open in Google&rsquo;s Ads Transparency Center ↗</a>
              </div>
              {(c.observed_ads ?? []).length > 0 && (
                <ul className="audit" style={{ marginBottom: 10 }}>
                  {c.observed_ads.slice(-5).reverse().map((a: any, i: number) => <li key={i} className="info"><span className="mark">”</span><div className="body"><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{a.text}</p><p className="meta" style={{ margin: 0 }}>saved {ago(a.at)}</p></div></li>)}
                </ul>
              )}
              {serp.filter((s) => s.domain === c.domain).length > 0 && (
                <ul className="audit" style={{ marginBottom: 10 }}>
                  {serp.filter((s) => s.domain === c.domain).slice(0, 4).map((s, i) => <li key={i} className="info"><span className="mark">↗</span><div className="body"><h4>{s.title}</h4><p className="meta" style={{ margin: 0 }}>{s.description} · on &ldquo;{s.keyword}&rdquo;</p></div></li>)}
                </ul>
              )}
              <ObserveAd clientId={client.id} id={c.id} />
            </div>
          </div>
        );
      })}

      {!confirmed.length && !suggested.length && (
        <div className="card card-pad"><div className="empty"><h3>No competitors yet</h3><p>Add the ones you know, or let Fortress suggest them from your account.</p></div></div>
      )}

      <div className="card">
        <div className="card-head"><h2>Who advertises on your searches</h2><span className="meta">{serp.length ? `seen ${ago(serp[0].seen_at)}` : ""}</span></div>
        {serp.length ? (
          <ul className="audit">
            {Object.entries(byKeyword).map(([kw, ads]) => (
              <li key={kw}>
                <div className="body" style={{ flex: 1 }}>
                  <h4>&ldquo;{kw}&rdquo;</h4>
                  {(ads as any[]).map((s, i) => <p key={i} className="meta" style={{ margin: "2px 0" }}><strong>{s.domain}</strong> — {s.title}</p>)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card-pad"><p className="meta" style={{ margin: 0 }}>
            {serpConfigured()
              ? "Press “See who advertises on my searches”: it checks your top searches, in your places, on a phone, and lists every ad shown."
              : "Seeing competitors' live ads automatically needs a search-results data provider — Google offers no API for other advertisers' ads, and its Transparency Center may not be scraped. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel (DataForSEO: pay per search, a fraction of a cent each) to switch it on. Until then, open a competitor in the Transparency Center and paste what you see."}
          </p></div>
        )}
      </div>
    </div>
  );
}
