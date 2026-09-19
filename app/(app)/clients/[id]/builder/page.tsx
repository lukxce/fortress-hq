import Link from "next/link";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { ago } from "@/lib/format";
import { NewDraftButton } from "@/components/builder/NewDraftButton";

export const dynamic = "force-dynamic";

const STATUS = { draft: "pill", launching: "pill-blue", paused: "pill-warn", launched: "pill-good", failed: "pill-bad" } as const;

export default async function Builder({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const drafts = await q<any>(`SELECT id, name, source, step, status, updated_at FROM drafts WHERE client_id = $1 ORDER BY updated_at DESC`, [client.id]);

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">New campaign</div>
          <h1>Build a Search campaign</h1>
          <p className="lede">Seven steps, one decision per screen. It reads the website, starts keywords from searches this business already wins, previews the ad as Google shows it, and launches paused until every part is in place.</p>
        </div>
        <div className="row">
          <Link href={`/clients/${client.id}/launch` as never} className="btn btn-primary">Guided launch</Link>
          <NewDraftButton clientId={client.id} />
        </div>
      </header>

      <div className="card">
        {drafts.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Campaign</th><th>Started from</th><th>Status</th><th>Last edited</th><th /></tr></thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id}>
                    <td className="cell-name">{d.name}</td>
                    <td className="meta">{d.source === "brain" ? "A recommendation" : "Blank"}</td>
                    <td><span className={`pill ${STATUS[d.status as keyof typeof STATUS]}`}>{d.status === "draft" ? `step ${d.step} of 7` : d.status === "paused" ? "built, waiting to go live" : d.status}</span></td>
                    <td className="meta">{ago(d.updated_at)}</td>
                    <td className="r"><Link className="btn btn-sm" href={(d.status === "paused" || d.status === "launched" ? `/clients/${client.id}/launch/${d.id}` : `/clients/${client.id}/builder/${d.id}`) as never}>{d.status === "launched" ? "View" : d.status === "paused" ? "Go live…" : "Continue"}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>No drafts yet</h3>
            <p>Start one here, or from a campaign the analysis proposes on the What to change page.</p>
          </div>
        )}
      </div>
    </div>
  );
}
