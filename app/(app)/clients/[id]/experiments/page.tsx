import Link from "next/link";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { dateShort, money } from "@/lib/format";
import { ExperimentActions } from "@/components/experiments/ExperimentActions";

export const dynamic = "force-dynamic";

const METRIC = { cpa: "Cost per conversion", spend: "Spend", conversions: "Conversions", cvr: "Conversion rate" } as const;
const VERDICT = { confirmed: "pill-good", refuted: "pill-bad", inconclusive: "pill" } as const;

export default async function Experiments({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const all = await q<any>(`SELECT * FROM experiments WHERE client_id = $1 AND status <> 'abandoned'
                             ORDER BY COALESCE(evaluated_at, applied_at, created_at) DESC`, [client.id]);
  const proposed = all.filter((e) => e.status === "proposed");
  const running = all.filter((e) => e.status === "running");
  const finished = all.filter((e) => e.status === "finished");

  const describe = (e: any) => `${METRIC[e.metric as keyof typeof METRIC] ?? e.metric} should go ${e.direction}`;

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Experiments</div>
          <h1>{client.name}</h1>
          <p className="lede">
            A recommendation that predicts something becomes a test. It has no clock until you start it, and its check date
            is set by how long this account needs to collect enough conversions to tell — not a fixed fortnight.
          </p>
        </div>
      </header>

      <section>
        <h2 style={{ marginBottom: 12 }}>Suggested, not started <span className="pill">{proposed.length}</span></h2>
        <div className="card">
          {proposed.length ? (
            <ul className="audit">
              {proposed.map((e) => (
                <li key={e.id}>
                  <div className="body">
                    <h4>{e.title}</h4>
                    <p className="meta" style={{ margin: "2px 0 8px" }}>{describe(e)}. {e.hypothesis}</p>
                    <div className="row" style={{ gap: 8 }}>
                      {e.recommendation_id && <Link className="btn btn-sm" href={`/clients/${client.id}/insights#rec-${e.recommendation_id}` as never}>See the recommendation</Link>}
                      <ExperimentActions clientId={client.id} id={e.id} status={e.status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="card-pad meta">No proposals. They appear when a recommendation predicts a change you can measure.</div>}
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 12 }}>Running now <span className="pill pill-blue">{running.length}</span></h2>
        <div className="card">
          {running.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Test</th><th>Started</th><th>How</th><th>Result on</th><th /></tr></thead>
                <tbody>
                  {running.map((e) => (
                    <tr key={e.id}>
                      <td><div className="cell-name">{e.title}</div><div className="cell-sub">{describe(e)}</div></td>
                      <td>{dateShort(e.applied_at)}</td>
                      <td>{e.applied_via === "button" ? "By Fortress" : "By you"}</td>
                      <td><strong>{dateShort(e.due_at)}</strong><div className="cell-sub">needs ~{e.baseline?.postDays ?? "?"} days of data plus a week for late conversions</div></td>
                      <td className="r"><ExperimentActions clientId={client.id} id={e.id} status={e.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="card-pad meta">Nothing running.</div>}
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 12 }}>Finished <span className="pill">{finished.length}</span></h2>
        <div className="card">
          {finished.length ? (
            <ul className="audit">
              {finished.map((e) => (
                <li key={e.id}>
                  <div className="body">
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className={`pill ${VERDICT[e.verdict as keyof typeof VERDICT]}`}>{e.verdict}</span>
                      <span className="meta">checked {dateShort(e.evaluated_at)}</span>
                    </div>
                    <h4>{e.title}</h4>
                    <p className="meta" style={{ margin: "2px 0 0" }}>{describe(e)}. {e.result?.explanation}</p>
                    {e.result?.before && e.result?.after && (
                      <p className="meta num" style={{ marginTop: 4 }}>
                        Before: {money(e.result.before.spend, client.currency)} · {Number(e.result.before.conversions).toFixed(1)} conv over {e.result.before.days} d.
                        After: {money(e.result.after.spend, client.currency)} · {Number(e.result.after.conversions).toFixed(1)} conv over {e.result.after.days} d.
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="card-pad meta">No test has reached its check date yet.</div>}
        </div>
      </section>
    </div>
  );
}
