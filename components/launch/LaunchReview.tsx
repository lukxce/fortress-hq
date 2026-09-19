"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";

type Stage = "draft" | "launching" | "failed" | "paused" | "launched";

/**
 * The last three steps, each its own button: Google checks the whole campaign,
 * it is built paused, and only then does it go live.
 */
export function LaunchActions({ clientId, draftId, status, name, daily, currency, blocking }: {
  clientId: number; draftId: number; status: Stage; name: string; daily: number | null; currency: string | null; blocking: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [checked, setChecked] = useState<null | { ok: boolean; error?: string }>(null);
  const [confirm, setConfirm] = useState<null | "build" | "live">(null);
  const [error, setError] = useState<string | null>(null);
  const money = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString()}${currency ? ` ${currency}` : ""}`);

  async function post(url: string, body: object) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: clientId, id: draftId, ...body }) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(b.message ?? b.error ?? "Something went wrong.");
    return b;
  }
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  };

  if (status === "launched") {
    return <div className="notice notice-good"><div><strong>Live.</strong> &ldquo;{name}&rdquo; is running. Fortress will remind you to check it after 3, 14 and 30 days.</div></div>;
  }

  const steps = [
    { n: 1, label: "Google checks the whole campaign", done: status === "paused" || checked?.ok === true },
    { n: 2, label: "Built in Google Ads, paused", done: status === "paused" },
    { n: 3, label: "Go live", done: false },
  ];

  return (
    <div className="card">
      <div className="card-head"><h2>Launch</h2><span className="meta">three steps, nothing spends until the last</span></div>
      <ol className="setup-steps">
        {steps.map((s) => (
          <li key={s.n} className={s.done ? "done" : ""}><span className="n">{s.done ? "✓" : s.n}</span><div className="body"><h4 style={{ margin: 0 }}>{s.label}</h4></div></li>
        ))}
      </ol>
      <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}>
        {blocking.length > 0 && status !== "paused" && (
          <div className="notice notice-warn" style={{ marginBottom: 12 }}><div><strong>Fix first:</strong> {blocking.join(" ")}</div></div>
        )}
        {checked && !checked.ok && <div className="notice notice-bad" style={{ marginBottom: 12 }}><div><strong>Google would reject it:</strong> {checked.error}</div></div>}
        {checked?.ok && status !== "paused" && <div className="notice notice-good" style={{ marginBottom: 12 }}><div>Google accepted the whole campaign — budget, places, keywords and ads. Nothing was created.</div></div>}
        {error && <p className="err">{error}</p>}
        <div className="row">
          {status !== "paused" && (
            <>
              <button className={`btn ${checked?.ok ? "" : "btn-primary"}`} disabled={busy !== null || blocking.length > 0}
                onClick={() => run("check", async () => { setChecked(await post("/api/drafts/dryrun", {})); })}>
                {busy === "check" && <span className="spinner" />}Check with Google
              </button>
              <button className={`btn ${checked?.ok ? "btn-primary" : ""}`} disabled={busy !== null || !checked?.ok} onClick={() => setConfirm("build")}>
                Build it paused
              </button>
            </>
          )}
          {status === "paused" && (
            <button className="btn btn-primary btn-lg" disabled={busy !== null} onClick={() => setConfirm("live")}>Go live</button>
          )}
        </div>
      </div>

      {confirm && (
        <Dialog onClose={() => setConfirm(null)} locked={busy !== null}>
          <div className="dialog-body">
            <div className="label eyebrow">Confirm a change in Google Ads</div>
            {confirm === "build" ? (
              <>
                <h2>Build &ldquo;{name}&rdquo; paused</h2>
                <p>Creates the campaign, ad groups, keywords and ads in Google Ads, <strong>switched off</strong>. It spends nothing until you press Go live.</p>
              </>
            ) : (
              <>
                <h2>Go live with &ldquo;{name}&rdquo;</h2>
                <p><strong>It starts spending up to {money(daily)} a day (about {money((daily ?? 0) * 30.4)} a month) as soon as you confirm.</strong> You can pause it any time in Google Ads or here.</p>
              </>
            )}
          </div>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setConfirm(null)} disabled={busy !== null}>Cancel</button>
            <button className="btn btn-primary" disabled={busy !== null} onClick={() => run(confirm, async () => {
              if (confirm === "build") await post("/api/drafts/launch", { confirm: true, goLive: false });
              else await post("/api/drafts/golive", { confirm: true });
              setConfirm(null);
              router.refresh();
            })}>{busy && <span className="spinner" />}{confirm === "build" ? "Build it" : "Go live"}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
