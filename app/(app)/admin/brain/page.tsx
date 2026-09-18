import Link from "next/link";
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/user";
import { MODEL, KNOWLEDGE, brainConfigured } from "@/lib/brain/recommend";
import { portfolioOutcomes, portfolioFeedback } from "@/lib/brain/learning";
import { OPERATING_CONTEXT } from "@/lib/brain/knowledge/context";
import { SMALL_ACCOUNTS } from "@/lib/brain/knowledge/smallaccount";
import { MECHANICS, REPORTING } from "@/lib/brain/knowledge/mechanics";
import { LEADGEN } from "@/lib/brain/knowledge/leadgen";
import { PMAX } from "@/lib/brain/knowledge/pmax";
import { AI_MAX } from "@/lib/brain/knowledge/aimax";
import { BENCHMARKS } from "@/lib/brain/knowledge/benchmarks";
import { DIAGNOSTICS } from "@/lib/brain/knowledge/diagnostics";
import { ago, AREA_LABEL } from "@/lib/format";
import { Lessons } from "@/components/admin/Lessons";
import { LearnNow, ProposedLessons } from "@/components/admin/Learning";
import { getSetting } from "@/lib/learning/settings";
import { INDUSTRIES } from "@/lib/learning/industry";
import { PRODUCT_LABEL } from "@/components/product/Product";

export const dynamic = "force-dynamic";

export default async function AdminBrain() {
  await requireAdmin();
  const [lessons, outcomes, feedback, runs, spend, proposed, patterns, changes, pool, autoApply, lastRun] = await Promise.all([
    q<any>(`SELECT l.id, l.text, l.product, l.active, l.created_at, COALESCE(u.email, CASE WHEN l.source = 'distilled' THEN 'drafted by the brain' END) AS author
              FROM brain_lessons l LEFT JOIN users u ON u.id = l.created_by
             WHERE l.status IN ('active', 'off') ORDER BY l.active DESC, l.id DESC`),
    portfolioOutcomes(),
    portfolioFeedback(),
    q<any>(`SELECT r.id, r.created_at, r.model, (r.request IS NOT NULL) AS has_transcript, r.cost_usd, r.findings_count, r.insights_count, r.skipped_count, r.actions_dropped, r.error,
                   c.name AS project, u.email AS owner
              FROM analysis_runs r JOIN clients c ON c.id = r.client_id LEFT JOIN users u ON u.id = c.owner_id
             ORDER BY r.created_at DESC LIMIT 25`),
    q<any>(`SELECT COALESCE(SUM(cost_usd) FILTER (WHERE created_at > now() - interval '30 days'),0)::float AS month,
                   count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS runs,
                   count(DISTINCT client_id)::int AS projects
              FROM analysis_runs`),
    q<any>(`SELECT id, text, product, challenges_knowledge, evidence, created_at FROM brain_lessons WHERE status = 'proposed' ORDER BY id DESC`),
    q<any>(`SELECT kind, industry, key, stats, projects, significant FROM portfolio_patterns ORDER BY projects DESC, key`),
    q<any>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'judged')::int AS judged,
                   count(*) FILTER (WHERE status = 'waiting')::int AS waiting,
                   (SELECT count(*)::int FROM change_events) AS events FROM change_outcomes`),
    q<any>(`SELECT c.id, c.name, c.industry, c.industry_source FROM clients c WHERE NOT c.archived ORDER BY c.name`),
    getSetting<boolean>("auto_apply_lessons", false),
    getSetting<any>("last_learning_run", null),
  ]);
  const effects = patterns.filter((p) => p.kind === "change_effect");
  const waste = patterns.filter((p) => p.kind === "waste_theme");
  const converting = patterns.filter((p) => p.kind === "converting_theme");
  const benchmarks = patterns.filter((p) => p.kind === "benchmark");
  const prevalence = patterns.filter((p) => p.kind === "finding_prevalence");
  const scopeLabel = (i: string) => (i === "all" ? "All accounts" : (INDUSTRIES as Record<string, string>)[i] ?? i);
  const pctx = (v: unknown) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");

  const modules: [string, string][] = [
    ["Operating context", OPERATING_CONTEXT], ["Small accounts", SMALL_ACCOUNTS], ["Mechanics", MECHANICS], ["Reporting", REPORTING],
    ["Lead generation", LEADGEN], ["Performance Max", PMAX], ["AI Max", AI_MAX], ["Benchmarks", BENCHMARKS], ["Diagnostics", DIAGNOSTICS],
  ];
  const tally = outcomes.reduce((t, o) => ({ c: t.c + o.confirmed, r: t.r + o.refuted, i: t.i + o.inconclusive }), { c: 0, r: 0, i: 0 });

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Admin</div>
          <h1>Brain</h1>
          <p className="meta">One brain for the whole installation. It learns from every project and every user; only admins see or teach it.</p>
        </div>
      </header>

      <div className="stats">
        <div className="card stat"><span className="label">Model</span><div className="stat-value" style={{ fontSize: 17, fontFamily: "var(--font-mono)" }}>{MODEL}</div><div className="stat-foot">{brainConfigured() ? "API key set" : "ANTHROPIC_API_KEY missing"}</div></div>
        <div className="card stat"><span className="label">Analyses · 30 days</span><div className="stat-value">{spend[0].runs}</div><div className="stat-foot">${spend[0].month.toFixed(2)} this month · {spend[0].projects} project{spend[0].projects === 1 ? "" : "s"} analysed so far</div></div>
        <div className="card stat"><span className="label">Predictions judged</span><div className="stat-value">{tally.c + tally.r + tally.i}</div><div className="stat-foot">{tally.c} confirmed · {tally.r} refuted · {tally.i} inconclusive</div></div>
        <div className="card stat"><span className="label">Lessons in force</span><div className="stat-value">{lessons.filter((l) => l.active).length}</div><div className="stat-foot">{lessons.length - lessons.filter((l) => l.active).length} turned off</div></div>
      </div>

      <div className="card card-pad">
        <div className="spread" style={{ marginBottom: 6 }}>
          <h2>What it learns from</h2>
          <LearnNow autoApply={autoApply} />
        </div>
        <p className="meta" style={{ marginBottom: 12 }}>
          Every project&rsquo;s data, for every user: each change anyone makes in a Google Ads account and what followed it, search words that waste or convert
          across accounts, the portfolio&rsquo;s own benchmarks for Ads, Analytics and Search Console, how common each problem is, what happened to its own
          recommendations — and experiments. Measured patterns reach every analysis automatically. Lessons it drafts from them wait below for approval
          {autoApply ? " — except that you have let them apply themselves" : ""}. It learns again every Monday.
        </p>
        <div className="stats">
          <div className="card stat"><span className="label">Projects in the pool</span><div className="stat-value">{pool.length}</div><div className="stat-foot">{pool.filter((p) => p.industry).length} with an industry</div></div>
          <div className="card stat"><span className="label">Account changes seen</span><div className="stat-value">{changes[0].events}</div><div className="stat-foot">{changes[0].total} grouped changes</div></div>
          <div className="card stat"><span className="label">Changes judged</span><div className="stat-value">{changes[0].judged}</div><div className="stat-foot">{changes[0].waiting} waiting for their after-window</div></div>
          <div className="card stat"><span className="label">Patterns</span><div className="stat-value">{patterns.length}</div><div className="stat-foot">{lastRun ? `learned ${ago(lastRun.at)}` : "not learned yet"}</div></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Lessons it drafted</h2><span className="meta">Evidence is copied from the measured patterns, never written by the model</span></div>
        <ProposedLessons lessons={proposed} />
      </div>

      <div className="card">
        <div className="card-head"><h2>What changes were followed by</h2><span className="meta">Every account, every change, whoever made it · observational</span></div>
        {effects.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Change</th><th>Scope</th><th className="r">Better</th><th className="r">Worse</th><th className="r">No clear change</th><th className="r">Moved with account</th><th className="r">Too little data</th><th className="r">Median CPA change</th><th className="r">Accounts</th></tr></thead>
            <tbody>{effects.map((e, i) => {
              const [kind, band] = e.key.split("|");
              return (
                <tr key={i}>
                  <td><div className="cell-name">{kind.replace(/_/g, " ")}</div><div className="cell-sub">{band}</div></td>
                  <td className="meta">{scopeLabel(e.industry)}</td>
                  <td className="num r">{e.stats.better}</td><td className="num r">{e.stats.worse}</td><td className="num r">{e.stats.noClearChange}</td>
                  <td className="num r">{e.stats.movedWithAccount}</td><td className="num r">{e.stats.tooLittleData + e.stats.confounded}</td>
                  <td className="num r">{pctx(e.stats.medianCpaChange)}</td><td className="num r">{e.projects}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="card-pad"><p className="meta">No change has finished its after-window yet. A change is judged about five weeks after it was made (seven for bidding changes), so this fills in from then on.</p></div>}
      </div>

      <div className="grid-2">
        {([["Words that waste across accounts", waste], ["Words that convert across accounts", converting]] as const).map(([title, list]) => (
          <div key={title} className="card">
            <div className="card-head"><h2>{title}</h2><span className="meta">3+ accounts, brand words removed</span></div>
            {list.length ? (
              <div className="table-wrap"><table>
                <thead><tr><th>Word</th><th>Scope</th><th className="r">Clicks</th><th className="r">Conv.</th><th className="r">Expected</th><th className="r">Accounts</th></tr></thead>
                <tbody>{list.slice(0, 40).map((w, i) => (
                  <tr key={i}><td className="cell-name">{w.key}</td><td className="meta">{scopeLabel(w.industry)}</td>
                    <td className="num r">{Math.round(w.stats.clicks)}</td><td className="num r">{Number(w.stats.conversions).toFixed(1)}</td>
                    <td className="num r">{w.stats.expectedAtAccountsOwnRates}</td><td className="num r">{w.projects}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <div className="card-pad"><p className="meta">Nothing passes the test yet. A word needs to appear in searches on at least three accounts, with enough clicks that the accounts&rsquo; own conversion rates predict three or more conversions.</p></div>}
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Portfolio benchmarks</h2><span className="meta">Your accounts, not industry averages</span></div>
          {benchmarks.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Rate</th><th>Scope</th><th className="r">Lower quarter</th><th className="r">Median</th><th className="r">Upper quarter</th><th className="r">Accounts</th></tr></thead>
              <tbody>{benchmarks.map((b, i) => (
                <tr key={i}><td className="cell-name">{b.key}</td><td className="meta">{scopeLabel(b.industry)}</td>
                  <td className="num r">{pctx(b.stats.p25)}</td><td className="num r">{pctx(b.stats.median)}</td><td className="num r">{pctx(b.stats.p75)}</td><td className="num r">{b.projects}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="card-pad"><p className="meta">Run Learn now after the first sync.</p></div>}
        </div>
        <div className="card">
          <div className="card-head"><h2>How common each problem is</h2><span className="meta">Open findings, last 14 days</span></div>
          {prevalence.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Finding</th><th className="r">Projects with it</th></tr></thead>
              <tbody>{prevalence.map((p, i) => (
                <tr key={i}><td className="cell-name">{p.key.replace(/_/g, " ")}</td><td className="num r">{p.stats.projectsWithIt} of {p.stats.projectsTotal}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="card-pad"><p className="meta">Nothing yet.</p></div>}
          <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}>
            <h3 style={{ marginBottom: 6 }}>Industries</h3>
            <p className="meta" style={{ marginBottom: 8 }}>Patterns are also read within a trade. Detected automatically; change one in its project settings.</p>
            <div className="row" style={{ gap: 6 }}>
              {pool.map((p) => <span key={p.id} className="pill">{p.name} · {p.industry ? scopeLabel(p.industry) : "not detected yet"}</span>)}
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2 style={{ marginBottom: 4 }}>Teach it</h2>
        <p className="meta" style={{ marginBottom: 14 }}>
          A lesson is a rule from experience. Every analysis and every answer reads the active lessons beside the verified knowledge, on every project.
          They can change judgement and order; they can never make it produce a figure.
        </p>
        <Lessons lessons={lessons} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>What has worked, everywhere</h2><span className="meta">Experiments with a verdict</span></div>
          {outcomes.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Change</th><th>Metric</th><th className="r">Confirmed</th><th className="r">Refuted</th><th className="r">Unclear</th><th className="r">Projects</th></tr></thead>
              <tbody>{outcomes.map((o, i) => (
                <tr key={i}><td><div className="cell-name">{o.action}</div><div className="cell-sub">{AREA_LABEL[o.area] ?? o.area}</div></td><td>{o.metric}</td>
                  <td className="num r">{o.confirmed}</td><td className="num r">{o.refuted}</td><td className="num r">{o.inconclusive}</td><td className="num r">{o.projects}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="card-pad"><p className="meta">No experiment has reached its check date on any project yet. Counts are shown as counts, never rates, so one lucky test cannot read as 100%.</p></div>}
        </div>
        <div className="card">
          <div className="card-head"><h2>What operators did with it</h2><span className="meta">Last 180 days</span></div>
          {feedback.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Kind</th><th className="r">Done</th><th className="r">Dismissed</th><th className="r">Left</th><th className="r">Projects</th></tr></thead>
              <tbody>{feedback.map((f, i) => (
                <tr key={i}><td><div className="cell-name">{AREA_LABEL[f.area] ?? f.area}</div><div className="cell-sub">{PRODUCT_LABEL[f.product] ?? f.product}</div></td>
                  <td className="num r">{f.done}</td><td className="num r">{f.dismissed}</td><td className="num r">{f.ignored}</td><td className="num r">{f.projects}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="card-pad"><p className="meta">No recommendation has been marked done or dismissed yet.</p></div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Recent analyses</h2><span className="meta">All projects, all users</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Project</th><th>When</th><th className="r">Findings</th><th className="r">Written</th><th className="r">Refused buttons</th><th className="r">Cost</th></tr></thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={i}>
                <td><Link href={`/admin/runs/${r.id}` as never} className="cell-name">{r.project}</Link><div className="cell-sub">{r.owner ?? "—"}{r.has_transcript ? " · full transcript" : ""}</div></td>
                <td>{ago(r.created_at)}{r.error && <div className="cell-sub bad-text">{r.error}</div>}</td>
                <td className="num r">{r.findings_count}</td><td className="num r">{r.insights_count}</td>
                <td className="num r">{r.actions_dropped ?? 0}</td><td className="num r">${Number(r.cost_usd ?? 0).toFixed(2)}</td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={6}><div className="empty">No analysis has run yet.</div></td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Verified knowledge</h2><span className="meta">{Math.round(KNOWLEDGE.length / 1000)}k characters, fact-checked against Google&rsquo;s documentation</span></div>
        <ul className="audit">
          {modules.map(([name, text]) => (
            <li key={name} className="info">
              <span className="mark">i</span>
              <div className="body" style={{ flex: 1, minWidth: 0 }}>
                <details>
                  <summary style={{ cursor: "pointer" }}><strong>{name}</strong> <span className="meta">· {Math.round(text.length / 1000)}k characters</span></summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, marginTop: 10, maxHeight: 420, overflow: "auto" }}>{text}</pre>
                </details>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
