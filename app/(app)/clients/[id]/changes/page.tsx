import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { ago } from "@/lib/format";
import { UndoButton } from "@/components/ads/UndoButton";

export const dynamic = "force-dynamic";

/** Every change Fortress made in Google Ads, who confirmed it, and how to put it back. */
export default async function Changes({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const rows = await q<any>(`SELECT a.*, u.email FROM action_log a LEFT JOIN users u ON u.id = a.user_id
                              WHERE a.client_id = $1 ORDER BY a.created_at DESC LIMIT 200`, [client.id]);
  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Changes</div>
          <h1>What Fortress changed in Google Ads</h1>
          <p className="meta">Every change was checked by Google first. The ones with an Undo can be put back exactly as they were.</p>
        </div>
      </header>
      <div className="card">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Change</th><th>By</th><th>When</th><th>Result</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><div className="cell-name">{r.summary}</div><div className="cell-sub">{r.kind.replace(/_/g, " ")}</div></td>
                    <td className="meta">{r.email ?? "—"}</td>
                    <td className="meta">{ago(r.created_at)}</td>
                    <td>{r.status === "failed" ? <span className="pill pill-bad" title={r.error ?? ""}>Failed</span> : r.undone_at ? <span className="pill">Undone {ago(r.undone_at)}</span> : <span className="pill pill-good">Applied</span>}</td>
                    <td className="r">{r.status === "applied" && !r.undone_at && r.undo ? <UndoButton clientId={client.id} id={r.id} summary={r.summary} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="card-pad"><div className="empty"><h3>No changes yet</h3><p>Changes made from What to change, Ads & copy or a launch appear here.</p></div></div>}
      </div>
    </div>
  );
}
