"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: number; label: string; sub: string | null };
type Slot = { provider: "ads" | "ga4" | "gsc" | "gtm"; label: string; current: number | null; options: Option[]; adds: string };

/**
 * Which Google account, property, site and container this project reads.
 * Only what the signed-in person's own Google connection can reach is offered.
 */
export function Bindings({ clientId, slots }: { clientId: number; slots: Slot[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(slot: Slot, value: string) {
    const inventoryId = value ? Number(value) : null;
    if (slot.current != null && !confirm(`Switch ${slot.label}? Data already pulled from the current one is removed, and the next sync reads the new one.`)) return;
    setBusy(slot.provider); setError(null);
    const res = await fetch("/api/clients/bindings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: clientId, provider: slot.provider, inventoryId }),
    });
    const b = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(b.error ?? "Could not change it.");
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 0 }}>
      {slots.map((s) => (
        <div key={s.provider} className="spread" style={{ padding: "14px 0", borderTop: "1px solid var(--line)", gap: 16, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h4 style={{ margin: 0 }}>{s.label}</h4>
            <p className="meta" style={{ margin: "2px 0 0" }}>{s.adds}</p>
          </div>
          <select style={{ width: 320, maxWidth: "100%" }} disabled={busy === s.provider}
            value={s.current ?? ""} onChange={(e) => change(s, e.target.value)} aria-label={s.label}>
            {s.provider !== "ads" && <option value="">Not connected</option>}
            {s.current != null && !s.options.some((o) => o.id === s.current) && <option value={s.current}>Connected through another person&rsquo;s Google</option>}
            {s.options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.sub ? ` — ${o.sub}` : ""}</option>)}
          </select>
        </div>
      ))}
      {error && <p className="err" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
