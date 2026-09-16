"use client";

import { useState } from "react";

export function IndustrySelect({ clientId, value, source, options }: { clientId: number; value: string | null; source: string | null; options: Record<string, string> }) {
  const [v, setV] = useState(value ?? "");
  const [state, setState] = useState<string | null>(source === "auto" ? "Detected automatically" : null);
  return (
    <div className="row" style={{ gap: 10 }}>
      <select style={{ width: 360, maxWidth: "100%" }} value={v} aria-label="Industry" onChange={async (e) => {
        setV(e.target.value); setState("Saving…");
        const res = await fetch("/api/clients/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: clientId, industry: e.target.value }) });
        setState(res.ok ? "Saved" : "Could not save");
      }}>
        {!v && <option value="">Not detected yet</option>}
        {Object.entries(options).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {state && <span className="meta">{state}</span>}
    </div>
  );
}
