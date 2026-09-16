import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { digits } from "@/lib/google/ads";
import { countOps } from "@/lib/google/quota";
import { tx } from "@/lib/db";
import type { ClientWithProps } from "@/lib/binding";

// Analytics and Search Console read in their own right, not only as a check on
// Google Ads. Each of these is a handful of API calls however many rows come
// back, and every writer runs inside tx(), which batches the inserts.

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);

// ------------------------------------------------------------- analytics --

/** Every event by name and day, 90 days: the only way to see one stop firing. */
export async function syncGa4Events(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const data = google.analyticsdata({ version: "v1beta", auth });
  const pid = digits(c.ga4_property_id!);
  const res = await data.properties.runReport({
    property: `properties/${pid}`,
    requestBody: {
      dateRanges: [{ startDate: "90daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "date" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "keyEvents" }],
      limit: "25000",
    },
  });
  await countOps("ga4", 1);
  const rows = res.data.rows ?? [];
  await tx(async (run) => {
    await run("DELETE FROM ga4_events WHERE property_id = $1", [pid]);
    for (const r of rows) {
      const d = r.dimensionValues ?? [];
      const m = r.metricValues ?? [];
      const raw = d[0]?.value ?? "";
      await run(
        `INSERT INTO ga4_events (client_id, property_id, date, event_name, event_count, key_events)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [c.id, pid, `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, d[1]?.value ?? "(not set)", num(m[0]?.value), num(m[1]?.value)]
      );
    }
  });
  return rows.length;
}

/** Sessions by device, source / medium and country over 90 days, in one batched call. */
export async function syncGa4Dims(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const data = google.analyticsdata({ version: "v1beta", auth });
  const pid = digits(c.ga4_property_id!);
  const dims = [
    ["device", "deviceCategory"],
    ["source_medium", "sessionSourceMedium"],
    ["country", "country"],
  ] as const;
  const res = await data.properties.batchRunReports({
    property: `properties/${pid}`,
    requestBody: {
      requests: dims.map(([, name]) => ({
        dateRanges: [{ startDate: "90daysAgo", endDate: "yesterday" }],
        dimensions: [{ name }],
        metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
        limit: "500",
      })),
    },
  });
  await countOps("ga4", 1);
  let n = 0;
  await tx(async (run) => {
    await run("DELETE FROM ga4_dims WHERE property_id = $1", [pid]);
    const reports = res.data.reports ?? [];
    for (let i = 0; i < reports.length; i++) {
      for (const r of reports[i].rows ?? []) {
        n++;
        const m = r.metricValues ?? [];
        await run(
          `INSERT INTO ga4_dims (client_id, property_id, dim_type, key, sessions, engaged_sessions, key_events)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [c.id, pid, dims[i][0], r.dimensionValues?.[0]?.value ?? "(not set)", num(m[0]?.value), num(m[1]?.value), num(m[2]?.value)]
        );
      }
    }
  });
  return n;
}

// -------------------------------------------------------- search console --

/**
 * Site totals by day, pages this period against the last, and query × page.
 * Search Console lags by two or three days, so every window ends three days ago.
 */
export async function syncGscDeep(auth: OAuth2Client, c: ClientWithProps): Promise<number> {
  const sc = google.searchconsole({ version: "v1", auth });
  const site = c.gsc_site_url!;
  const end = isoDaysAgo(3);
  const curStart = isoDaysAgo(3 + 27);
  const prevEnd = isoDaysAgo(3 + 28);
  const prevStart = isoDaysAgo(3 + 55);

  const query = async (body: Record<string, unknown>) => {
    const r = await sc.searchanalytics.query({ siteUrl: site, requestBody: body });
    await countOps("gsc", 1);
    return r.data.rows ?? [];
  };

  const [totals, pagesNow, pagesPrev, queryPages] = await Promise.all([
    query({ startDate: isoDaysAgo(93), endDate: end, dimensions: ["date"], rowLimit: 200 }),
    query({ startDate: curStart, endDate: end, dimensions: ["page"], rowLimit: 5000 }),
    query({ startDate: prevStart, endDate: prevEnd, dimensions: ["page"], rowLimit: 5000 }),
    query({ startDate: isoDaysAgo(93), endDate: end, dimensions: ["query", "page"], rowLimit: 25000 }),
  ]);

  const prev = new Map(pagesPrev.map((r) => [r.keys?.[0] ?? "", r]));
  const pages = new Set([...pagesNow.map((r) => r.keys?.[0] ?? ""), ...pagesPrev.map((r) => r.keys?.[0] ?? "")]);
  const now = new Map(pagesNow.map((r) => [r.keys?.[0] ?? "", r]));

  await tx(async (run) => {
    await run("DELETE FROM gsc_totals WHERE site_url = $1", [site]);
    for (const r of totals) {
      await run(`INSERT INTO gsc_totals (client_id, site_url, date, clicks, impressions, position) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [c.id, site, r.keys?.[0], r.clicks ?? 0, r.impressions ?? 0, r.position ?? null]);
    }
    await run("DELETE FROM gsc_pages WHERE site_url = $1", [site]);
    for (const page of pages) {
      if (!page) continue;
      const a = now.get(page), b = prev.get(page);
      await run(
        `INSERT INTO gsc_pages (client_id, site_url, page, clicks, impressions, position, prev_clicks, prev_impressions, prev_position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [c.id, site, page, a?.clicks ?? 0, a?.impressions ?? 0, a?.position ?? null, b?.clicks ?? 0, b?.impressions ?? 0, b?.position ?? null]
      );
    }
    await run("DELETE FROM gsc_query_pages WHERE site_url = $1", [site]);
    for (const r of queryPages) {
      await run(`INSERT INTO gsc_query_pages (client_id, site_url, query, page, clicks, impressions, position) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [c.id, site, r.keys?.[0] ?? "", r.keys?.[1] ?? "", r.clicks ?? 0, r.impressions ?? 0, r.position ?? null]);
    }
  });
  return totals.length + pages.size + queryPages.length;
}
