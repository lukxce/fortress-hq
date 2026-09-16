import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { searchStream, digits } from "@/lib/google/ads";
import { countOps } from "@/lib/google/quota";
import { q, tx } from "@/lib/db";
import type { ClientWithProps } from "@/lib/binding";

// The account's structure and the breakdowns the action loop needs.
//
// Reads are cheap — one operation per query whatever the row count — so this
// reads generously. Each job is independent: one failing (a resource the
// account has no access to, a field an older account lacks) never takes the
// rest down.

const WINDOW = 90;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const range = () => `segments.date BETWEEN '${isoDaysAgo(WINDOW)}' AND '${isoDaysAgo(1)}'`;
const num = (v: unknown) => Number(v ?? 0);
const big = (v: unknown) => String(v ?? 0);

const METRICS = `metrics.impressions, metrics.clicks, metrics.cost_micros,
                 metrics.conversions, metrics.conversions_value`;

export async function syncAdGroups(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status,
           ad_group.type, ad_group.cpc_bid_micros
      FROM ad_group
     WHERE ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'
  `);
  await tx(async (run) => {
    await run("DELETE FROM ad_groups WHERE ads_customer_id = $1", [cid]);
    for (const r of rows) {
      const g = r.adGroup ?? {};
      await run(
        `INSERT INTO ad_groups (client_id, ads_customer_id, campaign_id, ad_group_id,
            name, status, type, cpc_bid_micros)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.id, cid, String(r.campaign?.id ?? ""), String(g.id), g.name ?? "",
         g.status ?? null, g.type ?? null, g.cpcBidMicros ? String(g.cpcBidMicros) : null]
      );
    }
  });
  return rows.length;
}

export async function syncAds(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.type,
           ad_group_ad.status, ad_group_ad.ad_strength, ad_group_ad.ad.final_urls,
           ad_group_ad.ad.responsive_search_ad.headlines,
           ad_group_ad.ad.responsive_search_ad.descriptions,
           ad_group_ad.ad.responsive_search_ad.path1,
           ad_group_ad.ad.responsive_search_ad.path2
      FROM ad_group_ad
     WHERE ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED'
  `);
  await tx(async (run) => {
    await run("DELETE FROM ads WHERE ads_customer_id = $1", [cid]);
    for (const r of rows) {
      const aga = r.adGroupAd ?? {};
      const ad = aga.ad ?? {};
      const rsa = ad.responsiveSearchAd ?? {};
      const text = (xs: any[] | undefined) =>
        (xs ?? []).map((x) => ({ text: x.text ?? "", pinned: x.pinnedField ?? null }));
      await run(
        `INSERT INTO ads (client_id, ads_customer_id, campaign_id, ad_group_id, ad_id,
            type, status, ad_strength, final_urls, headlines, descriptions, path1, path2)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [c.id, cid, String(r.campaign?.id ?? ""), String(r.adGroup?.id ?? ""), String(ad.id),
         ad.type ?? null, aga.status ?? null, aga.adStrength ?? null, ad.finalUrls ?? [],
         JSON.stringify(text(rsa.headlines)), JSON.stringify(text(rsa.descriptions)),
         rsa.path1 ?? null, rsa.path2 ?? null]
      );
    }
  });
  return rows.length;
}

export async function syncAdGroupMetrics(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT ad_group.id, segments.date, ${METRICS}
      FROM ad_group WHERE ${range()}
  `);
  await tx(async (run) => {
    for (const r of rows) {
      const m = r.metrics ?? {};
      await run(
        `INSERT INTO metrics_daily (entity_type, entity_id, client_id, date,
            impressions, clicks, cost_micros, conversions, conversion_value_micros)
         VALUES ('ad_group',$1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (entity_type, entity_id, date) DO UPDATE SET
           client_id = EXCLUDED.client_id, impressions = EXCLUDED.impressions,
           clicks = EXCLUDED.clicks, cost_micros = EXCLUDED.cost_micros,
           conversions = EXCLUDED.conversions,
           conversion_value_micros = EXCLUDED.conversion_value_micros`,
        [String(r.adGroup?.id), c.id, r.segments?.date, big(m.impressions), big(m.clicks),
         big(m.costMicros), num(m.conversions), String(Math.round(num(m.conversionsValue) * 1e6))]
      );
    }
  });
  return rows.length;
}

/** Hour × day of week × campaign, 90 days, collapsed to the shape of a week. */
export async function syncSchedule(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT campaign.id, segments.day_of_week, segments.hour, ${METRICS}
      FROM campaign WHERE ${range()}
  `);
  const acc = new Map<string, any>();
  for (const r of rows) {
    const camp = String(r.campaign?.id ?? "");
    const day = r.segments?.dayOfWeek;
    const hour = r.segments?.hour;
    if (!day || hour == null) continue;
    const key = `${camp}|${day}|${hour}`;
    const m = r.metrics ?? {};
    const cur = acc.get(key) ?? { camp, day, hour: Number(hour), imp: 0n, clicks: 0n, cost: 0n, conv: 0, value: 0 };
    cur.imp += BigInt(big(m.impressions));
    cur.clicks += BigInt(big(m.clicks));
    cur.cost += BigInt(big(m.costMicros));
    cur.conv += num(m.conversions);
    cur.value += num(m.conversionsValue);
    acc.set(key, cur);
  }
  await tx(async (run) => {
    await run("DELETE FROM schedule_metrics WHERE ads_customer_id = $1", [cid]);
    for (const s of acc.values()) {
      await run(
        `INSERT INTO schedule_metrics (client_id, ads_customer_id, campaign_id, day_of_week,
            hour, impressions, clicks, cost_micros, conversions, conversion_value_micros, window_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [c.id, cid, s.camp, s.day, s.hour, String(s.imp), String(s.clicks), String(s.cost),
         s.conv, String(Math.round(s.value * 1e6)), WINDOW]
      );
    }
  });
  return acc.size;
}

/**
 * Impression share over 90 days, with budget-lost and rank-lost kept apart.
 * Search-only metrics: on campaign types without them Google returns nothing,
 * and the columns stay null rather than being read as zero.
 */
export async function syncImpressionShare(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT campaign.id, metrics.search_impression_share,
           metrics.search_budget_lost_impression_share,
           metrics.search_rank_lost_impression_share
      FROM campaign
     WHERE ${range()} AND campaign.status != 'REMOVED'
  `);
  await tx(async (run) => {
    for (const r of rows) {
      const m = r.metrics ?? {};
      await run(
        `UPDATE campaigns SET search_impression_share = $3, search_lost_is_budget = $4,
            search_lost_is_rank = $5
          WHERE ads_customer_id = $1 AND campaign_id = $2`,
        [cid, String(r.campaign?.id), m.searchImpressionShare ?? null,
         m.searchBudgetLostImpressionShare ?? null, m.searchRankLostImpressionShare ?? null]
      );
    }
  });
  return rows.length;
}

/** Existing negatives at campaign, ad group and shared-list level. */
export async function syncNegatives(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const out: any[] = [];

  const campaign = await searchStream(auth, cid, `
    SELECT campaign.id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
      FROM campaign_criterion
     WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'
       AND campaign.status != 'REMOVED'
  `).catch(() => []);
  for (const r of campaign) {
    out.push({ level: "campaign", campaign: String(r.campaign?.id ?? ""), adGroup: "", set: "",
      text: r.campaignCriterion?.keyword?.text, match: r.campaignCriterion?.keyword?.matchType });
  }

  const adGroup = await searchStream(auth, cid, `
    SELECT campaign.id, ad_group.id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type
      FROM ad_group_criterion
     WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = 'KEYWORD'
       AND ad_group.status != 'REMOVED'
  `).catch(() => []);
  for (const r of adGroup) {
    out.push({ level: "ad_group", campaign: String(r.campaign?.id ?? ""), adGroup: String(r.adGroup?.id ?? ""),
      set: "", text: r.adGroupCriterion?.keyword?.text, match: r.adGroupCriterion?.keyword?.matchType });
  }

  // Shared negative lists apply to every campaign they are attached to, so they
  // are expanded per campaign: "does this campaign already exclude X" is the
  // question every guard asks.
  const [sharedTerms, attached] = await Promise.all([
    searchStream(auth, cid, `
      SELECT shared_set.id, shared_criterion.keyword.text, shared_criterion.keyword.match_type
        FROM shared_criterion WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
    `).catch(() => []),
    searchStream(auth, cid, `
      SELECT campaign.id, shared_set.id FROM campaign_shared_set
       WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND campaign_shared_set.status = 'ENABLED'
    `).catch(() => []),
  ]);
  const bySet = new Map<string, string[]>();
  for (const a of attached) {
    const set = String(a.sharedSet?.id ?? "");
    bySet.set(set, [...(bySet.get(set) ?? []), String(a.campaign?.id ?? "")]);
  }
  for (const r of sharedTerms) {
    const set = String(r.sharedSet?.id ?? "");
    for (const camp of bySet.get(set) ?? [""]) {
      out.push({ level: "shared", campaign: camp, adGroup: "", set,
        text: r.sharedCriterion?.keyword?.text, match: r.sharedCriterion?.keyword?.matchType });
    }
  }

  await tx(async (run) => {
    await run("DELETE FROM negatives WHERE ads_customer_id = $1", [cid]);
    for (const n of out) {
      if (!n.text) continue;
      await run(
        `INSERT INTO negatives (client_id, ads_customer_id, level, campaign_id, ad_group_id,
            shared_set_id, text, match_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [c.id, cid, n.level, n.campaign, n.adGroup, n.set, String(n.text).toLowerCase(), n.match ?? ""]
      );
    }
  });
  return out.length;
}

/**
 * When each conversion action last received a hit, and the account settings
 * that decide whether imports and enhanced conversions can work.
 */
export async function syncConversionHealth(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  let n = 0;

  const fresh = await searchStream(auth, cid, `
    SELECT conversion_action.id, conversion_action.origin,
           metrics.conversion_last_received_request_date_time
      FROM conversion_action
     WHERE conversion_action.status != 'REMOVED'
  `).catch(() => []);
  await tx(async (run) => {
    for (const r of fresh) {
      const at = r.metrics?.conversionLastReceivedRequestDateTime ?? null;
      await run(
        `UPDATE conversion_actions SET last_received_at = $3, origin = $4
          WHERE ads_customer_id = $1 AND action_id = $2`,
        // Reported as "YYYY-MM-DD HH:MM:SS" in the account's time zone; a day's
        // precision is all a staleness check needs.
        [cid, String(r.conversionAction?.id), at ? String(at).replace(" ", "T") : null,
         r.conversionAction?.origin ?? null]
      );
      n++;
    }
  });

  const [cust] = await searchStream(auth, cid, `
    SELECT customer.descriptive_name, customer.currency_code, customer.time_zone,
           customer.auto_tagging_enabled,
           customer.conversion_tracking_setting.accepted_customer_data_terms,
           customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled,
           customer.conversion_tracking_setting.google_ads_conversion_customer,
           customer.call_reporting_setting.call_reporting_enabled
      FROM customer
  `).catch(() => []);
  if (cust?.customer) {
    const k = cust.customer;
    await q(`UPDATE clients SET ads_settings = $2 WHERE id = $1`, [c.id, JSON.stringify({
      name: k.descriptiveName ?? null,
      currency: k.currencyCode ?? null,
      timezone: k.timeZone ?? null,
      autoTagging: k.autoTaggingEnabled ?? null,
      acceptedCustomerDataTerms: k.conversionTrackingSetting?.acceptedCustomerDataTerms ?? null,
      enhancedConversionsForLeads: k.conversionTrackingSetting?.enhancedConversionsForLeadsEnabled ?? null,
      conversionCustomer: k.conversionTrackingSetting?.googleAdsConversionCustomer ?? null,
      callReporting: k.callReportingSetting?.callReportingEnabled ?? null,
    })]);
    n++;
  }
  return n;
}

/** Analytics by landing page and channel, so a page's paid engagement can be judged. */
export async function syncGa4Pages(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const data = google.analyticsdata({ version: "v1beta", auth });
  const res = await data.properties.runReport({
    property: `properties/${digits(c.ga4_property_id!)}`,
    requestBody: {
      dateRanges: [{ startDate: `${WINDOW}daysAgo`, endDate: "yesterday" }],
      dimensions: [{ name: "landingPage" }, { name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
      limit: "5000",
    },
  });
  await countOps("ga4", 1);
  const rows = res.data.rows ?? [];
  const pid = digits(c.ga4_property_id!);
  await tx(async (run) => {
    await run("DELETE FROM ga4_pages WHERE property_id = $1", [pid]);
    for (const r of rows) {
      const d = r.dimensionValues ?? [];
      const m = r.metricValues ?? [];
      await run(
        `INSERT INTO ga4_pages (client_id, property_id, page, channel, sessions,
            engaged_sessions, key_events, window_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [c.id, pid, d[0]?.value ?? "(not set)", d[1]?.value ?? "(none)",
         m[0]?.value ?? 0, m[1]?.value ?? 0, num(m[2]?.value), WINDOW]
      );
    }
  });
  return rows.length;
}
