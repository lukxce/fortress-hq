import Link from "next/link";
import { JobButton } from "@/components/ui/JobButtons";

type Step = { step: string; rows: number; error?: string };

/**
 * A new project's page before there is anything to show: connect, pull, analyse.
 * It sits where the sentence will be, so the page it becomes is already in view.
 */
export function SetupCard({ clientId, bound, syncSteps, synced, analysed, canAnalyse }: {
  clientId: number;
  bound: { label: string; connected: boolean }[];
  syncSteps: Step[] | null; synced: boolean; analysed: boolean; canAnalyse: boolean;
}) {
  const missing = bound.filter((b) => !b.connected);
  const stage = !synced ? 2 : !analysed ? 3 : 4;
  const failed = (syncSteps ?? []).filter((s) => s.error);
  return (
    <div className="card">
      <div className="card-head"><h2>Set up this project</h2><span className="meta">Step {Math.min(stage, 3)} of 3</span></div>
      <ol className="setup-steps">
        <li className="done">
          <span className="n">✓</span>
          <div className="body">
            <h4>Connect Google</h4>
            <p className="meta" style={{ margin: 0 }}>
              {bound.filter((b) => b.connected).map((b) => b.label).join(" · ") || "Nothing connected"}
              {missing.length > 0 && <> — {missing.map((m) => m.label).join(", ")} not connected. <Link href={`/clients/${clientId}/settings` as never}>Connect →</Link></>}
            </p>
          </div>
        </li>
        <li className={synced ? (failed.length ? "current" : "done") : "current"}>
          <span className="n">{synced && !failed.length ? "✓" : "2"}</span>
          <div className="body">
            <h4>Pull the data</h4>
            {syncSteps?.length ? (
              <div className="steplets">
                {syncSteps.map((s) => <span key={s.step} className={s.error ? "bad" : "ok"} title={s.error}>{s.error ? "✕" : "✓"} {s.step}</span>)}
              </div>
            ) : (
              <p className="meta" style={{ margin: "0 0 8px" }}>A year of daily performance, 90 days of search terms, keywords and hours, and whatever else is connected. About a minute.</p>
            )}
            {(!synced || failed.length > 0) && <div style={{ marginTop: 8 }}><JobButton clientId={clientId} job="sync" label={failed.length ? "Try again" : "Pull the data"} busyLabel="Pulling… (about a minute)" primary /></div>}
          </div>
        </li>
        <li className={analysed ? "done" : synced ? "current" : ""}>
          <span className="n">{analysed ? "✓" : "3"}</span>
          <div className="body">
            <h4>Work out what to change</h4>
            {!canAnalyse ? (
              <p className="meta" style={{ margin: 0 }}>Analysis is not set up on this installation yet — the admin needs to add the AI key.</p>
            ) : (
              <>
                <p className="meta" style={{ margin: "0 0 8px" }}>Every figure is measured first; the analysis then writes what to change, in order, with the exact steps.</p>
                {synced && !analysed && <JobButton clientId={clientId} job="analyse" label="Work out what to change" busyLabel="Thinking… (about a minute)" primary />}
              </>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}
