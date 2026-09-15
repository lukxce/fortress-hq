"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type InventoryRow = {
  id: number;
  provider: "ads" | "ga4" | "gsc" | "gtm";
  provider_id: string;
  display_name: string;
  domain: string | null;
  parent_id: string | null;
  parent_name: string | null;
  is_manager: boolean;
  currency: string | null;
  timezone: string | null;
  status: "available" | "selected" | "revoked";
  extra: Record<string, unknown>;
};

const GROUPS = [
  { key: "ads", label: "Google Ads", hint: "Managers are folders, not spendable accounts." },
  { key: "ga4", label: "Analytics", hint: "GA4 properties." },
  { key: "gsc", label: "Search Console", hint: "Verified properties." },
  { key: "gtm", label: "Tag Manager", hint: "Containers." },
] as const;

export function PickList({ initial }: { initial: InventoryRow[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [, startTransition] = useTransition();
  const router = useRouter();

  const selectedCount = rows.filter((r) => r.status === "selected").length;

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) =>
      [r.display_name, r.provider_id, r.domain ?? ""].some((v) => v.toLowerCase().includes(f))
    );
  }, [rows, filter]);

  async function discover() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/discovery", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? body.error ?? "Discovery failed.");
        return;
      }
      if (body.errors?.length) {
        setError(
          body.errors
            .map((e: { provider: string; message: string }) => `${e.provider}: ${e.message}`)
            .join(" · ")
        );
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: InventoryRow) {
    if (row.is_manager) return;
    const next = row.status === "selected" ? "available" : "selected";

    // Optimistic: the pick list should feel instant.
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));

    const res = await fetch("/api/inventory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [row.id], status: next }),
    });

    if (!res.ok) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      setError("Could not save that selection.");
    }
  }

  if (!rows.length) {
    return (
      <div className="sheet sheet-pad">
        <div className="empty">
          <h3>Nothing discovered yet</h3>
          <p style={{ maxWidth: 460, margin: "0 auto 20px" }}>
            Discovery reads what your Google account can reach across all four products.
            It only reads, and costs a handful of API operations.
          </p>
          <button className="btn btn-accent" onClick={discover} disabled={busy}>
            {busy && <span className="spinner" />}
            {busy ? "Looking…" : "Run discovery"}
          </button>
          {error && <p className="err" style={{ marginTop: 16 }}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="sheet toolbar">
        <input
          type="search"
          placeholder="Filter by name, id or domain…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="count meta">
          <strong className="num">{selectedCount}</strong> selected
        </span>
        <button className="btn btn-ghost btn-sm" onClick={discover} disabled={busy}>
          {busy && <span className="spinner" />}
          {busy ? "Looking…" : "Refresh"}
        </button>
      </div>

      {error && <div className="notice notice-bad">{error}</div>}

      {GROUPS.map((g) => {
        const items = filtered.filter((r) => r.provider === g.key);
        if (!items.length) return null;
        const spendable = items.filter((r) => !r.is_manager);
        const chosen = spendable.filter((r) => r.status === "selected").length;

        return (
          <section key={g.key} className="sheet sheet-pad">
            <div className="spread group-head">
              <div>
                <h2>{g.label}</h2>
                <p className="meta">{g.hint}</p>
              </div>
              <span className="pill">
                {chosen} / {spendable.length}
              </span>
            </div>

            <ul className="list">
              {items.map((r) => (
                <li key={r.id} className={r.is_manager ? "row manager" : "row"}>
                  <input
                    type="checkbox"
                    className="check"
                    checked={r.status === "selected"}
                    disabled={r.is_manager}
                    onChange={() => toggle(r)}
                    aria-label={`Select ${r.display_name}`}
                  />
                  <div className="grow info">
                    <span className="name">{r.display_name || r.provider_id}</span>
                    <span className="sub meta mono">
                      {r.provider_id}
                      {r.domain && <> · {r.domain}</>}
                      {r.parent_name && <> · {r.parent_name}</>}
                      {r.currency && <> · {r.currency}</>}
                    </span>
                  </div>
                  {r.is_manager && <span className="pill">manager</span>}
                  {!r.is_manager && r.status === "selected" && (
                    <span className="pill pill-good">importing</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
