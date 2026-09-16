import { q } from "@/lib/db";

/**
 * What the brain has learned across every project and every user.
 *
 * Three sources, all installation-wide rather than per project:
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
 * Small numbers are reported as small numbers: a kind of change with two
 * verdicts is shown with its count, never as a rate, so the brain cannot read
 * "100% confirmed" into one lucky test.
 */

export type Lesson = { id: number; text: string; product: string; active: boolean; created_at: string };

export async function activeLessons(): Promise<Lesson[]> {
  return q<Lesson>(`SELECT id, text, product, active, created_at FROM brain_lessons WHERE active ORDER BY product, id`);
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
  return q<{ product: string; area: string; done: number; dismissed: number; ignored: number; projects: number }>(`
    SELECT product, area,
           count(*) FILTER (WHERE status = 'done')::int AS done,
           count(*) FILTER (WHERE status = 'dismissed')::int AS dismissed,
           count(*) FILTER (WHERE status = 'superseded')::int AS ignored,
           count(DISTINCT client_id)::int AS projects
      FROM recommendations
     WHERE created_at > now() - interval '180 days' AND status <> 'open'
     GROUP BY 1, 2
     ORDER BY count(*) DESC
  `);
}

/** The block every analysis reads, whoever runs it and whichever project it is for. */
export async function learningForModel() {
  const [lessons, outcomes, feedback] = await Promise.all([activeLessons(), portfolioOutcomes(), portfolioFeedback()]);
  return {
    lessons: lessons.map((l) => ({ product: l.product, rule: l.text })),
    outcomesAcrossAllProjects: outcomes.length
      ? outcomes
      : "No experiment has reached a verdict on any project yet, so there is no portfolio track record.",
    operatorFeedbackLast180Days: feedback.length
      ? feedback
      : "No recommendation has been acted on or dismissed yet.",
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
    "Rules taught by the person who runs this installation, from experience across every account. They override general knowledge where they conflict, but never the rule that you do not produce figures.",
    "",
    ...[...by.entries()].flatMap(([p, xs]) => [`### ${label[p] ?? p}`, ...xs.map((x) => `- ${x}`), ""]),
  ].join("\n");
}
