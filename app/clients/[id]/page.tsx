import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { clientWithProperties } from "@/lib/binding";
import {
  periodTotals, pacing, campaignPerformance, dailySeries, lastSync,
} from "@/lib/engine/metrics";
import { lastAnalysis, brainConfigured } from "@/lib/brain/analyse";
import { Briefing } from "@/components/Briefing";

export const dynamic = "force-dynamic";

export default async function ClientDashboard({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isFinite(clientId)) notFound();

  const client = await clientWithProperties(clientId);
  if (!client) notFound();

  const [{ current, previous }, pace, campaigns, series, sync, analysis, findings, insights] =
    await Promise.all([
      periodTotals(clientId, 30),
      pacing(client),
      campaignPerformance(clientId, 30),
      dailySeries(clientId, 60),
      lastSync(clientId),
      lastAnalysis(clientId),
      q<any>(
        `SELECT * FROM findings WHERE client_id = $1 AND status = 'open'
          ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                   money_at_stake_micros DESC NULLS LAST`,
        [clientId]
      ),
      q<any>(
        `SELECT * FROM insights WHERE client_id = $1 AND status <> 'dismissed'
          ORDER BY priority, created_at DESC`,
        [clientId]
      ),
    ]);

  return (
    <Briefing
      client={{
        id: client.id,
        name: client.name,
        goalType: client.goal_type,
        targetCpa: client.target_cpa ? Number(client.target_cpa) : null,
        targetRoas: client.target_roas ? Number(client.target_roas) : null,
        currency: client.currency,
        hasAnalytics: Boolean(client.ga4_property_id),
        hasSearchConsole: Boolean(client.gsc_site_url),
        hasTagManager: Boolean(client.gtm_container_id),
      }}
      current={current}
      previous={previous}
      pacing={pace}
      campaigns={campaigns}
      series={series.map((s) => ({
        date: s.date,
        spend: Number(s.spend) / 1e6,
        conversions: Number(s.conversions),
      }))}
      findings={findings}
      insights={insights}
      lastSync={sync?.finished_at ?? null}
      lastAnalysis={analysis?.created_at ?? null}
      analysisCost={analysis?.cost_usd ? Number(analysis.cost_usd) : null}
      brainAvailable={brainConfigured()}
    />
  );
}
