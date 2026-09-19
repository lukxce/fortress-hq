"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UndoButton({ clientId, id, summary }: { clientId: number; id: number; summary: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
      {error && <span className="err">{error}</span>}
      <button className="btn btn-sm" disabled={busy} onClick={async () => {
        if (!confirm(`Undo: ${summary}?`)) return;
        setBusy(true); setError(null);
        const res = await fetch("/api/actions/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: clientId, id, confirm: true }) });
        const b = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setError(b.message ?? b.error ?? "Could not undo.");
        router.refresh();
      }}>{busy ? "Undoing…" : "Undo"}</button>
    </span>
  );
}
