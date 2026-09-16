import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { auditTracking } from "@/lib/tracking/audit";
import { count, ago, dateShort } from "@/lib/format";
import { TrackingBuilder } from "@/components/tracking/TrackingBuilder";

export const dynamic = "force-dynamic";

const MARK = { bad: "!", warn: "!", info: "i", ok: "✓" } as const;

export default async function Tracking({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const [audit, goals] = await Promise.all([
    auditTracking(client.id),
    q<any>(`SELECT * FROM conversion_goals WHERE client_id = $1 ORDER BY created_at DESC LIMIT 20`, [client.id]),
  ]);
  const primary = audit.actions.filter((a) => a.status === "ENABLED" && a.include_in_conversions).length;
  const problems = audit.checks.filter((c) => c.status === "bad").length;

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Conversion tracking</div>
          <h1>Is the number worth trusting?</h1>
          <p className="lede">
            Every figure in Fortress is downstream of what is counted as a conversion, so this is checked first —
            {problems ? <> and <span className="mark">{problems} thing{problems === 1 ? " is" : "s are"} wrong</span>.</> : " and nothing is badly wrong."}
          </p>
        </div>
      </header>

      <div className="card">
        <div className="card-head"><h2>Audit</h2><span className="meta">in the order to fix things</span></div>
        <ul className="audit">
          {audit.checks.map((c) => (
            <li key={c.id} className={c.status}>
              <span className="mark">{MARK[c.status]}</span>
              <div className="body">
                <h4>{c.title}</h4>
                <p className="meta" style={{ margin: 0 }}>{c.detail}</p>
                {c.fix && <div className="fix">{c.fix}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <div className="card-head"><h2>Conversion actions</h2><span className="meta">{audit.actions.length} in the account</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Action</th><th>Counts toward bidding</th><th>Counting</th><th className="r">Last 30 days</th><th>Last hit</th></tr></thead>
            <tbody>
              {audit.actions.map((a) => (
                <tr key={a.action_id}>
                  <td><div className="cell-name">{a.name}</div><div className="cell-sub">{String(a.category ?? "").toLowerCase().replace(/_/g, " ")} · {String(a.type ?? "").toLowerCase().replace(/_/g, " ")}{a.status !== "ENABLED" ? ` · ${String(a.status).toLowerCase()}` : ""}</div></td>
                  <td>{a.include_in_conversions ? <span className="pill pill-blue">Primary</span> : <span className="pill">Secondary</span>}</td>
                  <td className="meta">{a.counting_type === "ONE_PER_CLICK" ? "Once per click" : a.counting_type === "MANY_PER_CLICK" ? "Every time" : "—"}</td>
                  <td className="num r">{count(Number(a.conversions_30d ?? 0), 1)}</td>
                  <td className="meta">{a.last_received_at ? ago(a.last_received_at) : "—"}</td>
                </tr>
              ))}
              {!audit.actions.length && <tr><td colSpan={5} className="meta">Nothing synced yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Set up a new conversion</h2>
          <span className="meta">Created in Google Ads, fired from Tag Manager — straight to Ads, not through Analytics.</span>
        </div>
        {client.ads_customer_id
          ? <TrackingBuilder clientId={client.id} canWriteGtm={Boolean(client.gtm_container_id)} primaryCount={primary} />
          : <div className="card-pad meta">No Google Ads account is bound to this client.</div>}
      </div>

      {goals.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Created through Fortress</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Goal</th><th>Primary</th><th>Tag Manager</th><th>Created</th><th /></tr></thead>
              <tbody>
                {goals.map((g) => (
                  <tr key={g.id}>
                    <td className="cell-name">{g.name}</td>
                    <td>{g.is_primary ? "Yes" : "No"}</td>
                    <td className="meta">{g.gtm_tag_id ? (g.gtm_published ? "Published" : "In workspace — publish it") : "Not written"}</td>
                    <td className="meta">{dateShort(g.created_at)}</td>
                    <td className="r">{g.conversion_label && <a className="btn btn-sm" href={`/api/goals/file?client=${client.id}&goal=${g.id}`}>Import file</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
