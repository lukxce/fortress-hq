import { q, q1 } from "@/lib/db";
import { adsPost, digits } from "@/lib/google/ads";
import { countOps } from "@/lib/google/quota";
import { clientFor, connectionForClient } from "@/lib/google/auth";
import { clientWithProperties } from "@/lib/binding";
import { distil, type SiteSummary } from "./site";
import { suggestGroups, suggestAdText } from "./suggest";
import { readDraft, type Draft } from "./draft";
import { brandTerms, containsBrand, normalise } from "@/lib/engine/brand";
import { fromMicros } from "@/lib/engine/metrics";
import { MIN_PROJECTS } from "@/lib/learning/patterns";

/**
 * The guided launch: three answers in, a whole campaign out.
 *
 * Every number in the proposal comes from Google or the account — Keyword
 * Planner's forecast for exactly these places, this account's own conversion
 * rate, the portfolio's where the account has none — and says which. The
 * creative parts (grouping, ad text) come from the same builder helpers the
 * step-by-step wizard uses, and every part of the result can be changed there.
 */

export type Goal = "calls" | "leads" | "sales";
export type GuidedInput = { goal: Goal; places: { id: string; name: string }[]; monthlyBudget: number; website: string };

export type Check = { key: string; ok: boolean | null; title: string; detail: string; fix?: { label: string; href: string } };

export type Proposal = {
  summary: string;
  forecast: {
    source: "keyword_planner" | "none";
    clicksPerMonth: number | null; costPerMonth: number | null; avgCpc: number | null;
    conversionRate: number | null; conversionRateSource: string;
    leadsLow: number | null; leadsHigh: number | null; costPerLead: number | null;
    targetCpa: number | null; verdict: string;
  };
  bidding: { strategy: "MAXIMIZE_CONVERSIONS" | "MAXIMIZE_CLICKS"; maxCpc: number | null; why: string };
  checks: Check[];
  searchesPerMonth: number | null;
  built: string[];
};

const LANG: Record<string, string> = { serbian: "1035", english: "1000", croatian: "1039", bosnian: "1034", german: "1001", slovenian: "1034" };
const languageFor = (summary: SiteSummary | null, currency: string | null) => {
  const l = (summary?.language ?? "").toLowerCase();
  const hit = Object.entries(LANG).find(([k]) => l.includes(k));
  return `languageConstants/${hit?.[1] ?? (currency === "RSD" ? "1035" : "1000")}`;
};

// Searches that almost never buy, in the languages these accounts run in.
const STARTER_NEGATIVES = [
  "free", "jobs", "job", "salary", "career", "course", "diy", "how to", "what is", "wikipedia", "youtube", "pdf",
  "besplatno", "besplatan", "posao", "poslovi", "plata", "kurs", "obuka", "sam", "uradi sam", "kako", "šta je", "sta je", "polovni", "oglas",
];

/** Build a proposal and store it on a new draft. */
export async function buildGuided(clientId: number, input: GuidedInput): Promise<{ draftId: number; proposal: Proposal }> {
  const client = await clientWithProperties(clientId);
  if (!client?.ads_customer_id) throw new Error("Connect a Google Ads account to this project first.");
  const conn = await connectionForClient(clientId);
  if (!conn) throw new Error("No Google connection for this project.");
  const auth = await clientFor(conn.id);
  const cid = digits(client.ads_customer_id);
  const built: string[] = [];
  const currency = client.currency;

  // 1. What the business sells.
  const cached = await q1<{ summary: SiteSummary; url: string }>(`SELECT summary, url FROM site_summaries WHERE client_id = $1 AND crawled_at > now() - interval '30 days'`, [clientId]);
  const summary = cached && cached.url === input.website ? cached.summary : await distil(clientId, input.website);
  built.push(`Read ${input.website}: ${summary.offers.length} service${summary.offers.length === 1 ? "" : "s"} found`);

  // 2. What people search there, from Keyword Planner, seeded by what already converts and by the site.
  const language = languageFor(summary, currency);
  const geo = input.places.map((p) => `geoTargetConstants/${digits(p.id)}`);
  const [converting, brands] = await Promise.all([
    q<{ t: string }>(`SELECT lower(term) AS t FROM search_terms WHERE client_id = $1 GROUP BY 1 HAVING SUM(conversions) > 0 ORDER BY SUM(conversions) DESC LIMIT 10`, [clientId]),
    brandTerms(clientId),
  ]);
  const seeds = [...converting.map((c) => c.t), ...summary.offers.map((o) => o.name)].filter((x) => x.length <= 80).slice(0, 10);
  let ideas: { text: string; monthly: number | null; high: number | null; low: number | null }[] = [];
  try {
    const res = await adsPost(auth, `customers/${cid}:generateKeywordIdeas`, {
      language, geoTargetConstants: geo, keywordPlanNetwork: "GOOGLE_SEARCH", includeAdultKeywords: false, pageSize: 300,
      ...(seeds.length ? { keywordAndUrlSeed: { url: input.website, keywords: seeds } } : { urlSeed: { url: input.website } }),
    });
    await countOps("ads", 1);
    ideas = (res?.results ?? []).map((r: any) => ({
      text: String(r.text).toLowerCase(),
      monthly: r.keywordIdeaMetrics?.avgMonthlySearches != null ? Number(r.keywordIdeaMetrics.avgMonthlySearches) : null,
      high: r.keywordIdeaMetrics?.highTopOfPageBidMicros != null ? Number(r.keywordIdeaMetrics.highTopOfPageBidMicros) : null,
      low: r.keywordIdeaMetrics?.lowTopOfPageBidMicros != null ? Number(r.keywordIdeaMetrics.lowTopOfPageBidMicros) : null,
    })).filter((i: any) => (i.monthly ?? 0) > 0 && !containsBrand(i.text, brands)).sort((a: any, b: any) => (b.monthly ?? 0) - (a.monthly ?? 0)).slice(0, 120);
    built.push(`Keyword Planner: ${ideas.length} searches with volume in ${input.places.map((p) => p.name).join(", ")}`);
  } catch (err) {
    built.push(`Keyword Planner was not available (${(err as Error).message.slice(0, 120)}); keywords come from the site and the account`);
  }

  // 3. Groups and ads.
  const groups = await suggestGroups(clientId, summary, input.places.map((p) => p.name), {
    ideas: ideas.map((i) => ({ text: i.text, monthly: i.monthly })), goal: input.goal,
  });
  const ads = await Promise.all(groups.map((g) => suggestAdText(summary, { name: g.name, keywords: g.keywords.map((k) => k.text), finalUrl: g.finalUrl }).catch(() => null)));
  groups.forEach((g, i) => { const a = ads[i]; if (a) Object.assign(g, a); });
  built.push(`${groups.length} ad group${groups.length === 1 ? "" : "s"}, ${groups.reduce((n, g) => n + g.keywords.length, 0)} keywords, ads written for each`);

  // 4. Negatives: the usual non-buyers, plus words that fail on other accounts.
  const wasteWords = await q<{ key: string }>(`SELECT key FROM portfolio_patterns WHERE kind = 'waste_theme' AND industry = 'all' AND significant AND projects >= $1`, [MIN_PROJECTS]).catch(() => []);
  const keywordWords = new Set(groups.flatMap((g) => g.keywords.flatMap((k) => normalise(k.text).split(" "))));
  const negatives = [...new Set([...STARTER_NEGATIVES, ...wasteWords.map((w) => w.key)])].filter((n) => !normalise(n).split(" ").some((w) => keywordWords.has(w)));
  built.push(`${negatives.length} starting negatives`);

  // 5. Forecast for these keywords, here, at a bid that reaches the top of the page.
  const kwTexts = new Set(groups.flatMap((g) => g.keywords.map((k) => normalise(k.text))));
  const matched = ideas.filter((i) => kwTexts.has(normalise(i.text)));
  const highBids = matched.map((i) => i.high).filter((b): b is number => !!b).sort((a, b) => a - b);
  const maxCpcMicros = highBids.length ? highBids[Math.floor(highBids.length / 2)] : null;
  let fc: { clicks: number; cost: number; cpc: number } | null = null;
  if (maxCpcMicros) {
    try {
      const start = new Date(Date.now() + 864e5), end = new Date(Date.now() + 31 * 864e5);
      const res = await adsPost(auth, `customers/${cid}:generateKeywordForecastMetrics`, {
        campaign: {
          keywordPlanNetwork: "GOOGLE_SEARCH", geoTargetConstants: geo, languageConstants: [language],
          biddingStrategy: { manualCpcBiddingStrategy: { maxCpcBidMicros: String(maxCpcMicros) } },
          adGroups: groups.map((g) => ({
            biddableKeywords: g.keywords.slice(0, 20).map((k) => ({ maxCpcBidMicros: String(maxCpcMicros), keyword: { text: k.text, matchType: k.match } })),
            negativeKeywords: negatives.slice(0, 50).map((text) => ({ text, matchType: "PHRASE" })),
          })),
        },
        forecastPeriod: { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) },
      });
      await countOps("ads", 1);
      const m = res?.campaignForecastMetrics ?? {};
      if (m.clicks != null) fc = { clicks: Number(m.clicks), cost: fromMicros(m.totalCostMicros ?? m.costMicros ?? 0), cpc: fromMicros(m.averageCpcMicros ?? 0) };
      built.push("Forecast from Keyword Planner for the next 30 days");
    } catch (err) {
      built.push(`Forecast was not available (${(err as Error).message.slice(0, 120)})`);
    }
  }

  // 6. What a lead is likely to cost: this account's rate if it has one, else the portfolio's.
  const [acct] = await q<any>(`SELECT COALESCE(SUM(m.clicks),0)::float AS clicks, COALESCE(SUM(m.conversions),0)::float AS conv
                                 FROM metrics_daily m JOIN campaigns c ON c.client_id = m.client_id AND c.campaign_id = m.entity_id AND c.channel_type = 'SEARCH'
                                WHERE m.client_id = $1 AND m.entity_type = 'campaign' AND m.date > CURRENT_DATE - 91`, [clientId]);
  const bench = await q1<{ stats: any }>(`SELECT stats FROM portfolio_patterns WHERE kind = 'benchmark' AND key = 'ads: search conversion rate per click' AND industry = 'all'`).catch(() => null);
  const conversionRate = acct?.conv >= 10 ? acct.conv / acct.clicks : bench?.stats?.median ?? null;
  const conversionRateSource = acct?.conv >= 10 ? "this account's Search campaigns, last 90 days"
    : bench?.stats?.median ? "the median across your other accounts" : "not known yet";
  const budget = input.monthlyBudget;
  const clicksPerMonth = fc ? Math.min(fc.clicks, fc.cpc > 0 ? budget / fc.cpc : fc.clicks) : null;
  const costPerMonth = fc ? Math.min(budget, fc.cost) : null;
  const leads = clicksPerMonth != null && conversionRate != null ? clicksPerMonth * conversionRate : null;
  const leadsLow = leads != null ? Math.floor(leads * 0.6) : null, leadsHigh = leads != null ? Math.ceil(leads * 1.4) : null;
  const costPerLead = leads && costPerMonth ? costPerMonth / leads : null;
  const targetCpa = client.target_cpa ? Number(client.target_cpa) : null;
  const money = (n: number) => `${Math.round(n).toLocaleString()}${currency ? ` ${currency}` : ""}`;
  const verdict = !fc ? "No forecast — Keyword Planner could not estimate these searches here."
    : fc.cost < budget * 0.6 ? `These searches can only absorb about ${money(fc.cost)} a month here — the rest of the budget would go unspent. Add places or services to use it.`
    : costPerLead && targetCpa ? (costPerLead <= targetCpa ? `At about ${money(costPerLead)} per lead this fits your target of ${money(targetCpa)}.` : `At about ${money(costPerLead)} per lead this is above your target of ${money(targetCpa)} — start smaller, or expect to tighten keywords after the first two weeks.`)
    : costPerLead ? `Expect roughly ${money(costPerLead)} per lead; set a target in project settings to judge it against.` : "Set up conversion tracking so leads can be counted.";

  // 7. Readiness.
  const [conv, tags, speed, reach] = await Promise.all([
    q<any>(`SELECT name, category, include_in_conversions, last_received_at FROM conversion_actions WHERE client_id = $1 AND status = 'ENABLED'`, [clientId]),
    q1<any>(`SELECT result FROM tag_checks WHERE client_id = $1`, [clientId]),
    q<any>(`SELECT url, score, field, lab FROM page_speed WHERE client_id = $1 AND strategy = 'mobile' AND error IS NULL`, [clientId]),
    fetch(input.website, { redirect: "follow", signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false),
  ]);
  const wanted = input.goal === "calls" ? /PHONE|CALL/ : input.goal === "sales" ? /PURCHASE/ : /LEAD|SUBMIT|CONTACT|SIGNUP|BOOK|REQUEST|DEFAULT|PAGE_VIEW/;
  const primary = conv.filter((c) => c.include_in_conversions);
  const recording = primary.filter((c) => c.last_received_at && Date.now() - new Date(c.last_received_at).getTime() < 30 * 864e5);
  const fitting = primary.filter((c) => wanted.test(String(c.category ?? "")));
  const slow = speed.filter((s) => (s.field?.lcpMs ?? s.lab?.lcpMs ?? 0) > 4000);
  const tag = tags?.result;
  const checks: Check[] = [
    { key: "site", ok: reach, title: "The website answers", detail: reach ? `${input.website} loads.` : `${input.website} did not load — ads would send people to an error.` },
    { key: "tracking", ok: recording.length > 0, title: "Conversions are being counted",
      detail: recording.length ? `${recording.length} primary conversion action${recording.length === 1 ? " has" : "s have"} recorded in the last 30 days.`
        : primary.length ? "Primary conversion actions exist but none recorded anything in 30 days — the campaign would bid blind." : "No primary conversion action — nothing would be counted.",
      fix: recording.length ? undefined : { label: "Set up a conversion", href: `/clients/${clientId}/tracking` } },
    { key: "goal", ok: fitting.length > 0, title: `Something counts ${input.goal === "calls" ? "calls" : input.goal === "sales" ? "sales" : "leads"}`,
      detail: fitting.length ? `Counted by "${fitting[0].name}".` : `No conversion action counts ${input.goal}. The campaign would optimise for something else.`,
      fix: fitting.length ? undefined : { label: "Create one", href: `/clients/${clientId}/tracking` } },
    { key: "tag", ok: tag ? ["installed", "via_tag_manager"].includes(tag.ads?.status) : null, title: "The Google Ads tag is on the site",
      detail: !tag ? "Not checked yet — run the site check." : ["installed", "via_tag_manager"].includes(tag.ads?.status) ? `Found ${tag.ads?.id}.` : "Not found on the site.",
      fix: { label: "Check tags on the site", href: `/clients/${clientId}/tag-manager` } },
    { key: "speed", ok: speed.length ? slow.length === 0 : null, title: "Pages load fast enough on a phone",
      detail: !speed.length ? "Not measured yet." : slow.length ? `${slow.length} key page${slow.length === 1 ? " is" : "s are"} slow on mobile (over 4 s).` : "Key pages load in under 4 seconds on mobile.",
      fix: { label: "Page speed", href: `/clients/${clientId}/website` } },
    { key: "budget", ok: budget / 30.4 >= Math.max(fromEurosMin(currency), (fc?.cpc ?? 0) * 5), title: "The budget buys enough clicks to learn",
      detail: fc?.cpc ? `${money(budget / 30.4)} a day buys about ${Math.floor(budget / 30.4 / fc.cpc)} clicks a day at ${money(fc.cpc)} each${budget / 30.4 < fc.cpc * 5 ? " — under five a day, results take months to judge" : ""}.` : `${money(budget / 30.4)} a day.` },
  ];

  // 8. Bidding: optimise for conversions only when they are counted and will arrive often enough.
  const smart = recording.length > 0 && (leads ?? 0) >= 15;
  const bidding = smart
    ? { strategy: "MAXIMIZE_CONVERSIONS" as const, maxCpc: null, why: "Conversions are counted and the forecast expects enough of them for Google to learn from — Maximise conversions, with no target to start." }
    : { strategy: "MAXIMIZE_CLICKS" as const, maxCpc: maxCpcMicros ? fromMicros(maxCpcMicros) : null,
        why: `${recording.length ? "Fewer than about 15 conversions a month are expected" : "Conversions are not being counted yet"}, which is too little for Google's conversion bidding to learn from. Maximise clicks with a cap first; switch once conversions build up.` };

  const monthly = matched.reduce((n, i) => n + (i.monthly ?? 0), 0);
  const draft: Draft = readDraft({
    name: `${summary.offers[0]?.name ?? "Search"} — ${input.places.map((p) => p.name).join(", ")}`.slice(0, 120),
    business: { url: input.website, summary },
    locations: input.places, presence: "PRESENCE",
    groups, negatives, dailyBudget: Math.round((budget / 30.4) * 100) / 100,
    bidding: bidding.strategy, maxCpc: bidding.maxCpc ? Math.round(bidding.maxCpc * 100) / 100 : null,
  });

  const proposal: Proposal = {
    summary: `Show ads for ${groups.map((g) => g.name.toLowerCase()).join(", ")} to people searching in ${input.places.map((p) => p.name).join(", ")}, for about ${money(budget)} a month.`,
    forecast: { source: fc ? "keyword_planner" : "none", clicksPerMonth, costPerMonth, avgCpc: fc?.cpc ?? null, conversionRate, conversionRateSource, leadsLow, leadsHigh, costPerLead, targetCpa, verdict },
    bidding, checks, searchesPerMonth: monthly || null, built,
  };

  const [row] = await q<{ id: number }>(`INSERT INTO drafts (client_id, name, source, state, step, guided, proposal) VALUES ($1,$2,'wizard',$3,7,$4,$5) RETURNING id`,
    [clientId, draft.name, JSON.stringify(draft), JSON.stringify(input), JSON.stringify(proposal)]);
  return { draftId: row.id, proposal };
}

// Google's own floor is about one euro a day per campaign, in the account's currency.
function fromEurosMin(currency: string | null) {
  const per: Record<string, number> = { EUR: 1, RSD: 117, USD: 1.1, GBP: 0.85, CHF: 0.95, HUF: 400, BAM: 1.96 };
  return per[(currency ?? "EUR").toUpperCase()] ?? 1;
}
