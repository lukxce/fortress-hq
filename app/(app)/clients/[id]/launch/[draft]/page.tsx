import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { readDraft, problems } from "@/lib/builder/draft";
import type { Proposal } from "@/lib/builder/guided";
import { LaunchActions } from "@/components/launch/LaunchReview";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { converting: "already converts", search_console: "Search Console", planner: "Keyword Planner", site: "on the site", suggested: "suggested", manual: "added" };
const MATCH: Record<string, string> = { EXACT: "exact", PHRASE: "phrase", BROAD: "broad" };

export default async function LaunchReview({ params }: { params: Promise<{ id: string; draft: string }> }) {
  const client = await pageClient(params.then((p) => ({ id: p.id })));
  const { draft } = await params;
  const [row] = await q<any>(`SELECT * FROM drafts WHERE id = $1 AND client_id = $2`, [Number(draft), client.id]);
  if (!row) notFound();
  const d = readDraft(row.state);
  const p = row.proposal as Proposal | null;
  const cur = client.currency;
  const money = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString()}${cur ? ` ${cur}` : ""}`);
  const blocking = problems(d).map((x) => x.message);
  const volumes = new Map((await q<any>(`SELECT keyword, avg_monthly::int AS v FROM keyword_ideas WHERE client_id = $1
                                          UNION ALL SELECT keyword, avg_monthly::int FROM keyword_volumes WHERE client_id = $1`, [client.id])).map((r) => [r.keyword, r.v]));
  const f = p?.forecast;
  const edit = (step: number) => `/clients/${client.id}/builder/${row.id}?step=${step}`;

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow"><Link href={`/clients/${client.id}/launch` as never}>Launch a campaign</Link></div>
          <h1>{d.name}</h1>
          <p className="meta">{row.status === "launched" ? "Live" : row.status === "paused" ? "Built in Google Ads, paused — waiting for Go live" : "Proposal — nothing created yet"}</p>
        </div>
        {row.status !== "launched" && row.status !== "paused" && <Link href={edit(1) as never} className="btn">Change anything</Link>}
      </header>

      {p && <p className="sentence" style={{ fontSize: 21 }}>{p.summary}</p>}

      {f && (
        <div className="card">
          <div className="card-head"><h2>What it should buy in a month</h2><span className="meta">{f.source === "keyword_planner" ? "Keyword Planner forecast" : "No forecast available"}</span></div>
          <div className="stats" style={{ padding: 16 }}>
            <div className="card stat"><span className="label">Searches</span><div className="stat-value">{p?.searchesPerMonth?.toLocaleString() ?? "—"}</div><div className="stat-foot"><span>a month for these keywords here</span></div></div>
            <div className="card stat"><span className="label">Clicks</span><div className="stat-value">{f.clicksPerMonth != null ? Math.round(f.clicksPerMonth).toLocaleString() : "—"}</div><div className="stat-foot"><span>at about {money(f.avgCpc)} each</span></div></div>
            <div className="card stat"><span className="label">{client.goal_type === "roas" ? "Sales" : "Leads"}</span><div className="stat-value">{f.leadsLow != null ? `${f.leadsLow}–${f.leadsHigh}` : "—"}</div><div className="stat-foot"><span>{f.conversionRate != null ? `at ${(f.conversionRate * 100).toFixed(1)}% of clicks — ${f.conversionRateSource}` : "conversion rate not known yet"}</span></div></div>
            <div className="card stat"><span className="label">Per lead</span><div className="stat-value">{money(f.costPerLead)}</div><div className="stat-foot"><span>{f.targetCpa ? `target ${money(f.targetCpa)}` : "no target set"}</span></div></div>
          </div>
          <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}><p style={{ margin: 0 }}>{f.verdict}</p>
            <p className="meta" style={{ margin: "6px 0 0" }}>Forecasts are Google&rsquo;s estimate and ranges, not promises; the first two weeks set the real numbers.</p></div>
        </div>
      )}

      {p?.checks && (
        <div className="card">
          <div className="card-head"><h2>Before it goes live</h2><span className="meta">{p.checks.filter((c) => c.ok === false).length ? `${p.checks.filter((c) => c.ok === false).length} to fix` : "all clear"}</span></div>
          <ul className="audit">
            {p.checks.map((c) => (
              <li key={c.key} className={c.ok === true ? "ok" : c.ok === false ? "bad" : "info"}>
                <span className="mark">{c.ok === true ? "✓" : c.ok === false ? "!" : "?"}</span>
                <div className="body" style={{ flex: 1 }}>
                  <h4>{c.title}</h4>
                  <p className="meta" style={{ margin: 0 }}>{c.detail}</p>
                </div>
                {c.fix && c.ok !== true && <Link href={c.fix.href as never} className="btn btn-sm" style={{ alignSelf: "center" }}>{c.fix.label}</Link>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card card-pad">
        <div className="spread" style={{ marginBottom: 6 }}><h2>How it bids</h2>{row.status === "draft" && <Link href={edit(6) as never} className="btn btn-sm">Change</Link>}</div>
        <p style={{ margin: 0 }}><strong>{d.bidding === "MAXIMIZE_CLICKS" ? `Maximise clicks${d.maxCpc ? `, at most ${money(d.maxCpc)} a click` : ""}` : "Maximise conversions"}</strong> · {money(d.dailyBudget)} a day · {d.presence === "PRESENCE" ? "people in these places" : "people in or interested in these places"}</p>
        {p?.bidding && <p className="meta" style={{ margin: "6px 0 0" }}>{p.bidding.why}</p>}
      </div>

      {d.groups.map((g, i) => (
        <div key={i} className="card">
          <div className="card-head">
            <div><h2>{g.name}</h2><p className="meta" style={{ margin: 0 }}>Lands on {g.finalUrl || "—"}</p></div>
            {row.status === "draft" && <Link href={edit(4) as never} className="btn btn-sm">Change</Link>}
          </div>
          <div className="grid-2" style={{ padding: 16 }}>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Shows for {g.keywords.length} searches</div>
              <div className="chips">
                {g.keywords.map((k) => (
                  <span key={k.text} className="chip" title={`${MATCH[k.match]} match · ${SOURCE[k.source] ?? k.source}`}>
                    {k.text}{volumes.get(k.text.toLowerCase()) ? <span className="badge">{volumes.get(k.text.toLowerCase())}/mo</span> : null}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>The ad, as Google may show it</div>
              <div className="serp">
                <div className="sponsored">Sponsored</div>
                <div className="site"><div className="fav" /><div><div className="dom">{(() => { try { return new URL(g.finalUrl).host.replace(/^www\./, ""); } catch { return ""; } })()}</div><div className="url">{g.finalUrl}{g.path1 ? ` › ${g.path1}` : ""}{g.path2 ? ` › ${g.path2}` : ""}</div></div></div>
                <div className="title">{g.headlines.slice(0, 3).join(" | ")}</div>
                <div className="desc">{g.descriptions.slice(0, 2).join(" ")}</div>
              </div>
              <p className="meta" style={{ marginTop: 6 }}>{g.headlines.length} headlines and {g.descriptions.length} descriptions; Google mixes them.</p>
            </div>
          </div>
        </div>
      ))}

      <details className="card card-pad">
        <summary style={{ cursor: "pointer" }}><strong>{d.negatives.length} searches it will not show for</strong> <span className="meta">— jobs, free, how-to and words that fail on your other accounts</span></summary>
        <div className="chips" style={{ marginTop: 10 }}>{d.negatives.map((n) => <span key={n} className="chip">{n}</span>)}</div>
      </details>

      <LaunchActions clientId={client.id} draftId={row.id} status={row.status} name={d.name} daily={d.dailyBudget} currency={cur} blocking={blocking} />

      {p?.built && (
        <details className="meta">
          <summary style={{ cursor: "pointer" }}>How this was put together</summary>
          <ul>{p.built.map((b) => <li key={b}>{b}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
