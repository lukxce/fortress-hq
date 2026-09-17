import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { q, q1, tx } from "@/lib/db";
import { countOps } from "@/lib/google/quota";
import type { ClientWithProps } from "@/lib/binding";

/**
 * Google Business Profile: for a local business often the largest source of
 * leads, and the only place Google counts calls in countries where Ads cannot.
 *
 * Performance comes daily, about three days behind. Search keywords come as a
 * total over a month range, and small counts only as "fewer than N". Reviews
 * still live on the older My Business v4 API; if that is not enabled, the rest
 * syncs without them.
 */

export const GBP_METRICS = [
  "CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS", "BUSINESS_CONVERSATIONS", "BUSINESS_BOOKINGS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
] as const;

const ymd = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });

export async function syncGbp(auth: OAuth2Client, c: ClientWithProps & { gbp_location_id?: string | null }): Promise<number> {
  const location = c.gbp_location_id!;
  const perf = google.businessprofileperformance({ version: "v1", auth });
  const start = ymd(new Date(Date.now() - 180 * 864e5)), end = ymd(new Date(Date.now() - 864e5));

  const res = await perf.locations.fetchMultiDailyMetricsTimeSeries({
    location,
    dailyMetrics: [...GBP_METRICS],
    "dailyRange.startDate.year": start.year, "dailyRange.startDate.month": start.month, "dailyRange.startDate.day": start.day,
    "dailyRange.endDate.year": end.year, "dailyRange.endDate.month": end.month, "dailyRange.endDate.day": end.day,
  } as any);
  await countOps("gbp", 1);

  const rows: [string, string, number][] = [];
  for (const multi of res.data.multiDailyMetricTimeSeries ?? []) {
    for (const series of (multi as any).dailyMetricTimeSeries ?? []) {
      for (const v of series.timeSeries?.datedValues ?? []) {
        if (!v.date?.year) continue;
        const date = `${v.date.year}-${String(v.date.month).padStart(2, "0")}-${String(v.date.day).padStart(2, "0")}`;
        rows.push([date, series.dailyMetric, Number(v.value ?? 0)]);
      }
    }
  }

  // Search keywords over the last three full months.
  const now = new Date();
  const endMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const keywords: { keyword: string; impressions: number | null; threshold: number | null }[] = [];
  try {
    let pageToken: string | undefined;
    do {
      const kr = await (perf.locations.searchkeywords.impressions.monthly as any).list({
        parent: location, pageSize: 100, pageToken,
        "monthlyRange.startMonth.year": startMonth.getUTCFullYear(), "monthlyRange.startMonth.month": startMonth.getUTCMonth() + 1,
        "monthlyRange.endMonth.year": endMonth.getUTCFullYear(), "monthlyRange.endMonth.month": endMonth.getUTCMonth() + 1,
      });
      await countOps("gbp", 1);
      for (const k of kr.data.searchKeywordsCounts ?? []) {
        keywords.push({
          keyword: k.searchKeyword ?? "",
          impressions: k.insightsValue?.value != null ? Number(k.insightsValue.value) : null,
          threshold: k.insightsValue?.threshold != null ? Number(k.insightsValue.threshold) : null,
        });
      }
      pageToken = kr.data.nextPageToken ?? undefined;
    } while (pageToken && keywords.length < 1000);
  } catch { /* keywords are a bonus; the metrics above are what matters */ }

  // Reviews: the v4 API, addressed by account and location.
  const reviews: { id: string; rating: number | null; comment: string | null; replied: boolean; created: string | null }[] = [];
  const inv = await q1<{ parent_id: string | null }>(`SELECT i.parent_id FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = $1 AND cp.provider = 'gbp'`, [c.id]);
  if (inv?.parent_id) {
    const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    try {
      let pageToken: string | undefined;
      do {
        const r = await auth.request<any>({
          url: `https://mybusiness.googleapis.com/v4/${inv.parent_id}/${location}/reviews`,
          params: { pageSize: 50, pageToken },
        });
        await countOps("gbp", 1);
        for (const rv of r.data.reviews ?? []) {
          reviews.push({ id: rv.reviewId, rating: STARS[rv.starRating] ?? null, comment: rv.comment ?? null, replied: Boolean(rv.reviewReply), created: rv.createTime ?? null });
        }
        pageToken = r.data.nextPageToken;
      } while (pageToken && reviews.length < 500);
    } catch { /* v4 reviews need their own approval */ }
  }

  await tx(async (run) => {
    await run(`DELETE FROM gbp_daily WHERE location_id = $1`, [location]);
    for (const [date, metric, value] of rows) {
      await run(`INSERT INTO gbp_daily (client_id, location_id, date, metric, value) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [c.id, location, date, metric, value]);
    }
    if (keywords.length) {
      await run(`DELETE FROM gbp_keywords WHERE location_id = $1`, [location]);
      for (const k of keywords) {
        await run(`INSERT INTO gbp_keywords (client_id, location_id, month, keyword, impressions, threshold) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [c.id, location, startMonth.toISOString().slice(0, 10), k.keyword, k.impressions, k.threshold]);
      }
    }
    if (reviews.length) {
      await run(`DELETE FROM gbp_reviews WHERE location_id = $1`, [location]);
      for (const r of reviews) {
        await run(`INSERT INTO gbp_reviews (client_id, location_id, review_id, rating, comment, replied, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [c.id, location, r.id, r.rating, r.comment, r.replied, r.created]);
      }
    }
  });
  return rows.length + keywords.length + reviews.length;
}
