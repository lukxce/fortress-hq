import Anthropic from "@anthropic-ai/sdk";
import { q, q1 } from "@/lib/db";
import { clientWithProperties } from "@/lib/binding";
import { campaignPerformance, periodTotals, pacing } from "@/lib/engine/metrics";
import { computeFindings, storeFindings } from "@/lib/engine/findings";
import { segment, keywordSplit } from "@/lib/engine/segments";
import { monthlyShape } from "@/lib/engine/forensics";
import { OPERATING_CONTEXT } from "./knowledge/context";
import { MECHANICS, REPORTING } from "./knowledge/mechanics";
import { BENCHMARKS } from "./knowledge/benchmarks";
import { AI_MAX } from "./knowledge/aimax";
import { PMAX } from "./knowledge/pmax";
import { LEADGEN } from "./knowledge/leadgen";
import { DIAGNOSTICS, WRITING } from "./knowledge/diagnostics";

// Claude Opus 5. Pinned deliberately: the analysis quality of this app must not
// depend on a setting changed elsewhere for unrelated reasons.
const MODEL = "claude-opus-5";

// Pricing as of Sep 2026, used only to show the operator what a run cost.
const USD_PER_MTOK_IN = 5;
const USD_PER_MTOK_OUT = 25;

export type Insight = {
  headline: string;
  summary: string;
  category: "efficiency" | "tracking" | "targeting" | "budget" | "creative" | "structure";
  priority: 1 | 2 | 3;
  rationale: string;
  next_steps: string[];
};

export function brainConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * The context pack.
 *
 * Every figure here was computed by SQL before the model saw anything. The
 * model's job is to interpret and prioritise, never to calculate — a model that
 * does arithmetic on advertising spend will eventually be confidently wrong
 * about money.
 */
async function buildContext(clientId: number) {
  const client = await clientWithProperties(clientId);
  if (!client) throw new Error(`No client ${clientId}`);

  const [{ current, previous }, pace, campaigns, findings] = await Promise.all([
    periodTotals(clientId, 30),
    pacing(client),
    campaignPerformance(clientId, 30),
    computeFindings(clientId),
  ]);

  const topTerms = await q<any>(`
    SELECT term, cost_micros/1e6 AS spend, clicks, conversions
      FROM search_terms WHERE client_id = $1
     ORDER BY cost_micros DESC LIMIT 25
  `, [clientId]);

  const actions = await q<any>(`
    SELECT name, category, counting_type, include_in_conversions, conversions_30d
      FROM conversion_actions WHERE client_id = $1 AND status = 'ENABLED'
  `, [clientId]);

  // The segmentation. Without this the model can only restate the totals it was
  // given; with it, it can say where the money is actually going.
  const [devices, hours, dow, networks, geo, keywords, landing, gtmTags] =
    await Promise.all([
      segment(clientId, "device"),
      segment(clientId, "hour"),
      segment(clientId, "day_of_week"),
      segment(clientId, "network"),
      segment(clientId, "geo"),
      keywordSplit(clientId),
      q<any>(`SELECT url, clicks, cost_micros/1e6 AS spend, conversions
                FROM landing_pages WHERE client_id = $1
               ORDER BY cost_micros DESC LIMIT 15`, [clientId]),
      q<any>(`SELECT name, type, paused, consent_status
                FROM gtm_tags WHERE client_id = $1`, [clientId]),
    ]);

  const [months, placements, mix] = await Promise.all([
    monthlyShape(clientId),
    q<any>(`SELECT placement, display_name, placement_type,
                   SUM(clicks) AS clicks, SUM(cost_micros)/1e6 AS spend,
                   SUM(conversions) AS conversions
              FROM placements WHERE client_id = $1
             GROUP BY placement, display_name, placement_type
             ORDER BY SUM(clicks) DESC LIMIT 25`, [clientId]),
    q<any>(`SELECT action_name, SUM(conversions) AS conversions
              FROM conversion_breakdown WHERE client_id = $1
             GROUP BY action_name ORDER BY SUM(conversions) DESC LIMIT 15`, [clientId]),
  ]);

  return {
    client: {
      name: client.name,
      goal: client.goal_type,
      targetCpa: client.target_cpa ? Number(client.target_cpa) : null,
      targetRoas: client.target_roas ? Number(client.target_roas) : null,
      monthlyBudget: client.monthly_budget ? Number(client.monthly_budget) : null,
      currency: client.currency,
      connected: {
        analytics: Boolean(client.ga4_property_id),
        searchConsole: Boolean(client.gsc_site_url),
        tagManager: Boolean(client.gtm_container_id),
      },
    },
    last30Days: current,
    previous30Days: previous,
    pacing: pace,
    campaigns: campaigns.slice(0, 25),
    topSearchTermsBySpend: topTerms,
    conversionActions: actions,
    findings: findings.map((f) => ({
      severity: f.severity, title: f.title, detail: f.detail,
      moneyAtStake: f.moneyAtStake, evidence: f.evidence,
    })),
    // 90-day windows. These are pattern questions, so they need volume.
    segmentation: {
      note: "All segment figures cover the last 90 days.",
      byDevice: devices,
      byHourOfDay: hours.map((h) => ({ hour: Number(h.key), ...h })).sort((a, b) => a.hour - b.hour),
      byDayOfWeek: dow,
      byNetwork: networks,
      byCountry: geo.slice(0, 10),
    },
    keywords: {
      converting: keywords.workers.slice(0, 20),
      spendingWithoutConverting: keywords.spenders.slice(0, 20),
      lowQualityScore: keywords.lowQuality.slice(0, 15),
      totalKeywordSpend: keywords.totalSpend,
      spendOnNonConverting: keywords.spenderSpend,
    },
    landingPages: landing,
    // When the account changed, rather than merely that it did.
    monthlyShape: months,
    // Where display and Performance Max impressions physically landed.
    placements: placements.slice(0, 25),
    // What the account is actually optimising toward.
    conversionMix: mix,
    tagManager: gtmTags.length
      ? { tagCount: gtmTags.length, tags: gtmTags }
      : { note: "Tag Manager not connected or not yet synced." },
  };
}

const SYSTEM = `You are the analyst behind an advertising operations platform, writing for the person who owns the outcome: an agency operator deciding what to do this week, and who may have to justify it to the client whose money this is.

Every number you are given was computed from the account's own data before you saw it. Interpret and prioritise those numbers. Never calculate new ones, never estimate, and never state a figure that is not in the input.

HAVE A THESIS

A list of observations is not analysis. Find the story the account is telling and lead with it. Usually there is one: something changed at a point in time, or one structural fault is distorting everything downstream. Say what it is in your first insight, then use the rest to support and extend it.

  Weak:  "Cost per conversion has increased 40%."
  Strong: "March was the best month this account has had. A single campaign's traffic went from 7,000 clicks to 61,000 in April and every number since has been downstream of that."

CHAIN CAUSE TO EFFECT

Do not stop at the symptom. Follow it as far as the data allows, and say each link out loud.

  Weak:  "Display is underperforming."
  Strong: "Display went from 7,000 to 61,000 clicks in one month. Those clicks came from mobile app inventory at five cents each. One of those placements produced conversions at roughly account-average cost, so the bid strategy read it as success and bought more. That is where the unqualified traffic comes from."

SEPARATE MONEY DAMAGE FROM SIGNAL DAMAGE

Cheap junk traffic often costs almost nothing and does enormous harm, because the bid algorithm learns from it. When that is what the data shows, say so explicitly: the money was trivial, the signal was not. This distinction is frequently the most valuable thing in the analysis.

QUESTION THE HEADLINE NUMBERS

If a reported metric contradicts what the underlying data shows, say so. An account can report a falling cost per conversion while actually collapsing, because the conversion count is inflated by an action that means nothing. Trust the composition over the total.

SAY WHAT NOT TO TOUCH

An operator acting on your analysis will change things. Name the parts that are working and should be left alone, especially where a naive reading would suggest changing them. "Search CPCs have been stable throughout, it is not what changed" prevents damage.

ORDER THE FIXES, AND JUSTIFY THE ORDER

Sequence matters and the reason for it is usually itself an insight. If conversion counting is wrong, fixing placements first only moves the problem, because the algorithm will find a new junk source that produces the same worthless conversion. Say that.

BE SPECIFIC ABOUT THE ACTION

Every next step names a thing and an operation: this campaign, this keyword, this placement, this bid adjustment, this time band, this setting and what to change it to. Never "review", "monitor", "consider optimising", "keep an eye on".

RESPECT THE LIMITS OF THE DATA

- Never draw a conclusion from a segment with trivial traffic. Say the data is too thin instead.
- Distinguish correlation from cause, and say what would confirm it.
- If measurement is broken, say that first and state plainly that every efficiency figure downstream is unreliable. Do not recommend optimisation on top of numbers you have just called untrustworthy.
- You can see Google Ads and, where connected, Analytics, Search Console and Tag Manager. You cannot see the CRM, so you cannot know whether a conversion became revenue. Where that distinction matters, say what you cannot see.

STYLE

Plain, direct, unhedged. No filler, no "it's important to note", no motivational language. A smart reader who is not an advertising specialist should follow every sentence. Short sentences. Name real things: campaign names, keywords, placements, hours, figures from the input.

PRIORITY

1 = losing money or measuring wrong today. 2 = matters this month. 3 = worth knowing.

Return between 3 and 6 insights, ordered by priority. Fewer and sharper beats a long list. If the account is genuinely healthy, say so in one insight rather than manufacturing five.`;

export async function analyseClient(clientId: number): Promise<{
  insights: Insight[];
  cost: number;
  model: string;
}> {
  if (!brainConfigured()) throw new Error("ANTHROPIC_API_KEY is not set.");

  const context = await buildContext(clientId);
  const findings = await computeFindings(clientId);
  await storeFindings(clientId, findings);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim() });

  const schema = {
    type: "object",
    properties: {
      insights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            headline: { type: "string" },
            summary: { type: "string" },
            category: {
              type: "string",
              enum: ["efficiency", "tracking", "targeting", "budget", "creative", "structure"],
            },
            priority: { type: "integer", enum: [1, 2, 3] },
            rationale: { type: "string" },
            next_steps: { type: "array", items: { type: "string" } },
          },
          required: ["headline", "summary", "category", "priority", "rationale", "next_steps"],
          additionalProperties: false,
        },
      },
    },
    required: ["insights"],
    additionalProperties: false,
  };

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    // Ordered most-stable first so the whole knowledge block sits in a cacheable
    // prefix: it never changes between runs, while the account data always does.
    system: [
      {
        type: "text" as const,
        text: [OPERATING_CONTEXT, MECHANICS, REPORTING, LEADGEN, PMAX, AI_MAX, BENCHMARKS, DIAGNOSTICS, WRITING, SYSTEM].join("\n\n"),
        cache_control: { type: "ephemeral" as const },
      },
    ],
    output_config: { format: { type: "json_schema", schema } },
    messages: [{
      role: "user",
      content: `Here is everything known about this account. Brief me.\n\n${JSON.stringify(context, null, 2)}`,
    }],
  } as any);

  const text = (res.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  let parsed: { insights: Insight[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The model returned something that was not valid JSON.");
  }

  const usage = (res as any).usage ?? {};
  const cost =
    ((usage.input_tokens ?? 0) / 1e6) * USD_PER_MTOK_IN +
    ((usage.output_tokens ?? 0) / 1e6) * USD_PER_MTOK_OUT;

  await q("DELETE FROM insights WHERE client_id = $1 AND status = 'new'", [clientId]);
  for (const i of parsed.insights ?? []) {
    await q(
      `INSERT INTO insights (client_id, headline, summary, category, priority,
          rationale, next_steps, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [clientId, i.headline, i.summary, i.category, i.priority,
       i.rationale, JSON.stringify(i.next_steps ?? []), MODEL]
    );
  }

  await q(
    `INSERT INTO analysis_runs (client_id, model, input_tokens, output_tokens,
        cost_usd, findings_count, insights_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [clientId, MODEL, usage.input_tokens ?? 0, usage.output_tokens ?? 0,
     cost.toFixed(4), findings.length, parsed.insights?.length ?? 0]
  );

  return { insights: parsed.insights ?? [], cost, model: MODEL };
}

export async function lastAnalysis(clientId: number) {
  return q1<{ created_at: string; cost_usd: string; model: string; insights_count: number }>(
    `SELECT created_at, cost_usd, model, insights_count FROM analysis_runs
      WHERE client_id = $1 AND error IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [clientId]
  );
}
