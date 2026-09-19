import { q1 } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { adReport } from "@/lib/engine/adcopy";
import { ProductHead } from "@/components/product/Product";
import { AdCopyList } from "@/components/ads/AdCopyList";

export const dynamic = "force-dynamic";

export default async function AdsAndCopy({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const [{ ads, hasRatings }, site] = await Promise.all([
    adReport(client.id),
    q1<{ summary: unknown }>(`SELECT summary FROM site_summaries WHERE client_id = $1`, [client.id]),
  ]);
  const plain = ads.map((a: any) => ({
    ...a, cost_micros: undefined, final_urls: undefined,
    assets: a.assets.map((x: any) => ({ ...x, impressions: Number(x.impressions) })),
  }));
  return (
    <div className="stack rise">
      <ProductHead product="ads" title="Ads & copy" clientId={client.id} meta="Responsive search ads · 90 days" />
      <p className="lede" style={{ margin: 0 }}>
        An ad is only called weaker when it loses to the other ads in its ad group beyond chance.
        {hasRatings ? " Each line carries Google's own rating: Best, Good or Low." : " Google's Best / Good / Low ratings per line arrive with the next sync."}
        {" "}New lines are added as a new ad beside the old one, never an edit in place, so the two can be compared.
      </p>
      <AdCopyList clientId={client.id} ads={plain as any} summary={site?.summary ?? null} />
    </div>
  );
}
