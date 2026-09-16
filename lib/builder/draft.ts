import { z } from "zod";

/**
 * The shape of a campaign being built, and the check that decides whether it
 * can launch.
 *
 * Two parsers. The strict one guards launch: nothing reaches Google Ads unless
 * every required part is present and within Google's limits. The lenient one
 * reads drafts in progress, where half-filled is the normal state — a draft
 * that fails strict parsing is still a draft, never an error.
 */

export const MATCH = ["EXACT", "PHRASE", "BROAD"] as const;

// Half-typed is the normal state of a draft: empty and over-long values are
// allowed here and reported by problems(), never rejected. A rejected field
// would make the lenient reader drop the whole groups array mid-edit.
const Keyword = z.object({
  text: z.string().max(200),
  match: z.enum(MATCH).default("PHRASE"),
  // Where it came from, shown next to it: Search Console, converting searches,
  // the site, or a suggestion.
  source: z.enum(["search_console", "converting", "site", "suggested", "manual"]).default("manual"),
});

const Group = z.object({
  name: z.string().max(255),
  keywords: z.array(Keyword).default([]),
  finalUrl: z.string().default(""),
  headlines: z.array(z.string()).default([]),
  descriptions: z.array(z.string()).default([]),
  path1: z.string().default(""),
  path2: z.string().default(""),
});

export const DraftState = z.object({
  name: z.string().default("New campaign"),
  business: z.object({
    url: z.string().default(""),
    summary: z.record(z.string(), z.any()).nullable().default(null),
  }).default({ url: "", summary: null }),
  locations: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  presence: z.enum(["PRESENCE", "PRESENCE_OR_INTEREST"]).default("PRESENCE"),
  groups: z.array(Group).default([]),
  negatives: z.array(z.string()).default([]),
  dailyBudget: z.number().positive().nullable().default(null),
  bidding: z.enum(["MAXIMIZE_CONVERSIONS", "MAXIMIZE_CLICKS"]).default("MAXIMIZE_CONVERSIONS"),
  maxCpc: z.number().positive().nullable().default(null),
});

export type Draft = z.infer<typeof DraftState>;
export type DraftGroup = z.infer<typeof Group>;

/** Lenient: whatever is there, with defaults for what is not. Never throws. */
export function readDraft(raw: unknown): Draft {
  const parsed = DraftState.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  // Salvage field by field rather than discarding the operator's work.
  const base = DraftState.parse({});
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof Draft)[]) {
    const one = (DraftState.shape as any)[key].safeParse(r[key]);
    if (one.success) (base as any)[key] = one.data;
  }
  return base;
}

export type Problem = { step: number; message: string };

/** Everything that would stop a launch, in plain words, with the step to fix it on. */
export function problems(d: Draft): Problem[] {
  const out: Problem[] = [];
  if (!d.name.trim()) out.push({ step: 7, message: "The campaign needs a name." });
  if (!d.locations.length) out.push({ step: 3, message: "Choose at least one place to show ads." });
  if (!d.groups.length) out.push({ step: 4, message: "Add at least one group of searches." });
  d.groups.forEach((g, i) => {
    const label = `"${g.name || `Group ${i + 1}`}"`;
    const kws = g.keywords.filter((k) => k.text.trim());
    if (!g.name.trim()) out.push({ step: 4, message: `Group ${i + 1} needs a name.` });
    if (!kws.length) out.push({ step: 4, message: `${label} has no searches to show for.` });
    if (kws.some((k) => k.text.trim().length > 80)) out.push({ step: 4, message: `${label} has a search over 80 characters.` });
    if (g.path1.length > 15 || g.path2.length > 15) out.push({ step: 5, message: `${label} has a display path over 15 characters.` });
    if (!/^https?:\/\/\S+\.\S+/.test(g.finalUrl)) out.push({ step: 5, message: `${label} needs the page people land on.` });
    const heads = g.headlines.map((h) => h.trim()).filter(Boolean);
    const descs = g.descriptions.map((h) => h.trim()).filter(Boolean);
    if (heads.length < 3) out.push({ step: 5, message: `${label} needs at least 3 headlines (it has ${heads.length}).` });
    if (descs.length < 2) out.push({ step: 5, message: `${label} needs at least 2 descriptions (it has ${descs.length}).` });
    if (heads.some((h) => h.length > 30)) out.push({ step: 5, message: `${label} has a headline over 30 characters.` });
    if (descs.some((h) => h.length > 90)) out.push({ step: 5, message: `${label} has a description over 90 characters.` });
    if (heads.length > 15) out.push({ step: 5, message: `${label} has more than 15 headlines.` });
    if (descs.length > 4) out.push({ step: 5, message: `${label} has more than 4 descriptions.` });
    const dup = heads.find((h, j) => heads.findIndex((x) => x.toLowerCase() === h.toLowerCase()) !== j);
    if (dup) out.push({ step: 5, message: `${label} repeats the headline "${dup}".` });
  });
  if (!d.dailyBudget) out.push({ step: 6, message: "Set a daily budget." });
  return out;
}
