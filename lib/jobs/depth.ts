import type { OAuth2Client } from "google-auth-library";
import { q, tx } from "@/lib/db";
import { searchStream, digits } from "@/lib/google/ads";
import type { ClientWithProps } from "@/lib/binding";

/**
 * The detail behind ad copy, bids and search terms. Each pull is its own sync
 * step: one Google refusal (a field renamed in a new API version) costs that
 * detail only, never the rest of the sync.
 */

const WINDOW = 90;
const iso = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const range = (days = WINDOW) => `segments.date BETWEEN '${iso(days)}' AND '${iso(1)}'`;
const num = (v: unknown) => Number(v ?? 0);

/** Clicks, cost and conversions per ad over 90 days. */
export async function syncAdMetrics(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT ad_group_ad.ad.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM ad_group_ad WHERE ${range()} AND ad_group_ad.status != 'REMOVED'`);
  const by = new Map<string, { i: number; c: number; cost: number; conv: number }>();
  for (const r of rows) {
    const id = String(r.adGroupAd?.ad?.id ?? "");
    const m = r.metrics ?? {};
    const cur = by.get(id) ?? { i: 0, c: 0, cost: 0, conv: 0 };
    cur.i += num(m.impressions); cur.c += num(m.clicks); cur.cost += num(m.costMicros); cur.conv += num(m.conversions);
    by.set(id, cur);
  }
  await tx(async (run) => {
    await run(`UPDATE ads SET impressions = 0, clicks = 0, cost_micros = 0, conversions = 0 WHERE client_id = $1`, [c.id]);
    for (const [id, v] of by) {
      await run(`UPDATE ads SET impressions = $3, clicks = $4, cost_micros = $5, conversions = $6 WHERE client_id = $1 AND ad_id = $2`,
        [c.id, id, v.i, v.c, Math.round(v.cost), v.conv]);
    }
  });
  return by.size;
}

/** Every headline and description, with Google's Best / Good / Low rating. */
export async function syncAdAssets(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT campaign.id, ad_group.id, ad_group_ad.ad.id,
           ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label,
           ad_group_ad_asset_view.pinned_field, ad_group_ad_asset_view.enabled,
           asset.text_asset.text, metrics.impressions, metrics.clicks, metrics.conversions
      FROM ad_group_ad_asset_view
     WHERE ${range()} AND ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION')`);
  const by = new Map<string, any>();
  for (const r of rows) {
    const v = r.adGroupAdAssetView ?? {};
    const text = r.asset?.textAsset?.text;
    if (!text) continue;
    const key = `${r.adGroupAd?.ad?.id}|${v.fieldType}|${text}`;
    const cur = by.get(key) ?? {
      campaign: String(r.campaign?.id ?? ""), adGroup: String(r.adGroup?.id ?? ""), ad: String(r.adGroupAd?.ad?.id ?? ""),
      field: v.fieldType, text, label: v.performanceLabel ?? null, pinned: v.pinnedField ?? null, enabled: v.enabled ?? null,
      i: 0, c: 0, conv: 0,
    };
    const m = r.metrics ?? {};
    cur.i += num(m.impressions); cur.c += num(m.clicks); cur.conv += num(m.conversions);
    by.set(key, cur);
  }
  await tx(async (run) => {
    await run(`DELETE FROM ad_assets WHERE client_id = $1`, [c.id]);
    for (const a of by.values()) {
      await run(`INSERT INTO ad_assets (client_id, campaign_id, ad_group_id, ad_id, field_type, text, performance_label, pinned_field, enabled, impressions, clicks, conversions)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
        [c.id, a.campaign, a.adGroup, a.ad, a.field, a.text, a.label, a.pinned, a.enabled, a.i, a.c, a.conv]);
    }
  });
  return by.size;
}

/** What each keyword bids, what Google estimates it takes to show, and how often it does. */
export async function syncKeywordBids(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT ad_group.id, ad_group_criterion.criterion_id,
           ad_group_criterion.cpc_bid_micros, ad_group_criterion.effective_cpc_bid_micros,
           ad_group_criterion.position_estimates.first_page_cpc_micros,
           ad_group_criterion.position_estimates.top_of_page_cpc_micros,
           ad_group_criterion.position_estimates.first_position_cpc_micros
      FROM ad_group_criterion
     WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE
       AND ad_group_criterion.status != 'REMOVED'`);
  await tx(async (run) => {
    for (const r of rows) {
      const k = r.adGroupCriterion ?? {}, pe = k.positionEstimates ?? {};
      await run(`UPDATE keywords SET cpc_bid_micros = $4, effective_cpc_bid_micros = $5, first_page_cpc_micros = $6,
                        top_of_page_cpc_micros = $7, first_position_cpc_micros = $8
                  WHERE client_id = $1 AND ad_group_id = $2 AND criterion_id = $3`,
        [c.id, String(r.adGroup?.id ?? ""), String(k.criterionId ?? ""), k.cpcBidMicros ?? null, k.effectiveCpcBidMicros ?? null,
         pe.firstPageCpcMicros ?? null, pe.topOfPageCpcMicros ?? null, pe.firstPositionCpcMicros ?? null]);
    }
  });
  return rows.length;
}

/** Impression share per keyword: how many of its searches it actually showed on, and where. */
export async function syncKeywordShare(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT ad_group.id, ad_group_criterion.criterion_id,
           metrics.search_impression_share, metrics.search_top_impression_share,
           metrics.search_absolute_top_impression_share, metrics.search_rank_lost_impression_share
      FROM keyword_view WHERE ${range(30)}`);
  // Shares are ratios per day; with the date segment absent Google aggregates them itself.
  await tx(async (run) => {
    for (const r of rows) {
      const m = r.metrics ?? {}, k = r.adGroupCriterion ?? {};
      await run(`UPDATE keywords SET search_is = $4, search_top_is = $5, search_abs_top_is = $6, search_rank_lost_is = $7
                  WHERE client_id = $1 AND ad_group_id = $2 AND criterion_id = $3`,
        [c.id, String(r.adGroup?.id ?? ""), String(k.criterionId ?? ""),
         m.searchImpressionShare ?? null, m.searchTopImpressionShare ?? null, m.searchAbsoluteTopImpressionShare ?? null, m.searchRankLostImpressionShare ?? null]);
    }
  });
  return rows.length;
}

/**
 * Which keyword brought each search in. Search campaigns only: asking for the
 * keyword on Performance Max terms makes Google drop those rows silently.
 */
export async function syncSearchTermKeywords(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT campaign.id, ad_group.id, search_term_view.search_term,
           segments.keyword.info.text, segments.keyword.info.match_type,
           metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM search_term_view WHERE ${range()}`);
  const by = new Map<string, any>();
  for (const r of rows) {
    const kw = r.segments?.keyword?.info ?? {};
    const key = [r.campaign?.id, r.adGroup?.id, r.searchTermView?.searchTerm, kw.text, kw.matchType].join("|");
    const cur = by.get(key) ?? { campaign: String(r.campaign?.id ?? ""), adGroup: String(r.adGroup?.id ?? ""), term: r.searchTermView?.searchTerm ?? "",
      text: kw.text ?? "", match: kw.matchType ?? "", i: 0, c: 0, cost: 0, conv: 0 };
    const m = r.metrics ?? {};
    cur.i += num(m.impressions); cur.c += num(m.clicks); cur.cost += num(m.costMicros); cur.conv += num(m.conversions);
    by.set(key, cur);
  }
  await tx(async (run) => {
    await run(`DELETE FROM search_term_keywords WHERE client_id = $1`, [c.id]);
    for (const t of by.values()) {
      if (!t.term || !t.text) continue;
      await run(`INSERT INTO search_term_keywords (client_id, campaign_id, ad_group_id, term, keyword_text, keyword_match, impressions, clicks, cost_micros, conversions)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [c.id, t.campaign, t.adGroup, t.term, t.text, t.match, t.i, t.c, Math.round(t.cost), t.conv]);
    }
  });
  return by.size;
}

/** The last 28 days of every search, beside its 90. */
export async function syncRecentSearchTerms(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const cid = digits(c.ads_customer_id!);
  const rows: any[] = [];
  try {
    rows.push(...(await searchStream(auth, cid, `
      SELECT search_term_view.search_term, campaign.id, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM search_term_view WHERE ${range(28)}`)).map((r) => ({ term: r.searchTermView?.searchTerm, campaign: r.campaign?.id, m: r.metrics })));
  } catch { /* no standard search campaigns */ }
  try {
    rows.push(...(await searchStream(auth, cid, `
      SELECT campaign_search_term_view.search_term, campaign.id, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM campaign_search_term_view WHERE ${range(28)} AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'`))
      .map((r) => ({ term: r.campaignSearchTermView?.searchTerm, campaign: r.campaign?.id, m: r.metrics })));
  } catch { /* no Performance Max */ }
  const by = new Map<string, { term: string; campaign: string; c: number; cost: number; conv: number }>();
  for (const r of rows) {
    if (!r.term) continue;
    const key = `${r.campaign}|${r.term}`;
    const cur = by.get(key) ?? { term: r.term, campaign: String(r.campaign ?? ""), c: 0, cost: 0, conv: 0 };
    cur.c += num(r.m?.clicks); cur.cost += num(r.m?.costMicros); cur.conv += num(r.m?.conversions);
    by.set(key, cur);
  }
  await tx(async (run) => {
    await run(`UPDATE search_terms SET recent_clicks = 0, recent_cost_micros = 0, recent_conversions = 0 WHERE client_id = $1`, [c.id]);
    for (const t of by.values()) {
      await run(`UPDATE search_terms SET recent_clicks = $4, recent_cost_micros = $5, recent_conversions = $6
                  WHERE client_id = $1 AND campaign_id = $2 AND term = $3`, [c.id, t.campaign, t.term, t.c, Math.round(t.cost), t.conv]);
    }
  });
  return by.size;
}
