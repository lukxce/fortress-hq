import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { q, tx } from "@/lib/db";
import { connectionForClient, clientFor } from "@/lib/google/auth";
import { searchStream, digits } from "@/lib/google/ads";
import { countOps } from "@/lib/google/quota";
import { clientWithProperties, type ClientWithProps } from "@/lib/binding";
import {
  syncSegments, syncKeywords, syncLandingPages, syncGtm,
  syncPlacements, buildMonthly, syncConversionBreakdown,
} from "./segments";
import {
  syncAdGroups, syncAds, syncAdGroupMetrics, syncSchedule, syncImpressionShare,
  syncNegatives, syncConversionHealth, syncGa4Pages,
} from "./structure";

// Window sizes are a direct consequence of read economics. A GAQL query costs
// one operation regardless of how many rows come back, so a wide window is
// nearly free — while a narrow one produces confidently wrong conclusions. An
// early version of the predecessor pulled 7 days of search terms and made a
// five-figure waste problem look like a four-figure one.
const METRICS_DAYS = 365;
const SEARCH_TERM_DAYS = 90;
const GA4_DAYS = 90;
const GSC_DAYS = 90;

export type SyncReport = {
  clientId: number;
  ok: boolean;
  steps: { step: string; rows: number; ms: number; error?: string }[];
  ops: number;
};

const micros = (v: unknown) => BigInt(String(v ?? "0"));
const numeric = (v: unknown) => Number(v ?? 0);
const isoDaysAgo = (n: number) =>
  new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export async function syncClient(clientId: number): Promise<SyncReport> {
  const conn = await connectionForClient(clientId);
  if (!conn) throw new Error("No active Google connection.");
  const auth = await clientFor(conn.id);

  // Unscoped on purpose: the daily job syncs every client, and user-facing
  // routes check the caller may see the client before calling this.
  const client = await clientWithProperties(clientId, null);
  if (!client) throw new Error(`No client ${clientId}`);

  const report: SyncReport = { clientId, ok: true, steps: [], ops: 0 };

  const step = async (name: string, fn: () => Promise<number>) => {
    const t0 = Date.now();
    try {
      const rows = await fn();
      report.steps.push({ step: name, rows, ms: Date.now() - t0 });
    } catch (err) {
      report.ok = false;
      report.steps.push({
        step: name, rows: 0, ms: Date.now() - t0,
        error: (err as Error).message ?? String(err),
      });
    }
  };

  if (client.ads_customer_id) {
    await step("campaigns", () => syncCampaigns(auth, client));
    await step("daily metrics", () => syncMetrics(auth, client));
    await step("search terms", () => syncSearchTerms(auth, client));
    await step("conversion actions", () => syncConversionActions(auth, client));
    // The depth: where the money actually went, rather than that it went.
    await step("keywords", () => syncKeywords(auth, client));
    await step("landing pages", () => syncLandingPages(auth, client));
    await step("placements", () => syncPlacements(auth, client));
    await step("conversion mix", () => syncConversionBreakdown(auth, client));
    await step("ad groups", () => syncAdGroups(auth, client));
    await step("ads", () => syncAds(auth, client));
    await step("ad group metrics", () => syncAdGroupMetrics(auth, client));
    await step("hour and day", () => syncSchedule(auth, client));
    await step("impression share", () => syncImpressionShare(auth, client));
    await step("negatives", () => syncNegatives(auth, client));
    await step("conversion health", () => syncConversionHealth(auth, client));
    await step("segments", async () => {
      const res = await syncSegments(auth, client);
      const failed = res.filter((r) => r.error);
      if (failed.length === res.length) throw new Error(failed[0].error!);
      return res.reduce((n, r) => n + r.rows, 0);
    });
  }
  if (client.ga4_property_id) await step("analytics", () => syncGa4(auth, client));
  if (client.ga4_property_id) await step("analytics pages", () => syncGa4Pages(auth, client));
  if (client.gsc_site_url) await step("search console", () => syncGsc(auth, client));
  if (client.gtm_container_id) await step("tag manager", () => syncGtm(auth, client));
  // Derived from what was just written, so it runs last and costs no API calls.
  await step("monthly shape", () => buildMonthly(clientId));

  await q(
    `INSERT INTO job_runs (job, client_id, day, status, finished_at, detail)
     VALUES ('sync', $1, CURRENT_DATE, $2, now(), $3)
     ON CONFLICT (job, client_id, day) DO UPDATE
       SET status = EXCLUDED.status, finished_at = now(), detail = EXCLUDED.detail`,
    [clientId, report.ok ? "ok" : "failed", JSON.stringify(report.steps)]
  );

  return report;
}

// ------------------------------------------------------------------- ads ----

async function syncCampaigns(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT campaign.id, campaign.name, campaign.status,
           campaign.advertising_channel_type,
           campaign.bidding_strategy_type,
           campaign.target_cpa.target_cpa_micros,
           campaign.target_roas.target_roas,
           campaign.maximize_conversions.target_cpa_micros,
           campaign.maximize_conversion_value.target_roas,
           campaign.primary_status,
           campaign.primary_status_reasons,
           campaign.bidding_strategy_system_status,
           campaign.ai_max_setting.enable_ai_max,
           campaign.ai_max_setting.bundling_required,
           campaign.aca_migration_date_time,
           campaign.broad_match_migration_date_time,
           metrics.average_target_cpa_micros,
           metrics.average_target_roas,
           campaign_budget.recommended_budget_amount_micros,
           campaign.start_date_time,
           campaign.end_date_time,
           campaign_budget.amount_micros,
           campaign_budget.explicitly_shared,
           campaign_budget.resource_name,
           campaign.geo_target_type_setting.positive_geo_target_type
      FROM campaign
     WHERE campaign.status != 'REMOVED'
  `);

  await tx(async (run) => {
    for (const r of rows) {
      const camp = r.campaign ?? {};
      const budget = r.campaignBudget ?? {};
      // The target can live on the standalone strategy or inside a Maximize
      // strategy; Google is in the middle of re-splitting these, so read both.
      const targetCpa =
        camp.targetCpa?.targetCpaMicros ?? camp.maximizeConversions?.targetCpaMicros ?? null;
      const targetRoas =
        camp.targetRoas?.targetRoas ?? camp.maximizeConversionValue?.targetRoas ?? null;

      await run(
        `INSERT INTO campaigns (client_id, ads_customer_id, campaign_id, name, status,
            channel_type, bidding_strategy, target_cpa_micros, target_roas,
            budget_micros, budget_shared, primary_status, primary_status_reasons,
            start_date, end_date, bid_strategy_status, avg_target_cpa_micros,
            avg_target_roas, recommended_budget_micros, ai_max_enabled,
            ai_max_bundling_required, aca_migrated_at, broad_match_migrated_at,
            budget_resource_name, geo_target_type, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25, now())
         ON CONFLICT (ads_customer_id, campaign_id) DO UPDATE SET
           client_id = EXCLUDED.client_id, name = EXCLUDED.name,
           status = EXCLUDED.status, channel_type = EXCLUDED.channel_type,
           bidding_strategy = EXCLUDED.bidding_strategy,
           target_cpa_micros = EXCLUDED.target_cpa_micros,
           target_roas = EXCLUDED.target_roas,
           budget_micros = EXCLUDED.budget_micros,
           budget_shared = EXCLUDED.budget_shared,
           primary_status = EXCLUDED.primary_status,
           primary_status_reasons = EXCLUDED.primary_status_reasons,
           start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
           bid_strategy_status = EXCLUDED.bid_strategy_status,
           avg_target_cpa_micros = EXCLUDED.avg_target_cpa_micros,
           avg_target_roas = EXCLUDED.avg_target_roas,
           recommended_budget_micros = EXCLUDED.recommended_budget_micros,
           ai_max_enabled = EXCLUDED.ai_max_enabled,
           ai_max_bundling_required = EXCLUDED.ai_max_bundling_required,
           aca_migrated_at = EXCLUDED.aca_migrated_at,
           broad_match_migrated_at = EXCLUDED.broad_match_migrated_at,
           budget_resource_name = EXCLUDED.budget_resource_name,
           geo_target_type = EXCLUDED.geo_target_type,
           last_synced_at = now()`,
        [
          c.id, cid, String(camp.id), camp.name ?? "", camp.status ?? null,
          camp.advertisingChannelType ?? null, camp.biddingStrategyType ?? null,
          targetCpa ? String(targetCpa) : null,
          targetRoas ?? null,
          budget.amountMicros ? String(budget.amountMicros) : null,
          Boolean(budget.explicitlyShared),
          camp.primaryStatus ?? null,
          camp.primaryStatusReasons ?? [],
          camp.startDateTime ? camp.startDateTime.slice(0, 10) : null,
          camp.endDateTime ? camp.endDateTime.slice(0, 10) : null,
          camp.biddingStrategySystemStatus ?? null,
          r.metrics?.averageTargetCpaMicros ? String(r.metrics.averageTargetCpaMicros) : null,
          r.metrics?.averageTargetRoas ?? null,
          budget.recommendedBudgetAmountMicros ? String(budget.recommendedBudgetAmountMicros) : null,
          camp.aiMaxSetting?.enableAiMax ?? null,
          // An enum (REQUIRED / NOT_REQUIRED), not a boolean. Writing the raw
          // value into the boolean column failed the whole campaigns step.
          camp.aiMaxSetting?.bundlingRequired == null ? null : camp.aiMaxSetting.bundlingRequired === "REQUIRED",
          camp.acaMigrationDateTime ?? null,
          camp.broadMatchMigrationDateTime ?? null,
          budget.resourceName ?? null,
          camp.geoTargetTypeSetting?.positiveGeoTargetType ?? null,
        ]
      );
    }
  });
  return rows.length;
}

async function syncMetrics(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  // An explicit date range rather than a DURING literal: the whole year costs
  // the same single operation as a week, and a year is what makes
  // year-on-year and seasonality legible.
  const rows = await searchStream(auth, cid, `
    SELECT campaign.id, segments.date,
           metrics.impressions, metrics.clicks, metrics.cost_micros,
           metrics.conversions, metrics.conversions_value,
           metrics.original_conversion_value
      FROM campaign
     WHERE segments.date BETWEEN '${isoDaysAgo(METRICS_DAYS)}' AND '${isoDaysAgo(0)}'
  `);

  await writeMetrics(c, cid, rows);
  return rows.length;
}

async function writeMetrics(c: ClientWithProps, cid: string, rows: any[]) {
  await tx(async (run) => {
    for (const r of rows) {
      const m = r.metrics ?? {};
      await run(
        `INSERT INTO metrics_daily (entity_type, entity_id, client_id, date,
            impressions, clicks, cost_micros, conversions, conversion_value_micros,
            original_conversion_value_micros)
         VALUES ('campaign',$1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (entity_type, entity_id, date) DO UPDATE SET
           client_id = EXCLUDED.client_id,
           impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
           cost_micros = EXCLUDED.cost_micros, conversions = EXCLUDED.conversions,
           conversion_value_micros = EXCLUDED.conversion_value_micros,
           original_conversion_value_micros = EXCLUDED.original_conversion_value_micros`,
        [
          String(r.campaign?.id), c.id, r.segments?.date,
          String(m.impressions ?? 0), String(m.clicks ?? 0), String(m.costMicros ?? 0),
          numeric(m.conversions),
          String(Math.round(numeric(m.conversionsValue) * 1e6)),
          String(Math.round(numeric(m.originalConversionValue) * 1e6)),
        ]
      );
    }
  });
}

async function syncSearchTerms(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);

  // Two resources, because Performance Max does not appear in search_term_view
  // at all. On a PMax-dominant account the standard query returns nothing,
  // which reads as "this account buys no search traffic" when in fact it is
  // buying all of it through a resource we never asked.
  const rows: any[] = [];

  try {
    rows.push(...await searchStream(auth, cid, `
      SELECT search_term_view.search_term, campaign.id,
             segments.search_term_match_source,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM search_term_view
       WHERE segments.date BETWEEN '${isoDaysAgo(SEARCH_TERM_DAYS)}' AND '${isoDaysAgo(0)}'
    `));
  } catch { /* an account with no standard search campaigns has no view */ }

  try {
    // campaign_search_term_view, NOT campaign_search_term_insight. The insight
    // resource returns grouped category labels with no cost at all; this one
    // returns the actual search term WITH cost_micros, which is the difference
    // between "some category spent money" and a waste analysis.
    //
    // Hard constraint: adding any segments.keyword.* field to this query makes
    // Google silently drop every Performance Max row, with no error.
    //
    // The channel filter is not optional. This view covers Search campaigns as
    // well as Performance Max, and those Search rows are already in from
    // search_term_view above — both land on the same campaign|term key and get
    // summed, so without the filter every Search campaign's impressions, clicks,
    // cost and conversions were counted twice. The filter is a campaign
    // attribute, not a keyword segment, so PMax rows survive it.
    const pmax = await searchStream(auth, cid, `
      SELECT campaign_search_term_view.search_term, campaign.id,
             segments.search_term_match_source,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.conversions
        FROM campaign_search_term_view
       WHERE segments.date BETWEEN '${isoDaysAgo(SEARCH_TERM_DAYS)}' AND '${isoDaysAgo(0)}'
         AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
    `);
    for (const r of pmax) {
      rows.push({
        searchTermView: { searchTerm: r.campaignSearchTermView?.searchTerm ?? "" },
        campaign: r.campaign,
        segments: r.segments,
        metrics: r.metrics,
      });
    }
  } catch { /* the view is unavailable on accounts with no PMax campaigns */ }

  await tx(async (run) => {
    // Rows arrive segmented; collapse to one row per term per campaign.
    const acc = new Map<string, any>();
    for (const r of rows) {
      const term = r.searchTermView?.searchTerm ?? "";
      const camp = String(r.campaign?.id ?? "");
      const key = `${camp}|${term}`;
      const m = r.metrics ?? {};
      const cur = acc.get(key) ?? {
        term, camp, source: r.segments?.searchTermMatchSource ?? null,
        impressions: 0n, clicks: 0n, cost: 0n, conv: 0,
      };
      cur.impressions += micros(m.impressions);
      cur.clicks += micros(m.clicks);
      cur.cost += micros(m.costMicros);
      cur.conv += numeric(m.conversions);
      acc.set(key, cur);
    }

    for (const t of acc.values()) {
      await run(
        `INSERT INTO search_terms (client_id, ads_customer_id, campaign_id, term,
            match_source, impressions, clicks, cost_micros, conversions, window_days, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (ads_customer_id, campaign_id, term) DO UPDATE SET
           client_id = EXCLUDED.client_id, match_source = EXCLUDED.match_source,
           impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
           cost_micros = EXCLUDED.cost_micros, conversions = EXCLUDED.conversions,
           synced_at = now()`,
        [c.id, cid, t.camp, t.term, t.source,
         String(t.impressions), String(t.clicks), String(t.cost), t.conv, SEARCH_TERM_DAYS]
      );
    }
  });
  return rows.length;
}

async function syncConversionActions(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT conversion_action.id, conversion_action.name, conversion_action.category,
           conversion_action.type, conversion_action.status,
           conversion_action.counting_type,
           conversion_action.include_in_conversions_metric,
           conversion_action.click_through_lookback_window_days,
           conversion_action.view_through_lookback_window_days,
           conversion_action.value_settings.always_use_default_value,
           conversion_action.value_settings.default_value
      FROM conversion_action
     WHERE conversion_action.status != 'REMOVED'
  `);

  // metrics.conversions is not selectable on conversion_action (query_error 49),
  // so per-action volume comes from a segmented query and is joined in memory.
  let volume = new Map<string, number>();
  try {
    const vrows = await searchStream(auth, cid, `
      SELECT segments.conversion_action, metrics.conversions
        FROM customer
       WHERE segments.date DURING LAST_30_DAYS
    `);
    for (const v of vrows) {
      const rn = String(v.segments?.conversionAction ?? "");
      const id = rn.split("/").pop() ?? "";
      volume.set(id, (volume.get(id) ?? 0) + numeric(v.metrics?.conversions));
    }
  } catch { /* volume is useful, not essential */ }

  await tx(async (run) => {
    for (const r of rows) {
      const a = r.conversionAction ?? {};
      await run(
        `INSERT INTO conversion_actions (client_id, ads_customer_id, action_id, name,
            category, type, status, counting_type, include_in_conversions,
            click_window_days, view_window_days, conversions_30d,
            always_use_default_value, default_value, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
         ON CONFLICT (ads_customer_id, action_id) DO UPDATE SET
           client_id = EXCLUDED.client_id, name = EXCLUDED.name,
           category = EXCLUDED.category, type = EXCLUDED.type, status = EXCLUDED.status,
           counting_type = EXCLUDED.counting_type,
           include_in_conversions = EXCLUDED.include_in_conversions,
           click_window_days = EXCLUDED.click_window_days,
           view_window_days = EXCLUDED.view_window_days,
           conversions_30d = EXCLUDED.conversions_30d,
           always_use_default_value = EXCLUDED.always_use_default_value,
           default_value = EXCLUDED.default_value, synced_at = now()`,
        [c.id, cid, String(a.id), a.name ?? "", a.category ?? null, a.type ?? null,
         a.status ?? null, a.countingType ?? null,
         a.includeInConversionsMetric ?? null,
         a.clickThroughLookbackWindowDays ?? null,
         a.viewThroughLookbackWindowDays ?? null,
         volume.get(String(a.id)) ?? 0,
         a.valueSettings?.alwaysUseDefaultValue ?? null,
         a.valueSettings?.defaultValue ?? null]
      );
    }
  });
  return rows.length;
}

// ------------------------------------------------------------------ ga4 -----

async function syncGa4(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const data = google.analyticsdata({ version: "v1beta", auth });
  const res = await data.properties.runReport({
    property: `properties/${digits(c.ga4_property_id!)}`,
    requestBody: {
      dateRanges: [{ startDate: `${GA4_DAYS}daysAgo`, endDate: "yesterday" }],
      dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
      limit: "10000",
    },
  });
  await countOps("ga4", 1);

  const rows = res.data.rows ?? [];
  await tx(async (run) => {
    for (const r of rows) {
      const d = r.dimensionValues ?? [];
      const m = r.metricValues ?? [];
      const raw = d[0]?.value ?? "";
      const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      await run(
        `INSERT INTO ga4_daily (client_id, property_id, date, channel,
            sessions, engaged_sessions, key_events)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (property_id, date, channel) DO UPDATE SET
           client_id = EXCLUDED.client_id, sessions = EXCLUDED.sessions,
           engaged_sessions = EXCLUDED.engaged_sessions, key_events = EXCLUDED.key_events`,
        [c.id, digits(c.ga4_property_id!), date, d[1]?.value ?? "(none)",
         m[0]?.value ?? 0, m[1]?.value ?? 0, numeric(m[2]?.value)]
      );
    }
  });
  return rows.length;
}

// ------------------------------------------------------------------ gsc -----

async function syncGsc(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const sc = google.searchconsole({ version: "v1", auth });
  // Data lags two to three days, so the window deliberately ends before today.
  const res = await sc.searchanalytics.query({
    siteUrl: c.gsc_site_url!,
    requestBody: {
      startDate: isoDaysAgo(GSC_DAYS),
      endDate: isoDaysAgo(3),
      dimensions: ["date", "query"],
      rowLimit: 10000,
    },
  });
  await countOps("gsc", 1);

  const rows = res.data.rows ?? [];
  await tx(async (run) => {
    for (const r of rows) {
      const [date, query] = r.keys ?? [];
      await run(
        `INSERT INTO gsc_daily (client_id, site_url, date, query, clicks, impressions, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (site_url, date, query) DO UPDATE SET
           client_id = EXCLUDED.client_id, clicks = EXCLUDED.clicks,
           impressions = EXCLUDED.impressions, position = EXCLUDED.position`,
        [c.id, c.gsc_site_url, date, query ?? "", r.clicks ?? 0, r.impressions ?? 0, r.position ?? null]
      );
    }
  });
  return rows.length;
}
