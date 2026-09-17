"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Lesson = { id: number; text: string; product: string; active: boolean; created_at: string; author: string | null };

const PRODUCTS = [
  ["all", "All products"], ["ads", "Google Ads"], ["analytics", "Analytics"], ["search_console", "Search Console"], ["tag_manager", "Tag Manager"], ["business_profile", "Business Profile"], ["website", "Website"],
] as const;
const label = (p: string) => PRODUCTS.find(([k]) => k === p)?.[1] ?? p;

export function Lessons({ lessons }: { lessons: Lesson[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [product, setProduct] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(method: string, payload?: object, qs = "") {
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/lessons${qs}`, { method, headers: { "content-type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(b.error ?? "Could not save."); return false; }
    router.refresh();
    return true;
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 8 }}>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="For example: On lead-gen accounts under 30 conversions a month, never recommend switching to Target CPA — it has starved every account we tried it on." />
        <div className="row">
          <select value={product} onChange={(e) => setProduct(e.target.value)} style={{ width: "auto" }} aria-label="Applies to">
            {PRODUCTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn btn-primary" disabled={busy || text.trim().length < 10}
            onClick={async () => { if (await call("POST", { text, product })) setText(""); }}>Teach it</button>
          {error && <span className="err">{error}</span>}
        </div>
      </div>

      {lessons.length ? (
        <ul className="audit" style={{ borderTop: "1px solid var(--line)" }}>
          {lessons.map((l) => (
            <li key={l.id} className={l.active ? "info" : undefined} style={{ opacity: l.active ? 1 : 0.55 }}>
              <div className="body" style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <span className="pill pill-blue">{label(l.product)}</span>
                  {!l.active && <span className="pill">Off</span>}
                  <span className="meta">{new Date(l.created_at).toLocaleDateString("en-GB")}{l.author ? ` · ${l.author}` : ""}</span>
                </div>
                <p style={{ margin: 0 }}>{l.text}</p>
              </div>
              <div className="row" style={{ gap: 6, alignSelf: "center" }}>
                <button className="btn btn-sm" disabled={busy} onClick={() => call("PATCH", { id: l.id, active: !l.active })}>{l.active ? "Turn off" : "Turn on"}</button>
                <button className="btn btn-sm" disabled={busy} onClick={() => confirm("Delete this lesson?") && call("DELETE", undefined, `?id=${l.id}`)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">No lessons yet. Anything taught here is read by every analysis and every answer, on every project, for every user.</p>
      )}
    </div>
  );
}
