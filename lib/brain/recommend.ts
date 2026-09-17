import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { q, tx } from "@/lib/db";
import { monthlyImpact, storeFindings, type Finding } from "@/lib/engine/findings";
import { validateAction } from "@/lib/actions/kinds";
import { accountSnapshot } from "./snapshot";
import { activeLessons, learningForModel, lessonsAsText } from "./learning";
import { OPERATING_CONTEXT } from "./knowledge/context";
import { SMALL_ACCOUNTS } from "./knowledge/smallaccount";
import { MECHANICS, REPORTING } from "./knowledge/mechanics";
import { LEADGEN } from "./knowledge/leadgen";
import { PMAX } from "./knowledge/pmax";
import { AI_MAX } from "./knowledge/aimax";
import { BENCHMARKS } from "./knowledge/benchmarks";
import { DIAGNOSTICS, WRITING } from "./knowledge/diagnostics";
import { ANALYTICS } from "./knowledge/analytics";
import { SEARCH_CONSOLE } from "./knowledge/searchconsole";
import { TAG_MANAGER } from "./knowledge/tagmanager";
import { WEBSITE } from "./knowledge/website";
import { KEYWORDS } from "./knowledge/keywords";

// Claude Opus 5, pinned: analysis quality must not depend on a default changed
// elsewhere for unrelated reasons.
export const MODEL = "claude-opus-5";
const USD_PER_MTOK_IN = 5;
const USD_PER_MTOK_OUT = 25;

export function brainConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

// One block, always the same, so the prompt cache holds across projects. The
// other products' modules ride along even for Ads-only projects: a stable
// cached prefix costs a tenth of a fresh one.
export const KNOWLEDGE = [
  OPERATING_CONTEXT, SMALL_ACCOUNTS, MECHANICS, REPORTING, LEADGEN, PMAX, AI_MAX, BENCHMARKS, DIAGNOSTICS,
  KEYWORDS, TAG_MANAGER, ANALYTICS, SEARCH_CONSOLE, WEBSITE,
  WRITING,
].join("\n\n");

const SYSTEM = `You write the "What to change" list for an agency operator running one project: a business's Google Ads account together with whichever of Google Analytics, Search Console and Tag Manager are connected (client.connected). Your output becomes cards with numbered steps the operator follows, and some of those cards carry a button that makes the change in Google Ads after they confirm.

PRODUCTS

Every recommendation names the product whose settings change: ads, analytics, search_console, tag_manager, business_profile (the Google Business Profile), website (the site itself: speed, pages) — or cross when the fix only makes sense reading two together (a Search Console query with no paid coverage, a landing page that converts organic visitors but not paid ones). Each finding carries its product. Do not reduce the list to Google Ads when the findings show work in the other products: a broken key event in Analytics or a page losing organic clicks belongs on the list on its own merits. For Analytics, Search Console and Tag Manager the steps name those tools' menus (for example "Admin → Data streams → the stream → Configure tag settings → List unwanted referrals"). Buttons exist only for Google Ads.

THE RULE

You are never asked to find a number. Only to explain one. Every figure you are given was computed from the account's data before you saw it, in the findings and the snapshot. Quote those figures exactly. Never calculate a new one, estimate one, or round one misleadingly. If a figure is not in the input, do not state it.

Your job is the three things arithmetic cannot do: explain the mechanism in plain words, put the work in the right order, and do the creative parts — which searches become keywords, how a campaign should be split, what a test should prove.

WHAT A RECOMMENDATION MUST BE

- Actionable without a follow-up question. "Improve your keywords" is useless. "Pause these four keywords: they cost 1,240 and produced nothing in 90 days" is the standard.
- Built on findings. Every recommendation cites the ids of the findings it rests on in finding_ids. A recommendation with no finding behind it is only allowed for sequencing or a campaign proposal, and must say which data it rests on.
- steps are the actual clicks, in order, naming exact Google Ads menu items (for example "Campaigns → select the campaign → Keywords → Negative keywords → +"), keywords, campaign names and values. One operation per step.
- why explains the mechanism — why this is costing money or losing leads — in two to four plain sentences a non-specialist follows.
- No week-over-week commentary. That is reporting, not an action list.
- Say what not to touch where a naive reading would change something that works.

ORDER AND TIMING

- Measurement before optimisation. If conversion tracking is broken or double counting, that recommendation comes first and every efficiency recommendation must say its numbers are unreliable until fixed.
- do_by_days is days from today. Changes that restart Smart Bidding learning — budget, bid strategy, conversion goals, adding or removing campaigns from a strategy — must be spaced at least one conversion cycle apart (on low-volume accounts, two weeks or more; on Performance Max with low volume, up to six weeks). Target changes do not restart learning. Say in the steps when something must wait for an earlier change to settle.
- severity: do_first = losing money or measuring wrong today; worth_doing = matters this month; when_time = worth doing when there is time.

ACTIONS

At most one action per recommendation, and only when a button genuinely does the whole job. Five kinds exist; anything else stays as written steps with action_kind "none". Parameters go in action_params_json as a JSON object string.
- pause_campaign: {"campaign_id": "..."}
- add_negative_keywords: {"campaign_id": "...", "terms": ["..."], "match_type": "EXACT" | "PHRASE"} — Search campaigns only.
- change_budget: {"campaign_id": "...", "change_pct": integer between -30 and 30} — never more than 30% in one step.
- set_ad_schedule: {"campaign_id": "...", "start_hour": 0-23, "end_hour": 1-24, "days": ["MONDAY", ...], "mode": "exclude" | "adjust", "bid_adjust_pct": integer} — "adjust" only on Manual CPC or Maximise Clicks (TARGET_SPEND); on any other bid strategy use "exclude" or no action. Take the band from a schedule finding.
- set_device_bid_modifier: {"campaign_id": "...", "device": "MOBILE" | "DESKTOP" | "TABLET", "bid_adjust_pct": integer} — only -100 unless the strategy is Manual CPC, Maximise Clicks or Target CPA; never on Performance Max.
Use campaign ids exactly as given in the snapshot.

HARD RULES ON NEGATIVES — breaking these causes damage money cannot fix

- Never propose negativing a search term that appears in the converting search terms list, or any close variant of one.
- Never propose negativing anything containing a brand term (listed under client.brandTerms).
- Only propose negatives that appear among the non-converting search terms in the input.
Code enforces these as well; a proposal that breaks them loses its button.

PREDICTIONS

Where a change should move a number, set prediction_metric (cpa, spend, conversions or cvr) and prediction_direction (up or down), and state in prediction_hypothesis what should happen and why. That becomes an experiment the operator can start, which is checked later. Never predict a size — only a direction. Leave prediction_metric "none" for tracking fixes and anything unmeasurable.

CAMPAIGN PROPOSALS

Where the findings show demand the account does not structurally cover — searches that convert but are not keywords, Search Console queries with no paid coverage — you may propose a new campaign in campaign_plan_json: {"name": "...", "why": "...", "landing_url": "...", "ad_groups": [{"name": "...", "keywords": ["..."]}]}. Keywords must come from those findings or the converting search terms. Never invent ad copy or a budget — those stay empty for the operator.

WHAT THE PORTFOLIO HAS LEARNED

portfolioLearning holds what has been measured across every project: what each kind of change was followed by on other accounts (changeEffects, by volume band), search words that consistently waste or convert on several accounts, benchmarks from the portfolio itself, how common each problem is, how its own past recommendations were received, and the lessons in force. Use it to judge and order: a kind of change that was followed by worse results on several comparable accounts needs a stronger case here; a waste word that also fails on this account strengthens a negative-keyword recommendation. Cite portfolio evidence in why as "on other accounts we run" — never name another business, and never state a figure that is not in the input. This project's own data outranks the portfolio when it has enough volume.

VOLUME AND HONESTY

Most of these accounts are below the conversion floors. Findings marked "not yet evidence" or "early signal" have not passed the statistical tests: never build an action on them; at most mention them as something to re-check. Never recommend what the knowledge lists as harmful for sub-floor accounts.

OUTPUT

summary: one or two sentences — the story this account is telling right now, the single most important thing, with its figure from the findings.
recommendations: between 3 and 10, ordered by what to do first. Fewer and sharper beats a long list. If the account is genuinely healthy, say so in the summary and return only what is worth doing.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          product: { type: "string", enum: ["ads", "analytics", "search_console", "tag_manager", "business_profile", "website", "cross"] },
          area: { type: "string", enum: ["tracking", "waste", "targeting", "budget", "bidding", "structure", "creative", "opportunity", "schedule"] },
          severity: { type: "string", enum: ["do_first", "worth_doing", "when_time"] },
          finding_ids: { type: "array", items: { type: "integer" } },
          why: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          do_by_days: { type: "integer" },
          effort_minutes: { type: "integer" },
          action_kind: { type: "string", enum: ["none", "pause_campaign", "add_negative_keywords", "change_budget", "set_ad_schedule", "set_device_bid_modifier"] },
          action_params_json: { type: "string" },
          prediction_metric: { type: "string", enum: ["none", "cpa", "spend", "conversions", "cvr"] },
          prediction_direction: { type: "string", enum: ["none", "up", "down"] },
          prediction_hypothesis: { type: "string" },
          campaign_plan_json: { type: "string" },
        },
        required: ["title", "product", "area", "severity", "finding_ids", "why", "steps", "do_by_days", "effort_minutes",
          "action_kind", "action_params_json", "prediction_metric", "prediction_direction", "prediction_hypothesis", "campaign_plan_json"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "recommendations"],
  additionalProperties: false,
};

// Validation is per item and deliberately forgiving. One malformed field must
// not discard the rest of the work: a bad action loses its button, a bad plan
// loses the plan, and only an item missing its core (title, steps) is skipped.
const Core = z.object({
  title: z.string().min(3),
  why: z.string().default(""),
  steps: z.array(z.string()).min(1),
  severity: z.enum(["do_first", "worth_doing", "when_time"]).catch("worth_doing"),
  area: z.string().catch("structure"),
  product: z.enum(["ads", "analytics", "search_console", "tag_manager", "business_profile", "website", "cross"]).catch("ads"),
  finding_ids: z.array(z.number().int()).catch([]),
  do_by_days: z.number().int().min(0).max(120).catch(14),
  effort_minutes: z.number().int().min(1).max(600).catch(15),
});

const Plan = z.object({
  name: z.string().min(1),
  why: z.string().default(""),
  landing_url: z.string().default(""),
  ad_groups: z.array(z.object({ name: z.string(), keywords: z.array(z.string()).default([]) })).default([]),
});

export type RunResult = { inserted: number; skipped: number; actionsDropped: number; cost: number; summary: string };

export async function recommend(clientId: number): Promise<RunResult> {
  if (!brainConfigured()) throw new Error("ANTHROPIC_API_KEY is not set.");

  const snap = await accountSnapshot(clientId);
  const findings: Finding[] = snap._findings;
  await storeFindings(clientId, findings);

  const otherProducts = snap.client.connected.analytics || snap.client.connected.searchConsole || snap.client.connected.businessProfile;
  if (snap.baseline.conversions90 === 0 && !otherProducts) {
    // No conversions at all means no yardstick: every judgement below would be
    // meaningless. Say so rather than generate advice on top of nothing.
    await q(`UPDATE recommendations SET status = 'superseded', updated_at = now()
              WHERE client_id = $1 AND status = 'open'`, [clientId]);
    await q(`INSERT INTO recommendations (client_id, area, severity, title, why, steps, do_by, effort_minutes)
             VALUES ($1, 'tracking', 'do_first', $2, $3, $4, CURRENT_DATE, 30)`,
      [clientId, "No conversions recorded in 90 days — check tracking before anything else",
       "Without conversions there is nothing to judge spend against, so every efficiency recommendation would be guesswork. Clicks with no conversions almost always means tracking is broken, not that the ads failed.",
       JSON.stringify(["Open Goals → Conversions → Summary and check each primary action's status.",
         "Open the Tracking page in Fortress to see which actions last received a hit and when.",
         "Submit a test lead on the website and confirm it appears within a few hours."])]);
    return { inserted: 1, skipped: 0, actionsDropped: 0, cost: 0, summary: "No conversions recorded in 90 days." };
  }

  const [previous, record, learning, lessons] = await Promise.all([
    q<any>(`SELECT title, status, created_at::date AS created FROM recommendations
             WHERE client_id = $1 ORDER BY created_at DESC LIMIT 25`, [clientId]),
    q<any>(`SELECT title, verdict, result, evaluated_at::date AS evaluated FROM experiments
             WHERE client_id = $1 AND status = 'finished' ORDER BY evaluated_at DESC LIMIT 10`, [clientId]),
    learningForModel(clientId),
    activeLessons(),
  ]);

  const { _findings, ...forModel } = snap;
  const input = {
    today: new Date().toISOString().slice(0, 10),
    ...forModel,
    previousRecommendations: previous,
    trackRecord: record.length
      ? record
      : "No experiment has reached its check date on this account, so there is no track record yet.",
    // Installation-wide: what has worked, been refuted or been dismissed on
    // every project, for every user. Weigh a kind of change by how it has
    // fared elsewhere, and treat small counts as small.
    portfolioLearning: { experiments: learning.outcomesAcrossAllProjects, feedback: learning.operatorFeedbackLast180Days, portfolio: learning.portfolio },
  };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim() });
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [
      { type: "text" as const, text: KNOWLEDGE, cache_control: { type: "ephemeral" as const } },
      ...(lessons.length ? [{ type: "text" as const, text: lessonsAsText(lessons) }] : []),
      { type: "text" as const, text: SYSTEM },
    ],
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: `Here is everything measured about this account. Write the list.\n\n${JSON.stringify(input)}` }],
  } as any);

  const usage = (res as any).usage ?? {};
  const cost =
    ((usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1) / 1e6 * USD_PER_MTOK_IN +
    ((usage.output_tokens ?? 0) / 1e6) * USD_PER_MTOK_OUT;

  const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let top: { summary?: unknown; recommendations?: unknown[] };
  try {
    top = JSON.parse(text);
  } catch {
    await logRun(clientId, usage, cost, findings.length, 0, 0, 0, null, "The model returned something that was not JSON.");
    throw new Error("The model returned something that was not valid JSON.");
  }

  const summary = typeof top.summary === "string" ? top.summary : "";
  const items = Array.isArray(top.recommendations) ? top.recommendations : [];

  type Row = {
    core: z.infer<typeof Core>; impact: number | null; evidence: unknown;
    action: unknown; actionSummary: string | null; campaignIds: string[];
    prediction: { metric: string; direction: string; hypothesis: string } | null;
    plan: unknown;
  };
  const rows: Row[] = [];
  let skipped = 0, actionsDropped = 0;

  for (const item of items) {
    const core = Core.safeParse(item);
    if (!core.success) { skipped++; continue; }
    const it = item as Record<string, any>;
    const cited = core.data.finding_ids.map((id) => findings[id]).filter(Boolean);

    // The monthly figure is summed by code from the findings cited — never taken
    // from the model. Findings with no recoverable money contribute nothing.
    const impact = cited.length ? cited.reduce((n, f) => n + monthlyImpact(f), 0) : null;

    let action: unknown = null, actionSummary: string | null = null, campaignIds: string[] = [];
    if (it.action_kind && it.action_kind !== "none") {
      let params: unknown = null;
      try { params = JSON.parse(it.action_params_json || "{}"); } catch { /* bad JSON loses the button */ }
      const v = params ? await validateAction(clientId, { kind: it.action_kind, params }) : null;
      if (v?.ok) { action = v.action; actionSummary = v.summary; campaignIds = v.campaignIds; }
      else actionsDropped++;
    }
    for (const f of cited) if (f.entityType === "campaign" && f.entityId && !campaignIds.includes(f.entityId)) campaignIds.push(f.entityId);

    const prediction = it.prediction_metric && it.prediction_metric !== "none" && ["up", "down"].includes(it.prediction_direction)
      ? { metric: it.prediction_metric, direction: it.prediction_direction, hypothesis: String(it.prediction_hypothesis ?? "") }
      : null;

    let plan: unknown = null;
    if (it.campaign_plan_json) {
      try {
        const parsed = Plan.safeParse(JSON.parse(it.campaign_plan_json));
        if (parsed.success) plan = parsed.data;
      } catch { /* a bad plan loses the plan, not the recommendation */ }
    }

    rows.push({
      core: core.data, impact,
      evidence: { findings: cited.map((f) => ({ kind: f.kind, title: f.title, detail: f.detail, table: f.table ?? null, severity: f.severity })) },
      action, actionSummary, campaignIds, prediction, plan,
    });
  }

  const runId = await logRun(clientId, usage, cost, findings.length, rows.length, skipped, actionsDropped, summary, null);

  await tx(async (run) => {
    // Un-started experiments go with the recommendation that proposed them;
    // running ones stay, because someone is waiting on their verdict.
    await run(`DELETE FROM experiments WHERE client_id = $1 AND status = 'proposed'
                AND recommendation_id IN (SELECT id FROM recommendations WHERE client_id = $1 AND status = 'open')`, [clientId]);
    await run(`UPDATE recommendations SET status = 'superseded', updated_at = now()
                WHERE client_id = $1 AND status = 'open'`, [clientId]);

    for (const r of rows) {
      const [rec] = await run<{ id: number }>(
        `INSERT INTO recommendations (client_id, run_id, area, severity, title, why, steps, do_by,
            effort_minutes, monthly_impact, finding_kinds, evidence, action, prediction, campaign_plan, product)
         VALUES ($1,$2,$3,$4,$5,$6,$7, CURRENT_DATE + $8::int, $9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [clientId, runId, r.core.area, r.core.severity, r.core.title, r.core.why,
         JSON.stringify(r.core.steps), r.core.do_by_days, r.core.effort_minutes,
         r.impact != null ? r.impact.toFixed(2) : null,
         r.core.finding_ids.map((id) => findings[id]?.kind).filter(Boolean),
         JSON.stringify(r.evidence),
         r.action ? JSON.stringify({ ...(r.action as object), summary: r.actionSummary }) : null,
         r.prediction ? JSON.stringify(r.prediction) : null,
         r.plan ? JSON.stringify(r.plan) : null, r.core.product]
      );
      if (r.prediction) {
        await run(
          `INSERT INTO experiments (client_id, recommendation_id, title, hypothesis, metric, direction, scope)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [clientId, rec.id, r.core.title, r.prediction.hypothesis, r.prediction.metric,
           r.prediction.direction, JSON.stringify({ campaignIds: r.campaignIds })]
        );
      }
    }
  });

  return { inserted: rows.length, skipped, actionsDropped, cost, summary };
}

async function logRun(
  clientId: number, usage: any, cost: number, findings: number, inserted: number,
  skipped: number, dropped: number, summary: string | null, error: string | null
): Promise<number> {
  const [r] = await q<{ id: number }>(
    `INSERT INTO analysis_runs (client_id, model, input_tokens, output_tokens, cost_usd,
        findings_count, insights_count, skipped_count, actions_dropped, summary, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [clientId, MODEL,
     (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
     usage.output_tokens ?? 0, cost.toFixed(4), findings, inserted, skipped, dropped, summary, error]
  );
  return r.id;
}

export async function lastRun(clientId: number) {
  const [r] = await q<any>(`SELECT id, created_at, cost_usd, model, insights_count, skipped_count,
                                   actions_dropped, summary
                              FROM analysis_runs WHERE client_id = $1 AND error IS NULL
                             ORDER BY created_at DESC LIMIT 1`, [clientId]);
  return r ?? null;
}
