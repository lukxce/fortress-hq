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
import { PRODUCT_LABEL } from "@/components/product/Product";

export const dynamic = "force-dynamic";

export default async function AdminBrain() {
  await requireAdmin();
  const [lessons, outcomes, feedback, runs, spend] = await Promise.all([
    q<any>(`SELECT l.id, l.text, l.product, l.active, l.created_at, u.email AS author
              FROM brain_lessons l LEFT JOIN users u ON u.id = l.created_by ORDER BY l.active DESC, l.id DESC`),
    portfolioOutcomes(),
    portfolioFeedback(),
    q<any>(`SELECT r.created_at, r.model, r.cost_usd, r.findings_count, r.insights_count, r.skipped_count, r.actions_dropped, r.error,
                   c.name AS project, u.email AS owner
              FROM analysis_runs r JOIN clients c ON c.id = r.client_id LEFT JOIN users u ON u.id = c.owner_id
             ORDER BY r.created_at DESC LIMIT 25`),
    q<any>(`SELECT COALESCE(SUM(cost_usd) FILTER (WHERE created_at > now() - interval '30 days'),0)::float AS month,
                   count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS runs,
                   count(DISTINCT client_id)::int AS projects
              FROM analysis_runs`),
  ]);

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
                <td><div className="cell-name">{r.project}</div><div className="cell-sub">{r.owner ?? "—"}</div></td>
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
