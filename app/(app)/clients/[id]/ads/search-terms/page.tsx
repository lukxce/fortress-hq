import Link from "next/link";
import { pageClient } from "@/lib/page";
import { searchTermVerdicts, keywordVerdicts } from "@/lib/engine/verdicts";
import { negativeReport } from "@/lib/engine/negatives";
import { EvidenceTable } from "@/components/ui/bits";
import { DataTable } from "@/components/ui/DataTable";
import { ProductHead } from "@/components/product/Product";

export const dynamic = "force-dynamic";

// The actions worth a summary card, in the order they matter.
const ACTIONS: Record<"terms" | "keywords", { verdict: string; tone: string; say: string }[]> = {
  terms: [
    { verdict: "Add as negative", tone: "bad", say: "to add as negatives" },
    { verdict: "Add as keyword", tone: "ok", say: "converting, not yet keywords" },
    { verdict: "Lower the bid", tone: "warn", say: "converting, but too expensive" },
    { verdict: "Watch", tone: "warn", say: "spending without converting — not yet proof" },
  ],
  keywords: [
    { verdict: "Pause", tone: "bad", say: "to pause" },
    { verdict: "Give more budget", tone: "ok", say: "cheaper than the rest, held back by budget" },
    { verdict: "Lower the bid", tone: "warn", say: "converting, but too expensive" },
    { verdict: "Raise the bid", tone: "ok", say: "cheaper than the rest, losing on ad rank" },
    { verdict: "Fix quality", tone: "warn", say: "with poor quality scores" },
    { verdict: "Watch", tone: "warn", say: "spending without converting — not yet proof" },
  ],
};

export default async function SearchTermsAndKeywords({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; verdict?: string }>;
}) {
  const client = await pageClient(params);
  const { view, verdict } = await searchParams;
  const keywordsView = view === "keywords";
  const cur = client.currency;
  if (view === "negatives") return <Negatives clientId={client.id} currency={cur} />;
  const data = keywordsView ? await keywordVerdicts(client.id, cur) : await searchTermVerdicts(client.id, cur);
  const rows = data.rows as any[];
  const base = `/clients/${client.id}/ads/search-terms${keywordsView ? "?view=keywords&" : "?"}`;
  const cards = ACTIONS[keywordsView ? "keywords" : "terms"]
    .map((a) => ({ ...a, rows: rows.filter((r) => r.verdict === a.verdict) }))
    .filter((a) => a.rows.length);
  const money = (n: number) => `${Math.round(n).toLocaleString()}${cur ? ` ${cur}` : ""}`;
  const QS: Record<string, string> = { BELOW_AVERAGE: "Below", AVERAGE: "Average", ABOVE_AVERAGE: "Above" };

  return (
    <div className="stack rise">
      <ProductHead product="ads" title="Search terms and keywords" clientId={client.id}
        meta={`90 days${data.cpa ? ` · account cost per conversion ${money(data.cpa)}` : ""}`}>
        <div className="tabs">
          <Link href={`/clients/${client.id}/ads/search-terms` as never} className={`tab${!keywordsView ? " active" : ""}`}>Search terms</Link>
          <Link href={`/clients/${client.id}/ads/search-terms?view=keywords` as never} className={`tab${keywordsView ? " active" : ""}`}>Keywords</Link>
          <Link href={`/clients/${client.id}/ads/search-terms?view=negatives` as never} className="tab">Negatives</Link>
          <Link href={`/clients/${client.id}/ads/keywords` as never} className="tab">Ideas</Link>
        </div>
      </ProductHead>

      {cards.length > 0 ? (
        <div className="stats" style={{ gridTemplateColumns: `repeat(${Math.min(cards.length, 4)}, minmax(0, 1fr))` }}>
          {cards.slice(0, 4).map((a) => (
            <Link key={a.verdict} href={`${base}verdict=${encodeURIComponent(a.verdict)}` as never}
              className="card stat" style={{ color: "inherit", textDecoration: "none", boxShadow: verdict === a.verdict ? "0 0 0 2px var(--blue)" : undefined }}>
              <span className="label"><span className={`dot ${a.tone}`} style={{ marginRight: 6 }} />{a.verdict}</span>
              <div className="stat-value">{a.rows.length}</div>
              <div className="stat-foot"><span>{a.say}{a.rows.some((r) => r.spend) ? ` · ${money(a.rows.reduce((n, r) => n + (r.spend ?? 0), 0))} spent` : ""}</span></div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card card-pad">
          <p className="meta" style={{ margin: 0 }}>Nothing here needs action yet — no line has spent enough, or converted enough, for a verdict beyond chance.</p>
        </div>
      )}
      <p className="meta" style={{ margin: "-6px 2px 0" }}>
        A line is only called waste when it has spent {data.bar.toFixed(1)}× the account&rsquo;s cost per conversion with nothing back — the bar for {keywordsView ? "this many keywords" : "this many searches"} to be beyond chance. Anything short of that is &ldquo;Watch&rdquo;.
        {data.hidden > 0 && <> {data.hidden.toLocaleString()} {keywordsView ? "keywords" : "searches"} with no clicks are left out.</>}
        {verdict && <> <Link href={base.replace(/[?&]$/, "") as never}>Show all</Link></>}
      </p>

      {keywordsView ? (
        <DataTable
          search="Search keywords…" currency={cur} filter={{ key: "verdict", label: "Verdict" }} initialPick={verdict ?? "all"}
          columns={[
            { key: "text", label: "Keyword", sub: "where" },
            { key: "verdict", label: "What to do", format: "verdict", sub: "note" },
            { key: "monthly", label: "Searches/mo", format: "count", hint: "Keyword Planner, where the campaigns target" },
            { key: "quality_score", label: "Quality", format: "count", sub: "why" },
            { key: "clicks", label: "Clicks", format: "count" },
            { key: "spend", label: "Spend", format: "money" },
            { key: "conv", label: "Conv.", format: "decimal" },
            { key: "cpa", label: "CPA", format: "money" },
          ]}
          rows={rows.map((k) => ({
            ...k,
            where: [k.match_type?.toLowerCase(), k.campaign].filter(Boolean).join(" · "),
            why: [k.expected_ctr, k.ad_relevance, k.landing_page_experience].some(Boolean)
              ? [k.expected_ctr, k.ad_relevance, k.landing_page_experience].map((x: string) => QS[x] ?? "—").join(" · ") : null,
            cpa: k.conv > 0 ? k.spend / k.conv : null,
            verdict_tone: k.tone, verdict_rank: k.rank,
          }))}
          initialSort={{ key: "verdict", dir: 1 }}
        />
      ) : (
        <DataTable
          search="Search terms…" currency={cur} filter={{ key: "verdict", label: "Verdict" }} initialPick={verdict ?? "all"}
          columns={[
            { key: "term", label: "Search term", sub: "campaign" },
            { key: "verdict", label: "What to do", format: "verdict", sub: "note" },
            { key: "monthly", label: "Searches/mo", format: "count", hint: "Keyword Planner, where the campaigns target" },
            { key: "impressions", label: "Impr.", format: "count" },
            { key: "clicks", label: "Clicks", format: "count" },
            { key: "spend", label: "Spend", format: "money" },
            { key: "conv", label: "Conv.", format: "decimal" },
            { key: "cpa", label: "CPA", format: "money" },
          ]}
          rows={rows.map((t) => ({ ...t, cpa: t.conv > 0 ? t.spend / t.conv : null, verdict_tone: t.tone, verdict_rank: t.rank }))}
          initialSort={{ key: "verdict", dir: 1 }}
        />
      )}
    </div>
  );
}

async function Negatives({ clientId, currency }: { clientId: number; currency: string | null }) {
  const r = await negativeReport(clientId);
  const money = (n: number) => `${Math.round(n).toLocaleString()}${currency ? ` ${currency}` : ""}`;
  const tabs = (
    <div className="tabs">
      <Link href={`/clients/${clientId}/ads/search-terms` as never} className="tab">Search terms</Link>
      <Link href={`/clients/${clientId}/ads/search-terms?view=keywords` as never} className="tab">Keywords</Link>
      <Link href={`/clients/${clientId}/ads/search-terms?view=negatives` as never} className="tab active">Negatives</Link>
      <Link href={`/clients/${clientId}/ads/keywords` as never} className="tab">Ideas</Link>
    </div>
  );
  const section = (title: string, say: string, empty: string, body: React.ReactNode | null, tone: string) => (
    <div className="card">
      <div className="card-head"><h2><span className={`dot ${tone}`} style={{ marginRight: 8 }} />{title}</h2></div>
      <div className="card-pad" style={{ paddingBottom: body ? 0 : undefined }}><p className="meta" style={{ margin: 0 }}>{body ? say : empty}</p></div>
      {body && <div style={{ padding: 16 }}>{body}</div>}
    </div>
  );
  return (
    <div className="stack rise">
      <ProductHead product="ads" title="Search terms and keywords" clientId={clientId} meta="Negative keywords · 90 days">{tabs}</ProductHead>
      <div className="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="card stat"><span className="label"><span className="dot bad" style={{ marginRight: 6 }} />Blocking what you want</span><div className="stat-value">{r.conflicts.length}</div><div className="stat-foot"><span>negatives that block a keyword or a converting search</span></div></div>
        <div className="card stat"><span className="label"><span className="dot warn" style={{ marginRight: 6 }} />Missing elsewhere</span><div className="stat-value">{r.gaps.length}</div><div className="stat-foot"><span>excluded in one campaign, wasting in another{r.gaps.length ? ` · ${money(r.gaps.reduce((n, g) => n + g.spend, 0))}` : ""}</span></div></div>
        <div className="card stat"><span className="label"><span className="dot warn" style={{ marginRight: 6 }} />Words to exclude</span><div className="stat-value">{r.words.length}</div><div className="stat-foot"><span>fail across many small searches{r.words.length ? ` · ${money(r.words.reduce((n, w) => n + w.spend, 0))}` : ""}</span></div></div>
      </div>
      {section("Negatives blocking what you want", "A negative always beats a keyword: these searches cannot show your ad at all. Remove the negative, or make it exact match.",
        "No negative blocks one of your keywords or a search that converts.",
        r.conflicts.length ? <EvidenceTable table={{ columns: ["Negative", "Level", "Campaign", "Blocks", "Which is a"], rows: r.conflicts.slice(0, 100).map((c) => [c.negative, c.level, c.campaign ?? "all", c.blocks, c.what]) }} /> : null, "bad")}
      {section("Excluded in one campaign, still spending in another", "Someone already decided these are not wanted. A shared negative list applies that everywhere at once.",
        "Every search excluded somewhere is excluded wherever it spends.",
        r.gaps.length ? <EvidenceTable table={{ columns: ["Search", "Excluded in", "Still spending in", "Spend", "Clicks"], rows: r.gaps.map((g) => [g.term, g.negatedIn, g.spendingIn, Math.round(g.spend), g.clicks]) }} /> : null, "warn")}
      {section("Words that waste across many small searches", "Each search is too small to judge alone; together they are clearly below this account's rate — beyond chance across every word tested. None is in an active keyword, so a phrase negative blocks nothing you bid on.",
        "No word fails often enough across searches to be beyond chance yet. It needs more clicks, or the account converts evenly across its searches.",
        r.words.length ? (
          <>
            <EvidenceTable table={{ columns: ["Word", "Searches", "Clicks", "Spend", "Conversions", "Expected"], rows: r.words.map((w) => [w.word, w.searches, w.clicks, Math.round(w.spend), w.conversions, Math.round(w.expected * 10) / 10]) }} />
            <p className="meta" style={{ marginTop: 10 }}>To add as phrase negatives, one per line:</p>
            <pre className="snippet">{r.words.map((w) => `"${w.word}"`).join("\n")}</pre>
          </>
        ) : null, "warn")}
    </div>
  );
}
