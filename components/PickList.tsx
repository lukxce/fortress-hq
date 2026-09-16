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
  projects: { id: number; name: string }[];
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

  const [pending, setPending] = useState<number | null>(null);

  async function change(row: InventoryRow, action: "connect" | "disconnect") {
    if (row.is_manager) return;
    if (action === "disconnect") {
      const where = row.projects.length
        ? `\n\nThis stops pulling it into ${row.projects.map((p) => `"${p.name}"`).join(", ")} and removes the data already pulled from it there. The project${row.projects.length === 1 ? "" : "s"} stay${row.projects.length === 1 ? "s" : ""}; delete a project in its settings.`
        : "";
      if (!confirm(`Disconnect ${row.display_name || row.provider_id}?${where}`)) return;
    }
    setPending(row.id);
    setError(null);
    const res = await fetch("/api/inventory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [row.id], action }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(null);
    if (!res.ok) return setError(body.error ?? "Could not change that.");
    if (body.blockedIn?.length) setError(`Still read by ${body.blockedIn.join(", ")}, which you cannot manage.`);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: action === "connect" ? "selected" : "available", projects: action === "disconnect" ? r.projects.filter((p) => body.blockedIn?.includes(p.name)) : r.projects } : r)));
    startTransition(() => router.refresh());
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
          <strong className="num">{selectedCount}</strong> connected
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
                  <div className="grow info">
                    <span className="name">{r.display_name || r.provider_id}</span>
                    <span className="sub meta mono">
                      {r.provider_id}
                      {r.domain && <> · {r.domain}</>}
                      {r.parent_name && <> · {r.parent_name}</>}
                      {r.currency && <> · {r.currency}</>}
                    </span>
                  </div>
                  {r.is_manager ? <span className="pill">manager</span> : (
                    <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                      {r.status === "selected" || r.projects.length ? (
                        <>
                          <span className="pill pill-good" title={r.projects.map((p) => p.name).join(", ")}>
                            {r.projects.length ? `Connected · ${r.projects.length === 1 ? r.projects[0].name : `${r.projects.length} projects`}` : "Connected"}
                          </span>
                          <button className="btn btn-sm" disabled={pending === r.id} onClick={() => change(r, "disconnect")}>
                            {pending === r.id ? "…" : "Disconnect"}
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-sm btn-primary" disabled={pending === r.id} onClick={() => change(r, "connect")}>
                          {pending === r.id ? "…" : "Connect"}
                        </button>
                      )}
                    </div>
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
