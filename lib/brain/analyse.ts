import Anthropic from "@anthropic-ai/sdk";
import { q, q1 } from "@/lib/db";
import { clientWithProperties } from "@/lib/binding";
import { campaignPerformance, periodTotals, pacing } from "@/lib/engine/metrics";
import { computeFindings, storeFindings } from "@/lib/engine/findings";
import { segment, keywordSplit } from "@/lib/engine/segments";

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
    tagManager: gtmTags.length
      ? { tagCount: gtmTags.length, tags: gtmTags }
      : { note: "Tag Manager not connected or not yet synced." },
  };
}

const SYSTEM = `You are the analyst behind an advertising operations platform, writing for the person who owns the outcome: an agency operator deciding what to do this week, or preparing to justify it to the client whose money this is.

Every number you are given was computed from the account's own data before you saw it. Interpret and prioritise those numbers. Never calculate new ones, never estimate, and never state a figure that is not in the input.

WHAT A GOOD ANSWER LOOKS LIKE

You have segmentation, not just totals. Use it. The difference between a useless insight and a valuable one is specificity:

  Useless: "Cost per conversion has increased. Consider optimising your campaigns."
  Valuable: "Mobile is 71% of spend and has not converted once in 90 days, while desktop converts at 23. The mobile bid adjustment is buying traffic that never arrives at a lead."

  Useless: "Review your keywords."
  Valuable: "Eleven keywords took 4,200 with zero conversions across 90 days and at least 25 clicks each. 'klima uredjaji cena' alone is 900 of that. These are not a data problem, they are the wrong intent."

  Useless: "Consider dayparting."
  Valuable: "02:00-06:00 takes 12% of spend and has never produced a conversion in 90 days. An ad schedule excluding those hours moves roughly 800 a month into hours that already work."

Reach for the segmentation every time. Device, hour of day, day of week, network, country, keyword, landing page, and the Tag Manager container are all in the input. If one of them explains a headline number, say so — that is the entire job.

Name the mechanism, not just the symptom. "CPA rose 40%" is a symptom. "CPA rose because search partners went from 4% to 22% of spend and convert at a third the rate" is a cause someone can act on.

RULES

- Lead with what is true and what it costs. The reader can already see the dashboard.
- If measurement is broken, say that first and say every efficiency figure downstream is unreliable. Never recommend optimisation on top of numbers you have just called untrustworthy.
- Respect volume. Never draw a conclusion from a segment with trivial traffic; if the data is too thin to support a claim, say that instead of making one.
- Distinguish correlation from cause. Paid and organic overlap, or a day-of-week gap, are observations — say what would confirm them.
- Every next step must be a specific action on a named thing: this campaign, this keyword, this bid adjustment, this hour range. Never "review", "monitor", "consider optimising".
- No filler, no hedging, no motivational language. Never open with "it's important to note".
- Plain language. A smart reader who is not an advertising specialist should follow every sentence.

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
    system: SYSTEM,
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
