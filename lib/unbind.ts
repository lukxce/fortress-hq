// What each product writes, so unbinding it can remove its data and two
// sources never mix in one project.
export const PRODUCT_TABLES: Record<"ads" | "ga4" | "gsc" | "gtm" | "gbp", string[]> = {
  ads: ["campaigns", "ad_groups", "ads", "keywords", "search_terms", "metrics_daily", "schedule_metrics", "segment_metrics",
    "negatives", "conversion_actions", "landing_pages", "placements", "monthly_metrics", "conversion_breakdown"],
  ga4: ["ga4_daily", "ga4_pages", "ga4_events", "ga4_dims"],
  gsc: ["gsc_daily", "gsc_totals", "gsc_pages", "gsc_query_pages"],
  gtm: ["gtm_tags", "gtm_triggers", "gtm_snapshots"],
  gbp: ["gbp_daily", "gbp_keywords", "gbp_reviews"],
};

export const FINDING_PRODUCT = { ads: "ads", ga4: "analytics", gsc: "search_console", gtm: "tag_manager", gbp: "business_profile" } as const;

type Run = (sql: string, params?: unknown[]) => Promise<unknown>;

/** Stop a project reading one product: drop the binding and everything pulled from it. */
export async function unbind(run: Run, clientId: number, provider: keyof typeof PRODUCT_TABLES) {
  for (const table of PRODUCT_TABLES[provider]) await run(`DELETE FROM ${table} WHERE client_id = $1`, [clientId]);
  await run(`DELETE FROM findings WHERE client_id = $1 AND product = $2`, [clientId, FINDING_PRODUCT[provider]]);
  await run(`DELETE FROM client_properties WHERE client_id = $1 AND provider = $2`, [clientId, provider]);
}
