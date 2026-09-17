import { arrow, tone, money, count, pct } from "@/lib/format";
import type { Metric } from "@/lib/report";

/** A change: the arrow shows the real direction, the colour shows good or bad. */
export function Delta({ change, lowerIsBetter = false, label }: { change: number | null | undefined; lowerIsBetter?: boolean; label?: string }) {
  return (
    <span className={`delta ${tone(change, lowerIsBetter)}`} title={label}>
      {arrow(change)}
    </span>
  );
}

export function fmtMetric(m: Pick<Metric, "format">, v: number | null, currency: string | null) {
  if (m.format === "money") return money(v, currency);
  if (m.format === "pct") return pct(v);
  if (m.format === "decimal") return count(v, 1);
  return count(v);
}

export function StatCard({ metric, currency, versus }: { metric: Metric; currency: string | null; versus: string }) {
  return (
    <div className="card stat">
      <span className="label">{metric.label}</span>
      <div className="stat-value">{fmtMetric(metric, metric.current, currency)}</div>
      <div className="stat-foot">
        <Delta change={metric.change} lowerIsBetter={metric.lowerIsBetter} />
        <span>{versus}</span>
      </div>
    </div>
  );
}

/** Spend per day; days with no conversions render grey. */
export function SpendBars({ series, currency, legend = true }: { series: { date: string; spend: number; conversions: number }[]; currency: string | null; legend?: boolean }) {
  if (!series.length) return <p className="meta">No spend in this period.</p>;
  const max = Math.max(...series.map((s) => s.spend), 1);
  return (
    <div>
      <div className="bars" role="img" aria-label="Spend per day">
        {series.map((s) => (
          <div
            key={s.date}
            className={`bar${s.conversions === 0 ? " zero" : ""}`}
            style={{ height: `${Math.max(2, (s.spend / max) * 100)}%` }}
            title={`${s.date}: ${money(s.spend, currency)} · ${count(s.conversions, 1)} conversions`}
          />
        ))}
      </div>
      <div className="bar-axis"><span>{series[0].date}</span><span>{series[series.length - 1].date}</span></div>
      {legend && <div className="chart-legend" style={{ marginTop: 10 }}>
        <span><i style={{ background: "var(--blue)" }} />Spend on days with conversions</span>
        <span><i style={{ background: "var(--ink-4)", opacity: 0.55 }} />Days with no conversions</span>
      </div>}
    </div>
  );
}

/** 24 hours, each coloured against the account's own cost per conversion. */
export function HourBars({ hours, currency }: { hours: { hour: number; spend: number; conversions: number; cpa: number | null; tone: string }[]; currency: string | null }) {
  const max = Math.max(...hours.map((h) => h.spend), 1);
  return (
    <div>
      <div className="bars" role="img" aria-label="Spend by hour of day">
        {hours.map((h) => (
          <div
            key={h.hour}
            className={`bar ${h.tone}`}
            style={{ height: `${h.spend > 0 ? Math.max(3, (h.spend / max) * 100) : 2}%` }}
            title={`${String(h.hour).padStart(2, "0")}:00 — ${money(h.spend, currency)}, ${count(h.conversions, 1)} conversions${h.cpa ? `, ${money(h.cpa, currency)} each` : ""}`}
          />
        ))}
      </div>
      <div className="bar-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
      <div className="chart-legend" style={{ marginTop: 10 }}>
        <span><i style={{ background: "#2f9e5b" }} />Cheaper than your average conversion</span>
        <span><i style={{ background: "#e0a23a" }} />Up to double</span>
        <span><i style={{ background: "#d94141" }} />Double or more, or nothing after a conversion&rsquo;s worth of spend</span>
      </div>
    </div>
  );
}

export function EvidenceTable({ table }: { table: { columns: string[]; rows: (string | number | null)[][] } }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j} className={typeof v === "number" ? "num r" : undefined}>{typeof v === "number" ? v.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : (v ?? "—")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
