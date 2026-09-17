import Link from "next/link";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { lastRun, brainConfigured } from "@/lib/brain/recommend";
import { money, ago, AREA_LABEL, PRODUCT_LABEL } from "@/lib/format";
import { JobButton } from "@/components/ui/JobButtons";
import { RecommendationCard, type Rec, type TrackRecord } from "@/components/insights/RecommendationCard";

export const dynamic = "force-dynamic";

const PRODUCTS = ["ads", "analytics", "search_console", "tag_manager", "business_profile", "website", "cross"];

/**
 * One list, in the order to work it: severity, then money. Product and area
 * are filters, not headings — an operator works top-down by consequence.
 */
export default async function WhatToChange({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ product?: string; area?: string }>;
}) {
  const client = await pageClient(params);
  const sp = await searchParams;
  const product = sp.product && PRODUCTS.includes(sp.product) ? sp.product : null;
  const area = sp.area && sp.area in AREA_LABEL ? sp.area : null;
  const cur = client.currency;

  const [all, run, doneCount, record] = await Promise.all([
    q<any>(`SELECT r.*, e.id AS experiment_id, e.status AS experiment_status
              FROM recommendations r
              LEFT JOIN experiments e ON e.recommendation_id = r.id
             WHERE r.client_id = $1 AND r.status = 'open'
             ORDER BY CASE r.severity WHEN 'do_first' THEN 0 WHEN 'worth_doing' THEN 1 ELSE 2 END,
                      r.monthly_impact DESC NULLS LAST, r.id`, [client.id]),
    lastRun(client.id),
    q<{ n: number }>(`SELECT count(*)::int AS n FROM recommendations WHERE client_id = $1 AND status = 'done'
                        AND updated_at > now() - interval '30 days'`, [client.id]),
    // Every project's judged experiments, by the kind of change behind them.
    q<any>(`SELECT COALESCE(r.action->>'kind', r.area) AS kind,
                   count(*) FILTER (WHERE e.verdict = 'confirmed')::int AS confirmed,
                   count(*) FILTER (WHERE e.verdict = 'refuted')::int AS refuted,
                   count(*) FILTER (WHERE e.verdict = 'inconclusive')::int AS inconclusive
              FROM experiments e JOIN recommendations r ON r.id = e.recommendation_id
             WHERE e.status = 'finished' GROUP BY 1`),
  ]);

  const recs = all.filter((r) => (!product || r.product === product) && (!area || r.area === area));
  const total = recs.reduce((n, r) => n + (Number(r.monthly_impact) || 0), 0);
  const records = new Map<string, TrackRecord>(record.map((r) => [r.kind, { confirmed: r.confirmed, refuted: r.refuted, inconclusive: r.inconclusive }]));
  const count = (key: "product" | "area", v: string) => all.filter((r) => r[key] === v).length;
  const href = (next: { product?: string | null; area?: string | null }) => {
    const p = new URLSearchParams();
    const pr = next.product !== undefined ? next.product : product;
    const ar = next.area !== undefined ? next.area : area;
    if (pr) p.set("product", pr);
    if (ar) p.set("area", ar);
    const qs = p.toString();
    return `/clients/${client.id}/insights${qs ? `?${qs}` : ""}`;
  };
  const products = PRODUCTS.filter((p) => count("product", p));
  const areas = Object.keys(AREA_LABEL).filter((a) => count("area", a));

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">What to change</div>
          <h1>{client.name}</h1>
          <p className="meta">
            {run ? `Analysed ${ago(run.created_at)}` : "Not analysed yet"}
            {doneCount[0]?.n ? ` · ${doneCount[0].n} done in the last 30 days` : ""}
          </p>
        </div>
        {brainConfigured() && (
          <JobButton clientId={client.id} job="analyse" label={run ? "Analyse again" : "Work out what to change"} busyLabel="Thinking… (about a minute)" primary={!run} />
        )}
      </header>

      {all.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {total > 0 && (
            <p className="lede" style={{ margin: 0, maxWidth: "none" }}>
              About <strong style={{ fontFamily: "var(--font-display)", fontSize: 19 }}>{money(total, cur)}</strong> a month is spent above what its conversions were worth{product || area ? " in this selection" : ""}. Below, in the order to fix it.
            </p>
          )}
          {run?.summary && !product && !area && <p className="meta" style={{ margin: 0, maxWidth: "78ch", fontSize: 13.5 }}>{run.summary}</p>}
        </div>
      )}

      {all.length > 1 && (products.length > 1 || areas.length > 1) && (
        <div className="stack" style={{ gap: 8 }}>
          {products.length > 1 && (
            <div className="chips">
              <Link href={href({ product: null }) as never} className={`chip${!product ? " on" : ""}`}>All sources</Link>
              {products.map((p) => (
                <Link key={p} href={href({ product: product === p ? null : p }) as never} className={`chip${product === p ? " on" : ""}`}>
                  {PRODUCT_LABEL[p]}<span className="badge">{count("product", p)}</span>
                </Link>
              ))}
            </div>
          )}
          {areas.length > 1 && (
            <div className="chips">
              <Link href={href({ area: null }) as never} className={`chip${!area ? " on" : ""}`}>All areas</Link>
              {areas.map((a) => (
                <Link key={a} href={href({ area: area === a ? null : a }) as never} className={`chip${area === a ? " on" : ""}`}>
                  {AREA_LABEL[a]}<span className="badge">{count("area", a)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {!all.length ? (
        <div className="card card-pad">
          <div className="empty">
            <h3>{run ? "Nothing open" : "Not analysed yet"}</h3>
            <p style={{ maxWidth: 480, margin: "0 auto 16px" }}>
              {run
                ? "Everything from the last analysis is done or dismissed. Run it again after the next sync to see what has changed."
                : "The analysis measures the account first — every figure comes from the data — then writes what to change, in order, with the exact clicks."}
            </p>
            {!brainConfigured() && <p className="err">Analysis is not set up on this installation yet — the admin needs to add the AI key.</p>}
          </div>
        </div>
      ) : !recs.length ? (
        <div className="card card-pad"><p className="meta" style={{ margin: 0 }}>Nothing open in this selection. <Link href={href({ product: null, area: null }) as never}>Show everything</Link></p></div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {recs.map((r) => (
            <RecommendationCard key={r.id} clientId={client.id} currency={cur} rec={r as Rec}
              record={records.get(r.action?.kind ?? r.area) ?? { confirmed: 0, refuted: 0, inconclusive: 0 }} />
          ))}
        </div>
      )}
    </div>
  );
}
