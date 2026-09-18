"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Pull fresh data from Google, or run the analysis. Both refresh the page when
 * done. An analysis that would repeat the last one is refused by the server
 * with an explanation; the operator can still insist.
 */
export function JobButton({ clientId, job, label, busyLabel, primary = false }: {
  clientId: number; job: "sync" | "analyse"; label: string; busyLabel: string; primary?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  async function run(force = false) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/${job}?client=${clientId}${force ? "&force=1" : ""}`, { method: "POST" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.message ?? b.error ?? "Failed.");
      if (b.unchanged) { setNotice(b.message); return; }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row" style={{ gap: 8 }}>
      <button className={`btn ${primary ? "btn-primary" : ""}`} onClick={() => run()} disabled={busy}>
        {busy && <span className="spinner" />}
        {busy ? busyLabel : label}
      </button>
      {notice && (
        <span className="meta" style={{ maxWidth: 420 }}>
          {notice}{" "}
          <button className="link-quiet" style={{ color: "var(--blue)", fontWeight: 600 }} onClick={() => run(true)} disabled={busy}>Analyse anyway</button>
        </span>
      )}
      {error && <span className="err">{error}</span>}
    </span>
  );
}
