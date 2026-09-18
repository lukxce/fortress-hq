import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/user";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

const pretty = (s: string) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };

/** One analysis in full: every block sent to the model, and exactly what came back. */
export default async function AnalysisRun({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [run] = await q<any>(`
    SELECT r.*, c.name AS project FROM analysis_runs r JOIN clients c ON c.id = r.client_id WHERE r.id = $1`, [Number(id)]);
  if (!run) notFound();
  const req = run.request as { model: string; effort: string; system: string[]; user: string } | null;
  const userJson = req?.user ? req.user.slice(req.user.indexOf("\n\n") + 2) : "";
  const labels = ["Knowledge (cached across every analysis)", "Lessons in force", "Instructions"];

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow"><Link href={"/admin/brain" as never}>Brain</Link> · Analysis {run.id}</div>
          <h1>{run.project}</h1>
          <p className="meta">
            {ago(run.created_at)} · {run.model} · {Number(run.input_tokens).toLocaleString()} tokens in, {Number(run.output_tokens).toLocaleString()} out
            · ${Number(run.cost_usd).toFixed(2)}{run.duration_ms ? ` · ${Math.round(run.duration_ms / 1000)} s` : ""}{run.stop_reason ? ` · stopped: ${run.stop_reason}` : ""}
          </p>
        </div>
      </header>

      {run.error && <div className="notice notice-warn"><div>{run.error}</div></div>}

      {!req ? (
        <div className="card card-pad">
          <p className="meta" style={{ margin: 0 }}>
            This run happened before transcripts were kept, so what was sent and returned was not stored. Every analysis from now on is kept in full here.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head"><h2>What was sent</h2><span className="meta">{req.system.length + 1} blocks · effort {req.effort}</span></div>
            <div className="rec-disclosures">
              {req.system.map((text, i) => (
                <details key={i}>
                  <summary>{req.system.length === 2 && i === 1 ? labels[2] : labels[i] ?? `System block ${i + 1}`} · {text.length.toLocaleString()} characters</summary>
                  <div><pre className="snippet" style={{ maxHeight: 520 }}>{text}</pre></div>
                </details>
              ))}
              <details open>
                <summary>The project&rsquo;s data · {userJson.length.toLocaleString()} characters</summary>
                <div><pre className="snippet" style={{ maxHeight: 640 }}>{pretty(userJson)}</pre></div>
              </details>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>What came back</h2><span className="meta">{(run.response_text ?? "").length.toLocaleString()} characters</span></div>
            <div className="card-pad"><pre className="snippet" style={{ maxHeight: 720 }}>{run.response_text ? pretty(run.response_text) : "Nothing was returned."}</pre></div>
          </div>
        </>
      )}
    </div>
  );
}
