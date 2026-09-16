import { q } from "@/lib/db";
import { normalise } from "@/lib/engine/brand";

/**
 * What the brain has learned across every project and every user.
 *
 * Every source is installation-wide rather than per project:
 *
 *   1. Lessons — rules the admin writes. They apply to every analysis.
 *   2. Outcomes — every experiment that reached a verdict, anywhere, grouped by
 *      the kind of finding and the kind of change behind it. A change that keeps
 *      getting refuted on other accounts should be proposed with less
 *      confidence on this one.
 *   3. Feedback — what operators did with recommendations: done, dismissed, or
 *      left. A kind of recommendation operators dismiss almost every time is
 *      either wrong for these accounts or badly explained.
 *
 *   4. Portfolio patterns — measured by code from every project's data: what
 *      each kind of change made in any account was followed by, search words
 *      that waste or convert across accounts, benchmarks, how common each
 *      problem is (lib/learning/patterns.ts). These apply automatically.
 *
 * Small numbers are reported as small numbers: a kind of change with two
 * verdicts is shown with its count, never as a rate, so the brain cannot read
 * "100% confirmed" into one lucky test.
 */

export type Lesson = { id: number; text: string; product: string; active: boolean; created_at: string };

export async function activeLessons(): Promise<Lesson[]> {
  return q<Lesson>(`SELECT id, text, product, active, created_at FROM brain_lessons WHERE status = 'active' ORDER BY product, id`);
}

export async function portfolioOutcomes() {
  return q<{ area: string; action: string; metric: string; confirmed: number; refuted: number; inconclusive: number; projects: number }>(`
    SELECT COALESCE(r.area, 'unknown') AS area,
           COALESCE(r.action->>'kind', 'written steps') AS action,
           e.metric,
           count(*) FILTER (WHERE e.verdict = 'confirmed')::int AS confirmed,
           count(*) FILTER (WHERE e.verdict = 'refuted')::int AS refuted,
           count(*) FILTER (WHERE e.verdict = 'inconclusive')::int AS inconclusive,
           count(DISTINCT e.client_id)::int AS projects
      FROM experiments e
      LEFT JOIN recommendations r ON r.id = e.recommendation_id
     WHERE e.status = 'finished'
     GROUP BY 1, 2, 3
     ORDER BY count(*) DESC
  `);
}

export async function portfolioFeedback() {
  // "Still there" asks whether the problem a dismissed or ignored recommendation
  // was about is still measured today — ignoring it did not make it go away.
  return q<{ product: string; area: string; done: number; dismissed: number; ignored: number; not_done_problem_still_there: number; projects: number }>(`
    SELECT r.product, r.area,
           count(*) FILTER (WHERE r.status = 'done')::int AS done,
           count(*) FILTER (WHERE r.status = 'dismissed')::int AS dismissed,
           count(*) FILTER (WHERE r.status = 'superseded')::int AS ignored,
           count(*) FILTER (WHERE r.status IN ('dismissed', 'superseded') AND EXISTS (
             SELECT 1 FROM findings f WHERE f.client_id = r.client_id AND f.kind = ANY(r.finding_kinds)
                AND f.status = 'open' AND f.last_seen > now() - interval '14 days'))::int AS not_done_problem_still_there,
           count(DISTINCT r.client_id)::int AS projects
      FROM recommendations r
     WHERE r.created_at > now() - interval '180 days' AND r.status <> 'open'
     GROUP BY 1, 2
     ORDER BY count(*) DESC
  `);
}

/**
 * The portfolio patterns that bear on one project: its own industry and all
 * projects, change effects for its volume band, and only those search themes
 * that actually occur in its own searches (the rest are noise to it).
 */
export async function portfolioForProject(clientId: number) {
  const [[me], [pool]] = await Promise.all([
    q<any>(`SELECT COALESCE(industry, 'unknown') AS industry,
                   (SELECT COALESCE(SUM(conversions),0)::float FROM metrics_daily WHERE client_id = $1 AND entity_type = 'campaign' AND date > CURRENT_DATE - 29) AS conv28
              FROM clients WHERE id = $1`, [clientId]),
    q<any>(`SELECT count(*)::int AS projects, (SELECT count(*)::int FROM change_outcomes WHERE status = 'judged') AS judged,
                   (SELECT max(computed_at) FROM portfolio_patterns) AS computed_at
              FROM clients WHERE NOT archived`),
  ]);
  const scopes = me?.industry && me.industry !== "unknown" ? ["all", me.industry] : ["all"];
  const monthly = Number(me?.conv28 ?? 0) * (30.4 / 28);
  const band = monthly < 10 ? "under 10 conversions a month" : monthly < 30 ? "10 to 30 a month" : "over 30 a month";

  const patterns = await q<any>(`SELECT kind, industry, key, stats, projects, significant FROM portfolio_patterns WHERE industry = ANY($1)`, [scopes]);
  if (!patterns.length) return null;

  const words = new Set<string>();
  for (const t of await q<{ term: string }>(`SELECT DISTINCT term FROM search_terms WHERE client_id = $1`, [clientId])) {
    const ws = normalise(t.term).split(/\s+/);
    ws.forEach((w, i) => { words.add(w); if (i) words.add(`${ws[i - 1]} ${w}`); });
  }
  const pick = ({ kind, industry, key, stats, projects, significant }: any) => ({ scope: industry, key, projects, significant, ...stats });

  return {
    note: "Measured across every project Fortress runs, by code. Observational: a change followed by an improvement is not proof it caused it. Weigh by the number of projects, and prefer this project's own data where it has enough.",
    thisProject: { industry: me?.industry, volumeBand: band },
    pool,
    changeEffects: patterns.filter((p) => p.kind === "change_effect" && (p.key.endsWith("|any volume") || p.key.endsWith(`|${band}`))).map(pick),
    searchWordsThatWasteAcrossAccounts: patterns.filter((p) => p.kind === "waste_theme" && words.has(p.key)).map(pick).slice(0, 40),
    searchWordsThatConvertAcrossAccounts: patterns.filter((p) => p.kind === "converting_theme").map(pick).slice(0, 40),
    benchmarks: patterns.filter((p) => p.kind === "benchmark").map(pick),
    commonProblems: patterns.filter((p) => p.kind === "finding_prevalence" && p.projects >= 2).map(pick),
  };
}

/** The block every analysis reads, whoever runs it and whichever project it is for. */
export async function learningForModel(clientId?: number) {
  const [lessons, outcomes, feedback, portfolio] = await Promise.all([
    activeLessons(), portfolioOutcomes(), portfolioFeedback(), clientId ? portfolioForProject(clientId) : Promise.resolve(null),
  ]);
  return {
    lessons: lessons.map((l) => ({ product: l.product, rule: l.text })),
    outcomesAcrossAllProjects: outcomes.length
      ? outcomes
      : "No experiment has reached a verdict on any project yet, so there is no portfolio track record.",
    operatorFeedbackLast180Days: feedback.length
      ? feedback
      : "No recommendation has been acted on or dismissed yet.",
    portfolio: portfolio ?? "No portfolio patterns have been computed yet.",
  };
}

/** Lessons as system text, so they sit beside the knowledge layer with the same authority. */
export function lessonsAsText(lessons: Lesson[]): string {
  if (!lessons.length) return "";
  const by = new Map<string, string[]>();
  for (const l of lessons) by.set(l.product, [...(by.get(l.product) ?? []), l.text]);
  const label: Record<string, string> = { all: "All products", ads: "Google Ads", analytics: "Analytics", search_console: "Search Console", tag_manager: "Tag Manager" };
  return [
    "## Lessons from the admin",
    "",
    "Rules taught by the admin, or drafted by this system from patterns measured across every account and approved. They override general knowledge where they conflict, but never the rule that you do not produce figures.",
    "",
    ...[...by.entries()].flatMap(([p, xs]) => [`### ${label[p] ?? p}`, ...xs.map((x) => `- ${x}`), ""]),
  ].join("\n");
}
