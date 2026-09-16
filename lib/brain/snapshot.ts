import { q } from "@/lib/db";
import { clientWithProperties } from "@/lib/binding";
import { campaignPerformance, periodTotals, pacing, fromMicros } from "@/lib/engine/metrics";
import { computeFindings, monthlyImpact, type Finding } from "@/lib/engine/findings";
import { segment, keywordSplit } from "@/lib/engine/segments";
import { monthlyShape } from "@/lib/engine/forensics";
import { accountBaseline } from "@/lib/engine/stats";
import { brandTerms } from "@/lib/engine/brand";

/**
 * Everything the brain and the chat are allowed to know about one account.
 *
 * Every figure here was computed by SQL before any model saw it. The model's
 * job is to explain, sequence and propose — never to find or calculate a number.
 */
export async function accountSnapshot(clientId: number) {
  const client = await clientWithProperties(clientId);
  if (!client) throw new Error(`No client ${clientId}`);

  const [base90, { current, previous }, pace, campaigns, findings, brands] = await Promise.all([
    accountBaseline(clientId, 90),
    periodTotals(clientId, 30),
    pacing(client),
    campaignPerformance(clientId, 30),
    computeFindings(clientId),
    brandTerms(clientId),
  ]);

  const [campaignSettings, adGroups, actions, converting, wasteful, topKeywords, negatives] = await Promise.all([
    q<any>(`SELECT campaign_id, name, status, channel_type, bidding_strategy,
                   budget_micros, budget_shared, target_cpa_micros, target_roas,
                   search_impression_share, search_lost_is_budget, search_lost_is_rank,
                   geo_target_type, primary_status_reasons
              FROM campaigns WHERE client_id = $1 AND status <> 'REMOVED'`, [clientId]),
    q<any>(`SELECT g.ad_group_id, g.campaign_id, g.name, g.status,
                   COALESCE(SUM(m.cost_micros),0)/1e6 AS spend, COALESCE(SUM(m.conversions),0) AS conversions
              FROM ad_groups g
              LEFT JOIN metrics_daily m ON m.entity_type = 'ad_group' AND m.entity_id = g.ad_group_id
               AND m.date > CURRENT_DATE - 91
             WHERE g.client_id = $1
             GROUP BY g.ad_group_id, g.campaign_id, g.name, g.status
             ORDER BY 5 DESC LIMIT 40`, [clientId]),
    q<any>(`SELECT name, category, type, counting_type, include_in_conversions,
                   conversions_30d, last_received_at
              FROM conversion_actions WHERE client_id = $1 AND status = 'ENABLED'`, [clientId]),
    q<any>(`SELECT term, SUM(cost_micros)/1e6 AS spend, SUM(clicks) AS clicks, SUM(conversions) AS conversions
              FROM search_terms WHERE client_id = $1 AND conversions > 0
             GROUP BY term ORDER BY SUM(conversions) DESC LIMIT 50`, [clientId]),
    q<any>(`SELECT term, SUM(cost_micros)/1e6 AS spend, SUM(clicks) AS clicks
              FROM search_terms WHERE client_id = $1 AND conversions = 0
             GROUP BY term ORDER BY SUM(cost_micros) DESC LIMIT 40`, [clientId]),
    q<any>(`SELECT text, match_type, quality_score, SUM(cost_micros)/1e6 AS spend,
                   SUM(clicks) AS clicks, SUM(conversions) AS conversions
              FROM keywords WHERE client_id = $1 AND status = 'ENABLED'
             GROUP BY text, match_type, quality_score ORDER BY SUM(cost_micros) DESC LIMIT 60`, [clientId]),
    q<any>(`SELECT count(*)::int AS n FROM negatives WHERE client_id = $1`, [clientId]),
  ]);

  const [devices, hours, dow] = await Promise.all([
    segment(clientId, "device"), segment(clientId, "hour"), segment(clientId, "day_of_week"),
  ]);
  const keywords = await keywordSplit(clientId);
  const months = await monthlyShape(clientId);
  const beyondAds = await otherProducts(clientId);

  return {
    client: {
      name: client.name,
      currency: client.currency,
      goal: client.goal_type,
      targetCpa: client.target_cpa ? Number(client.target_cpa) : null,
      targetRoas: client.target_roas ? Number(client.target_roas) : null,
      monthlyBudget: client.monthly_budget ? Number(client.monthly_budget) : null,
      brandTerms: brands,
      connected: {
        googleAds: Boolean(client.ads_customer_id),
        analytics: Boolean(client.ga4_property_id),
        searchConsole: Boolean(client.gsc_site_url),
        tagManager: Boolean(client.gtm_container_id),
      },
    },
    baseline: {
      note: "The yardstick. Account cost per conversion over the last 90 days.",
      spend90: base90.spend, conversions90: base90.conversions, accountCpa90: base90.cpa,
    },
    last30Days: current,
    previous30Days: previous,
    pacing: pace,
    campaigns: campaignSettings.map((c) => {
      const perf = campaigns.find((p) => p.campaign_id === c.campaign_id);
      return {
        id: c.campaign_id, name: c.name, status: c.status, type: c.channel_type,
        bidStrategy: c.bidding_strategy,
        dailyBudget: c.budget_micros ? fromMicros(c.budget_micros) : null,
        sharedBudget: c.budget_shared,
        targetCpa: c.target_cpa_micros ? fromMicros(c.target_cpa_micros) : null,
        targetRoas: c.target_roas ? Number(c.target_roas) : null,
        impressionShare: c.search_impression_share, lostToBudget: c.search_lost_is_budget, lostToRank: c.search_lost_is_rank,
        geoTargeting: c.geo_target_type,
        last30: perf ? { spend: perf.spend, clicks: perf.clicks, conversions: perf.conversions, cpa: perf.cpa } : null,
      };
    }),
    adGroups,
    conversionActions: actions,
    findings: findings.map((f, id) => findingForModel(f, id)),
    convertingSearchTerms: converting,
    wastefulSearchTerms: wasteful,
    keywords: {
      top60BySpend: topKeywords,
      spendingWithoutConverting: keywords.spenders.slice(0, 20),
    },
    breakdowns90d: { devices, hours, daysOfWeek: dow },
    monthlyShape: months,
    existingNegatives: negatives[0]?.n ?? 0,
    analytics: beyondAds.analytics,
    searchConsole: beyondAds.searchConsole,
    tagManager: beyondAds.tagManager,
    _findings: findings,
  };
}

/** The other three products, summarised: enough to reason about, not every row. */
async function otherProducts(clientId: number) {
  const [ga, events, channels, gsc, pages, tags] = await Promise.all([
    q<any>(`SELECT COALESCE(SUM(sessions) FILTER (WHERE date > CURRENT_DATE - 31),0)::int AS sessions30,
                   COALESCE(SUM(key_events) FILTER (WHERE date > CURRENT_DATE - 31),0)::float AS key_events30,
                   COALESCE(SUM(sessions) FILTER (WHERE date <= CURRENT_DATE - 31 AND date > CURRENT_DATE - 61),0)::int AS sessions_prev30,
                   COALESCE(SUM(key_events) FILTER (WHERE date <= CURRENT_DATE - 31 AND date > CURRENT_DATE - 61),0)::float AS key_events_prev30,
                   count(*)::int AS n
              FROM ga4_daily WHERE client_id = $1`, [clientId]),
    q<any>(`SELECT event_name, SUM(event_count)::int AS count90, SUM(key_events)::float AS key_events90
              FROM ga4_events WHERE client_id = $1 GROUP BY event_name ORDER BY SUM(event_count) DESC LIMIT 25`, [clientId]),
    q<any>(`SELECT channel, SUM(sessions)::int AS sessions90, SUM(key_events)::float AS key_events90
              FROM ga4_daily WHERE client_id = $1 AND date > CURRENT_DATE - 91 GROUP BY channel ORDER BY 2 DESC`, [clientId]),
    q<any>(`SELECT COALESCE(SUM(clicks) FILTER (WHERE date > CURRENT_DATE - 31),0)::int AS clicks28,
                   COALESCE(SUM(impressions) FILTER (WHERE date > CURRENT_DATE - 31),0)::int AS impressions28,
                   COALESCE(SUM(clicks) FILTER (WHERE date <= CURRENT_DATE - 31 AND date > CURRENT_DATE - 59),0)::int AS clicks_prev28,
                   count(*)::int AS n
              FROM gsc_totals WHERE client_id = $1`, [clientId]),
    q<any>(`SELECT page, clicks::int, prev_clicks::int, position::float FROM gsc_pages WHERE client_id = $1 ORDER BY clicks DESC LIMIT 20`, [clientId]),
    q<any>(`SELECT name, type, paused FROM gtm_tags WHERE client_id = $1 ORDER BY name LIMIT 60`, [clientId]),
  ]);
  return {
    analytics: ga[0]?.n ? { note: "Google Analytics, all channels, not only paid.", ...ga[0], n: undefined, channels90d: channels, events90d: events } : null,
    searchConsole: gsc[0]?.n ? { note: "Organic Google search. Windows end three days ago.", ...gsc[0], n: undefined, topPages28d: pages } : null,
    tagManager: tags.length ? { tags } : null,
  };
}

export type Snapshot = Awaited<ReturnType<typeof accountSnapshot>>;

function findingForModel(f: Finding, id: number) {
  return {
    id,
    kind: f.kind,
    product: f.product,
    area: f.area,
    severity: f.severity,
    title: f.title,
    detail: f.detail,
    monthlyImpact: Math.round(monthlyImpact(f)),
    campaignId: f.entityType === "campaign" ? f.entityId : undefined,
    table: f.table ? { columns: f.table.columns, rows: f.table.rows.slice(0, 25) } : undefined,
    evidence: trim(f.evidence),
  };
}

/** Evidence can be large; the model needs its shape, not every row. */
function trim(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.slice(0, depth === 0 ? 30 : 15).map((x) => trim(x, depth + 1));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .filter(([k]) => k !== "hourly" || depth > 0)
      .map(([k, x]) => [k, trim(x, depth + 1)]));
  }
  if (typeof v === "number") return Math.round(v * 100) / 100;
  return v;
}
