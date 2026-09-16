import { classifyIndustries } from "./industry";
import { judgeOutcomes } from "./outcomes";
import { computePatterns } from "./patterns";
import { distillLessons } from "./distill";
import { setSetting } from "./settings";

/** One learning pass across every project. Safe to run any time; each step is idempotent. */
export async function learn(opts: { distill?: boolean } = {}) {
  const t0 = Date.now();
  const industries = await classifyIndustries().catch((e) => ({ error: (e as Error).message }));
  const outcomes = await judgeOutcomes();
  const patterns = await computePatterns();
  const lessons = opts.distill === false ? null : await distillLessons().catch((e) => ({ error: (e as Error).message }));
  const report = { at: new Date().toISOString(), ms: Date.now() - t0, industries, outcomes, patterns, lessons };
  await setSetting("last_learning_run", report);
  return report;
}
