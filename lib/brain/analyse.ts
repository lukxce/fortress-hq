import Anthropic from "@anthropic-ai/sdk";
import { q, q1 } from "@/lib/db";
import { clientWithProperties } from "@/lib/binding";
import { campaignPerformance, periodTotals, pacing } from "@/lib/engine/metrics";
import { computeFindings, storeFindings } from "@/lib/engine/findings";

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
  };
}

const SYSTEM = `You are the analyst behind an advertising operations platform. You are writing for the person who owns the outcome — an agency operator briefing themselves before they act, or before they talk to the client whose money this is.

Every number you are given was computed from the account's own data before you saw it. Interpret and prioritise those numbers. Never calculate new ones, never estimate, and never state a figure that is not in the input.

How to write:
- Lead with what is true and what it costs. The reader can already see the dashboard; they need to know what it means.
- Be specific. "Three campaigns are burning budget on branded terms you already rank first for" beats "consider reviewing your keyword strategy".
- Say what you do not know. If tracking is broken, say every efficiency figure downstream is unreliable, and say that before anything else.
- No filler, no hedging, no motivational language. Never open with "it's important to note".
- Write plainly. A smart reader who is not an advertising specialist should follow every sentence.
- Where a finding is correlational rather than causal, say so plainly rather than implying certainty.

Priority means: 1 is losing money or measuring wrong today. 2 matters this month. 3 is worth knowing.

Return between 3 and 6 insights. Fewer, sharper ones beat a long list.`;

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
