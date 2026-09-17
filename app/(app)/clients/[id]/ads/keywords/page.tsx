import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { fromMicros } from "@/lib/engine/metrics";
import { DataTable } from "@/components/ui/DataTable";
import { ProductHead, NoDataYet } from "@/components/product/Product";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function KeywordResearch({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }>;
}) {
  const client = await pageClient(params);
  const { view } = await searchParams;
  const existing = view === "existing";
  const cur = client.currency;
  const [ideas, volumes, [meta]] = await Promise.all([
    q<any>(`SELECT keyword, avg_monthly::float AS monthly, competition, low_bid_micros, high_bid_micros, fetched_at FROM keyword_ideas WHERE client_id = $1`, [client.id]),
    q<any>(`SELECT keyword, avg_monthly::float AS monthly, competition, sources, low_bid_micros, high_bid_micros, fetched_at FROM keyword_volumes WHERE client_id = $1`, [client.id]),
    q<any>(`SELECT keyword_targeting FROM clients WHERE id = $1`, [client.id]),
  ]);
  const t = meta?.keyword_targeting;
  const fetched = (ideas[0] ?? volumes[0])?.fetched_at;
  const bid = (m: any) => (m ? Math.round(fromMicros(m)) : null);

  return (
    <div className="stack rise">
      <ProductHead product="ads" title="Keyword research" clientId={client.id}
        meta={fetched ? `Keyword Planner · ${t?.geo?.length ? `${t.geo.length} targeted location${t.geo.length === 1 ? "" : "s"}` : "all locations"}${t?.languageGuessed ? " · language guessed" : ""} · refreshed weekly` : "Keyword Planner"}>
        <div className="tabs">
          <Link href={`/clients/${client.id}/ads/keywords` as never} className={`tab${!existing ? " active" : ""}`}>New ideas · {ideas.length}</Link>
          <Link href={`/clients/${client.id}/ads/keywords?view=existing` as never} className={`tab${existing ? " active" : ""}`}>Volumes for what you have · {volumes.length}</Link>
        </div>
      </ProductHead>
      <p className="meta" style={{ margin: 0 }}>
        Monthly searches are Google&rsquo;s rounded 12-month averages where this account&rsquo;s campaigns target. Good for choosing between searches, not for forecasting clicks.
        Top-of-page bids are what advertisers paid to appear above the organic results, in {cur ?? "the account's currency"}.
      </p>
      {!ideas.length && !volumes.length ? (
        <NoDataYet clientId={client.id} what="Sync asks Keyword Planner for volumes of every keyword, converting search and organic query, and for new ideas seeded from what converts and from the website." />
      ) : existing ? (
        <DataTable search="Search…" currency={cur} filter={{ key: "source", label: "Source" }}
          columns={[
            { key: "keyword", label: "Search" }, { key: "source", label: "Source" },
            { key: "monthly", label: "Monthly searches", format: "count" }, { key: "competition", label: "Competition" },
            { key: "low", label: "Top-of-page bid, low", format: "money" }, { key: "high", label: "high", format: "money" },
          ]}
          rows={volumes.map((v) => ({ keyword: v.keyword, source: (v.sources ?? []).join(", "), monthly: v.monthly, competition: v.competition, low: bid(v.low_bid_micros), high: bid(v.high_bid_micros) }))}
          initialSort={{ key: "monthly", dir: -1 }} />
      ) : (
        <DataTable search="Search ideas…" currency={cur} filter={{ key: "competition", label: "Competition" }}
          columns={[
            { key: "keyword", label: "Idea" }, { key: "monthly", label: "Monthly searches", format: "count" }, { key: "competition", label: "Competition" },
            { key: "low", label: "Top-of-page bid, low", format: "money" }, { key: "high", label: "high", format: "money" },
          ]}
          rows={ideas.map((v) => ({ keyword: v.keyword, monthly: v.monthly, competition: v.competition, low: bid(v.low_bid_micros), high: bid(v.high_bid_micros) }))}
          initialSort={{ key: "monthly", dir: -1 }} />
      )}
    </div>
  );
}
