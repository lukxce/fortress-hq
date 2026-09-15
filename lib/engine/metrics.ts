import { q, q1 } from "@/lib/db";
import type { ClientWithProps } from "@/lib/binding";

/** Money is stored in micros everywhere. Convert only at the edge. */
export const fromMicros = (v: string | number | null | undefined) =>
  Number(v ?? 0) / 1e6;

export type Totals = {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number;
  cpa: number | null;
  roas: number | null;
  cpc: number | null;
  ctr: number | null;
  cvr: number | null;
};

function totalsFrom(row: any): Totals {
  const spend = fromMicros(row?.cost_micros);
  const conversions = Number(row?.conversions ?? 0);
  const value = fromMicros(row?.conversion_value_micros);
  const clicks = Number(row?.clicks ?? 0);
  const impressions = Number(row?.impressions ?? 0);
  return {
    spend, clicks, impressions, conversions, conversionValue: value,
    cpa: conversions > 0 ? spend / conversions : null,
    roas: spend > 0 ? value / spend : null,
    cpc: clicks > 0 ? spend / clicks : null,
    ctr: impressions > 0 ? clicks / impressions : null,
    cvr: clicks > 0 ? conversions / clicks : null,
  };
}

const SUMS = `
  COALESCE(SUM(cost_micros),0) AS cost_micros,
  COALESCE(SUM(clicks),0) AS clicks,
  COALESCE(SUM(impressions),0) AS impressions,
  COALESCE(SUM(conversions),0) AS conversions,
  COALESCE(SUM(conversion_value_micros),0) AS conversion_value_micros
`;

/** Totals for a window ending yesterday, and the equivalent window before it. */
export async function periodTotals(clientId: number, days: number) {
  const [cur] = await q(`
    SELECT ${SUMS} FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign'
       AND date > CURRENT_DATE - ($2::int + 1) AND date <= CURRENT_DATE - 1
  `, [clientId, days]);

  const [prev] = await q(`
    SELECT ${SUMS} FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign'
       AND date > CURRENT_DATE - ($2::int * 2 + 1) AND date <= CURRENT_DATE - ($2::int + 1)
  `, [clientId, days]);

  return { current: totalsFrom(cur), previous: totalsFrom(prev) };
}

export type Pacing = {
  monthSpend: number;
  monthlyBudget: number | null;
  daysElapsed: number;
  daysInMonth: number;
  projected: number;
  variancePct: number | null;   // positive means projected to overspend
  dailyAverage: number;
};

/** Where the month lands if the current daily rate holds. */
export async function pacing(client: ClientWithProps): Promise<Pacing> {
  const [row] = await q<{ spend: string }>(`
    SELECT COALESCE(SUM(cost_micros),0) AS spend
      FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign'
       AND date >= date_trunc('month', CURRENT_DATE)
  `, [client.id]);

  const monthSpend = fromMicros(row?.spend);
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const dailyAverage = daysElapsed > 0 ? monthSpend / daysElapsed : 0;
  const projected = dailyAverage * daysInMonth;
  const budget = client.monthly_budget ? Number(client.monthly_budget) : null;

  return {
    monthSpend, monthlyBudget: budget, daysElapsed, daysInMonth, projected,
    variancePct: budget && budget > 0 ? ((projected - budget) / budget) * 100 : null,
    dailyAverage,
  };
}

export type CampaignRow = {
  campaign_id: string;
  name: string;
  status: string | null;
  channel_type: string | null;
  primary_status: string | null;
  primary_status_reasons: string[] | null;
  budget_micros: string | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number;
  cpa: number | null;
  roas: number | null;
};

export async function campaignPerformance(clientId: number, days = 30): Promise<CampaignRow[]> {
  const rows = await q<any>(`
    SELECT c.campaign_id, c.name, c.status, c.channel_type,
           c.primary_status, c.primary_status_reasons, c.budget_micros,
           COALESCE(SUM(m.cost_micros),0) AS cost_micros,
           COALESCE(SUM(m.clicks),0) AS clicks,
           COALESCE(SUM(m.impressions),0) AS impressions,
           COALESCE(SUM(m.conversions),0) AS conversions,
           COALESCE(SUM(m.conversion_value_micros),0) AS conversion_value_micros
      FROM campaigns c
      LEFT JOIN metrics_daily m
        ON m.entity_type = 'campaign' AND m.entity_id = c.campaign_id
       AND m.date > CURRENT_DATE - ($2::int + 1) AND m.date <= CURRENT_DATE - 1
     WHERE c.client_id = $1
     GROUP BY c.campaign_id, c.name, c.status, c.channel_type,
              c.primary_status, c.primary_status_reasons, c.budget_micros
     ORDER BY SUM(m.cost_micros) DESC NULLS LAST
  `, [clientId, days]);

  return rows.map((r) => {
    const t = totalsFrom(r);
    return {
      campaign_id: r.campaign_id, name: r.name, status: r.status,
      channel_type: r.channel_type, primary_status: r.primary_status,
      primary_status_reasons: r.primary_status_reasons,
      budget_micros: r.budget_micros,
      spend: t.spend, clicks: t.clicks, impressions: t.impressions,
      conversions: t.conversions, conversionValue: t.conversionValue,
      cpa: t.cpa, roas: t.roas,
    };
  });
}

export async function dailySeries(clientId: number, days = 60) {
  return q<{ date: string; spend: string; conversions: string }>(`
    SELECT date::text AS date,
           COALESCE(SUM(cost_micros),0) AS spend,
           COALESCE(SUM(conversions),0) AS conversions
      FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign'
       AND date > CURRENT_DATE - ($2::int + 1) AND date <= CURRENT_DATE - 1
     GROUP BY date ORDER BY date
  `, [clientId, days]);
}

export async function lastSync(clientId: number) {
  return q1<{ finished_at: string; status: string }>(`
    SELECT finished_at, status FROM job_runs
     WHERE job = 'sync' AND client_id = $1
     ORDER BY finished_at DESC NULLS LAST LIMIT 1
  `, [clientId]);
}
