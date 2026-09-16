import Link from "next/link";
import { pageClient } from "@/lib/page";
import { overview } from "@/lib/report";
import { lastSync } from "@/lib/engine/metrics";
import { ago } from "@/lib/format";
import { CampaignTable } from "@/components/overview/CampaignTable";
import { ProductHead } from "@/components/product/Product";

export const dynamic = "force-dynamic";

const RANGES = [7, 14, 30, 90] as const;

export default async function AdsCampaigns({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }>;
}) {
  const client = await pageClient(params);
  const { days: raw } = await searchParams;
  const days = RANGES.includes(Number(raw) as never) ? Number(raw) : 30;
  const [o, sync] = await Promise.all([overview(client.id, days), lastSync(client.id)]);

  return (
    <div className="stack rise">
      <ProductHead product="ads" title="Campaigns" clientId={client.id} meta={`Last ${days} days · synced ${ago(sync?.finished_at)}`}>
        <div className="tabs">
          {RANGES.map((r) => (
            <Link key={r} href={`/clients/${client.id}/ads?days=${r}` as never} className={`tab${r === days ? " active" : ""}`}>{r} days</Link>
          ))}
        </div>
      </ProductHead>
      <p className="meta" style={{ margin: 0 }}>Health is judged against this account&rsquo;s own cost per conversion, and only when the difference is more than chance.</p>
      <CampaignTable rows={o.campaigns} currency={client.currency} />
    </div>
  );
}
