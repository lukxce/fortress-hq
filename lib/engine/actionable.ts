import { q } from "@/lib/db";
import { fromMicros } from "./metrics";
import type { Finding } from "./findings";
import { binomCdf, testSegment } from "./stats";
import { brandTerms, containsBrand, normalise } from "./brand";

// The findings that turn into an action: which keywords cost too much, which
// converting searches are not yet keywords, which campaigns are capped while
// winning, which ads are thin — plus the ones only a tool reading Analytics,
// Search Console and Tag Manager alongside Ads can make.
//
// Every one is judged against the account's own cost per conversion and tested
// for chance (stats.ts). Fixed multipliers like "CPA above 2.5× the account"
// fire on noise at 20 conversions a month; a corrected exact test does not.

const WINDOW = 90;
const SERBIA = "2688";

// Rows are loosely typed on purpose: every query here is read once, right below it.
type Row = any;

async function baseline90(clientId: number) {
  const [r] = await q<Row>(`
    SELECT COALESCE(SUM(cost_micros),0) AS cost, COALESCE(SUM(conversions),0) AS conv,
           COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(impressions),0) AS imp
      FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign'
       AND date > CURRENT_DATE - ${WINDOW + 1} AND date <= CURRENT_DATE - 1
  `, [clientId]);
  const spend = fromMicros(r?.cost);
  const conversions = Number(r?.conv ?? 0);
  return { spend, conversions, clicks: Number(r?.clicks ?? 0), cpa: conversions > 0 ? spend / conversions : null };
}

const money = (n: number) => Math.round(n * 100) / 100;

// ----------------------------------------------------- overpriced keywords --

async function overpricedKeywords(clientId: number): Promise<Finding[]> {
  const rows = await q<Row>(`
    SELECT k.text, k.match_type, k.campaign_id, k.ad_group_id, k.criterion_id,
           c.name AS campaign, g.name AS ad_group,
           SUM(k.cost_micros) AS cost, SUM(k.conversions) AS conv, SUM(k.clicks) AS clicks
      FROM keywords k
      LEFT JOIN campaigns c ON c.campaign_id = k.campaign_id AND c.client_id = k.client_id
      LEFT JOIN ad_groups g ON g.ad_group_id = k.ad_group_id AND g.client_id = k.client_id
     WHERE k.client_id = $1 AND k.status = 'ENABLED'
     GROUP BY k.text, k.match_type, k.campaign_id, k.ad_group_id, k.criterion_id, c.name, g.name
  `, [clientId]);
  const kws = rows.map((r) => ({ ...r, spend: fromMicros(r.cost), conversions: Number(r.conv), clicks: Number(r.clicks) }))
    .filter((k) => k.spend > 0);
  const total = { spend: kws.reduce((n, k) => n + k.spend, 0), conversions: kws.reduce((n, k) => n + k.conversions, 0) };
  if (total.conversions < 1 || kws.length < 3) return [];

  const k = kws.length;
  const flagged = kws
    .filter((x) => x.conversions > 0)
    .map((x) => {
      const test = testSegment(x, total, k, "worse");
      const rest = { spend: total.spend - x.spend, conversions: total.conversions - x.conversions };
      const restCpa = rest.conversions > 0 ? rest.spend / rest.conversions : null;
      return { ...x, test, restCpa, cpa: x.spend / x.conversions };
    })
    .filter((x) => x.test.significant && x.restCpa && x.cpa > x.restCpa * 1.5)
    .sort((a, b) => (b.spend - b.conversions * b.restCpa!) - (a.spend - a.conversions * a.restCpa!))
    .slice(0, 15);
  if (!flagged.length) return [];

  const excess = flagged.reduce((n, x) => n + Math.max(0, x.spend - x.conversions * x.restCpa!), 0);
  return [{
    kind: "keywords_overpriced",
    area: "bidding",
    severity: "warning",
    title: `${flagged.length} keyword${flagged.length === 1 ? " converts" : "s convert"}, but at far more than the rest of the account`,
    detail: `"${flagged[0].text}" converts at ${flagged[0].cpa.toFixed(2)} against ${flagged[0].restCpa!.toFixed(2)} for everything else. Each of these is significantly more expensive than its share of spend predicts, not just unlucky. They are worth keeping but not at this price: lower the bid, tighten the match type, or check the landing page — pausing would lose conversions.`,
    evidence: { keywords: flagged.map((x) => ({ text: x.text, match: x.match_type, spend: x.spend, conversions: x.conversions, cpa: x.cpa, restCpa: x.restCpa, p: x.test.p })) },
    moneyAtStake: excess,
    windowDays: WINDOW,
    table: {
      columns: ["Keyword", "Match", "Campaign", "Spend", "Conv.", "CPA", "Rest of account"],
      rows: flagged.map((x) => [x.text, x.match_type, x.campaign, money(x.spend), money(x.conversions), money(x.cpa), money(x.restCpa!)]),
    },
  }];
}

// -------------------------------------------------- searches to promote ----

/**
 * Searches that already convert but are not keywords. Demand reached by
 * accident: no control over the bid, the ad shown, or — on Performance Max —
 * whether it keeps being reached at all. Usually the biggest single win.
 */
async function searchesToPromote(clientId: number): Promise<Finding[]> {
  const [terms, keywords, negatives] = await Promise.all([
    q<Row>(`
      SELECT s.term, s.campaign_id, c.name AS campaign, c.channel_type,
             SUM(s.cost_micros) AS cost, SUM(s.conversions) AS conv, SUM(s.clicks) AS clicks
        FROM search_terms s
        LEFT JOIN campaigns c ON c.campaign_id = s.campaign_id AND c.client_id = s.client_id
       WHERE s.client_id = $1 AND s.conversions >= 2
       GROUP BY s.term, s.campaign_id, c.name, c.channel_type
       ORDER BY SUM(s.conversions) DESC
    `, [clientId]),
    q<{ text: string }>(`SELECT DISTINCT text FROM keywords WHERE client_id = $1 AND status <> 'REMOVED'`, [clientId]),
    q<{ text: string }>(`SELECT DISTINCT text FROM negatives WHERE client_id = $1`, [clientId]),
  ]);
  const have = new Set(keywords.map((k) => normalise(k.text)));
  const blocked = new Set(negatives.map((n) => normalise(n.text)));
  const candidates = terms
    .filter((t) => !have.has(normalise(t.term)) && !blocked.has(normalise(t.term)))
    .slice(0, 20)
    .map((t) => ({ ...t, spend: fromMicros(t.cost), conversions: Number(t.conv), clicks: Number(t.clicks) }));
  if (!candidates.length) return [];

  const fromPmax = candidates.filter((t) => t.channel_type === "PERFORMANCE_MAX").length;
  return [{
    kind: "searches_to_promote",
    area: "opportunity",
    severity: "warning",
    title: `${candidates.length} search${candidates.length === 1 ? " converts" : "es convert"} without being a keyword`,
    detail: `"${candidates[0].term}" brought ${candidates[0].conversions.toFixed(0)} conversions over 90 days, but nothing in the account bids on it directly. ${fromPmax ? `${fromPmax} of these came through Performance Max, where an exact-match keyword in a Search campaign is the only thing that takes priority over it. ` : ""}Adding them as exact-match keywords gives control over the bid and the ad shown. Two or three conversions is thin evidence of quality, so add them rather than pour budget into them.`,
    evidence: { terms: candidates.map((t) => ({ term: t.term, campaign: t.campaign, channel: t.channel_type, spend: t.spend, conversions: t.conversions })) },
    windowDays: WINDOW,
    table: {
      columns: ["Search", "Came through", "Spend", "Clicks", "Conv."],
      rows: candidates.map((t) => [t.term, t.campaign, money(t.spend), t.clicks, money(t.conversions)]),
    },
  }];
}

// ---------------------------------------------------- overpriced campaigns --

async function overpricedCampaigns(clientId: number): Promise<Finding[]> {
  const rows = await q<Row>(`
    SELECT c.campaign_id, c.name, c.channel_type, c.bidding_strategy,
           COALESCE(SUM(m.cost_micros),0) AS cost, COALESCE(SUM(m.conversions),0) AS conv
      FROM campaigns c
      JOIN metrics_daily m ON m.entity_type = 'campaign' AND m.entity_id = c.campaign_id
       AND m.date > CURRENT_DATE - ${WINDOW + 1} AND m.date <= CURRENT_DATE - 1
     WHERE c.client_id = $1
     GROUP BY c.campaign_id, c.name, c.channel_type, c.bidding_strategy
    HAVING SUM(m.cost_micros) > 0
  `, [clientId]);
  const camps = rows.map((r) => ({ ...r, spend: fromMicros(r.cost), conversions: Number(r.conv) }));
  const total = { spend: camps.reduce((n, c) => n + c.spend, 0), conversions: camps.reduce((n, c) => n + c.conversions, 0) };
  if (camps.length < 2 || total.conversions < 1) return [];
  const accountCpa = total.spend / total.conversions;

  const out: Finding[] = [];
  for (const c of camps) {
    if (c.conversions === 0 || c.spend < accountCpa * 4) continue;
    const test = testSegment(c, total, camps.length, "worse");
    const restConv = total.conversions - c.conversions;
    if (!test.significant || restConv < 1) continue;
    const restCpa = (total.spend - c.spend) / restConv;
    const cpa = c.spend / c.conversions;
    if (cpa < restCpa * 1.5) continue;
    out.push({
      kind: "campaign_overpriced",
      area: "budget",
      severity: "warning",
      title: `${c.name} pays ${(((cpa - restCpa) / restCpa) * 100).toFixed(0)}% more per conversion than the rest of the account`,
      detail: `${cpa.toFixed(2)} per conversion over 90 days against ${restCpa.toFixed(2)} elsewhere, on ${c.spend.toFixed(0)} of spend — ${c.conversions.toFixed(0)} conversions where the account's rate predicts about ${test.expected.toFixed(0)}. Before cutting it, check whether it is doing a different job (prospecting, a different service) that the rest of the account depends on.`,
      evidence: { campaign: c.name, spend: c.spend, conversions: c.conversions, cpa, restCpa, expected: test.expected, p: test.p },
      moneyAtStake: Math.max(0, c.spend - c.conversions * restCpa),
      windowDays: WINDOW,
      entityType: "campaign",
      entityId: c.campaign_id,
    });
  }
  return out;
}

// ------------------------------------------------ budget-capped winners ----

/**
 * Campaigns losing impressions to budget while converting better than the rest.
 *
 * Lost share to budget and lost share to rank need opposite fixes — more money
 * versus better ads — so only budget-lost share counts here. It is also only
 * meaningful where Google computes it meaningfully: not on Maximise Conversions
 * or Maximise Conversion Value, which are limited by budget by design.
 */
async function budgetCappedWinners(clientId: number): Promise<Finding[]> {
  const rows = await q<Row>(`
    SELECT c.campaign_id, c.name, c.bidding_strategy, c.budget_micros,
           c.search_impression_share AS share, c.search_lost_is_budget AS lost_budget,
           COALESCE(SUM(m.cost_micros),0) AS cost, COALESCE(SUM(m.conversions),0) AS conv,
           COALESCE(SUM(m.impressions),0) AS imp, COALESCE(SUM(m.clicks),0) AS clicks
      FROM campaigns c
      JOIN metrics_daily m ON m.entity_type = 'campaign' AND m.entity_id = c.campaign_id
       AND m.date > CURRENT_DATE - ${WINDOW + 1} AND m.date <= CURRENT_DATE - 1
     WHERE c.client_id = $1 AND c.status = 'ENABLED'
     GROUP BY c.campaign_id, c.name, c.bidding_strategy, c.budget_micros,
              c.search_impression_share, c.search_lost_is_budget
    HAVING SUM(m.cost_micros) > 0
  `, [clientId]);
  const camps = rows.map((r) => ({
    ...r, spend: fromMicros(r.cost), conversions: Number(r.conv),
    impressions: Number(r.imp), clicks: Number(r.clicks),
    share: r.share != null ? Number(r.share) : null,
    lostBudget: r.lost_budget != null ? Number(r.lost_budget) : null,
  }));
  const total = { spend: camps.reduce((n, c) => n + c.spend, 0), conversions: camps.reduce((n, c) => n + c.conversions, 0) };
  if (total.conversions < 1) return [];

  const out: Finding[] = [];
  for (const c of camps) {
    if (/MAXIMIZE_CONVERSION/.test(c.bidding_strategy ?? "")) continue;
    if (c.lostBudget == null || c.lostBudget < 0.08 || c.lostBudget >= 0.9 || c.conversions < 3) continue;
    const test = testSegment(c, total, camps.length, "better");
    if (!test.significant) continue;
    const restConv = total.conversions - c.conversions;
    const restCpa = restConv > 0 ? (total.spend - c.spend) / restConv : null;
    const cpa = c.spend / c.conversions;
    if (restCpa && cpa >= restCpa) continue;

    // Turn lost share into conversions a month before recommending money.
    const share = c.share && c.share > 0.1 ? c.share : null;
    const monthlyImp = c.impressions / WINDOW * 30.4;
    const ctr = c.impressions > 0 ? c.clicks / c.impressions : 0;
    const cvr = c.clicks > 0 ? c.conversions / c.clicks : 0;
    const extraConv = share ? monthlyImp * (c.lostBudget / share) * ctr * cvr : null;

    out.push({
      kind: "budget_capped_winner",
      area: "budget",
      severity: "warning",
      title: `${c.name} beats the account average but loses ${(c.lostBudget * 100).toFixed(0)}% of its impressions to budget`,
      detail: `It converts at ${cpa.toFixed(2)}${restCpa ? ` against ${restCpa.toFixed(2)} for the rest of the account` : ""}, and Google reports ${(c.lostBudget * 100).toFixed(0)}% of the auctions it was eligible for were lost because the budget ran out — not because of rank. ${extraConv != null ? `At its current click-through and conversion rates, recovering that share is worth roughly ${extraConv.toFixed(1)} more conversions a month${extraConv < 2 ? ", which is small in absolute terms" : ""}. ` : ""}Raise the budget in steps of no more than 30%, and watch whether the extra conversions come at the same cost — the marginal ones usually cost more.`,
      evidence: { campaign: c.name, cpa, restCpa, lostBudgetShare: c.lostBudget, impressionShare: c.share, extraConversionsPerMonth: extraConv, p: test.p },
      windowDays: WINDOW,
      entityType: "campaign",
      entityId: c.campaign_id,
    });
  }
  return out;
}

// -------------------------------------------------------------- thin ads ----

async function thinAds(clientId: number): Promise<Finding[]> {
  const rows = await q<Row>(`
    SELECT g.ad_group_id, g.name AS ad_group, c.name AS campaign,
           count(a.ad_id) FILTER (WHERE a.status = 'ENABLED') AS live_ads,
           max(jsonb_array_length(a.headlines)) FILTER (WHERE a.status = 'ENABLED'
               AND a.type = 'RESPONSIVE_SEARCH_AD') AS best_headlines
      FROM ad_groups g
      JOIN campaigns c ON c.campaign_id = g.campaign_id AND c.client_id = g.client_id
      LEFT JOIN ads a ON a.ad_group_id = g.ad_group_id AND a.client_id = g.client_id
     WHERE g.client_id = $1 AND g.status = 'ENABLED' AND c.status = 'ENABLED'
       AND c.channel_type = 'SEARCH'
     GROUP BY g.ad_group_id, g.name, c.name
  `, [clientId]);
  const thin = rows.filter((r) => Number(r.live_ads ?? 0) < 2 || (r.best_headlines != null && Number(r.best_headlines) < 8));
  if (!thin.length) return [];
  return [{
    kind: "ads_thin",
    area: "creative",
    severity: "info",
    title: `${thin.length} live ad group${thin.length === 1 ? " has" : "s have"} fewer than two ads or fewer than eight headlines`,
    detail: `A responsive search ad with few headlines gives Google little to assemble, and a single ad leaves nothing to compare. Adding headlines is cheap. This is about coverage, not Ad Strength — which shows no reliable link to performance — so do it when there is time, not first.`,
    evidence: { adGroups: thin.map((r) => ({ adGroup: r.ad_group, campaign: r.campaign, liveAds: Number(r.live_ads ?? 0), headlines: r.best_headlines })) },
    table: {
      columns: ["Ad group", "Campaign", "Live ads", "Most headlines"],
      rows: thin.slice(0, 20).map((r) => [r.ad_group, r.campaign, Number(r.live_ads ?? 0), r.best_headlines ?? "—"]),
    },
  }];
}

// ----------------------------------------------------------- good hours ----

async function strongHours(clientId: number): Promise<Finding[]> {
  const rows = await q<Row>(`
    SELECT hour, SUM(cost_micros) AS cost, SUM(conversions) AS conv
      FROM schedule_metrics WHERE client_id = $1 GROUP BY hour
  `, [clientId]);
  const hours = Array.from({ length: 24 }, (_, h) => {
    const r = rows.find((x) => Number(x.hour) === h);
    return { spend: fromMicros(r?.cost), conversions: Number(r?.conv ?? 0) };
  });
  const total = { spend: hours.reduce((n, h) => n + h.spend, 0), conversions: hours.reduce((n, h) => n + h.conversions, 0) };
  if (total.conversions < 10) return [];

  let best: any = null;
  for (let len = 3; len <= 8; len++) {
    for (let start = 0; start < 24; start++) {
      let spend = 0, conversions = 0;
      for (let i = 0; i < len; i++) { spend += hours[(start + i) % 24].spend; conversions += hours[(start + i) % 24].conversions; }
      if (conversions < 3 || spend <= 0) continue;
      const test = testSegment({ spend, conversions }, total, 24, "better");
      const restConv = total.conversions - conversions;
      if (!test.significant || restConv < 1) continue;
      const cpa = spend / conversions;
      const restCpa = (total.spend - spend) / restConv;
      if (cpa > restCpa * 0.65) continue;
      if (!best || test.p < best.test.p) best = { start, end: (start + len) % 24, spend, conversions, cpa, restCpa, test };
    }
  }
  if (!best) return [];
  const pad = (n: number) => String(n).padStart(2, "0");
  return [{
    kind: "hours_strong",
    area: "schedule",
    severity: "info",
    title: `Conversions between ${pad(best.start)}:00 and ${pad(best.end)}:00 cost ${(((best.restCpa - best.cpa) / best.restCpa) * 100).toFixed(0)}% less than the rest of the day`,
    detail: `${best.conversions.toFixed(0)} conversions at ${best.cpa.toFixed(2)} each against ${best.restCpa.toFixed(2)} at other hours, over 90 days. If the budget runs out before this window, it is being spent in the wrong hours. A positive ad-schedule adjustment works on Manual CPC and Maximise Clicks; Smart Bidding strategies already weight hours themselves and ignore it.`,
    evidence: best,
    windowDays: WINDOW,
  }];
}

// ------------------------------------------------------- conversion setup --

async function conversionSetup(clientId: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const actions = await q<Row>(`
    SELECT action_id, name, category, type, counting_type, include_in_conversions,
           last_received_at, conversions_30d, origin
      FROM conversion_actions WHERE client_id = $1 AND status = 'ENABLED'
  `, [clientId]);
  const primary = actions.filter((a) => a.include_in_conversions);

  const LEAD = /SUBMIT_LEAD_FORM|CONTACT|REQUEST_QUOTE|BOOK_APPOINTMENT|PHONE_CALL_LEAD|SIGNUP/;
  const LATER = /QUALIFIED_LEAD|CONVERTED_LEAD|IMPORTED_LEAD/;
  const early = primary.filter((a) => LEAD.test(a.category ?? ""));
  const late = primary.filter((a) => LATER.test(a.category ?? ""));
  if (early.length && late.length) {
    out.push({
      kind: "conversion_stages_mixed",
      area: "tracking",
      severity: "critical",
      title: "Bidding counts both the enquiry and the qualified lead",
      detail: `${early.map((a) => `"${a.name}"`).slice(0, 2).join(", ")} and ${late.map((a) => `"${a.name}"`).slice(0, 2).join(", ")} are both primary. That counts one customer twice at two stages, so bidding believes the account converts better than it does. Google's rule is one biddable stage: keep the later stage primary once it has volume, and make the enquiry secondary.`,
      evidence: { enquiry: early.map((a) => a.name), later: late.map((a) => a.name) },
    });
  }
  if (primary.length > 3) {
    out.push({
      kind: "conversion_too_many_primary",
      area: "tracking",
      severity: "warning",
      title: `${primary.length} conversion actions are counted as primary`,
      detail: `Bidding optimises toward every one of them equally. With this many, some are almost certainly weak signals — page views, taps, sign-ups — that the algorithm will find the cheapest source of. Keep the ones that are genuinely a lead or a sale primary and move the rest to secondary, where they still report.`,
      evidence: { actions: primary.map((a) => ({ name: a.name, category: a.category, type: a.type })) },
      table: { columns: ["Action", "Category", "Type", "Counting", "Last 30 days"], rows: primary.map((a) => [a.name, a.category, a.type, a.counting_type, Number(a.conversions_30d ?? 0)]) },
    });
  }

  // A primary action whose tag has gone quiet while the account still buys clicks.
  const [clicks] = await q<Row>(`
    SELECT COALESCE(SUM(clicks),0) AS clicks FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign' AND date > CURRENT_DATE - 15
  `, [clientId]);
  const recentClicks = Number(clicks?.clicks ?? 0);
  const stale = primary.filter((a) =>
    /^(WEBPAGE|WEBPAGE_CODELESS|CLICK_TO_CALL|GOOGLE_ANALYTICS_4_CUSTOM|UPLOAD_CLICKS)$/.test(a.type ?? "")
    && a.last_received_at && Date.now() - new Date(a.last_received_at).getTime() > 14 * 864e5
  );
  if (stale.length && recentClicks >= 100) {
    out.push({
      kind: "conversion_action_stale",
      area: "tracking",
      severity: "critical",
      title: `${stale.length === 1 ? `"${stale[0].name}" has` : `${stale.length} primary actions have`} received nothing for over two weeks`,
      detail: `Google last received a hit ${stale.map((a) => `for "${a.name}" on ${String(a.last_received_at).slice(0, 10)}`).slice(0, 3).join(", ")}, while the account bought ${recentClicks.toLocaleString()} clicks in the last 14 days. A primary action that stops receiving hits is almost always a broken or removed tag, and bidding is now steering on the actions that remain.`,
      evidence: { actions: stale.map((a) => ({ name: a.name, type: a.type, lastReceived: a.last_received_at })), recentClicks },
    });
  }
  return out;
}

// -------------------------------------------------------- account settings --

async function accountSettings(clientId: number): Promise<Finding[]> {
  const [client] = await q<Row>(`SELECT ads_settings FROM clients WHERE id = $1`, [clientId]);
  const s = client?.ads_settings ?? {};
  const out: Finding[] = [];
  const base = await baseline90(clientId);

  if (s.autoTagging === false && base.spend > 0) {
    out.push({
      kind: "auto_tagging_off",
      area: "tracking",
      severity: "critical",
      title: "Auto-tagging is switched off",
      detail: `Without auto-tagging there is no click identifier on the landing page, so Analytics cannot attribute paid sessions to Google Ads properly and offline conversion import cannot work at all. It is one setting: Admin → Account settings → Auto-tagging.`,
      evidence: { autoTagging: false },
    });
  }

  const [geo] = await q<Row>(`
    SELECT segment_key, SUM(cost_micros) AS cost FROM segment_metrics
     WHERE client_id = $1 AND segment_type = 'geo'
     GROUP BY segment_key ORDER BY SUM(cost_micros) DESC LIMIT 1
  `, [clientId]);
  if (s.callReporting === true && geo?.segment_key === SERBIA) {
    out.push({
      kind: "call_reporting_unsupported",
      area: "tracking",
      severity: "info",
      title: "Call reporting is on, in a country where Google cannot provide it",
      detail: `Google forwarding numbers are not available in Serbia, so call reporting cannot record calls here. Google's own guidance for such countries is to switch call reporting off so call assets show the real number reliably. Phone leads have to be counted another way — taps on the number on the site, or a call-tracking service.`,
      evidence: { callReporting: true, mainCountry: "Serbia" },
    });
  }
  return out;
}

// ---------------------------------------------------- Search Console demand --

/**
 * Queries people already find the site for, where it ranks 4–20 and nothing is
 * paid for. Real demand from the business's own site, not a keyword tool's guess.
 */
async function searchConsoleOpportunities(clientId: number): Promise<Finding[]> {
  const brands = await brandTerms(clientId);
  const rows = await q<Row>(`
    SELECT query, SUM(impressions) AS imp, SUM(clicks) AS clicks,
           SUM(position * impressions) / NULLIF(SUM(impressions),0) AS pos
      FROM gsc_daily
     WHERE client_id = $1 AND query <> '' AND date > CURRENT_DATE - 91
     GROUP BY query
    HAVING SUM(impressions) >= 100
     ORDER BY SUM(impressions) DESC
     LIMIT 400
  `, [clientId]);
  if (!rows.length) return [];
  const [paid, kws] = await Promise.all([
    q<{ term: string }>(`SELECT DISTINCT term FROM search_terms WHERE client_id = $1`, [clientId]),
    q<{ text: string }>(`SELECT DISTINCT text FROM keywords WHERE client_id = $1`, [clientId]),
  ]);
  const covered = new Set([...paid.map((p) => normalise(p.term)), ...kws.map((k) => normalise(k.text))]);
  const open = rows
    .map((r) => ({ query: r.query, impressions: Number(r.imp), clicks: Number(r.clicks), position: Number(r.pos) }))
    .filter((r) => r.position >= 4 && r.position <= 20 && !covered.has(normalise(r.query)) && !containsBrand(r.query, brands))
    .slice(0, 20);
  if (!open.length) return [];
  return [{
    kind: "search_console_opportunities",
    area: "opportunity",
    severity: "info",
    title: `${open.length} search${open.length === 1 ? "" : "es"} already find the site organically, off page one, with no ads`,
    detail: `"${open[0].query}" showed the site ${open[0].impressions.toLocaleString()} times in 90 days at an average position of ${open[0].position.toFixed(1)}, and the account pays for nothing on it. These come from Search Console, so they are demand this business demonstrably attracts. Below position 3 organic clicks are scarce — a paid ad on the best-fitting ones is the fastest way to be seen.`,
    evidence: { queries: open },
    table: { columns: ["Search", "Impressions", "Organic clicks", "Avg position"], rows: open.map((o) => [o.query, o.impressions, o.clicks, Math.round(o.position * 10) / 10]) },
  }];
}

// --------------------------------------------------- landing page drop-off --

/**
 * Where paid traffic dies. Ads says what a page costs; Analytics says whether
 * the people who land on it engage. A page taking real spend whose paid
 * sessions engage far less than paid sessions elsewhere is losing the click
 * after it has been paid for.
 */
async function landingPageDropoff(clientId: number): Promise<Finding[]> {
  const pages = await q<Row>(`
    SELECT page, SUM(sessions) AS sessions, SUM(engaged_sessions) AS engaged, SUM(key_events) AS key_events
      FROM ga4_pages
     WHERE client_id = $1 AND channel IN ('Paid Search', 'Cross-network', 'Paid Other', 'Paid Video', 'Display')
     GROUP BY page
  `, [clientId]);
  if (pages.length < 2) return [];
  const all = pages.map((p) => ({ page: p.page, sessions: Number(p.sessions), engaged: Number(p.engaged), keyEvents: Number(p.key_events) }))
    .filter((p) => p.sessions > 0);
  const totalS = all.reduce((n, p) => n + p.sessions, 0);
  const totalE = all.reduce((n, p) => n + p.engaged, 0);
  if (totalS < 100) return [];
  const rate = totalE / totalS;

  const ads = await q<Row>(`SELECT url, cost_micros, conversions FROM landing_pages WHERE client_id = $1`, [clientId]);
  const spendByPath = new Map<string, number>();
  for (const a of ads) {
    try {
      const path = new URL(a.url).pathname.replace(/\/$/, "") || "/";
      spendByPath.set(path, (spendByPath.get(path) ?? 0) + fromMicros(a.cost_micros));
    } catch { /* not a URL */ }
  }

  const k = all.filter((p) => p.sessions >= 30).length;
  const bad = all
    .filter((p) => p.sessions >= 30)
    .map((p) => ({ ...p, pRate: p.engaged / p.sessions, pv: binomCdf(p.engaged, p.sessions, rate),
      spend: spendByPath.get((p.page.split("?")[0].replace(/\/$/, "") || "/")) ?? null }))
    .filter((p) => p.pv < 0.05 / Math.max(1, k) && p.pRate < rate * 0.7)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    .slice(0, 8);
  if (!bad.length) return [];

  return [{
    kind: "landing_page_paid_dropoff",
    area: "creative",
    severity: "warning",
    title: `Paid visitors to ${bad[0].page} engage far less than on the rest of the site`,
    detail: `${(bad[0].pRate * 100).toFixed(0)}% of paid sessions landing there were engaged, against ${(rate * 100).toFixed(0)}% for paid traffic overall, across ${bad[0].sessions} sessions in 90 days${bad[0].spend != null ? ` and ${bad[0].spend.toFixed(0)} of ad spend` : ""}. The click has already been paid for; the page is where it is lost. Check that the page matches what the ad promises, loads fast on mobile, and shows the phone number and form without scrolling.`,
    evidence: { overallEngagement: rate, pages: bad },
    table: { columns: ["Page", "Paid sessions", "Engaged", "Engagement", "Ad spend"], rows: bad.map((b) => [b.page, b.sessions, b.engaged, `${(b.pRate * 100).toFixed(0)}%`, b.spend != null ? money(b.spend) : "—"]) },
  }];
}

export async function actionableFindings(clientId: number): Promise<Finding[]> {
  const groups = await Promise.all([
    overpricedKeywords(clientId),
    searchesToPromote(clientId),
    overpricedCampaigns(clientId),
    budgetCappedWinners(clientId),
    thinAds(clientId),
    strongHours(clientId),
    conversionSetup(clientId),
    accountSettings(clientId),
    searchConsoleOpportunities(clientId),
    landingPageDropoff(clientId),
  ].map((p) => p.catch((err) => {
    console.error("[findings]", (err as Error).message);
    return [] as Finding[];
  })));
  return groups.flat();
}

