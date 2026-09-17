"use client";

import { useMemo, useState } from "react";
import { money, count, pct, TYPE_LABEL, STRATEGY_LABEL } from "@/lib/format";
import { Delta } from "@/components/ui/bits";
import { useDensity } from "@/components/ui/DataTable";

export type CampaignRow = {
  id: string; name: string; status: string | null; type: string | null; strategy: string | null;
  client?: string; clientId?: number;
  dailyBudget: number | null; spend: number; clicks: number; impressions: number; conversions: number;
  cpa: number | null; ctr: number | null; spendChange: number | null; lostToBudget: number | null;
  health: { level: "good" | "okay" | "poor" | "off"; reason: string };
  currency?: string | null;
};

type Key = "name" | "spend" | "conversions" | "cpa" | "clicks" | "ctr" | "health";
const HEALTH_RANK = { poor: 0, okay: 1, good: 2, off: 3 };
const HEALTH_LABEL = { good: "Good", okay: "Okay", poor: "Poor", off: "Paused" };

/**
 * Every campaign, filterable and sortable. Health is good / okay / poor rather
 * than a bare score, and hovering it says why.
 */
export function CampaignTable({ rows, currency, showClient = false }: { rows: CampaignRow[]; currency: string | null; showClient?: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"running" | "all" | "paused">("running");
  const [type, setType] = useState("all");
  const [health, setHealth] = useState("all");
  const [client, setClient] = useState("all");
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "spend", dir: -1 });
  const [dense, setDense] = useDensity();

  const types = useMemo(() => [...new Set(rows.map((r) => r.type).filter(Boolean))] as string[], [rows]);
  const clients = useMemo(() => [...new Set(rows.map((r) => r.client).filter(Boolean))] as string[], [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => status === "all" || (status === "running" ? r.status === "ENABLED" : r.status !== "ENABLED"))
      .filter((r) => type === "all" || r.type === type)
      .filter((r) => health === "all" || r.health.level === health)
      .filter((r) => client === "all" || r.client === client)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.client ?? "").toLowerCase().includes(q))
      .sort((a, b) => {
        const v = (r: CampaignRow) =>
          sort.key === "name" ? r.name.toLowerCase()
          : sort.key === "health" ? HEALTH_RANK[r.health.level]
          : (r[sort.key] ?? (sort.dir === 1 ? Infinity : -Infinity));
        const x = v(a), y = v(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
  }, [rows, query, status, type, health, client, sort]);

  const th = (key: Key, label: string, right = false) => (
    <th
      className={`sortable${right ? " r" : ""}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
    >
      {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="card">
      <div className="table-tools">
        <input type="search" placeholder="Search campaigns…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="count-inline">{shown.length} of {rows.length}</span>
        <div className="tabs" role="tablist">
          {(["running", "paused", "all"] as const).map((s) => (
            <button key={s} className={`tab${status === s ? " active" : ""}`} onClick={() => setStatus(s)}>
              {s === "running" ? "Running" : s === "paused" ? "Paused" : "All"}
            </button>
          ))}
        </div>
        {showClient && clients.length > 1 && (
          <select value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
            <option value="all">All projects</option>
            {clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Campaign type">
          <option value="all">All types</option>
          {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
        </select>
        <select value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Health">
          <option value="all">Any health</option>
          <option value="poor">Poor</option>
          <option value="okay">Okay</option>
          <option value="good">Good</option>
        </select>
        <div className="right">
          <button className="btn btn-quiet btn-sm" onClick={() => setDense(!dense)} title="Row density">{dense ? "Comfortable" : "Compact"}</button>
        </div>
      </div>
      <div className="table-wrap scroll">
        <table className={dense ? "dense" : undefined}>
          <thead>
            <tr>
              {th("name", "Campaign")}
              {showClient && <th>Project</th>}
              <th className="sortable" title="Judged against this account's own cost per conversion, and only when the difference is more than chance" onClick={() => setSort((s) => ({ key: "health", dir: s.key === "health" ? (s.dir === 1 ? -1 : 1) : -1 }))}>
                Health <i className="info-tip">i</i>{sort.key === "health" ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </th>
              {th("spend", "Spend", true)}
              {th("conversions", "Conv.", true)}
              {th("cpa", "Cost / conv.", true)}
              {th("clicks", "Clicks", true)}
              {th("ctr", "CTR", true)}
              <th className="r">Budget / day</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const cur = r.currency ?? currency;
              return (
                <tr key={`${r.clientId ?? ""}-${r.id}`}>
                  <td>
                    <div className="cell-name">{r.name}</div>
                    <div className="cell-sub">{TYPE_LABEL[r.type ?? ""] ?? r.type} · {STRATEGY_LABEL[r.strategy ?? ""] ?? r.strategy ?? "—"}</div>
                  </td>
                  {showClient && <td>{r.clientId ? <a href={`/clients/${r.clientId}`}>{r.client}</a> : r.client}</td>}
                  <td><span className={`health ${r.health.level}`} title={r.health.reason}>{HEALTH_LABEL[r.health.level]}</span></td>
                  <td className="num r">
                    {money(r.spend, cur)}
                    {r.spendChange != null && <div><Delta change={r.spendChange} /></div>}
                  </td>
                  <td className="num r">{count(r.conversions, 1)}</td>
                  <td className="num r">{money(r.cpa, cur)}</td>
                  <td className="num r">{count(r.clicks)}</td>
                  <td className="num r">{pct(r.ctr)}</td>
                  <td className="num r">
                    {money(r.dailyBudget, cur)}
                    {r.lostToBudget != null && r.lostToBudget >= 0.1 && <div className="cell-sub">{pct(r.lostToBudget, 0)} lost to budget</div>}
                  </td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={showClient ? 9 : 8}><div className="empty">No campaigns match.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
