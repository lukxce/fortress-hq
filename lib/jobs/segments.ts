import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { tx, q } from "@/lib/db";
import { searchStream, digits } from "@/lib/google/ads";
import { countOps, gtmPace } from "@/lib/google/quota";
import type { ClientWithProps } from "@/lib/binding";

// Every query here is one operation regardless of how many rows come back, so
// the entire set below costs less than ten against a 15,000/day ceiling. This
// is the cheapest depth available anywhere in the product.

// Ninety days, not thirty. These are pattern questions — which hour bleeds,
// which device converts — and a pattern needs volume behind it before it means
// anything. The query costs one operation either way, so a narrow window is
// pure downside. Google keeps granular data for 37 months, so this is well
// within range and can be widened further if a client is low-volume.
const WINDOW = 90;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const range = () => `segments.date BETWEEN '${isoDaysAgo(WINDOW)}' AND '${isoDaysAgo(1)}'`;
const num = (v: unknown) => Number(v ?? 0);

type Seg = {
  campaignId: string;
  type: string;
  key: string;
  impressions: string; clicks: string; cost: string;
  conversions: number; value: number;
};

function collect(rows: any[], type: string, keyOf: (r: any) => string | null): Seg[] {
  const acc = new Map<string, Seg>();
  for (const r of rows) {
    const key = keyOf(r);
    if (key == null || key === "") continue;
    const campaignId = String(r.campaign?.id ?? "");
    const id = `${campaignId}|${key}`;
    const m = r.metrics ?? {};
    const cur = acc.get(id) ?? {
      campaignId, type, key,
      impressions: "0", clicks: "0", cost: "0", conversions: 0, value: 0,
    };
    cur.impressions = String(BigInt(cur.impressions) + BigInt(String(m.impressions ?? 0)));
    cur.clicks = String(BigInt(cur.clicks) + BigInt(String(m.clicks ?? 0)));
    cur.cost = String(BigInt(cur.cost) + BigInt(String(m.costMicros ?? 0)));
    cur.conversions += num(m.conversions);
    cur.value += num(m.conversionsValue);
    acc.set(id, cur);
  }
  return [...acc.values()];
}

async function write(client: ClientWithProps, cid: string, segs: Seg[]) {
  if (!segs.length) return;
  await tx(async (run) => {
    for (const s of segs) {
      await run(
        `INSERT INTO segment_metrics (client_id, ads_customer_id, campaign_id,
            segment_type, segment_key, impressions, clicks, cost_micros,
            conversions, conversion_value_micros, window_days, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         ON CONFLICT (ads_customer_id, campaign_id, segment_type, segment_key)
         DO UPDATE SET client_id = EXCLUDED.client_id,
           impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
           cost_micros = EXCLUDED.cost_micros, conversions = EXCLUDED.conversions,
           conversion_value_micros = EXCLUDED.conversion_value_micros,
           window_days = EXCLUDED.window_days, synced_at = now()`,
        [client.id, cid, s.campaignId, s.type, s.key,
         s.impressions, s.clicks, s.cost, s.conversions,
         String(Math.round(s.value * 1e6)), WINDOW]
      );
    }
  });
}

const METRICS = `metrics.impressions, metrics.clicks, metrics.cost_micros,
                 metrics.conversions, metrics.conversions_value`;

/** consentType's shape varies by API version; coerce rather than trust it. */
function consentTypes(tag: any): string[] {
  const raw = tag?.consentSettings?.consentType;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any) => (typeof c === "string" ? c : c?.value ?? ""))
    .filter((v: string) => Boolean(v));
}

/** All the segmentations, each independent so one failure cannot take the rest. */
export async function syncSegments(
  auth: OAuth2Client,
  client: ClientWithProps
): Promise<{ type: string; rows: number; error?: string }[]> {
  const cid = digits(client.ads_customer_id!);
  const out: { type: string; rows: number; error?: string }[] = [];

  const jobs: [string, string, (r: any) => string | null][] = [
    ["device",
     `SELECT campaign.id, segments.device, ${METRICS} FROM campaign WHERE ${range()}`,
     (r) => r.segments?.device ?? null],
    ["hour",
     `SELECT campaign.id, segments.hour, ${METRICS} FROM campaign WHERE ${range()}`,
     (r) => r.segments?.hour != null ? String(r.segments.hour) : null],
    ["day_of_week",
     `SELECT campaign.id, segments.day_of_week, ${METRICS} FROM campaign WHERE ${range()}`,
     (r) => r.segments?.dayOfWeek ?? null],
    ["network",
     `SELECT campaign.id, segments.ad_network_type, ${METRICS} FROM campaign WHERE ${range()}`,
     (r) => r.segments?.adNetworkType ?? null],
  ];

  for (const [type, gaql, keyOf] of jobs) {
    try {
      const rows = await searchStream(auth, cid, gaql);
      const segs = collect(rows, type, keyOf);
      await write(client, cid, segs);
      out.push({ type, rows: segs.length });
    } catch (err) {
      out.push({ type, rows: 0, error: (err as Error).message });
    }
  }

  // Geography is a different resource, not a segment on campaign.
  try {
    const rows = await searchStream(auth, cid, `
      SELECT campaign.id, geographic_view.country_criterion_id, ${METRICS}
        FROM geographic_view WHERE ${range()}`);
    const segs = collect(rows, "geo", (r) =>
      r.geographicView?.countryCriterionId != null
        ? String(r.geographicView.countryCriterionId) : null);
    await write(client, cid, segs);
    out.push({ type: "geo", rows: segs.length });
  } catch (err) {
    out.push({ type: "geo", rows: 0, error: (err as Error).message });
  }

  return out;
}

/** Keyword-level performance, including why a quality score is low. */
export async function syncKeywords(
  auth: OAuth2Client,
  client: ClientWithProps
): Promise<number> {
  const cid = digits(client.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id,
           ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type,
           ad_group_criterion.status,
           ad_group_criterion.quality_info.quality_score,
           ad_group_criterion.quality_info.creative_quality_score,
           ad_group_criterion.quality_info.search_predicted_ctr,
           ad_group_criterion.quality_info.post_click_quality_score,
           ${METRICS}
      FROM keyword_view
     WHERE ${range()}
  `);

  await tx(async (run) => {
    for (const r of rows) {
      const c = r.adGroupCriterion ?? {};
      const qi = c.qualityInfo ?? {};
      const m = r.metrics ?? {};
      await run(
        `INSERT INTO keywords (client_id, ads_customer_id, campaign_id, ad_group_id,
            criterion_id, text, match_type, status, quality_score,
            expected_ctr, ad_relevance, landing_page_experience,
            impressions, clicks, cost_micros, conversions, conversion_value_micros,
            window_days, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
         ON CONFLICT (ads_customer_id, criterion_id, ad_group_id) DO UPDATE SET
           client_id = EXCLUDED.client_id, text = EXCLUDED.text,
           match_type = EXCLUDED.match_type, status = EXCLUDED.status,
           quality_score = EXCLUDED.quality_score,
           expected_ctr = EXCLUDED.expected_ctr,
           ad_relevance = EXCLUDED.ad_relevance,
           landing_page_experience = EXCLUDED.landing_page_experience,
           impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
           cost_micros = EXCLUDED.cost_micros, conversions = EXCLUDED.conversions,
           conversion_value_micros = EXCLUDED.conversion_value_micros,
           window_days = EXCLUDED.window_days, synced_at = now()`,
        [client.id, cid, String(r.campaign?.id ?? ""), String(r.adGroup?.id ?? ""),
         String(c.criterionId ?? ""), c.keyword?.text ?? "", c.keyword?.matchType ?? null,
         c.status ?? null, qi.qualityScore ?? null,
         qi.searchPredictedCtr ?? null, qi.creativeQualityScore ?? null,
         qi.postClickQualityScore ?? null,
         String(m.impressions ?? 0), String(m.clicks ?? 0), String(m.costMicros ?? 0),
         num(m.conversions), String(Math.round(num(m.conversionsValue) * 1e6)), WINDOW]
      );
    }
  });
  return rows.length;
}

/** Where the clicks land. */
export async function syncLandingPages(
  auth: OAuth2Client,
  client: ClientWithProps
): Promise<number> {
  const cid = digits(client.ads_customer_id!);
  const rows = await searchStream(auth, cid, `
    SELECT landing_page_view.unexpanded_final_url, ${METRICS}
      FROM landing_page_view WHERE ${range()}
  `);

  const acc = new Map<string, any>();
  for (const r of rows) {
    const url = r.landingPageView?.unexpandedFinalUrl ?? "";
    if (!url) continue;
    const m = r.metrics ?? {};
    const cur = acc.get(url) ?? { url, impressions: 0n, clicks: 0n, cost: 0n, conv: 0 };
    cur.impressions += BigInt(String(m.impressions ?? 0));
    cur.clicks += BigInt(String(m.clicks ?? 0));
    cur.cost += BigInt(String(m.costMicros ?? 0));
    cur.conv += num(m.conversions);
    acc.set(url, cur);
  }

  await tx(async (run) => {
    for (const p of acc.values()) {
      await run(
        `INSERT INTO landing_pages (client_id, ads_customer_id, url,
            impressions, clicks, cost_micros, conversions, window_days, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (ads_customer_id, url) DO UPDATE SET
           client_id = EXCLUDED.client_id, impressions = EXCLUDED.impressions,
           clicks = EXCLUDED.clicks, cost_micros = EXCLUDED.cost_micros,
           conversions = EXCLUDED.conversions, window_days = EXCLUDED.window_days,
           synced_at = now()`,
        [client.id, cid, p.url, String(p.impressions), String(p.clicks),
         String(p.cost), p.conv, WINDOW]
      );
    }
  });
  return acc.size;
}

/** The live Tag Manager container, so its health can actually be judged. */
export async function syncGtm(
  auth: OAuth2Client,
  client: ClientWithProps
): Promise<number> {
  const gtm = google.tagmanager({ version: "v2", auth });

  const inv = await q<{ parent_id: string; provider_id: string }>(
    `SELECT i.parent_id, i.provider_id FROM inventory i
      JOIN client_properties cp ON cp.inventory_id = i.id
     WHERE cp.client_id = $1 AND cp.provider = 'gtm'`,
    [client.id]
  );
  if (!inv.length) return 0;

  const { parent_id: accountId, provider_id: containerId } = inv[0];
  const path = `accounts/${accountId}/containers/${containerId}`;

  const live = await gtm.accounts.containers.versions.live({ parent: path });
  await countOps("gtm", 1);
  await gtmPace();

  const v = live.data;
  const tags = v.tag ?? [];

  await tx(async (run) => {
    await run(
      `INSERT INTO gtm_snapshots (client_id, container_id, version_id, version_name,
          tag_count, fingerprint, seen_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (container_id, version_id) DO UPDATE SET
         tag_count = EXCLUDED.tag_count, fingerprint = EXCLUDED.fingerprint,
         seen_at = now()`,
      [client.id, containerId, String(v.containerVersionId ?? "live"),
       v.name ?? null, tags.length, v.fingerprint ?? null]
    );

    await run("DELETE FROM gtm_tags WHERE container_id = $1", [containerId]);
    for (const t of tags) {
      await run(
        `INSERT INTO gtm_tags (client_id, container_id, tag_id, name, type,
            paused, firing_triggers, consent_status, consent_types, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
        [client.id, containerId, String(t.tagId), t.name ?? "", t.type ?? null,
         Boolean(t.paused), t.firingTriggerId ?? [],
         t.consentSettings?.consentStatus ?? null,
         consentTypes(t)]
      );
    }
  });

  return tags.length;
}
