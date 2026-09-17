// Formatting at the edge only. Figures arrive already computed; this decides
// how they read, never what they are.

const group = (n: number, digits: number) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Money in the account's currency. Large dinar figures lose their decimals. */
export function money(n: number | null | undefined, currency?: string | null, opts: { digits?: number } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const big = Math.abs(n) >= 1000 || currency === "RSD" || currency === "HUF";
  const digits = opts.digits ?? (big ? 0 : 2);
  return `${group(n, digits)}${currency ? ` ${currency}` : ""}`;
}

export function count(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  // Summed conversions land a hair off whole numbers (19.9999); read them as whole.
  const whole = Math.abs(n - Math.round(n)) < 0.05;
  return group(whole ? Math.round(n) : n, whole ? 0 : digits);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/** A change as an arrow that always shows the real direction. */
export function arrow(change: number | null | undefined): string {
  if (change == null || !Number.isFinite(change)) return "—";
  if (Math.abs(change) < 0.005) return "→ 0%";
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(change * 100).toFixed(0)}%`;
}

/** The colour of a change: lowerIsBetter flips the colour, never the arrow. */
export function tone(change: number | null | undefined, lowerIsBetter = false): "good" | "bad" | "flat" {
  if (change == null || !Number.isFinite(change) || Math.abs(change) < 0.02) return "flat";
  const up = change > 0;
  return up !== lowerIsBetter ? "good" : "bad";
}

export function ago(iso: string | Date | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function dateShort(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export const SEVERITY_LABEL = { do_first: "Do first", worth_doing: "Worth doing", when_time: "When you have time" } as const;
export const SEVERITY_PILL = { do_first: "pill-bad", worth_doing: "pill-warn", when_time: "pill" } as const;

export const PRODUCT_LABEL: Record<string, string> = {
  ads: "Google Ads", analytics: "Analytics", search_console: "Search Console", tag_manager: "Tag Manager", business_profile: "Business Profile", website: "Website", cross: "Across products",
};

export const AREA_LABEL: Record<string, string> = {
  tracking: "Tracking", waste: "Wasted spend", targeting: "Targeting", budget: "Budget",
  bidding: "Bidding", structure: "Structure", creative: "Ads and pages",
  opportunity: "Opportunities", schedule: "Hours and days",
};

export const TYPE_LABEL: Record<string, string> = {
  SEARCH: "Search", PERFORMANCE_MAX: "Performance Max", DISPLAY: "Display", VIDEO: "Video",
  SHOPPING: "Shopping", DEMAND_GEN: "Demand Gen", MULTI_CHANNEL: "App", LOCAL_SERVICES: "Local Services",
};

export const STRATEGY_LABEL: Record<string, string> = {
  MAXIMIZE_CONVERSIONS: "Maximise conversions", MAXIMIZE_CONVERSION_VALUE: "Maximise conversion value",
  TARGET_CPA: "Target CPA", TARGET_ROAS: "Target ROAS", TARGET_SPEND: "Maximise clicks",
  MANUAL_CPC: "Manual CPC", TARGET_IMPRESSION_SHARE: "Target impression share",
};
