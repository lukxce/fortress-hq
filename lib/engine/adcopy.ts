import { q } from "@/lib/db";
import type { Finding } from "./findings";
import { fromMicros } from "./metrics";
import { testSegment } from "./stats";
import { normalise } from "./brand";

/**
 * Ad copy: which ads lose to their neighbours, which headlines Google itself
 * rates Low, and whether the copy says what people searched.
 *
 * An ad is only "weaker" when its click-through (or conversion rate, with
 * enough conversions) is below the rest of its ad group beyond chance, with
 * the correction for how many ads were compared.
 */

type Row = any;
export type AdVerdict = { verdict: string; tone: string; note: string; rank: number };
const STOP = new Set(["the", "and", "for", "with", "near", "from", "your", "you", "kod", "ili", "za", "na", "od", "do", "sa", "iz", "po"]);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export async function adReport(clientId: number) {
  const [ads, assets, kws] = await Promise.all([
    q<Row>(`SELECT a.ad_id, a.ad_group_id, a.campaign_id, a.status, a.ad_strength, a.final_urls, a.headlines, a.descriptions,
                   a.impressions::float, a.clicks::float, a.cost_micros, a.conversions::float,
                   g.name AS ad_group, c.name AS campaign
              FROM ads a
              LEFT JOIN ad_groups g ON g.client_id = a.client_id AND g.ad_group_id = a.ad_group_id
              LEFT JOIN campaigns c ON c.client_id = a.client_id AND c.campaign_id = a.campaign_id
             WHERE a.client_id = $1 AND a.status <> 'REMOVED' AND a.type = 'RESPONSIVE_SEARCH_AD'`, [clientId]),
    q<Row>(`SELECT ad_id, field_type, text, performance_label, pinned_field, impressions::float FROM ad_assets WHERE client_id = $1`, [clientId]).catch(() => []),
    q<Row>(`SELECT k.ad_group_id, k.text, SUM(k.clicks)::float AS clicks FROM keywords k WHERE k.client_id = $1 AND k.status = 'ENABLED'
             AND NOT EXISTS (SELECT 1 FROM negatives n WHERE n.client_id = k.client_id AND n.level = 'ad_group'
                              AND n.ad_group_id = k.ad_group_id AND lower(n.text) = lower(k.text))
             GROUP BY k.ad_group_id, k.text ORDER BY SUM(k.clicks) DESC`, [clientId]),
  ]);

  const byGroup = new Map<string, Row[]>();
  for (const a of ads) byGroup.set(a.ad_group_id, [...(byGroup.get(a.ad_group_id) ?? []), a]);
  // "Off-topic" only matters where the ad is also under-performing; competitor
  // campaigns, for one, rightly keep the competitor's name out of the headline.
  const ctrs = ads.filter((a) => a.status === "ENABLED" && a.impressions >= 100).map((a) => a.clicks / a.impressions).sort((x, y) => x - y);
  const medianCtr = ctrs.length ? ctrs[Math.floor(ctrs.length / 2)] : 0;
  const compared = ads.filter((a) => a.status === "ENABLED" && (byGroup.get(a.ad_group_id) ?? []).filter((x) => x.status === "ENABLED").length >= 2).length;

  const result = ads.map((a) => {
    const assetsHere = assets.filter((x) => x.ad_id === a.ad_id);
    const low = assetsHere.filter((x) => x.performance_label === "LOW");
    const best = assetsHere.filter((x) => x.performance_label === "BEST");
    const headlines = (a.headlines ?? []).map((h: any) => h.text);
    const pinned = (a.headlines ?? []).filter((h: any) => h.pinned).length;
    const topKeywords = kws.filter((k) => k.ad_group_id === a.ad_group_id).slice(0, 5).map((k) => k.text);
    const kwWords = new Set(topKeywords.flatMap((k) => normalise(k).split(" ").filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5))));
    const copyWords = new Set(headlines.flatMap((h: string) => normalise(h).split(" ").map((w) => w.slice(0, 5))));
    const mentions = kwWords.size === 0 || [...kwWords].some((w) => copyWords.has(w));

    let v: AdVerdict = { verdict: "Fine", tone: "pill", note: "Nothing stands out", rank: 6 };
    const peers = (byGroup.get(a.ad_group_id) ?? []).filter((x) => x.status === "ENABLED" && x.ad_id !== a.ad_id);
    if (a.status !== "ENABLED") v = { verdict: "Paused", tone: "pill", note: "Not running", rank: 8 };
    else if (peers.length) {
      const rest = { imp: peers.reduce((n, x) => n + x.impressions, 0), clicks: peers.reduce((n, x) => n + x.clicks, 0), conv: peers.reduce((n, x) => n + x.conversions, 0) };
      const ctr = testSegment({ spend: a.impressions, conversions: a.clicks }, { spend: a.impressions + rest.imp, conversions: a.clicks + rest.clicks }, compared, "worse");
      const cvr = a.conversions + rest.conv >= 10
        ? testSegment({ spend: a.clicks, conversions: a.conversions }, { spend: a.clicks + rest.clicks, conversions: a.conversions + rest.conv }, compared, "worse") : null;
      const myCtr = a.impressions ? a.clicks / a.impressions : 0, restCtr = rest.imp ? rest.clicks / rest.imp : 0;
      if (cvr?.significant) v = { verdict: "Weaker ad", tone: "pill-bad", note: `Converts ${pct(a.conversions / Math.max(1, a.clicks))} of clicks against ${pct(rest.conv / Math.max(1, rest.clicks))} for the other ads here — beyond chance; pause it or rewrite`, rank: 0 };
      else if (ctr.significant && myCtr < restCtr * 0.7) v = { verdict: "Weaker ad", tone: "pill-bad", note: `Clicked ${pct(myCtr)} of the time against ${pct(restCtr)} for the other ads here — beyond chance`, rank: 0 };
    }
    if (v.rank >= 6 && a.status === "ENABLED") {
      if (low.length >= 2) v = { verdict: "Replace weak lines", tone: "pill-warn", note: `Google rates ${low.length} of its lines Low: ${low.slice(0, 2).map((x) => `"${x.text}"`).join(", ")}`, rank: 1 };
      else if (!mentions && topKeywords.length && a.impressions >= 100 && a.clicks / a.impressions < medianCtr) v = { verdict: "Off-topic headlines", tone: "pill-warn", note: `No headline mentions what people search here (e.g. "${topKeywords[0]}"), and it is clicked less than most of your ads`, rank: 2 };
      else if (a.ad_strength === "POOR" && a.impressions >= 100) v = { verdict: "Strengthen", tone: "pill-warn", note: `Ad strength ${String(a.ad_strength).toLowerCase()}: ${headlines.length} headlines, ${(a.descriptions ?? []).length} descriptions${pinned >= 3 ? `, ${pinned} pinned (pins limit the combinations Google can try)` : ""}`, rank: 3 };
      else if (best.length) v = { verdict: "Working", tone: "pill-good", note: `${best.length} line${best.length === 1 ? "" : "s"} rated Best by Google`, rank: 5 };
    }
    return {
      ...a, spend: fromMicros(a.cost_micros), ctr: a.impressions ? a.clicks / a.impressions : null,
      assets: assetsHere, topKeywords, finalUrl: (a.final_urls ?? [])[0] ?? "", ...v,
    };
  });
  return { ads: result, hasRatings: assets.length > 0 };
}

export async function adCopyFindings(clientId: number): Promise<Finding[]> {
  const { ads } = await adReport(clientId);
  const weak = ads.filter((a) => a.verdict === "Weaker ad");
  const lowLines = ads.filter((a) => a.verdict === "Replace weak lines");
  const offTopic = ads.filter((a) => a.verdict === "Off-topic headlines");
  const out: Finding[] = [];
  if (weak.length) {
    out.push({
      kind: "ads_weaker_than_neighbours", product: "ads", area: "creative", severity: "warning",
      title: `${weak.length} ad${weak.length === 1 ? " loses" : "s lose"} clearly to the other ads in ${weak.length === 1 ? "its" : "their"} ad group`,
      detail: `In "${weak[0].ad_group}": ${weak[0].note}. Google keeps showing a weaker ad part of the time; pausing it moves those impressions to the better one.`,
      evidence: { ads: weak.map((a) => ({ adGroup: a.ad_group, adId: a.ad_id, note: a.note })) },
      table: { columns: ["Ad group", "Campaign", "Why"], rows: weak.slice(0, 20).map((a) => [a.ad_group, a.campaign, a.note]) },
    });
  }
  if (lowLines.length + offTopic.length) {
    out.push({
      kind: "ads_copy_to_rewrite", product: "ads", area: "creative", severity: "info",
      title: `${lowLines.length + offTopic.length} ad${lowLines.length + offTopic.length === 1 ? " needs" : "s need"} better lines`,
      detail: `${lowLines.length ? `${lowLines.length} carry headlines or descriptions Google rates Low. ` : ""}${offTopic.length ? `${offTopic.length} never mention in a headline what people search in that ad group — the searcher's own words in the headline are the strongest relevance signal there is. ` : ""}The Ads page can write replacements and add them as a new ad beside the old one.`,
      evidence: { ads: [...lowLines, ...offTopic].map((a) => ({ adGroup: a.ad_group, verdict: a.verdict, note: a.note })) },
    });
  }
  return out;
}
