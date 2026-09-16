"use client";

import { useMemo, useState } from "react";
import { money, count, pct } from "@/lib/format";

export type Column = {
  key: string;
  label: string;
  format?: "text" | "count" | "decimal" | "pct" | "money" | "position" | "url";
  /** Shown under the value, from another field of the row. */
  sub?: string;
  hint?: string;
};

type Row = Record<string, string | number | null>;

/**
 * Any list worth reading: searchable, sortable, and with one optional
 * filter over a column's values. Formats are named rather than passed as
 * functions, so server pages can hand it plain rows.
 */
export function DataTable({ columns, rows, search, filter, currency, empty = "Nothing to show.", initialSort, limit = 500 }: {
  columns: Column[]; rows: Row[]; search?: string; currency?: string | null; empty?: string;
  filter?: { key: string; label: string };
  initialSort?: { key: string; dir: 1 | -1 };
  limit?: number;
}) {
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState("all");
  const [sort, setSort] = useState(initialSort ?? { key: columns.find((c) => c.format && c.format !== "text" && c.format !== "url")?.key ?? columns[0].key, dir: -1 as 1 | -1 });

  const options = useMemo(() => filter ? [...new Set(rows.map((r) => r[filter.key]).filter((v) => v != null && v !== ""))].map(String).sort() : [], [rows, filter]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const textKeys = columns.filter((c) => !c.format || c.format === "text" || c.format === "url").map((c) => c.key);
    return rows
      .filter((r) => !filter || pick === "all" || String(r[filter.key]) === pick)
      .filter((r) => !q || textKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
  }, [rows, query, pick, sort, columns, filter]);

  const cell = (c: Column, v: string | number | null) => {
    if (v == null || v === "") return "—";
    switch (c.format) {
      case "count": return count(Number(v));
      case "decimal": return count(Number(v), 1);
      case "pct": return pct(Number(v));
      case "money": return money(Number(v), currency);
      case "position": return Number(v).toFixed(1);
      case "url": return shortUrl(String(v));
      default: return String(v);
    }
  };
  const numeric = (c: Column) => c.format && c.format !== "text" && c.format !== "url";

  return (
    <div className="card">
      {(search || filter) && (
        <div className="table-tools">
          {search && <input type="search" placeholder={search} value={query} onChange={(e) => setQuery(e.target.value)} />}
          {filter && options.length > 1 && (
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={filter.label}>
              <option value="all">{filter.label}: all</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          <span className="meta" style={{ marginLeft: "auto" }}>{Math.min(shown.length, limit)} of {rows.length}</span>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} title={c.hint} className={`sortable${numeric(c) ? " r" : ""}`}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : numeric(c) ? -1 : 1 }))}>
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r, i) => (
              <tr key={i}>
                {columns.map((c, j) => (
                  <td key={c.key} className={numeric(c) ? "num r" : undefined} title={c.format === "url" ? String(r[c.key] ?? "") : undefined}>
                    <div className={j === 0 ? "cell-name" : undefined}>{cell(c, r[c.key])}</div>
                    {c.sub && r[c.sub] != null && <div className="cell-sub">{String(r[c.sub])}</div>}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={columns.length}><div className="empty">{empty}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function shortUrl(u: string) {
  try {
    const x = new URL(u);
    return (x.pathname + x.search) || "/";
  } catch {
    return u;
  }
}
