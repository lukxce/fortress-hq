import Anthropic from "@anthropic-ai/sdk";
import { q } from "@/lib/db";
import { accountSnapshot } from "./snapshot";
import { OPERATING_CONTEXT } from "./knowledge/context";
import { SMALL_ACCOUNTS } from "./knowledge/smallaccount";
import { REPORTING } from "./knowledge/mechanics";

// The Ask bubble. One fixed snapshot, one prompt, one answer — deliberately not
// a tool-calling loop, which is what keeps a reply to seconds. Sonnet rather
// than Opus for the same reason: the arithmetic is already done, and speed
// matters more in a conversation than in the weekly analysis.
const CHAT_MODEL = "claude-sonnet-5";

const SYSTEM = `You answer questions about one Google Ads account for the agency operator running it. You can see a snapshot of the account: settings, campaigns, ad groups, keywords, search terms, conversion actions, hour/day/device breakdowns, measured findings, and the current recommendations. You also know whether Analytics, Search Console and Tag Manager are connected.

Rules:
- Answer only from the snapshot. If a figure is not in it, say so plainly rather than estimating.
- Name the window every number comes from ("over the last 90 days", "last 30 days").
- Explain any jargon in the same breath you use it.
- If the question is ambiguous, say which readings are possible and answer the most likely one, noting the other — do not pick one silently and sound confident.
- Never calculate a figure the snapshot does not contain. Comparing two figures that are both present is fine.
- You cannot change anything. When the operator wants something changed, point to the page that can: What to change (recommendations and their buttons), Tracking (conversion actions and Tag Manager), New campaign (the builder).
- Short, direct answers. No preamble.`;

export async function answer(clientId: number, question: string, history: { role: "user" | "assistant"; content: string }[]) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");

  const { _findings, ...snap } = await accountSnapshot(clientId);
  const recs = await q<any>(`SELECT title, severity, area, monthly_impact, status, do_by
                               FROM recommendations WHERE client_id = $1 AND status = 'open'
                              ORDER BY created_at DESC LIMIT 20`, [clientId]);

  const anthropic = new Anthropic({ apiKey: key });
  const res = await anthropic.messages.create({
    model: CHAT_MODEL,
    max_tokens: 1200,
    system: [
      { type: "text" as const, text: [OPERATING_CONTEXT, SMALL_ACCOUNTS, REPORTING].join("\n\n"), cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: `${SYSTEM}\n\nACCOUNT SNAPSHOT\n${JSON.stringify({ ...snap, currentRecommendations: recs })}`, cache_control: { type: "ephemeral" as const } },
    ],
    messages: [
      ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: question },
    ],
  } as any);

  return (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
}
