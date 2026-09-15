"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Totals = {
  spend: number; clicks: number; impressions: number;
  conversions: number; conversionValue: number;
  cpa: number | null; roas: number | null; cpc: number | null;
  ctr: number | null; cvr: number | null;
};

type Props = {
  client: {
    id: number; name: string;
    goalType: "cpa" | "roas" | null;
    targetCpa: number | null; targetRoas: number | null;
    currency: string | null;
    hasAnalytics: boolean; hasSearchConsole: boolean; hasTagManager: boolean;
  };
  current: Totals;
  previous: Totals;
  pacing: {
    monthSpend: number; monthlyBudget: number | null;
    daysElapsed: number; daysInMonth: number;
    projected: number; variancePct: number | null; dailyAverage: number;
  };
  campaigns: any[];
  series: { date: string; spend: number; conversions: number }[];
  findings: any[];
  insights: any[];
  lastSync: string | null;
  lastAnalysis: string | null;
  analysisCost: number | null;
  brainAvailable: boolean;
};

export function Briefing(p: Props) {
  const [busy, setBusy] = useState<null | "sync" | "analyse">(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const cur = p.client.currency ?? "";
  const money = (n: number, dp = 0) =>
    `${n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}${cur ? ` ${cur}` : ""}`;

  const critical = p.findings.filter((f) => f.severity === "critical");
  const warnings = p.findings.filter((f) => f.severity === "warning");
  const trackingBroken = critical.some((f) =>
    ["ads_tracking_broken", "tracking_silent_everywhere", "conversion_multi_counting"].includes(f.kind)
  );

  async function run(kind: "sync" | "analyse") {
    setBusy(kind);
    setError(null);
    try {
      const url = kind === "sync" ? `/api/sync?client=${p.client.id}` : `/api/analyse?client=${p.client.id}`;
      const res = await fetch(url, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.message ?? body.error ?? "That did not work."); return; }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const noData = p.current.spend === 0 && p.current.impressions === 0;

  return (
    <div className="stack rise">
      <header className="spread brief-head">
        <div>
          <h1>{p.client.name}</h1>
          <p className="meta">
            Last 30 days
            {p.lastSync && <> · synced {ago(p.lastSync)}</>}
            {p.lastAnalysis && <> · analysed {ago(p.lastAnalysis)}</>}
          </p>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => run("sync")} disabled={busy !== null}>
            {busy === "sync" && <span className="spinner" />}
            {busy === "sync" ? "Pulling…" : "Sync now"}
          </button>
          {p.brainAvailable && !noData && (
            <button className="btn btn-accent btn-sm" onClick={() => run("analyse")} disabled={busy !== null}>
              {busy === "analyse" && <span className="spinner" />}
              {busy === "analyse" ? "Thinking…" : "Analyse"}
            </button>
          )}
        </div>
      </header>

      {error && <div className="notice notice-bad">{error}</div>}

      {noData ? (
        <div className="sheet sheet-pad">
          <div className="empty">
            <h3>Nothing pulled yet</h3>
            <p style={{ maxWidth: 440, margin: "0 auto 20px" }}>
              Sync reads a year of daily performance, 90 days of search terms, and
              whatever Analytics and Search Console are connected. Roughly twenty
              API operations.
            </p>
            <button className="btn btn-accent" onClick={() => run("sync")} disabled={busy !== null}>
              {busy === "sync" && <span className="spinner" />}
              {busy === "sync" ? "Pulling…" : "Pull the data"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* The verdict, before any numbers. */}
          <Verdict
            critical={critical}
            warnings={warnings}
            trackingBroken={trackingBroken}
            money={money}
          />

          <div className="kpis">
            <Kpi label="Spend" value={money(p.current.spend)} prev={p.previous.spend} cur={p.current.spend} invert />
            <Kpi label="Conversions" value={p.current.conversions.toFixed(0)} prev={p.previous.conversions} cur={p.current.conversions} />
            {p.client.goalType === "roas" ? (
              <Kpi
                label="Return on ad spend"
                value={p.current.roas !== null ? `${p.current.roas.toFixed(2)}x` : "—"}
                prev={p.previous.roas ?? 0} cur={p.current.roas ?? 0}
                target={p.client.targetRoas ? `${p.client.targetRoas.toFixed(2)}x target` : undefined}
                onTarget={p.client.targetRoas != null && p.current.roas != null ? p.current.roas >= p.client.targetRoas : undefined}
              />
            ) : (
              <Kpi
                label="Cost per conversion"
                value={p.current.cpa !== null ? money(p.current.cpa, 2) : "—"}
                prev={p.previous.cpa ?? 0} cur={p.current.cpa ?? 0} invert
                target={p.client.targetCpa ? `${money(p.client.targetCpa, 2)} target` : undefined}
                onTarget={p.client.targetCpa != null && p.current.cpa != null ? p.current.cpa <= p.client.targetCpa : undefined}
              />
            )}
            <Pacing p={p.pacing} money={money} />
          </div>

          <Chart series={p.series} money={money} />

          {p.insights.length > 0 && <Insights insights={p.insights} />}

          {p.findings.length > 0 && <Findings findings={p.findings} money={money} />}

          <Campaigns campaigns={p.campaigns} money={money} goalType={p.client.goalType} />

          <Coverage client={p.client} />

          {p.analysisCost !== null && (
            <p className="meta" style={{ textAlign: "right" }}>
              Last analysis cost ${p.analysisCost.toFixed(3)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- verdict --

function Verdict({ critical, warnings, trackingBroken, money }: any) {
  if (trackingBroken) {
    const f = critical.find((x: any) =>
      ["ads_tracking_broken", "tracking_silent_everywhere", "conversion_multi_counting"].includes(x.kind)
    );
    return (
      <section className="sheet sheet-pad verdict verdict-bad">
        <span className="pill pill-bad">Measurement first</span>
        <h2>{f.title}</h2>
        <p>{f.detail}</p>
        <p className="verdict-note">
          Everything below is calculated from the conversion number, so treat
          every efficiency figure on this page as unreliable until this is fixed.
        </p>
      </section>
    );
  }
  if (critical.length) {
    const stake = critical.reduce((n: number, f: any) => n + Number(f.money_at_stake_micros ?? 0) / 1e6, 0);
    return (
      <section className="sheet sheet-pad verdict verdict-bad">
        <span className="pill pill-bad">{critical.length} needing action</span>
        <h2>{critical[0].title}</h2>
        <p>{critical[0].detail}</p>
        {stake > 0 && <p className="verdict-note">About {money(stake)} is tied up in what is flagged below.</p>}
      </section>
    );
  }
  if (warnings.length) {
    return (
      <section className="sheet sheet-pad verdict">
        <span className="pill pill-warn">{warnings.length} worth looking at</span>
        <h2>{warnings[0].title}</h2>
        <p>{warnings[0].detail}</p>
      </section>
    );
  }
  return (
    <section className="sheet sheet-pad verdict verdict-good">
      <span className="beacon">Nothing on fire</span>
      <h2 style={{ marginTop: 16 }}>No problems detected.</h2>
      <p>Tracking looks sound, pacing is within range, and no campaign is spending without return.</p>
    </section>
  );
}

// ------------------------------------------------------------------- kpi ---

function Kpi({ label, value, prev, cur, invert, target, onTarget }: any) {
  const change = prev > 0 ? ((cur - prev) / prev) * 100 : null;
  const good = change === null ? null : invert ? change < 0 : change > 0;
  return (
    <div className="sheet kpi">
      <span className="label">{label}</span>
      <span className="kpi-value num">{value}</span>
      <div className="kpi-foot">
        {change !== null && Math.abs(change) >= 1 && (
          <span className={`delta ${good ? "up" : "down"}`}>
            {change > 0 ? "↑" : "↓"} {Math.abs(change).toFixed(0)}%
          </span>
        )}
        {target && (
          <span className={`pill ${onTarget === undefined ? "" : onTarget ? "pill-good" : "pill-bad"}`}>
            {target}
          </span>
        )}
      </div>
    </div>
  );
}

function Pacing({ p, money }: any) {
  if (!p.monthlyBudget) {
    return (
      <div className="sheet kpi">
        <span className="label">This month</span>
        <span className="kpi-value num">{money(p.monthSpend)}</span>
        <div className="kpi-foot"><span className="meta">no budget set</span></div>
      </div>
    );
  }
  const pct = (p.monthSpend / p.monthlyBudget) * 100;
  const expected = (p.daysElapsed / p.daysInMonth) * 100;
  const over = (p.variancePct ?? 0) > 12;
  const under = (p.variancePct ?? 0) < -12;
  return (
    <div className="sheet kpi">
      <span className="label">Pacing</span>
      <span className="kpi-value num">{money(p.monthSpend)}</span>
      <div className="pace-bar">
        <div className="pace-fill" style={{ width: `${Math.min(100, pct)}%` }} />
        <div className="pace-marker" style={{ left: `${Math.min(100, expected)}%` }} />
      </div>
      <div className="kpi-foot">
        <span className={`pill ${over ? "pill-bad" : under ? "pill-warn" : "pill-good"}`}>
          {over ? "ahead of plan" : under ? "behind plan" : "on plan"}
        </span>
        <span className="meta">{money(p.projected)} projected</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- chart ---

function Chart({ series, money }: any) {
  if (series.length < 2) return null;
  const w = 1000, h = 180, pad = 8;
  const maxSpend = Math.max(...series.map((s: any) => s.spend), 1);
  const maxConv = Math.max(...series.map((s: any) => s.conversions), 1);
  const x = (i: number) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const ySpend = (v: number) => h - pad - (v / maxSpend) * (h - pad * 2);
  const yConv = (v: number) => h - pad - (v / maxConv) * (h - pad * 2);

  const line = (accessor: (s: any) => number, scale: (v: number) => number) =>
    series.map((s: any, i: number) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${scale(accessor(s)).toFixed(1)}`).join(" ");

  const area = `${line((s: any) => s.spend, ySpend)} L ${x(series.length - 1).toFixed(1)} ${h - pad} L ${x(0).toFixed(1)} ${h - pad} Z`;

  return (
    <section className="sheet sheet-pad">
      <div className="spread" style={{ marginBottom: 14 }}>
        <h2>Last 60 days</h2>
        <div className="row legend">
          <span><i className="swatch swatch-spend" /> spend</span>
          <span><i className="swatch swatch-conv" /> conversions</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="chart" preserveAspectRatio="none" role="img"
           aria-label={`Daily spend peaking at ${money(maxSpend)} and conversions peaking at ${maxConv.toFixed(0)}`}>
        <path d={area} className="area" />
        <path d={line((s: any) => s.spend, ySpend)} className="line-spend" />
        <path d={line((s: any) => s.conversions, yConv)} className="line-conv" />
      </svg>
      <div className="spread meta" style={{ marginTop: 6 }}>
        <span>{series[0].date}</span>
        <span>peak {money(maxSpend)}/day</span>
        <span>{series[series.length - 1].date}</span>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- insights ---

function Insights({ insights }: any) {
  return (
    <section className="sheet sheet-pad">
      <div className="spread" style={{ marginBottom: 4 }}>
        <h2>What I would do</h2>
        <span className="meta">interpretation, not measurement</span>
      </div>
      <ul className="insights">
        {insights.map((i: any) => (
          <li key={i.id}>
            <div className="ins-head">
              <span className={`rank rank-${i.priority}`}>{i.priority}</span>
              <div className="grow">
                <strong>{i.headline}</strong>
                <span className="pill">{i.category}</span>
              </div>
            </div>
            <p className="ins-summary">{i.summary}</p>
            {i.rationale && <p className="ins-why meta">{i.rationale}</p>}
            {Array.isArray(i.next_steps) && i.next_steps.length > 0 && (
              <ol className="steps">
                {i.next_steps.map((s: string, n: number) => <li key={n}>{s}</li>)}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// -------------------------------------------------------------- findings ---

function Findings({ findings, money }: any) {
  return (
    <section className="sheet sheet-pad">
      <div className="spread" style={{ marginBottom: 4 }}>
        <h2>Detected</h2>
        <span className="meta">measured, not inferred</span>
      </div>
      <ul className="findings">
        {findings.map((f: any) => {
          const stake = f.money_at_stake_micros ? Number(f.money_at_stake_micros) / 1e6 : null;
          return (
            <li key={f.id} className={f.severity}>
              <span className="dot-sev" />
              <div className="grow">
                <div className="find-head">
                  <strong>{f.title}</strong>
                  {stake != null && stake > 0 && <span className="pill">{money(stake)}</span>}
                </div>
                <p className="meta">{f.detail}</p>
                <Evidence evidence={f.evidence} money={money} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Evidence({ evidence, money }: any) {
  const terms = evidence?.topTerms ?? evidence?.queries;
  if (!Array.isArray(terms) || !terms.length) return null;
  return (
    <div className="evidence">
      {terms.slice(0, 6).map((t: any, i: number) => (
        <span key={i} className="ev-item">
          <span className="mono">{t.term ?? t.query}</span>
          <span className="dim">{money(Number(t.cost ?? t.paidSpend ?? 0), 2)}</span>
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- campaigns ---

function Campaigns({ campaigns, money, goalType }: any) {
  const live = campaigns.filter((c: any) => c.spend > 0);
  if (!live.length) return null;
  return (
    <section className="sheet sheet-pad">
      <h2 style={{ marginBottom: 14 }}>Campaigns</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th className="right">Spend</th>
              <th className="right">Conv.</th>
              <th className="right">{goalType === "roas" ? "ROAS" : "CPA"}</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {live.map((c: any) => (
              <tr key={c.campaign_id}>
                <td className="ink">{c.name}</td>
                <td className="right num">{money(c.spend)}</td>
                <td className="right num">{c.conversions.toFixed(0)}</td>
                <td className="right num">
                  {goalType === "roas"
                    ? c.roas !== null ? `${c.roas.toFixed(2)}x` : "—"
                    : c.cpa !== null ? money(c.cpa, 2) : "—"}
                </td>
                <td>
                  {c.conversions === 0 && c.spend > 0
                    ? <span className="pill pill-bad">no conversions</span>
                    : c.primary_status === "ELIGIBLE"
                      ? <span className="pill pill-good">running</span>
                      : <span className="pill">{(c.primary_status ?? c.status ?? "").toLowerCase()}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- coverage ---

function Coverage({ client }: any) {
  const missing = [
    !client.hasAnalytics && "Analytics",
    !client.hasSearchConsole && "Search Console",
    !client.hasTagManager && "Tag Manager",
  ].filter(Boolean) as string[];
  if (!missing.length) return null;
  return (
    <div className="notice notice-warn">
      <strong>{missing.join(" and ")} not connected.</strong>{" "}
      {missing.includes("Analytics")
        ? "Without Analytics, a campaign spending with no conversions cannot be told apart from a broken tag — which is the single most valuable check this tool makes."
        : "Connecting it would widen what can be checked."}
    </div>
  );
}

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
