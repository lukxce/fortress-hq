import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { lastRun, brainConfigured } from "@/lib/brain/recommend";
import { money, ago, AREA_LABEL } from "@/lib/format";
import { JobButton } from "@/components/ui/JobButtons";
import { RecommendationCard, type Rec } from "@/components/insights/RecommendationCard";

export const dynamic = "force-dynamic";

// Tracking first, because every other number depends on it; then money
// leaving; then the rest.
const AREA_ORDER = ["tracking", "waste", "budget", "bidding", "schedule", "targeting", "opportunity", "creative", "structure"];

export default async function WhatToChange({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const cur = client.currency;
  const [recs, run, doneCount] = await Promise.all([
    q<any>(`SELECT r.*, e.id AS experiment_id, e.status AS experiment_status
              FROM recommendations r
              LEFT JOIN experiments e ON e.recommendation_id = r.id
             WHERE r.client_id = $1 AND r.status = 'open'
             ORDER BY CASE r.severity WHEN 'do_first' THEN 0 WHEN 'worth_doing' THEN 1 ELSE 2 END,
                      r.monthly_impact DESC NULLS LAST, r.id`, [client.id]),
    lastRun(client.id),
    q<{ n: number }>(`SELECT count(*)::int AS n FROM recommendations WHERE client_id = $1 AND status = 'done'
                        AND updated_at > now() - interval '30 days'`, [client.id]),
  ]);

  const total = recs.reduce((n, r) => n + (Number(r.monthly_impact) || 0), 0);
  const groups = AREA_ORDER.map((a) => ({ area: a, items: recs.filter((r) => r.area === a) }))
    .concat([{ area: "other", items: recs.filter((r) => !AREA_ORDER.includes(r.area)) }])
    .filter((g) => g.items.length);

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">What to change</div>
          <h1>{client.name}</h1>
          <p className="meta">
            {run ? `Analysed ${ago(run.created_at)} · ${run.insights_count} written${run.skipped_count ? `, ${run.skipped_count} skipped` : ""}${Number(run.cost_usd) ? ` · $${Number(run.cost_usd).toFixed(2)}` : ""}` : "Not analysed yet"}
            {doneCount[0]?.n ? ` · ${doneCount[0].n} done in the last 30 days` : ""}
          </p>
        </div>
        {brainConfigured() && (
          <JobButton clientId={client.id} job="analyse" label={run ? "Analyse again" : "Work out what to change"} busyLabel="Thinking… (about a minute)" primary />
        )}
      </header>

      {recs.length > 0 && (
        <div className="card card-pad">
          <div className="impact-banner">
            <span className="label">Roughly on the table</span>
            <span className="big">{money(total, cur)}<span className="meta" style={{ fontSize: 15, marginLeft: 6 }}>a month</span></span>
          </div>
          {run?.summary && <p className="lede" style={{ marginTop: 8 }}>{run.summary}</p>}
          <p className="meta" style={{ marginTop: 6 }}>
            Only spend above what its conversions were worth counts, summed from the measured findings — never a figure the AI produced.
          </p>
        </div>
      )}

      {!recs.length && (
        <div className="card card-pad">
          <div className="empty">
            <h3>{run ? "Nothing open" : "No recommendations yet"}</h3>
            <p style={{ maxWidth: 480, margin: "0 auto 16px" }}>
              {run
                ? "Everything from the last analysis is done or dismissed. Run it again after the next sync to see what has changed."
                : "The analysis measures the account first — every figure comes from the data — then writes what to change, in order, with the exact clicks."}
            </p>
            {!brainConfigured() && <p className="err">ANTHROPIC_API_KEY is not set, so analysis is unavailable.</p>}
          </div>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.area} className="area-group">
          <h2>{AREA_LABEL[g.area] ?? "Other"} <span className="pill">{g.items.length}</span></h2>
          <div className="stack">
            {g.items.map((r) => (
              <RecommendationCard key={r.id} clientId={client.id} currency={cur} rec={r as Rec} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
