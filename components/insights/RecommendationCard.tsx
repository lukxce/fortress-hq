"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money, dateShort, SEVERITY_LABEL, SEVERITY_PILL, AREA_LABEL } from "@/lib/format";
import { EvidenceTable } from "@/components/ui/bits";

export type Rec = {
  id: number; area: string; severity: "do_first" | "worth_doing" | "when_time";
  title: string; why: string; steps: string[]; do_by: string | null; effort_minutes: number | null;
  monthly_impact: string | null;
  evidence: { findings?: { title: string; detail: string; table: { columns: string[]; rows: any[][] } | null }[] };
  action: { kind: string; params: Record<string, unknown>; summary?: string } | null;
  prediction: { metric: string; direction: string; hypothesis: string } | null;
  campaign_plan: { name: string; why: string; ad_groups: { name: string; keywords: string[] }[] } | null;
  experiment_id: number | null; experiment_status: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  pause_campaign: "Pause it for me",
  add_negative_keywords: "Add these negatives",
  change_budget: "Change the budget",
  set_ad_schedule: "Set the ad schedule",
  set_device_bid_modifier: "Set the device adjustment",
};

export function RecommendationCard({ rec, clientId, currency }: { rec: Rec; clientId: number; currency: string | null }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | { summary: string; warnings: string[]; token: string; action: any } | { error: string }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const impact = rec.monthly_impact != null ? Number(rec.monthly_impact) : 0;
  const tables = (rec.evidence?.findings ?? []).filter((f) => f.table?.rows?.length);

  async function preview() {
    setBusy("preview");
    try {
      const res = await fetch("/api/actions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: clientId, mode: "preview", action: { kind: rec.action!.kind, params: rec.action!.params } }),
      });
      const b = await res.json();
      setDialog(b.ok ? { summary: b.summary, warnings: b.warnings ?? [], token: b.token, action: b.action } : { error: b.reason ?? b.error ?? "This change can no longer be made." });
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!dialog || "error" in dialog) return;
    setBusy("apply");
    try {
      const res = await fetch("/api/actions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: clientId, mode: "apply", action: dialog.action, token: dialog.token, recommendationId: rec.id }),
      });
      const b = await res.json();
      if (!res.ok) { setDialog({ error: b.message ?? b.error ?? "Google rejected the change." }); return; }
      setDialog(null);
      setDone(`Done in Google Ads. ${rec.prediction ? "The experiment has started — its check date is on the Experiments page." : ""}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function mark(status: "done" | "dismissed") {
    setBusy(status);
    try {
      if (status === "done" && rec.experiment_id && rec.experiment_status === "proposed") {
        await fetch("/api/experiments", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ client: clientId, op: "start", id: rec.experiment_id }) });
      } else {
        await fetch("/api/recommendations", { method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ client: clientId, id: rec.id, status }) });
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function buildCampaign() {
    setBusy("build");
    try {
      const res = await fetch("/api/drafts", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: clientId, fromRecommendation: rec.id }) });
      const b = await res.json();
      if (res.ok) router.push(`/clients/${clientId}/builder/${b.id}` as never);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="card rec" id={`rec-${rec.id}`}>
      <div className="rec-top">
        <div className="row" style={{ gap: 8 }}>
          <span className={`pill ${SEVERITY_PILL[rec.severity]}`}>{SEVERITY_LABEL[rec.severity]}</span>
          <span className="pill">{AREA_LABEL[rec.area] ?? rec.area}</span>
          {rec.prediction && <span className="pill pill-blue">Testable</span>}
        </div>
        <h3 className="rec-title">{rec.title}</h3>
        {rec.why && <p className="rec-why">{rec.why}</p>}
        <div className="rec-facts">
          {impact > 0 && <span>Worth <b>≈ {money(impact, currency)}</b> a month</span>}
          {rec.effort_minutes && <span>Takes <b>{rec.effort_minutes < 60 ? `${rec.effort_minutes} min` : `${Math.round(rec.effort_minutes / 60)} h`}</b></span>}
          {rec.do_by && <span>By <b>{dateShort(rec.do_by)}</b></span>}
        </div>
      </div>

      <div className="rec-body">
        <ol className="steps">
          {rec.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>

        {rec.campaign_plan && (
          <div className="notice notice-blue" style={{ marginTop: 14 }}>
            <div>
              <strong>Proposed campaign: {rec.campaign_plan.name}.</strong>{" "}
              {rec.campaign_plan.ad_groups.map((g) => `${g.name} (${g.keywords.length} keywords)`).join(", ")}.
              Headlines and budget are left for you to fill in.
            </div>
          </div>
        )}

        {rec.prediction && (
          <p className="meta" style={{ marginTop: 12 }}>
            <strong>Prediction:</strong> {rec.prediction.metric === "cpa" ? "cost per conversion" : rec.prediction.metric} goes {rec.prediction.direction}. {rec.prediction.hypothesis}
          </p>
        )}

        {tables.length > 0 && (
          <details className="disclosure">
            <summary>The numbers behind this</summary>
            {tables.map((f, i) => (
              <div key={i} style={{ marginTop: 10 }}>
                <div className="meta" style={{ marginBottom: 6 }}>{f.title}</div>
                <div className="inner"><EvidenceTable table={f.table!} /></div>
              </div>
            ))}
          </details>
        )}
      </div>

      <div className="rec-foot">
        {done ? <span className="ok-text">{done}</span> : (
          <>
            {rec.action && (
              <button className="btn btn-primary" onClick={preview} disabled={busy !== null}>
                {busy === "preview" && <span className="spinner" />}{ACTION_LABEL[rec.action.kind] ?? "Do it for me"}
              </button>
            )}
            {rec.campaign_plan && (
              <button className="btn btn-primary" onClick={buildCampaign} disabled={busy !== null}>
                {busy === "build" && <span className="spinner" />}Build this campaign
              </button>
            )}
            <button className="btn" onClick={() => mark("done")} disabled={busy !== null}>
              {rec.experiment_id && rec.experiment_status === "proposed" ? "I did it myself — start the test" : "I did it myself"}
            </button>
            <button className="btn btn-quiet" onClick={() => mark("dismissed")} disabled={busy !== null}>Dismiss</button>
          </>
        )}
      </div>

      {dialog && (
        <div className="dialog-backdrop" onClick={() => busy !== "apply" && setDialog(null)}>
          <div className="dialog" role="alertdialog" aria-modal onClick={(e) => e.stopPropagation()}>
            <div className="dialog-body">
              {"error" in dialog ? (
                <>
                  <h2>This change can&rsquo;t be made</h2>
                  <p>{dialog.error}</p>
                  <p className="meta">The written steps still stand — you can make the change yourself in Google Ads.</p>
                </>
              ) : (
                <>
                  <div className="label eyebrow">Confirm a change in Google Ads</div>
                  <h2>{rec.title}</h2>
                  <p style={{ fontSize: 15 }}><span className="mark">{dialog.summary}</span></p>
                  {dialog.warnings.map((w) => <div key={w} className="notice notice-warn" style={{ marginTop: 10 }}>{w}</div>)}
                  <p className="meta" style={{ marginTop: 12 }}>This is applied to the live account immediately and recorded in the action log.</p>
                </>
              )}
            </div>
            <div className="dialog-foot">
              <button className="btn" onClick={() => setDialog(null)} disabled={busy === "apply"}>{"error" in dialog ? "Close" : "Cancel"}</button>
              {!("error" in dialog) && (
                <button className="btn btn-primary" onClick={apply} disabled={busy === "apply"}>
                  {busy === "apply" && <span className="spinner" />}Make this change
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
