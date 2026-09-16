"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddGoogleTag({ clientId, product, id }: { clientId: number; product: "ads" | "analytics"; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = product === "ads" ? "Google Ads" : "Analytics";
  return (
    <div style={{ marginTop: 6 }}>
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={async () => {
        if (!confirm(`Add the ${label} Google tag ${id} to the Tag Manager workspace?${product === "ads" ? " A conversion linker is added too if there is none." : ""}\n\nNothing goes live until you publish it in Tag Manager.`)) return;
        setBusy(true); setError(null);
        const res = await fetch("/api/tagcheck/add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: clientId, product }) });
        const b = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setError(b.message ?? b.error ?? "Could not add it.");
        router.refresh();
      }}>{busy ? "Adding…" : `Add the ${label} tag in Tag Manager`}</button>
      {error && <div className="err" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="meta" style={{ cursor: "pointer" }}>Show the code to add to the site</summary>
      <p className="meta" style={{ margin: "6px 0" }}>Paste it into the &lt;head&gt; of every page, as high as possible. If the site uses a cookie banner, load it through that instead.</p>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--ground-2)", padding: 10, borderRadius: 8 }}>{code}</pre>
      <button className="btn btn-sm" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
    </details>
  );
}
