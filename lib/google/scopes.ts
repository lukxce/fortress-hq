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
