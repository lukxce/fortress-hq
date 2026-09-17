"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductAccess } from "@/lib/google/scopes";

export function ConnectionPanel({
  email,
  access,
}: {
  email: string | null;
  access: ProductAccess[];
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const core = access.filter((a) => a.key !== "gbp");
  const business = access.find((a) => a.key === "gbp");
  const missing = core.filter((a) => !a.canRead);
  const allGranted = missing.length === 0;

  async function disconnect() {
    if (!confirm("Disconnect this Google account? The grant is revoked at Google and the stored token deleted.")) return;
    setBusy(true);
    try {
      await fetch("/api/auth/google/disconnect", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sheet sheet-pad">
      <div className="spread conn-head">
        <div>
          <h2>Google access</h2>
          <p className="meta">{email ?? "connected"}</p>
        </div>
        <span className={`pill ${allGranted ? "pill-good" : "pill-warn"}`}>
          {allGranted ? "all four granted" : `${missing.length} not granted`}{business?.canRead ? " · Business Profile" : ""}
        </span>
      </div>

      <ul className="access">
        {access.map((a) => (
          <li key={a.key} className={a.canRead ? "granted" : "denied"}>
            <span className="mark" aria-hidden>{a.canRead ? "✓" : "—"}</span>
            <div className="body">
              <div className="row-head">
                <strong>{a.label}</strong>
                {a.canRead && a.hasWriteScopes && (
                  <span className="pill">{a.canWrite ? "read + write" : "read only"}</span>
                )}
              </div>
              <p className="meta">{a.canRead ? a.why : `Not granted. ${a.why}`}</p>
            </div>
          </li>
        ))}
      </ul>

      {!allGranted && (
        <div className="notice notice-warn">
          Google lets you tick permissions individually on the consent screen, and
          anything left unticked simply is not granted. If ticking them all made
          the consent fail, the matching API is probably not enabled on the Cloud
          project — that has to be fixed before the grant can succeed.
        </div>
      )}

      <div className="conn-actions">
        <a href="/api/auth/google" className={`btn ${allGranted ? "btn-ghost" : "btn-accent"}`}>
          {allGranted ? "Re-authorise" : "Grant the missing access"}
        </a>
        {business && !business.canRead && (
          <a href="/api/auth/google?with=business" className="btn btn-ghost" title="Asks Google for Business Profile access as well">
            Connect Business Profile
          </a>
        )}
        <button className="btn btn-quiet btn-sm" onClick={disconnect} disabled={busy}>
          {busy ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    </section>
  );
}
