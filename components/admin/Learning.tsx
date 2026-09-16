"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Proposed = { id: number; text: string; product: string; challenges_knowledge: string | null; evidence: { patterns?: any[] } | null; created_at: string };

const PRODUCT: Record<string, string> = { all: "All products", ads: "Google Ads", analytics: "Analytics", search_console: "Search Console", tag_manager: "Tag Manager" };

export function LearnNow({ autoApply }: { autoApply: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [auto, setAuto] = useState(autoApply);

  return (
    <div className="row" style={{ gap: 12 }}>
      <label className="row meta" style={{ gap: 6, cursor: "pointer" }}>
        <input type="checkbox" className="check" checked={auto} onChange={async (e) => {
          setAuto(e.target.checked);
          await fetch("/api/admin/learn", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoApply: e.target.checked }) });
        }} />
        Apply its own lessons without asking
      </label>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        const res = await fetch("/api/admin/learn", { method: "POST" });
        const b = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setMsg(b.error ?? "Learning failed.");
        setMsg(`Judged ${b.outcomes?.judged ?? 0} changes · ${b.patterns?.patterns ?? 0} patterns · ${typeof b.lessons?.proposed === "number" ? `${b.lessons.proposed} lesson${b.lessons.proposed === 1 ? "" : "s"} drafted` : "no lessons drafted"}`);
        router.refresh();
      }}>{busy ? "Learning… (a minute or two)" : "Learn now"}</button>
      {msg && <span className="meta">{msg}</span>}
    </div>
  );
}

export function ProposedLessons({ lessons }: { lessons: Proposed[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (id: number, status: "active" | "rejected") => {
    setBusy(id);
    await fetch("/api/admin/lessons", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
    setBusy(null);
    router.refresh();
  };
  if (!lessons.length) return <div className="card-pad"><p className="meta">Nothing waiting. Drafts appear here after each weekly learning pass, when the portfolio shows something the knowledge does not already say.</p></div>;
  return (
    <ul className="audit">
      {lessons.map((l) => (
        <li key={l.id} className={l.challenges_knowledge ? "warn" : "info"}>
          <span className="mark">{l.challenges_knowledge ? "!" : "i"}</span>
          <div className="body" style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span className="pill pill-blue">{PRODUCT[l.product] ?? l.product}</span>
              {l.challenges_knowledge && <span className="pill pill-warn">Challenges: {l.challenges_knowledge}</span>}
            </div>
            <p style={{ margin: 0 }}>{l.text}</p>
            <details style={{ marginTop: 6 }}>
              <summary className="meta" style={{ cursor: "pointer" }}>Evidence ({l.evidence?.patterns?.length ?? 0} pattern{l.evidence?.patterns?.length === 1 ? "" : "s"})</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 6 }}>{JSON.stringify(l.evidence?.patterns?.map(({ kind, industry, key, projects, stats }) => ({ kind, industry, key, accounts: projects, ...stats })), null, 2)}</pre>
            </details>
          </div>
          <div className="row" style={{ gap: 6, alignSelf: "center" }}>
            <button className="btn btn-sm btn-primary" disabled={busy === l.id} onClick={() => act(l.id, "active")}>Approve</button>
            <button className="btn btn-sm" disabled={busy === l.id} onClick={() => act(l.id, "rejected")}>Reject</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
