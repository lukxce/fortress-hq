"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";

type Asset = { field_type: string; text: string; performance_label: string | null; pinned_field: string | null; impressions: number };
type Ad = {
  ad_id: string; ad_group_id: string; ad_group: string; campaign: string; status: string; ad_strength: string | null;
  headlines: { text: string; pinned: string | null }[]; descriptions: { text: string }[]; finalUrl: string;
  impressions: number; clicks: number; conversions: number; ctr: number | null; assets: Asset[]; topKeywords: string[];
  verdict: string; tone: string; note: string; rank: number;
};

const LABEL: Record<string, string> = { BEST: "pill-good", GOOD: "pill-blue", LOW: "pill-bad", LEARNING: "pill", PENDING: "pill" };

export function AdCopyList({ clientId, ads, summary }: { clientId: number; ads: Ad[]; summary: unknown }) {
  const [filter, setFilter] = useState("needs work");
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<null | { ad: Ad; headlines: string[]; descriptions: string[]; path1: string; path2: string }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const shown = useMemo(() => ads
    .filter((a) => filter === "all" ? a.status === "ENABLED" : filter === "needs work" ? a.rank <= 3 : a.verdict === filter)
    .sort((a, b) => a.rank - b.rank || b.impressions - a.impressions), [ads, filter]);
  const counts = useMemo(() => ads.reduce((m: Record<string, number>, a) => ({ ...m, [a.verdict]: (m[a.verdict] ?? 0) + 1 }), {}), [ads]);

  async function write(ad: Ad) {
    setBusy(ad.ad_id); setMsg(null);
    const res = await fetch("/api/builder/adtext", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: clientId, summary, group: { name: ad.ad_group, keywords: ad.topKeywords, finalUrl: ad.finalUrl,
        keep: ad.assets.filter((x) => x.performance_label === "BEST").map((x) => x.text) } }) });
    const b = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg(b.message ?? b.error ?? "Could not write new lines.");
    // Keep what Google rates Best, add the new lines after it.
    const best = ad.assets.filter((x) => x.performance_label === "BEST");
    const heads = [...new Set([...best.filter((x) => x.field_type === "HEADLINE").map((x) => x.text), ...b.headlines])].slice(0, 15);
    const descs = [...new Set([...best.filter((x) => x.field_type === "DESCRIPTION").map((x) => x.text), ...b.descriptions])].slice(0, 4);
    setDraft({ ad, headlines: heads, descriptions: descs, path1: b.path1 ?? "", path2: b.path2 ?? "" });
  }

  async function add() {
    if (!draft) return;
    setBusy("add");
    const res = await fetch("/api/ads/new", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: clientId, adGroupId: draft.ad.ad_group_id, finalUrl: draft.ad.finalUrl, headlines: draft.headlines.filter(Boolean),
        descriptions: draft.descriptions.filter(Boolean), path1: draft.path1, path2: draft.path2, confirm: true }) });
    const b = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg(b.message ?? b.error ?? "Google did not accept the ad.");
    setDraft(null);
    setMsg(`New ad added to "${draft.ad.ad_group}". The old one keeps running beside it; pause it once the new one proves itself. Undo on the Changes page.`);
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="chips">
        {["needs work", "Weaker ad", "Replace weak lines", "Off-topic headlines", "Strengthen", "Working", "all"].filter((f) => f === "needs work" || f === "all" || counts[f]).map((f) => (
          <button key={f} className={`chip${filter === f ? " on" : ""}`} onClick={() => setFilter(f)}>
            {f === "needs work" ? "Needs work" : f === "all" ? "All running" : f}
            {f !== "all" && <span className="badge">{f === "needs work" ? ads.filter((a) => a.rank <= 3).length : counts[f]}</span>}
          </button>
        ))}
      </div>
      {msg && <div className="notice notice-blue"><div>{msg}</div></div>}
      <div className="card">
        {shown.length ? shown.slice(0, 100).map((a) => (
          <div key={a.ad_id} style={{ borderTop: "1px solid var(--line)", padding: "14px 20px" }}>
            <div className="spread" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <span className={`pill ${a.tone}`}>{a.verdict}</span>
                  <span className="cell-name">{a.ad_group}</span><span className="meta">· {a.campaign}</span>
                </div>
                <p className="meta" style={{ margin: 0 }}>{a.note}</p>
                <p className="meta" style={{ margin: "4px 0 0" }}>
                  {a.impressions.toLocaleString()} impressions · {a.ctr != null ? `${(a.ctr * 100).toFixed(1)}% clicked` : "—"} · {a.conversions.toFixed(0)} conversions · 90 days
                </p>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setOpen(open === a.ad_id ? null : a.ad_id)}>{open === a.ad_id ? "Hide lines" : "Show lines"}</button>
                {a.status === "ENABLED" && a.finalUrl && <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => write(a)}>{busy === a.ad_id && <span className="spinner" />}Write better lines</button>}
              </div>
            </div>
            {open === a.ad_id && (
              <div className="grid-2" style={{ marginTop: 10 }}>
                {(["HEADLINE", "DESCRIPTION"] as const).map((field) => {
                  const lines = field === "HEADLINE" ? a.headlines.map((h) => h.text) : a.descriptions.map((d) => d.text);
                  return (
                    <div key={field}>
                      <div className="label" style={{ marginBottom: 6 }}>{field === "HEADLINE" ? "Headlines" : "Descriptions"}</div>
                      {lines.map((t) => {
                        const asset = a.assets.find((x) => x.field_type === field && x.text === t);
                        return (
                          <div key={t} className="row" style={{ gap: 6, padding: "3px 0" }}>
                            {asset?.performance_label && <span className={`pill ${LABEL[asset.performance_label] ?? "pill"}`}>{asset.performance_label.toLowerCase()}</span>}
                            <span style={{ fontSize: 13.5 }}>{t}</span>
                            {asset?.pinned_field && <span className="meta">pinned</span>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )) : <div className="card-pad"><p className="meta" style={{ margin: 0 }}>Nothing here.</p></div>}
      </div>

      {draft && (
        <Dialog onClose={() => setDraft(null)} locked={busy === "add"}>
          <div className="dialog-body">
            <div className="label eyebrow">New ad for {draft.ad.ad_group}</div>
            <h2>Check the lines</h2>
            <p className="meta">Lines Google rates Best are kept first. Edit anything; Google checks the ad before it is created, beside the old one.</p>
            <div className="stack-sm" style={{ maxHeight: 360, overflow: "auto" }}>
              {draft.headlines.map((h, i) => (
                <input key={`h${i}`} type="text" value={h} maxLength={30}
                  onChange={(e) => setDraft({ ...draft, headlines: draft.headlines.map((x, j) => (j === i ? e.target.value : x)) })} />
              ))}
              {draft.descriptions.map((d, i) => (
                <input key={`d${i}`} type="text" value={d} maxLength={90}
                  onChange={(e) => setDraft({ ...draft, descriptions: draft.descriptions.map((x, j) => (j === i ? e.target.value : x)) })} />
              ))}
            </div>
          </div>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDraft(null)} disabled={busy === "add"}>Cancel</button>
            <button className="btn btn-primary" onClick={add} disabled={busy === "add"}>{busy === "add" && <span className="spinner" />}Add this ad in Google Ads</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
