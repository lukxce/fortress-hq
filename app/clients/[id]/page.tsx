import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { clientWithProperties } from "@/lib/binding";
import {
  periodTotals, pacing, campaignPerformance, dailySeries, lastSync,
} from "@/lib/engine/metrics";
import { lastAnalysis, brainConfigured } from "@/lib/brain/analyse";
import { segment, keywordSplit } from "@/lib/engine/segments";
import { Briefing } from "@/components/Briefing";

export const dynamic = "force-dynamic";

const RANGES = [7, 14, 30, 90, 180, 365] as const;

export default async function ClientDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { id } = await params;
  const { days: rawDays } = await searchParams;
  const days = RANGES.includes(Number(rawDays) as any) ? Number(rawDays) : 30;
  const clientId = Number(id);
  if (!Number.isFinite(clientId)) notFound();

  const client = await clientWithProperties(clientId);
  if (!client) notFound();

  const [{ current, previous }, pace, campaigns, series, sync, analysis, findings, insights] =
    await Promise.all([
      periodTotals(clientId, days),
      pacing(client),
      campaignPerformance(clientId, days),
      dailySeries(clientId, Math.max(days, 30)),
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

  const segments = {
    device: await segment(clientId, "device"),
    hour: await segment(clientId, "hour"),
    day_of_week: await segment(clientId, "day_of_week"),
    network: await segment(clientId, "network"),
  };
  const keywords = await keywordSplit(clientId);
  const gtmTags = await q<any>(
    `SELECT name, type, paused, consent_status FROM gtm_tags WHERE client_id = $1
      ORDER BY paused, name`, [clientId]
  );

  return (
    <Briefing
      days={days}
      ranges={[...RANGES]}
      segments={segments}
      keywords={{
        workers: keywords.workers.slice(0, 12),
        spenders: keywords.spenders.slice(0, 12),
        lowQuality: keywords.lowQuality.slice(0, 12),
        totalSpend: keywords.totalSpend,
        spenderSpend: keywords.spenderSpend,
      }}
      gtmTags={gtmTags}
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
