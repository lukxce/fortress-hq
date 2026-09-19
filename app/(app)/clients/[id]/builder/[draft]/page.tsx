import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { readDraft } from "@/lib/builder/draft";
import { CampaignWizard } from "@/components/builder/CampaignWizard";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params, searchParams }: { params: Promise<{ id: string; draft: string }>; searchParams: Promise<{ step?: string }> }) {
  const client = await pageClient(params);
  const { draft } = await params;
  const { step } = await searchParams;
  const [row] = await q<any>(`SELECT * FROM drafts WHERE id = $1 AND client_id = $2`, [Number(draft), client.id]);
  if (!row) notFound();

  const [conversions, log, site, url] = await Promise.all([
    q<any>(`SELECT name, category, last_received_at, conversions_30d FROM conversion_actions
             WHERE client_id = $1 AND status = 'ENABLED' AND include_in_conversions ORDER BY conversions_30d DESC`, [client.id]),
    q<any>(`SELECT step, status, error FROM launch_steps WHERE draft_id = $1 ORDER BY id`, [row.id]),
    q<any>(`SELECT url FROM site_summaries WHERE client_id = $1`, [client.id]),
    q<any>(`SELECT unnest(final_urls) AS url FROM ads WHERE client_id = $1 LIMIT 1`, [client.id]),
  ]);
  // Where the business lives online: set by the operator, read before, the
  // Search Console property, or the landing page of an existing ad.
  let origin = client.website ?? site[0]?.url ?? (client.gsc_site_url?.startsWith("http") ? client.gsc_site_url : client.gsc_site_url?.startsWith("sc-domain:") ? `https://${client.gsc_site_url.slice(10)}` : "") ?? "";
  if (!origin && url[0]?.url) { try { origin = new URL(url[0].url).origin; } catch { /* ignore */ } }

  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <p className="meta">{row.guided ? <Link href={`/clients/${client.id}/launch/${row.id}` as never}>← Back to the proposal</Link> : <Link href={`/clients/${client.id}/builder` as never}>← All drafts</Link>}</p>
          <h1>{row.name}</h1>
        </div>
      </header>
      <CampaignWizard
        clientId={client.id} draftId={row.id} initial={readDraft(row.state)} initialStep={Number(step) || row.step} status={row.status}
        conversions={conversions} currency={client.currency} defaultUrl={origin} launchLog={log}
      />
    </div>
  );
}
