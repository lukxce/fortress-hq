// Requested in full at the first consent. Adding a scope later forces
// re-authentication, and the roadmap needs writes (conversion actions in Ads,
// key events in GA4, tags in Tag Manager) even though Phase 1 only reads.
export const SCOPES = [
  "openid",
  "email",

  "https://www.googleapis.com/auth/adwords",

  // GA4 needs BOTH. The Data API (runReport) accepts analytics.readonly or
  // analytics, and does NOT accept analytics.edit, which is Admin-API only.
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/analytics.edit",

  "https://www.googleapis.com/auth/webmasters.readonly",

  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.publish",
] as const;

// Asked for separately, only when someone connects Business Profile. Requesting
// a scope whose API is not enabled on the Cloud project makes Google refuse the
// whole consent — so an unapproved Business Profile API must not break signing in.
export const BUSINESS_SCOPE = "https://www.googleapis.com/auth/business.manage";


const A = "https://www.googleapis.com/auth/";

/** What each product needs, and what it gains with write access. */
export const PRODUCT_SCOPES = [
  {
    key: "ads" as const,
    label: "Google Ads",
    read: [`${A}adwords`],
    write: [],
    why: "Campaigns, spend, keywords, search terms.",
  },
  {
    key: "ga4" as const,
    label: "Analytics",
    read: [`${A}analytics.readonly`],
    write: [`${A}analytics.edit`],
    why: "Sessions and key events, so a broken tag can be told from a real drop in demand.",
  },
  {
    key: "gsc" as const,
    label: "Search Console",
    read: [`${A}webmasters.readonly`],
    write: [],
    why: "Organic queries, and which of them you are also paying for.",
  },
  {
    key: "gtm" as const,
    label: "Tag Manager",
    read: [`${A}tagmanager.readonly`],
    write: [`${A}tagmanager.edit.containers`, `${A}tagmanager.publish`],
    why: "Container contents, and whether anyone changed them overnight.",
  },
  {
    key: "gbp" as const,
    label: "Business Profile",
    read: [BUSINESS_SCOPE],
    write: [],
    why: "Calls, direction requests, website clicks, what people searched to find the business, and reviews.",
  },
];

export type ProductAccess = {
  key: "ads" | "ga4" | "gsc" | "gtm" | "gbp";
  label: string;
  why: string;
  canRead: boolean;
  canWrite: boolean;
  hasWriteScopes: boolean;
};

/** Turn a granted-scope list into per-product access. */
export function productAccess(granted: string[]): ProductAccess[] {
  const has = (s: string) => granted.includes(s);
  return PRODUCT_SCOPES.map((p) => ({
    key: p.key,
    label: p.label,
    why: p.why,
    canRead: p.read.every(has),
    canWrite: p.write.length > 0 && p.write.every(has),
    hasWriteScopes: p.write.length > 0,
  }));
}
