"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

async function call(payload: object) {
  const res = await fetch("/api/competitors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b.message ?? b.error ?? "Something went wrong.");
  return b;
}

export function AddCompetitor({ clientId }: { clientId: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack-sm">
      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
        <input type="text" placeholder="Competitor name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 260 }} />
        <input type="text" placeholder="their-website.com" value={site} onChange={(e) => setSite(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={async () => {
          setBusy(true); setError(null);
          try { await call({ action: "add", client: clientId, name, website: site }); setName(""); setSite(""); router.refresh(); }
          catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? <><span className="spinner" />Reading their site…</> : "Add and analyse"}</button>
      </div>
      {error && <p className="err">{error}</p>}
    </div>
  );
}

export function CompetitorActions({ clientId, id, status }: { clientId: number; id: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (label: string, payload: object) => async () => {
    setBusy(label); setError(null);
    try { await call({ client: clientId, id, ...payload }); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <span className="row" style={{ gap: 6 }}>
      {error && <span className="err">{error}</span>}
      {status === "suggested" && <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={run("confirm", { action: "status", status: "confirmed" })}>Track it</button>}
      {status === "confirmed" && <button className="btn btn-sm" disabled={!!busy} onClick={run("analyse", { action: "analyse" })}>{busy === "analyse" ? "Reading…" : "Read again"}</button>}
      <button className="btn btn-sm btn-quiet" disabled={!!busy} onClick={run("ignore", status === "suggested" ? { action: "status", status: "ignored" } : { action: "delete" })}>{status === "suggested" ? "Not a competitor" : "Remove"}</button>
    </span>
  );
}

export function ObserveAd({ clientId, id }: { clientId: number; id: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack-sm">
      <textarea rows={2} placeholder="Paste an ad you saw (headline and text)…" value={text} onChange={(e) => setText(e.target.value)} />
      <div><button className="btn btn-sm" disabled={busy || text.trim().length < 5} onClick={async () => {
        setBusy(true);
        try { await call({ action: "observe", client: clientId, id, text }); setText(""); router.refresh(); } finally { setBusy(false); }
      }}>Save this ad</button></div>
    </div>
  );
}

export function PageActions({ clientId, serp }: { clientId: number; serp: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = (label: string, action: string) => async () => {
    setBusy(label); setMsg(null);
    try {
      const b = await call({ action, client: clientId });
      setMsg(action === "suggest" ? `${b.suggested} suggestion${b.suggested === 1 ? "" : "s"} from your account.` : `${b.ads} ads found on ${b.keywords} of your searches.`);
      router.refresh();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <span className="row" style={{ gap: 8 }}>
      {msg && <span className="meta">{msg}</span>}
      <button className="btn" disabled={!!busy} onClick={run("suggest", "suggest")}>{busy === "suggest" ? "Looking…" : "Suggest from my account"}</button>
      <button className="btn" disabled={!!busy || !serp} title={serp ? "Checks your top searches, in your places" : "Needs a DataForSEO key"} onClick={run("serp", "serp")}>{busy === "serp" ? "Searching…" : "See who advertises on my searches"}</button>
    </span>
  );
}
