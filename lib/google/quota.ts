import { q } from "@/lib/db";

// Google exposes no "quota remaining" endpoint, so we count our own.
// Ads: 15,000 operations/day on Basic. A GAQL search is 1 operation regardless
// of how many rows come back; each mutated entity is 1. Failed calls count.
// Tag Manager is the tight one: 10,000/day AND 25 per 100 seconds per project.
export const LIMITS: Record<string, number> = {
  ads: 15_000,
  ga4: 200_000,
  gsc: 1_000_000,
  gtm: 10_000,
};

export async function countOps(provider: string, n = 1, isError = false): Promise<void> {
  try {
    await q(
      `INSERT INTO quota_usage (day, provider, ops, errors)
       VALUES (CURRENT_DATE, $1, $2, $3)
       ON CONFLICT (day, provider)
       DO UPDATE SET ops = quota_usage.ops + $2, errors = quota_usage.errors + $3`,
      [provider, n, isError ? 1 : 0]
    );
  } catch {
    // Accounting must never take down a real request.
  }
}

export async function todayUsage(): Promise<{ provider: string; ops: number; errors: number }[]> {
  return q("SELECT provider, ops, errors FROM quota_usage WHERE day = CURRENT_DATE ORDER BY provider");
}

/** Tag Manager allows 25 requests per 100 seconds. Space them out. */
export function gtmPace(): Promise<void> {
  return new Promise((r) => setTimeout(r, 1500));
}
