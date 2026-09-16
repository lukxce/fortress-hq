"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Pull fresh data from Google, or run the analysis. Both refresh the page when done. */
export function JobButton({ clientId, job, label, busyLabel, primary = false }: {
  clientId: number; job: "sync" | "analyse"; label: string; busyLabel: string; primary?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/${job}?client=${clientId}`, { method: "POST" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.message ?? b.error ?? "Failed.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row" style={{ gap: 8 }}>
      <button className={`btn ${primary ? "btn-primary" : ""}`} onClick={run} disabled={busy}>
        {busy && <span className="spinner" />}
        {busy ? busyLabel : label}
      </button>
      {error && <span className="err">{error}</span>}
    </span>
  );
}
