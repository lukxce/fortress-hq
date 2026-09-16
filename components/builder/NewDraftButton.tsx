"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewDraftButton({ clientId }: { clientId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-primary" disabled={busy} onClick={async () => {
      setBusy(true);
      const res = await fetch("/api/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: clientId }) });
      const b = await res.json();
      if (res.ok) router.push(`/clients/${clientId}/builder/${b.id}` as never);
      else setBusy(false);
    }}>{busy && <span className="spinner" />}Start a new campaign</button>
  );
}
