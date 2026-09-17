import Anthropic from "@anthropic-ai/sdk";
import { q } from "@/lib/db";
import { KNOWLEDGE, MODEL } from "@/lib/brain/recommend";
import { portfolioFeedback, portfolioOutcomes } from "@/lib/brain/learning";
import { getSetting } from "./settings";

/**
 * Turning measurements into lessons.
 *
 * Once a week the brain reads every pattern the code measured across all
 * projects, what happened to its own recommendations, the lessons already in
 * force and the ones an admin rejected, next to the verified knowledge it
 * started from. It drafts lessons only where the portfolio shows something the
 * knowledge does not already say — or contradicts it.
 *
 * A drafted lesson carries the ids of the patterns it rests on, and the evidence
 * stored with it is copied from those patterns by code, never written by the
 * model. A draft citing nothing is thrown away. Drafts wait for an admin unless
 * "apply its own lessons" is switched on.
 */

const SYSTEM = `You maintain the lessons of an advertising analysis system that runs many businesses' Google Ads, Analytics, Search Console and Tag Manager. You already have verified knowledge (above). Below are patterns measured by code across every connected project.

Write lessons: short rules that should change how future analyses judge or order recommendations. Rules:
- Every lesson cites the ids of the patterns it rests on in pattern_ids. Only cite patterns marked significant, or change effects whose counts clearly point one way on several projects.
- Never write a number in the lesson text. The evidence is attached separately by code.
- A lesson must add something: a pattern the knowledge does not state, a narrowing of general advice to a kind of account (a volume band, an industry), or a contradiction. If a pattern only confirms what the knowledge already says, skip it.
- When a pattern contradicts the knowledge, set challenges_knowledge to the claim it contradicts, in a few words, and phrase the lesson carefully: what these accounts showed, for which kind of account.
- Observational data is not an experiment. Say "on these accounts, X was followed by Y", never "X causes Y".
- Waste and converting search themes are words, and a word can mean different things in different trades. Scope a theme lesson to its industry when the pattern is industry-scoped.
- Do not repeat a lesson already in force or one the admin rejected.
- Fewer, sharper lessons. Zero is a fine answer.`;

const SCHEMA = {
  type: "object",
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          product: { type: "string", enum: ["all", "ads", "analytics", "search_console", "tag_manager", "business_profile", "website"] },
          pattern_ids: { type: "array", items: { type: "integer" } },
          challenges_knowledge: { type: "string" },
        },
        required: ["text", "product", "pattern_ids", "challenges_knowledge"],
        additionalProperties: false,
      },
    },
  },
  required: ["lessons"],
  additionalProperties: false,
};

export async function distillLessons(): Promise<{ proposed: number; applied: boolean; cost: number }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { proposed: 0, applied: false, cost: 0 };

  const [patterns, lessons, outcomes, feedback, auto] = await Promise.all([
    q<any>(`SELECT id, kind, industry, key, stats, projects, significant FROM portfolio_patterns
             WHERE significant OR (kind = 'change_effect' AND projects >= 2) ORDER BY kind, projects DESC LIMIT 400`),
    q<any>(`SELECT text, product, status FROM brain_lessons WHERE status IN ('active', 'proposed', 'rejected')`),
    portfolioOutcomes(),
    portfolioFeedback(),
    getSetting<boolean>("auto_apply_lessons", false),
  ]);
  if (!patterns.length) return { proposed: 0, applied: auto, cost: 0 };

  const anthropic = new Anthropic({ apiKey: key });
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: [
      { type: "text" as const, text: KNOWLEDGE, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: SYSTEM },
    ],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: JSON.stringify({
      patterns,
      experimentsAcrossProjects: outcomes,
      whatOperatorsDidWithRecommendations: feedback,
      lessonsInForce: lessons.filter((l) => l.status === "active").map((l) => l.text),
      alreadyProposed: lessons.filter((l) => l.status === "proposed").map((l) => l.text),
      rejectedByAdmin: lessons.filter((l) => l.status === "rejected").map((l) => l.text),
    }) }],
  } as any);

  const usage = (res as any).usage ?? {};
  const cost = (((usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1) * 5 + (usage.output_tokens ?? 0) * 25) / 1e6;
  const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let drafts: any[] = [];
  try { drafts = JSON.parse(text).lessons ?? []; } catch { return { proposed: 0, applied: auto, cost }; }

  const byId = new Map(patterns.map((p) => [p.id, p]));
  let proposed = 0;
  for (const d of drafts) {
    const cited = (d.pattern_ids ?? []).map((id: number) => byId.get(id)).filter(Boolean);
    if (!cited.length || typeof d.text !== "string" || d.text.length < 20) continue;
    await q(`INSERT INTO brain_lessons (text, product, status, active, source, evidence, challenges_knowledge)
             VALUES ($1, $2, $3, $4, 'distilled', $5, $6)`,
      [d.text.trim(), d.product ?? "all", auto ? "active" : "proposed", auto,
       JSON.stringify({ patterns: cited, drafted_at: new Date().toISOString() }),
       d.challenges_knowledge?.trim() || null]);
    proposed++;
  }
  return { proposed, applied: auto, cost };
}
