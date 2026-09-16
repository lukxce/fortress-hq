"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ExperimentActions({ clientId, id, status }: { clientId: number; id: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function op(name: "start" | "abandon") {
    if (name === "abandon" && !confirm("Stop this test without a verdict? It will not count toward the track record.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/experiments", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: clientId, op: name, id }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? "Failed.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row" style={{ gap: 6 }}>
      {status === "proposed" && (
        <button className="btn btn-sm btn-primary" onClick={() => op("start")} disabled={busy}>I made this change — start the clock</button>
      )}
      <button className="btn btn-sm btn-quiet" onClick={() => op("abandon")} disabled={busy}>{status === "proposed" ? "Drop" : "Stop without a verdict"}</button>
      {error && <span className="err">{error}</span>}
    </span>
  );
}
