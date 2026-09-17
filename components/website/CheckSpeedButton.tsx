"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CheckSpeedButton({ clientId }: { clientId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="row" style={{ gap: 8 }}>
      {error && <span className="err">{error}</span>}
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        const res = await fetch(`/api/speed?client=${clientId}`, { method: "POST" });
        const b = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setError(b.message ?? b.error ?? "Check failed.");
        router.refresh();
      }}>{busy ? "Checking… (1–2 minutes)" : "Check now"}</button>
    </div>
  );
}
