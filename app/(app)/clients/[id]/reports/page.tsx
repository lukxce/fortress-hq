import { pageClient } from "@/lib/page";
import { weeklyReport } from "@/lib/report";
import { money, count, dateShort, pct, TYPE_LABEL } from "@/lib/format";
import { Delta, HourBars, SpendBars, fmtMetric } from "@/components/ui/bits";

export const dynamic = "force-dynamic";

const DAY = { MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday", THURSDAY: "Thursday", FRIDAY: "Friday", SATURDAY: "Saturday", SUNDAY: "Sunday" } as const;
const DEVICE: Record<string, string> = { MOBILE: "Mobile", DESKTOP: "Desktop", TABLET: "Tablet", CONNECTED_TV: "Connected TV", OTHER: "Other" };

export default async function Reports({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const cur = client.currency;
  const r = await weeklyReport(client.id);
  const last = `${dateShort(r.weeks.last.from)}–${dateShort(new Date(new Date(r.weeks.last.to).getTime() - 864e5))}`;
  const prev = `${dateShort(r.weeks.previous.from)}–${dateShort(new Date(new Date(r.weeks.previous.to).getTime() - 864e5))}`;
  const devTotal = r.devices.reduce((n, d) => n + d.spend, 0);

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Reports</div>
          <h1>Week over week</h1>
          <p className="meta">{last} against {prev}. Complete weeks only — a partial week makes every comparison look like a collapse. No AI in this page.</p>
        </div>
      </header>

      <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        {r.metrics.map((m) => (
          <div key={m.key} className="card stat">
            <span className="label">{m.label}</span>
            <div className="stat-value" style={{ fontSize: 20 }}>{fmtMetric(m, m.current, cur)}</div>
            <div className="stat-foot"><Delta change={m.change} lowerIsBetter={m.lowerIsBetter} /><span>was {fmtMetric(m, m.previous, cur)}</span></div>
          </div>
        ))}
      </div>

      <div className="card card-pad">
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2>Spend by hour of day</h2>
          <span className="meta">90 days{r.accountCpa90 ? ` · coloured against your ${money(r.accountCpa90, cur)} cost per conversion` : ""}</span>
        </div>
        {r.hours.some((h) => h.spend > 0) ? <HourBars hours={r.hours} currency={cur} /> : <p className="meta">Sync to see the hour-by-hour shape.</p>}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Day of week</h2><span className="meta">90 days</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Day</th><th className="r">Spend</th><th className="r">Clicks</th><th className="r">Conv.</th><th className="r">Cost / conv.</th></tr></thead>
              <tbody>
                {r.days.map((d) => {
                  const bad = r.accountCpa90 && (d.cpa == null ? d.spend >= r.accountCpa90 : d.cpa >= r.accountCpa90 * 2);
                  const good = r.accountCpa90 && d.cpa != null && d.cpa <= r.accountCpa90;
                  return (
                    <tr key={d.day}>
                      <td className="cell-name">{DAY[d.day as keyof typeof DAY]}</td>
                      <td className="num r">{money(d.spend, cur)}</td>
                      <td className="num r">{count(d.clicks)}</td>
                      <td className="num r">{count(d.conversions, 1)}</td>
                      <td className={`num r ${bad ? "bad-text" : good ? "ok-text" : ""}`}>{money(d.cpa, cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Devices</h2><span className="meta">90 days</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Device</th><th className="r">Share</th><th className="r">Spend</th><th className="r">Conv.</th><th className="r">Cost / conv.</th></tr></thead>
              <tbody>
                {r.devices.map((d) => (
                  <tr key={d.key}>
                    <td className="cell-name">{DEVICE[d.key] ?? d.key}</td>
                    <td className="num r">{pct(devTotal ? d.spend / devTotal : null, 0)}</td>
                    <td className="num r">{money(d.spend, cur)}</td>
                    <td className="num r">{count(d.conversions, 1)}</td>
                    <td className="num r">{money(d.cpa, cur)}</td>
                  </tr>
                ))}
                {!r.devices.length && <tr><td colSpan={5} className="meta">No device data yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Campaign movement</h2><span className="meta">{last} vs {prev}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Campaign</th><th className="r">Spend</th><th className="r">Change</th><th className="r">Conv.</th><th className="r">Was</th><th className="r">Cost / conv.</th><th className="r">Change</th></tr></thead>
            <tbody>
              {r.campaigns.map((c) => (
                <tr key={c.id}>
                  <td><div className="cell-name">{c.name}</div><div className="cell-sub">{TYPE_LABEL[c.type ?? ""] ?? c.type}</div></td>
                  <td className="num r">{money(c.spend, cur)}</td>
                  <td className="r"><Delta change={c.spendChange} /></td>
                  <td className="num r">{count(c.conversions, 1)}</td>
                  <td className="num r dim">{count(c.conversionsPrev, 1)}</td>
                  <td className="num r">{money(c.cpa, cur)}</td>
                  <td className="r"><Delta change={c.cpaChange} lowerIsBetter /></td>
                </tr>
              ))}
              {!r.campaigns.length && <tr><td colSpan={7} className="meta">No spend in either week.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="meta card-pad" style={{ paddingTop: 12 }}>
          One week holds few conversions on an account this size, so a large swing in cost per conversion is often noise. The trend and the What to change page apply the statistical tests; this page only describes.
        </p>
      </div>

      <div className="card card-pad">
        <div className="spread" style={{ marginBottom: 14 }}><h2>Eight weeks</h2><span className="meta">daily spend; grey days had no conversions</span></div>
        <SpendBars series={r.series} currency={cur} />
      </div>
    </div>
  );
}
