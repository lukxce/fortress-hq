/** Two small lines: this window solid, the previous window dashed (the GA4 pattern). No axis. */
export function Sparkline({ current, previous, width = 120, height = 26, lowerIsBetter = false }: {
  current: (number | null)[]; previous?: (number | null)[]; width?: number; height?: number; lowerIsBetter?: boolean;
}) {
  const all = [...current, ...(previous ?? [])].filter((v): v is number => v != null && Number.isFinite(v));
  if (all.length < 2) return null;
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const path = (vals: (number | null)[]) => {
    const step = vals.length > 1 ? width / (vals.length - 1) : width;
    let d = "", pen = false;
    vals.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      const x = i * step, y = height - 2 - ((v - min) / span) * (height - 4);
      d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const first = current.find((v) => v != null), last = [...current].reverse().find((v) => v != null);
  const up = first != null && last != null && last > first;
  const colour = first == null || last == null || first === last ? "var(--ink-3)" : up !== lowerIsBetter ? "var(--ok)" : "var(--bad)";
  return (
    <svg className="spark" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      {previous && <path d={path(previous)} fill="none" stroke="var(--ink-4)" strokeWidth="1.25" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      <path d={path(current)} fill="none" stroke={colour} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
