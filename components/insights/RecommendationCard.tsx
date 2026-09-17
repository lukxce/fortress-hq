"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money, dateShort, SEVERITY_LABEL, AREA_LABEL, PRODUCT_LABEL } from "@/lib/format";
import { EvidenceTable } from "@/components/ui/bits";
import { Dialog } from "@/components/ui/Dialog";

export type Rec = {
  id: number; area: string; product?: string; severity: "do_first" | "worth_doing" | "when_time";
  title: string; why: string; steps: string[]; do_by: string | null; effort_minutes: number | null;
  monthly_impact: string | null;
  evidence: { findings?: { title: string; detail: string; table: { columns: string[]; rows: any[][] } | null }[] };
  action: { kind: string; params: Record<string, unknown>; summary?: string } | null;
  prediction: { metric: string; direction: string; hypothesis: string } | null;
  campaign_plan: { name: string; why: string; ad_groups: { name: string; keywords: string[] }[] } | null;
  experiment_id: number | null; experiment_status: string | null;
};

export type TrackRecord = { confirmed: number; refuted: number; inconclusive: number } | null;

const ACTION_LABEL: Record<string, string> = {
  pause_campaign: "Pause the campaign…",
  add_negative_keywords: "Add the negatives…",
  change_budget: "Change the budget…",
  set_ad_schedule: "Set the ad schedule…",
  set_device_bid_modifier: "Set the device adjustment…",
};

const METRIC: Record<string, string> = { cpa: "cost per conversion", cvr: "conversion rate", spend: "spend", conversions: "conversions" };

/**
 * Severity first, then the evidence in plain words, then three closed
 * disclosures. One primary action per card; Apply never runs from the card
 * face, it opens the confirmation with the exact change.
 */
export function RecommendationCard({ rec, clientId, currency, record }: { rec: Rec; clientId: number; currency: string | null; record?: TrackRecord }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | { summary: string; warnings: string[]; token: string; action: any } | { error: string }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const impact = rec.monthly_impact != null ? Number(rec.monthly_impact) : 0;
  const findings = rec.evidence?.findings ?? [];
  const testable = rec.experiment_id && rec.experiment_status === "proposed";

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
      setDone(`Done in Google Ads.${rec.prediction ? " The test has started — its check date is on Experiments." : ""}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function mark(status: "done" | "dismissed", reason?: string) {
    setBusy(status);
    try {
      if (status === "done" && testable) {
        await fetch("/api/experiments", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ client: clientId, op: "start", id: rec.experiment_id }) });
      }
      await fetch("/api/recommendations", { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: clientId, id: rec.id, status, reason }) });
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

  const judged = record ? record.confirmed + record.refuted + record.inconclusive : 0;

  return (
    <article className="card rec" id={`rec-${rec.id}`}>
      <div className="rec-top">
        <div className="rec-head">
          <span className={`sev ${rec.severity}`}>{SEVERITY_LABEL[rec.severity]}</span>
          <span className="pill pill-outline">{AREA_LABEL[rec.area] ?? rec.area}</span>
          {rec.product && rec.product !== "ads" && <span className="pill pill-outline">{PRODUCT_LABEL[rec.product] ?? rec.product}</span>}
          {impact > 0 && <span className="worth" title="Summed by code from the measured findings this rests on — never a figure the AI produced.">≈ {money(impact, currency)}/mo</span>}
        </div>
        <h3 className="rec-title">{rec.title}</h3>
        {rec.why && <p className="rec-why">{rec.why}</p>}
        <div className="rec-meta">
          {rec.effort_minutes ? <span>Takes {rec.effort_minutes < 60 ? `${rec.effort_minutes} min` : `${Math.round(rec.effort_minutes / 60)} h`}</span> : null}
          {rec.do_by && <span>By {dateShort(rec.do_by)}</span>}
          {rec.action && <span>Fortress can make this change</span>}
          {record !== undefined && <span>{judged ? `Similar changes: ${record!.confirmed} confirmed, ${record!.refuted} refuted` : "No track record for this kind of change yet"}</span>}
        </div>
      </div>

      <div className="rec-disclosures">
        <details>
          <summary>Steps ({rec.steps.length})</summary>
          <div>
            <ol className="steps">{rec.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            {rec.campaign_plan && (
              <div className="notice notice-blue" style={{ marginTop: 12 }}>
                <div>
                  <strong>Proposed campaign: {rec.campaign_plan.name}.</strong>{" "}
                  {rec.campaign_plan.ad_groups.map((g) => `${g.name} (${g.keywords.length} keywords)`).join(", ")}. Headlines and budget are left for you.
                </div>
              </div>
            )}
          </div>
        </details>
        {findings.length > 0 && (
          <details>
            <summary>Numbers behind this ({findings.length} finding{findings.length === 1 ? "" : "s"})</summary>
            <div className="stack" style={{ gap: 12 }}>
              {findings.map((f, i) => (
                <div key={i}>
                  <div style={{ fontWeight: 550, marginBottom: 2 }}>{f.title}</div>
                  <p className="meta" style={{ margin: "0 0 8px" }}>{f.detail}</p>
                  {f.table?.rows?.length ? <div className="disclosure"><div className="inner"><EvidenceTable table={f.table} /></div></div> : null}
                </div>
              ))}
            </div>
          </details>
        )}
        {rec.prediction && (
          <details>
            <summary>What should happen</summary>
            <div>
              <p style={{ margin: 0 }}>{METRIC[rec.prediction.metric] ?? rec.prediction.metric} should go <strong>{rec.prediction.direction}</strong>. {rec.prediction.hypothesis}</p>
              <p className="meta" style={{ margin: "6px 0 0" }}>Marking it done starts a test: a baseline is taken now and the result is judged with the same statistical test once enough conversions have arrived.</p>
            </div>
          </details>
        )}
      </div>

      <div className="rec-foot">
        {done ? <span className="ok-text">{done}</span> : (
          <>
            {rec.action && (
              <button className="btn btn-primary" onClick={preview} disabled={busy !== null}>
                {busy === "preview" && <span className="spinner" />}{ACTION_LABEL[rec.action.kind] ?? "Make the change…"}
              </button>
            )}
            {rec.campaign_plan && (
              <button className={`btn ${rec.action ? "" : "btn-primary"}`} onClick={buildCampaign} disabled={busy !== null}>
                {busy === "build" && <span className="spinner" />}Build this campaign
              </button>
            )}
            <button className={`btn ${rec.action || rec.campaign_plan ? "" : "btn-primary"}`} onClick={() => mark("done")} disabled={busy !== null}>
              {testable ? "Done — start the test" : "Done"}
            </button>
            <details className="menu" style={{ marginLeft: "auto" }}>
              <summary className="btn btn-quiet">Dismiss ▾</summary>
              <div className="menu-list">
                <button onClick={() => mark("dismissed", "not_relevant")}>Not relevant to this business</button>
                <button onClick={() => mark("dismissed", "already_done")}>Already done</button>
                <button onClick={() => mark("dismissed", "wrong")}>The analysis is wrong</button>
              </div>
            </details>
          </>
        )}
      </div>

      {dialog && (
        <Dialog onClose={() => setDialog(null)} locked={busy === "apply"}>
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
                <p style={{ fontSize: 15 }}><strong>{dialog.summary}</strong></p>
                {dialog.warnings.map((w) => <div key={w} className="notice notice-warn" style={{ marginTop: 10 }}>{w}</div>)}
                <p className="meta" style={{ marginTop: 12 }}>
                  Applied to the live account immediately and recorded in the action log.{rec.prediction ? " A test starts with it, and its result is judged later." : ""}
                </p>
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
        </Dialog>
      )}
    </article>
  );
}
