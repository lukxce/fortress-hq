"use client";

import { useState } from "react";

export function DeleteProject({ clientId, name }: { clientId: number; name: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="meta" style={{ margin: 0 }}>
        Removes the project and everything pulled into it — performance history, findings, recommendations, experiments and what the site check found.
        The Google accounts themselves are not touched and stay connected. This cannot be undone.
      </p>
      <div className="row" style={{ gap: 8 }}>
        <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type "${name}" to confirm`} style={{ maxWidth: 320 }} aria-label="Project name to confirm" />
        <button className="btn" style={{ color: "var(--bad)", borderColor: "var(--bad)" }} disabled={busy || typed.trim() !== name.trim()} onClick={async () => {
          setBusy(true); setError(null);
          const res = await fetch(`/api/clients?id=${clientId}&confirm=${encodeURIComponent(typed)}`, { method: "DELETE" });
          const b = await res.json().catch(() => ({}));
          if (!res.ok) { setBusy(false); return setError(b.error ?? "Could not delete it."); }
          window.location.href = "/overview";
        }}>{busy ? "Deleting…" : "Delete project"}</button>
      </div>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
