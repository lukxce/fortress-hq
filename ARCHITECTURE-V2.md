# Ads Copilot: review, fixes, and the multi-client v2

Written 15 Sep 2026 against `ADS-COPILOT-ARCHITECTURE.md`. The Google API facts
below were checked against Google's own pages today; sources are linked inline.
Where something could not be verified it is marked as such.

---

## 1. Verdict on the current design

**The skeleton is right.** Five decisions are correct and should survive into
any rewrite:

1. Read once into a local Postgres mirror, serve every page from it. Reads are
   1 op per GAQL query regardless of rows; this is still true
   ([quotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas)).
2. Deterministic code computes every number; the model only interprets.
3. Machine-executable actions are a closed Zod union; everything else is prose.
4. Every write appends to a log before the next write; launches are resumable.
5. Campaigns are born PAUSED and flipped only after all children exist.

**Where it is weak:**

| Area | Problem | Severity |
|---|---|---|
| Scoring | Absolute euro thresholds (`spend/10`, `spend > 5`), no volume gates, unweighted QS, CPA-only, search-only | High: this is what the AI reasons over |
| Hypothesis verdicts | ±10% CPA over 14 days with no minimum conversions and no confounder check is mostly noise | High: it feeds back into prompts, so noise compounds |
| Sync coverage | No `primary_status`, no `change_event`, no `recommendation`, no PMax asset groups, no policy/disapproval, no device/geo segments | Medium |
| Launch defaults | Missing presence-only geo, network settings, bid strategy, conversion precondition, `validate_only` dry run | Medium: these are the classic local-business waste sources |
| Job model | No lock; two syncs racing double-spend quota. PGlite single-process forces jobs through Next | Medium |
| Google-side facts | Six things in the doc are now stale (see §3) | Must fix before extending |
| Scope | Ads-only. Agency work is Ads + GA4 + GSC + GTM, and the daily job is pacing and alerts, not scoring | The reason for v2 |

---

## 2. Fixes to the existing logic

### 2.1 Scoring engine

Keep the four-component shape, change the maths.

- **Account-relative waste, not euros.** Define `expectedConv = spend / medianCpa`.
  A zero-conversion campaign's efficiency penalty scales with `expectedConv`, so
  a €200 dud in a €50k account is not treated like a €200 dud in a €500 account.
- **Volume gates.** Below a minimum (suggest 100 clicks or 5 conversions in the
  window), a component is `null`, not 10. The UI shows "insufficient data" and
  the context pack says so explicitly. A `null` health because QS is missing
  currently reads as "average", which is wrong for PMax.
- **Shrinkage.** For CTR and CVR deltas, blend toward the account mean with a
  pseudo-count (e.g. `k = 50` clicks). This kills the ±100% swings on tiny
  campaigns that drive momentum today.
- **Impression-weight quality score** instead of a flat mean over keywords.
- **Goal-aware efficiency.** Read `campaign.bidding_strategy_type` and the
  target inside it (`maximize_conversions.target_cpa_micros`,
  `maximize_conversion_value.target_roas`). Score against the campaign's own
  target first, the account median second. Thermiq-type accounts need ROAS,
  lead-gen needs CPA. Note Google is re-splitting standalone `TARGET_CPA` /
  `TARGET_ROAS` from the Maximize strategies
  ([June 2026](https://ads-developers.googleblog.com/2026/06/updates-to-smart-bidding-strategy.html));
  store both the type and the optional target so the mapping survives.
- **Remove the double penalty.** `waste` and `efficiency` both zero out on
  "spend, no conversions". Make `waste` about search-term waste share
  (zero-conversion search-term spend / total spend), which is a distinct signal.
- **Use Google's own status first.** `campaign.primary_status` and
  `primary_status_reasons` (LIMITED_BY_BUDGET, LEARNING, MISCONFIGURED,
  ad disapprovals) are the cheapest, most reliable health signals available and
  the current sync ignores them.

### 2.2 Hypothesis evaluation

- **Minimum volume** in both windows, otherwise `inconclusive_low_volume`,
  which the prompt must treat as "no evidence", not as a weak signal.
- **Confounders from `change_event`.** Pull the last 30 days of account
  changes daily (the resource only serves 30 days and needs `LIMIT`). If any
  other change touched the same campaign inside the window, mark the hypothesis
  `contaminated`.
- **Difference-in-differences.** Compare the campaign's CPA change against the
  rest of the account's CPA change over the same window. This absorbs
  seasonality and account-wide shocks.
- **Verdict per action kind**, not one CPA rule:
  - `change_budget` up: conversions up and CPA within +15%.
  - `add_negative_keywords`: zero-conversion search-term spend share down.
  - `pause_campaign`: spend stopped and account conversions not down more than
    the paused campaign contributed.
- Re-evaluate at 28 days as well as 14.

### 2.3 Sync additions (still ~20 ops per account per day)

| Resource | Why |
|---|---|
| `campaign.primary_status`, `campaign_budget.recommended_budget_amount_micros` | health, "limited by budget" |
| `change_event` (daily, 30d) | contamination, client accountability, "who changed what" |
| `recommendation` | Google's own suggestions, with apply/dismiss tracking |
| `ad_group_ad.policy_summary` | disapprovals |
| `asset_group`, `asset_group_asset`, `campaign_search_term_insight` | PMax visibility |
| `search_term_view` segmented by `segments.search_term_match_source` | AI Max: which terms came from keywords vs AI Max broad vs keywordless. Do not sum with `ai_max_search_term_ad_combination_view` ([Google warns](https://developers.google.com/google-ads/api/docs/campaigns/ai-max-for-search-campaigns/ai-max-reporting)) |
| `campaign` metrics by `segments.device`, `geographic_view`, `ad_schedule_view` | device/geo/hour waste |
| `customer` metrics by `segments.conversion_action` | per-action volume without the in-memory join |
| `customer.optimization_score`, `customer.status` | account-level |

### 2.4 Launch state machine

Add to the campaign step:

- `geo_target_type_setting.positive_geo_target_type = PRESENCE` (default is
  presence-or-interest; for a Niš AC installer this is the single biggest
  waste source).
- `network_settings`: search partners off, content network off.
- Explicit `ai_max_setting.enable_ai_max` decision. Campaign-level broad match
  and legacy ACA are blocked at creation since 3 Aug 2026 and removed from
  v26+ ([migration post](https://ads-developers.googleblog.com/2026/08/migrate-campaign-level-broad-match-and.html)).
- Do **not** add a `CampaignCriterion.language` on Search campaigns; this
  returns `OPERATION_NOT_PERMITTED_FOR_CONTEXT` from late Sept 2026
  ([announcement](https://ads-developers.googleblog.com/2026/08/google-ads-language-targeting-changes.html)).
- Use `start_date_time` / `end_date_time`; the date-only fields were removed in v23.
- Default bid strategy: `MAXIMIZE_CLICKS` with a CPC ceiling, switch to tCPA
  after ~30 conversions. Make this a stored rule, not a prompt instruction.
- Negatives as a `shared_set` attached to the campaign, not per-campaign criteria.
- `final_url_suffix` with UTMs so GA4 landing-page data joins back.
- Sitelink / callout `campaign_asset`s.
- **Precondition before flipping to ENABLED:** the account has at least one
  enabled primary conversion action with volume in the last 30 days. Otherwise
  stop at PAUSED and raise a task.
- **Dry run:** run the whole plan once with `validate_only: true` before the
  real mutates. Google validates without writing; this catches most rejections
  at zero risk and 0 quota-relevant side effects.

### 2.5 Jobs, DB, brain

- Move to real Postgres (Docker locally, Neon hosted). PGlite's single-process
  constraint is what forced jobs through Next; a real DB lets a separate worker
  own scheduling. Use `pg-boss` for the queue (Postgres-backed, no Redis).
- Migrations: numbered SQL files plus a `schema_migrations` table. Ten lines.
- A `job_runs` table with a unique `(job, client_id, date)` key so a re-run is
  a no-op, plus `pg_advisory_lock` per client during sync.
- Quota accounting per Google Cloud project (that is now the unit, see §3),
  with a token bucket for GTM (see §4).
- Brain: replace `execFile("claude")` with the Agent SDK; same Zod contract,
  but you get timeouts, cost caps and structured errors. Keep `caffeinate`
  for overnight runs on the Mac.
- `confirm: "APPLY"` is a fixed string. Fine on localhost; when hosted, make
  it a one-time nonce issued with the preview.

---

## 3. What changed on Google's side (mid-2025 → Sep 2026)

### 3.1 Google Ads API

- **Developer tokens are sunset (9 Sep 2026).** Access level is now a property
  of the Google Cloud project whose OAuth client or service account you use.
  The header is accepted and ignored; a future major will reject it. Existing
  levels were "transferred based on recent API activity", so **check the
  Cloud Console "Google Ads API Overview" page** and reapply if the level is
  wrong. ([blog](https://ads-developers.googleblog.com/2026/09/new-onboarding-experience-for-google-ads-api.html),
  [policy](https://developers.google.com/google-ads/api/docs/api-policy/developer-token))
- **Access tiers** ([official](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)):
  Test 15,000/day on test accounts; **Explorer 2,880/day on production** (the
  doc's figure is correct); **Basic 15,000/day, now auto-approved in minutes**
  after brand verification; Standard unlimited, manual review with design
  questionnaire. Explorer blocks account creation, user access management,
  keyword planner, billing/invoices. **Apply for Basic.**
- **Brand verification is mandatory** for new Basic/Standard: the OAuth
  consent screen must be External, In production, with verified branding
  ([page](https://developers.google.com/google-ads/api/docs/api-policy/brand-verification)).
- **Passkeys** required to mint new refresh tokens via the user flow since
  5 Aug 2026. Service accounts are exempt
  ([security requirements](https://developers.google.com/google-ads/api/docs/oauth/security-requirements)).
- **Service accounts work without Workspace** since Jan 2025: add the SA email
  as a user on the MCC ([doc](https://developers.google.com/google-ads/api/docs/oauth/service-accounts)).
  Max 20 accounts per email, so add it to the manager, not each client.
- **Versions**: monthly releases, 4 majors/year, ~12-month life. Current major
  v25 (v25.1 latest). v22 dies Oct 2026, v23 Feb 2027, v24 May 2027, v25 Aug
  2027. v26 due Oct 2026 and will drop campaign-level broad match / ACA
  entities ([sunset table](https://developers.google.com/google-ads/api/docs/sunset-dates)).
- **Breaking changes that touch this codebase**: `Campaign.start_date`/`end_date`
  removed (v23); `CallAd` removed (v23); ad sharing across ad groups forbidden
  (v23); `click_type` off asset views (v24); lifecycle-goal resources removed
  (v25); Search language targeting removed (Sept 2026); DSA creation removed
  Jan 2027.
- **Offline conversions / Customer Match** are closed to new adopters in the
  Ads API since 15 Jun 2026; the path is the
  [Data Manager API](https://developers.google.com/data-manager/api). Relevant
  if HubSpot reconciliation ever becomes an upload.
- **Data retention**: granular stats only 37 months back (from 1 Jun 2026).
  365-day windows are unaffected.
- **Aug 2026 policy**: proxies/wrappers/MCP servers re-exposing the API to
  third parties are banned; an agency automating its own managed accounts is
  explicitly exempt. Keep the tool single-tenant.
- **Node**: no official Google library. Opteo `google-ads-api` stable is
  **24.1.0** (targets API v24.1), `25.1.0-beta.1` published 11 Sep 2026.
  Whether the beta makes `developer_token` optional is unverified. Expect a
  1–2 month lag behind each major.
- **Official read-only MCP server** exists
  ([googleads/google-ads-mcp](https://github.com/googleads/google-ads-mcp)),
  Python. Useful for ad-hoc exploration in a Claude session, not for the product.

### 3.2 Google Analytics 4

- Data API still **v1beta + v1alpha**, no v1 GA. Nothing shipped in all of
  2025; 2026 added Ads-attributed conversion reports (alpha, Apr) and
  `properties.chat` natural-language querying + `dataTruncationReasons` (Sep)
  ([changelog](https://developers.google.com/analytics/devguides/reporting/data/v1/changelog)).
- Quotas unchanged: 200k tokens/property/day, 40k/hour, 10 concurrent
  ([quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas)).
  A daily 3-report pull per client is a few hundred tokens. Non-issue.
- **Ads cost/clicks/impressions with a `date` dimension are now truncated to
  36 months** (Jun 2026).
- Admin API v1beta covers property/stream/key-event/custom-dimension/Ads-link
  creation. Access bindings, BigQuery links, subproperties are **alpha-only**.
- Creating the Google Ads conversion from a GA4 key event is **UI-only**; the
  Ads side surfaces it as `ConversionAction` types `GOOGLE_ANALYTICS_4_*`.
- Consent change 15 Jun 2026: `ad_storage` is now the sole control for Ads
  cookies/IDs; Google Signals demoted.
- Node: `@google-analytics/data` 7.1.0, `@google-analytics/admin` 10.1.0
  (two majors in a month, Node ≥ 22; pin).
- Official **read-only GA4 MCP server** exists
  ([googleanalytics/google-analytics-mcp](https://github.com/googleanalytics/google-analytics-mcp)),
  still "experimental".

### 3.3 Google Tag Manager

- API v2 unchanged in surface. **Quota is the binding constraint: 10,000
  requests/day and 25 requests per 100 s, per Cloud project**, 403 on breach
  ([limits](https://developers.google.com/tag-platform/tag-manager/api/v2/limits-quotas)).
  Batch endpoint historically unreliable. One container provisioning run is
  20–40 calls, so a global serial queue with ~1.5 s spacing.
- Product changes: Google tag and GTM **unified (20 Aug 2026)**; `G-`/`AW-`
  containers accept only Google-provided tag types (Jul 2026); Google tag
  gateway GA across CDNs; new Client ID / Session ID built-ins (Dec 2025).
- Tag type strings (`googtag`, `gaawe`, `awct`, `gclidw`) are not in the
  official reference; build golden JSON from a container export and replay.
- Publish flow: `workspaces.create_version` → `versions.publish`; check
  `compilerError` (returned with HTTP 200), `syncStatus.mergeConflict`. Free
  GTM has a 3-workspace cap; never leave orphan workspaces.
- Consent Mode v2: every `Tag` carries `consentSettings`; audit it.
- Node: `googleapis` 181 / `@googleapis/tagmanager` 20. No maintained wrapper.

### 3.4 Search Console

- v1 endpoints: `searchanalytics.query`, `sitemaps`, `sites`,
  `urlInspection.index.inspect`. Added Apr 2025: `hour` dimension with
  `dataState=hourly_all`, ~10 days of history (must be captured daily).
- **The Generative AI performance report (Jun 2026) is UI-only**, not in the
  API or BigQuery export. AI Mode traffic is folded into totals since Jun 2025.
- Quotas ([limits](https://developers.google.com/webmaster-tools/limits)):
  1,200 QPM per site; URL Inspection **2,000/day per property**. Unchanged.
- Still: 50k rows/day/type, 16 months, 2–3 day lag, anonymised queries.
  Google's own advice is one query per day per property into your own store.
- Node: `googleapis` `searchconsole('v1')`; still regenerated weekly.
- No official MCP server.

### 3.5 OAuth / Cloud Console

- **"Testing" publishing status expires refresh tokens after 7 days.** If the
  current Ads Copilot OAuth client is in Testing, that is why re-auth keeps
  being needed. Move to In production.
- `adwords` is officially a sensitive scope (since 2020). GA/GTM write scopes
  appear to be treated as sensitive in verification (indirect evidence).
  Read-only scopes and service-account-only apps are exempt from verification.
- Client secrets are shown once at creation for all clients since Nov 2025;
  unused OAuth clients are auto-deleted after 6 months.
- Loopback redirects on a Desktop client remain supported.

---

## 4. The multi-client app

### 4.1 Shape

One repo, TypeScript, Node ≥ 22. Two processes, one database.

```
apps/web        Next.js 16: dashboard, per-client views, approvals, reports
apps/worker     Node process: pg-boss queue, schedules, connector syncs, rules
packages/db     Postgres schema, migrations, typed query helpers
packages/google Connectors: ads / ga4 / gsc / gtm, each behind one interface
packages/engine Deterministic: pacing, alerts, scoring, conv audit, verdicts
packages/brain  Agent SDK + Zod contracts + prompts + context pack builders
```

**Database: Vercel Postgres, from day one** (decided 15 Sep 2026). No local
Postgres, no Docker, no Homebrew on the machine and no reason to add them. The
same `DATABASE_URL` serves local development and deployment, so there is no
dialect drift and no "works locally, breaks in prod" class of bug.

Web on Vercel. The worker is a plain Node process on purpose: Vercel functions
time out, and Tag Manager needs a long-lived serial queue that respects 25
requests per 100 seconds. Run it locally under `caffeinate` at first, move it to
a small always-on box when the schedule needs to survive a closed laptop.

Port from Ads Copilot as-is: `crypto.ts` (**needed** — user OAuth is the active
path, so there is a refresh token to encrypt at rest; see §4.2), the launch state machine's *ordering and resumability*, `convaudit.ts`,
`draft.ts`, `brain/` JSON extraction. Rewrite: scoring, evaluate, sync, db, and
the Ads transport. `googleads.ts` mostly does not survive: the enum decoder is
unnecessary over REST (§4.8) and account discovery is a dozen lines against
`customer_client`.

### 4.2 Identity and auth

One Google Cloud project, External + In production + brand verified (required
for Basic Ads access anyway). Then two identities:

**Option A: one service account**
(`fortress-hq@e-outrider-508711-c6.iam.gserviceaccount.com`) as the data-plane
identity for all four products. Onboarding a client is four access grants and no
consent screens:

| Product | Grant | Level |
|---|---|---|
| Google Ads | Add SA as user on the **agency MCC** (once) | Standard |
| GA4 | Add SA on the client property | Viewer (Editor if you provision) |
| Search Console | Add SA on the property | Full (Owner for bulk export) |
| Tag Manager | Add SA on the account/container | Read, or Publish for provisioning |

No refresh tokens to encrypt or rotate, no 7-day expiry, no passkey ceremony,
exempt from OAuth verification. The MCC cap of 20 accounts per email does not
apply because access flows through the manager.

**The agency manager account is the access hub for Ads, and only for Ads.**
Every client Ads account hangs off one MCC, so a single grant inherits down to
all of them, and traversal is a `customer_client` query against the MCC with
`login-customer-id` set to it — `listAccessibleCustomers` returns only direct
grants, never the tree. GA4, Search Console and Tag Manager have no equivalent
hub; those are per-property no matter what. That asymmetry is the whole reason
user OAuth wins today: it collapses three per-property chores into one consent.

This path also rules out the Opteo Node library, which has no service-account
support at all. See §4.8 — that decision survives the switch to user OAuth, for
reasons that turn out not to depend on it.

**Both paths are first-class, not primary-and-fallback** (decided 15 Sep 2026).
The credential is resolved at startup and everything downstream is identical:

```
token.json present?  → OAuth2Client with a stored refresh token   (user OAuth)
else key file?       → GoogleAuth with a service-account key       (service account)
```

`preflight/` already implements exactly this and is the reference. `token.json`
takes precedence, so switching is deleting one file.

**Running on user OAuth now.** Single operator, accounts already under
management, so per-property grants across GA4, Search Console and Tag Manager
are pure overhead. One consent screen reaches everything. The service account
(`fortress-hq@e-outrider-508711-c6.iam.gserviceaccount.com`) exists and stays
idle until the tool runs unattended on a server, where a re-auth prompt with
nobody watching is the failure mode to avoid.

**Decide the scope set before the first consent.** Adding a scope later forces
re-authentication, and the roadmap already calls for writes: creating conversion
actions in Ads, key events in GA4, and tags in Tag Manager. Request the full set
now even though Phase 1 only reads:

```
auth/adwords                      read + write (conversion actions, negatives, budgets)
auth/analytics.readonly           GA4 Data API — runReport
auth/analytics.edit               GA4 Admin API — key events, custom dimensions, Ads links
auth/webmasters.readonly          Search Console (read-only is all we need)
auth/tagmanager.readonly          list accounts and containers
auth/tagmanager.edit.containers   create tags
auth/tagmanager.publish           publish a container version
```

**Both Analytics scopes are required, and this is easy to get wrong.** The Data
API (`runReport`) accepts `analytics.readonly` or `analytics` — it does **not**
accept `analytics.edit`, which only covers the Admin API. Requesting `edit`
alone gives you a token that can create key events but cannot read a single
report.

`analytics.edit` and the Tag Manager write scopes are treated as sensitive, so
the consent screen will show an unverified-app warning until scope verification
is done. For a single operator that is a click-through, not a blocker — the
100-user cap on unverified apps is irrelevant when there is one user. Do not
pursue scope verification unless someone else ever needs to sign in.

Getting the token: Desktop-app OAuth client, loopback redirect,
`access_type=offline` and `prompt=consent` (without both, Google returns no
refresh token). Expect a **passkey prompt** — since 5 Aug 2026 minting a new
refresh token through the user flow requires passkey auth, not a password or
SMS. Service accounts are exempt.

Because user OAuth is the active path, the refresh token has to be stored
encrypted, so `crypto.ts` from the old codebase does earn its place. Handle
`invalid_grant` as a first-class state: the token is dead (revoked, password
changed, unused six months) and the app should say "re-authenticate" rather
than reporting a sync failure.

**Single-operator now, multi-user kept open (revised 15 Sep 2026).** One person
uses this today, and it only touches accounts already under management, so there
is no scope verification to chase and the gate is a shared password.

But ownership is not left out, because it is the expensive thing to retrofit.
Migration 002 adds `users`, `connections.user_id`, `clients.owner_id` and
`client_access`, all **nullable** — null means "belongs to the installation",
which is correct for one operator. Adding those columns to populated tables
later would mean backfilling, adjudicating orphans, and touching every query at
once; adding them while the tables are empty costs nothing.

The gate itself is contained in `lib/session.ts` and the login route. Swapping
the shared password for a real identity provider (Auth.js, Clerk, Neon Auth) is
a rewrite of those two files plus a backfill, not an application-wide change.
Note that the identity provider is *not* a decision to make at database-creation
time — Neon Auth can be switched on later against the same database, so there is
nothing to pre-commit to.

On the access tier: Explorer would have been enough (2,880 ops/day is ~140
accounts), but Basic was pursued and **approved on 15 Sep 2026**, giving
15,000/day plus Keyword Planner and invoice data. See `PHASE-0.md`.

An `access_probes` job runs daily per client and records which of the four
products is readable/writable, so the onboarding checklist is live, not a doc.

### 4.2b Connect, discover, select, bind

*Added 15 Sep 2026. This replaces hand-filled client config.*

The onboarding flow is: **sign in once, see everything you can reach, tick what
you want, bind the four products together into a client.** Nothing syncs until
it is selected.

```
OAuth consent ──► discovery (4 cheap read calls) ──► inventory table
                                                          │
                                        you tick what matters
                                                          ▼
                                                   selected = true
                                                          │
                                     auto-suggest bindings by domain
                                                          ▼
                                            clients (Ads + GA4 + GSC + GTM)
                                                          │
                                                          ▼
                                                    daily sync, dashboards
```

**Discovery is one call per product and costs almost nothing:**

| Product | Call | Returns |
|---|---|---|
| Google Ads | `listAccessibleCustomers`, then `customer_client` per accessible root | the whole tree: id, name, currency, timezone, manager flag, status |
| GA4 | `accountSummaries.list` | every account and property with display names, one page |
| Search Console | `sites.list` | every property with its permission level |
| Tag Manager | `accounts.list` then `containers.list` | every container with public id and usage context |

Ads is the only one needing two steps, because `listAccessibleCustomers` returns
direct grants only. Traverse `customer_client` from each accessible root with
`login-customer-id` set to it, then drop rows where `manager = true` — those are
folders, not spendable accounts. Failures on individual customers get swallowed:
cancelled and suspended accounts should skip, never abort the sweep.

**Selection is explicit and it is a quota decision, not just UI.** An account
sitting in the inventory unselected costs nothing. Selecting it opts it into
~20 operations a day forever. That is why discovery and sync are separate
tables rather than "sync everything visible".

**Binding is suggested, never assumed.** A client is one Ads account plus
optionally a GA4 property, a Search Console site and a GTM container. Matching
is by domain, which each product exposes differently:

- Search Console gives the domain directly in `siteUrl`.
- GA4 gives it from the web data stream's `defaultUri`.
- Google Ads has no domain field. Derive it from the most common registrable
  domain across campaign final URLs, which needs one extra query per account and
  is worth it.
- Tag Manager gives nothing useful. Match on container name, or let the user
  pick.

Score the candidates, present the best guess pre-ticked, and let it be
overridden. Never auto-bind silently: a wrong binding makes the conversion
cross-check compare two unrelated businesses, which is worse than no binding at
all. Leaving a slot empty must stay valid — plenty of accounts have Ads and no
Tag Manager access.

**Re-running discovery is safe and expected.** Upsert on the provider id, mark
newly-appeared rows so they surface in the UI, and mark disappeared rows
`revoked` rather than deleting them, so historical metrics keep their parent.

`preflight/` already performs all four discovery calls. It is the prototype for
this flow, and `npm run check -- --inventory` writes the full result to
`inventory.json`.

### 4.3 Data model

Agency layer (new):

- `connections`: one row per authenticated identity. `kind` (`user_oauth` |
  `service_account`), encrypted credential, granted scopes, last successful
  refresh. Supports more than one so a second login can cover accounts the
  first cannot reach.
- `inventory`: everything discovery found, across all four products. `provider`
  (`ads` | `ga4` | `gsc` | `gtm`), `provider_id`, `display_name`, `domain`
  (derived where possible), `parent_id` (the MCC, or the GA4 account),
  `is_manager`, `status` (`available` | `selected` | `revoked`), `first_seen`,
  `last_seen`. This is the pick list.
- `clients`: a binding plus the judgement calls. Business name, goal type
  (`lead` | `ecommerce`), monthly media budget, target CPA or ROAS, currency,
  timezone, report recipients.
- `client_properties`: which inventory row fills each of the four slots for a
  client, plus how the binding was made (`auto` | `confirmed` | `manual`) so a
  guessed binding can be told from one you actually checked.
- `alerts`, `tasks`, `notes`, `reports`, `job_runs`, `quota_usage` (per
  Cloud project per API per day).

Per connector, keep the mirror pattern:

- **Ads**: existing tables plus §2.3 additions. `metrics_daily` gains
  `segment_device`, `segment_conversion_action` variants (or separate fact
  tables per segment; do not widen one table).
- **GA4**: `ga4_metrics_daily` (sessions, engaged sessions, key events by name,
  by `sessionDefaultChannelGroup` and `sessionGoogleAdsCampaignName`),
  `ga4_landing_pages_daily` (paid sessions, engagement rate, key events per
  landing page), `ga4_key_events` (from Admin API).
- **GSC**: `gsc_daily` keyed `(site, date, type, query, page, device,
  country)`, append-only, one query per property per day per type, re-pulled
  for the last 3 days with `dataState=all` to finalise. Optional hourly pull
  for the last 10 days.
- **GTM**: `gtm_snapshots`: full live container version JSON per day, plus a
  normalised `gtm_tags` view (type, firing triggers, consent settings, paused).

Money stays in micros. Dates stay in the account's timezone.

### 4.4 The deterministic engine (this is the product)

Ordered by how much agency time each saves.

1. **Budget pacing.** Per client and per campaign: MTD spend, days elapsed,
   projected month-end, over/under vs monthly budget, and "limited by budget"
   flags. A daily table, plus a threshold alert. This is the job you do by
   hand every morning.
2. **Alert rules** (all local SQL, all with volume gates):
   - Spend continues, conversions zero for 3 days **and** GA4 key events for
     the same period are also zero → tracking broke. Key events present but
     Ads conversions zero → Ads-side tag or import broke. Both zero and
     traffic down → demand, not tracking. This triage is only possible
     because GA4 and Ads live in the same DB.
   - Disapprovals (`policy_summary`), account status changes, billing issues.
   - Spend spike > 2× the 7-day mean; CPA drift > 30% week over week.
   - GSC: clicks or impressions down > 30% week over week on a property;
     sitemap errors.
   - GTM: live version changed since yesterday (someone edited the container).
     Diff the snapshot and attach it to the alert.
3. **Tracking truth.** Port `convaudit.ts`, then add the automatic GA4
   comparison: Ads conversions per action vs GA4 key events per name, daily,
   with the expected relationship for GA4-imported actions. HubSpot stays
   manual until it is worth an integration.
4. **Paid/organic overlap** from GSC: queries where the site holds an average
   position ≤ 3 organically and also receives paid clicks. Surface as negative
   candidates with the caveat that this is correlational.
5. **Landing page health**: GA4 engagement rate and key-event rate for paid
   sessions per landing page; flag the bottom decile with meaningful traffic.
6. **Scoring** as fixed in §2.1, per campaign, goal-aware.
7. **Monthly client report** rendered from the local DB (HTML → PDF): spend,
   conversions, CPA/ROAS, top campaigns, top search terms, organic trend,
   changes made (from `change_event` plus your own audit log), next steps
   (prose from the brain, approved by you before it goes out).

### 4.5 Writes, in order of risk

Phase 3 only, all behind the two-layer gate that already exists.

- Ads: `add_negative_keywords` (to a shared set), `change_budget` with a hard
  ±30%/day cap enforced in code, `pause_campaign`, `pause_keyword`,
  `pause_ad`. Always `validate_only` first, then real. Log to `changes` so it
  appears next to Google's `change_event` rows.
- Ads launch: the ported state machine with §2.4 defaults.
- GA4 Admin: create key events, custom dimensions, Ads link. Beta, stable.
- GTM provisioning: Google tag, GA4 event tags, Conversion Linker, Ads
  conversion tags, consent settings, in one pass (create workspace → tags →
  `create_version` → `publish`), through the serial queue, from golden JSON
  templates you export once from a hand-built container.

### 4.6 Quota plan

| API | Limit | Your load at 50 clients | Verdict |
|---|---|---|---|
| Google Ads (**Basic**, approved 15 Sep 2026) | 15,000 ops/day per project | ~20 ops/account/day | ~750 accounts of headroom. Mutations never need rationing. Keyword Planner and invoice data also unlocked |
| GA4 Data | 200k tokens/property/day | a few hundred | non-issue |
| GSC | 1,200 QPM/site; 2,000 URL inspections/day/property | 3–6 queries/property/day | non-issue; budget inspections explicitly |
| GTM | 10,000/day and 25/100 s per project | read snapshot ≈ 3 calls/container/day | fine only with a global serial queue |

`quota_usage` records every call per API per day; the dashboard shows it.
Failed Ads calls still count.

### 4.7 The brain, scoped

Weekly per client, after sync. Context pack = pacing + alerts + scores +
tracking truth + overlap + landing pages + hypotheses track record, all from
SQL. Outputs are the same closed action union (widened per §4.5) plus prose:
a client-update draft and a prioritised list. Verdicts stay deterministic and
now need volume and contamination checks to be written to the track record.
Use Google's two read-only MCP servers only inside your own Claude sessions
for ad-hoc questions; the product reads its own DB.

### 4.8 The Google Ads transport: drop the Opteo library

**A decision change from the original design.** It was first forced by the
service-account model, and it survives that model being set aside.

*Re-examined 15 Sep 2026, when user OAuth became the active path.* On user
OAuth, Opteo would technically work — it wants `client_id`, `client_secret` and
`refresh_token`, all of which you now have. So the decisive argument has to be
restated, and it is this: **§4.2 commits to both auth paths working
interchangeably.** Opteo satisfies exactly one of them. Building on it would
mean the move to a server — the day a re-auth prompt at 3am with nobody
watching becomes the failure mode — costs a rewrite of the entire Ads layer
rather than deleting one file. The remaining objections below stand on their
own regardless.

The Opteo `google-ads-api` package, which the current Ads Copilot is built on,
**cannot authenticate with a service account**, in either 24.1.0 or the
25.1.0-beta. `CustomerOptions.refresh_token` is required and auth is constructed
privately with no injection point. The maintainer closed the community PR adding
service-account support on 30 Jan 2026 with "Google Service Account support isn't
on our roadmap for this project... this will have to continue to be a fork"
([PR #525](https://github.com/Opteo/google-ads-api/pull/525)). Requests for it
have been open since 2019.

It has also not reacted to the developer-token sunset: `developer_token` is still
a required field, and because the library always sets the header, leaving it
unset sends the literal string `"undefined"`
([PR #550](https://github.com/Opteo/google-ads-api/pull/550), opened by an
outside contributor on 14 Sep 2026, unanswered). Repo health is thin: one
maintainer, 51 open issues, last commit 15 Jun 2026.

So the choice is: keep Opteo and be permanently locked to user OAuth, or write
a thin REST client and keep both doors open.

**Drop Opteo. Write a thin REST client.** Roughly 200 lines of transport plus
typed helpers for the ~15 GAQL queries the app actually runs.

Why this is less work than it sounds, and in places better:

- **Mutates work over REST**, so this is not a read-only compromise. Google's
  REST overview lists Search, SearchStream and Mutate as the common methods.
- **`searchStream` works over REST** and is framed as a JSON array of chunk
  objects, each `{results, fieldMask, requestId}`. Stream-parse it rather than
  buffering a year of daily metrics into memory.
- **Enum decoding disappears.** REST follows the canonical protobuf JSON
  mapping, which serialises enums as their *name*. `campaign.status` comes back
  as `"ENABLED"`, not `2`. The `enumName()` decoder that §6 of the old doc calls
  "the single sharpest gotcha in the codebase" exists only because gRPC returns
  integers. Over REST the bug class is gone.
- **Two mapping rules to internalise instead.** Field names are lowerCamelCase
  in JSON responses but snake_case in the GAQL string itself (`SELECT
  ad_group_criterion...` returns `adGroupCriterion`). And int64 fields are
  serialised as JSON **strings**, so `costMicros` arrives as `"1234560"`. Parse
  with `Number()` for display-scale money, `BigInt` if you ever aggregate raw
  micros across an account.
- **Headers:** `Authorization: Bearer`, `Content-Type: application/json`,
  `login-customer-id` (digits only) for manager traversal, and
  `x-goog-user-project` with the Cloud project id, which is what Google's own
  Node client sends for service-account auth. Send **no** `developer-token`
  header at all.
- **You lose the generated types.** That is the one genuine cost. Mitigate by
  hand-typing the result shape of each fixed query, which is tractable at ~15
  queries and gives a smaller, truer surface than a generated client covering a
  thousand resources you never touch.

The preflight in `preflight/` is already this client in miniature. Its endpoint
shapes, header set and error handling are written and syntax-checked, and the
endpoints answer `401 UNAUTHENTICATED` rather than `404`, so the paths are right.
It has **not** been run against live credentials yet, which is exactly what
Phase 0 step 9 does. If the transport has a problem, you find it there, for the
cost of one command, before any of Phase 1 is built on top of it.

Considered and rejected: `google-ads-api-report-fetcher` (gaarf), Google's own
Apache-2.0 Node client, which *does* support service accounts. It is a report
fetcher: reads only, and it paginates `googleAds:search` rather than streaming.
Useful as a reference implementation, not as the dependency.

### 4.9 Version pins (Sep 2026)

```
node >= 22
(no Google Ads client library — thin REST client, see 4.8)
google-auth-library 11.x      (token minting for the Ads REST calls)
@google-analytics/data 7.1.0
@google-analytics/admin 10.1.0
googleapis 181.x              (searchconsole v1, tagmanager v2, analyticsadmin v1beta)
pg-boss, pg, zod 4, @anthropic-ai/claude-agent-sdk
```

Ads REST version lives in one constant. Currently `v25`. Plan a v26 cutover in
Nov 2026; it removes campaign-level broad match and legacy auto-created assets.

---

## 5. Build order

*Revised 15 Sep 2026 on the operator's call: **front and OAuth first**, scoring
deferred. The original order led with the engine, which is backwards for a tool
whose first job is to let you see and pick accounts.*

### Phase 1 — connect and see (the whole of the first build)

1. **Next.js app + Vercel Postgres.** `DATABASE_URL` is the only config.
   Migrations as numbered SQL files. No ORM.
2. **OAuth, ported from the existing app.** `connections` table with
   `refresh_token_enc` (AES-256-GCM via `crypto.ts`), access tokens minted on
   demand and never persisted. This already works in Ads Copilot today; it is a
   port, not a design problem.
3. **Connect screen.** Sign in → discovery across all four products → the pick
   list → tick what you want. §4.2b.
4. **Binding screen.** Attach a GA4 property, a Search Console site and a GTM
   container to each selected Ads account, domain-matched and pre-ticked,
   always overridable.
5. **Sync + dashboards.** Pull the selected accounts into Postgres, then
   campaign / spend / conversion views reading only local SQL.

That is a complete, useful tool: sign in, choose accounts, see the numbers.

### Phase 2 — deterministic reads on top

Budget pacing, alerts, the conversion-tracking audit, paid/organic overlap from
Search Console. All local SQL, no AI.

### Phase 3 — writes

Negatives, budgets, pausing. Conversion goals created in Ads, then tagged in GTM
and mirrored as GA4 key events. Campaign launches.

### Phase 4 — the brain

Claude API over the local data. Analysis only; every number still computed by
code first.

### What Phase 3 and 4 actually involve

The operator's roadmap, with the parts that are harder than they look flagged.

**Conversion goals created in Ads, pushed to Tag Manager and Analytics.**
Workable, in exactly one direction:

| Step | API | Automatable |
|---|---|---|
| Create the conversion action in Google Ads | `ConversionActionService` | yes |
| Get its tag id / label | read it back | yes |
| Create the Ads conversion tag + Conversion Linker in GTM | `tags.create` (`awct`, `gclidw`) | yes |
| Version and publish the container | `create_version` → `versions.publish` | yes |
| Create the matching GA4 key event | Admin API `keyEvents.create` | yes |
| **Import a GA4 key event back into Ads as a conversion** | — | **no, UI only** |

So build it Ads-first: the conversion originates as an Ads conversion action and
gets tagged through GTM. That is the normal direction anyway. The reverse — GA4
key event imported into Ads — has no API and must stay a manual step.

Three things to respect when writing to Tag Manager. Google's own docs say
destructive operations have "no warnings, no confirmations, and no undo".
`create_version` can return HTTP 200 with `compilerError: true` and no version
created, so check the body, not the status. Free Tag Manager allows only three
concurrent workspaces, so create, version and publish in one pass and never
leave orphans.

**Keyword targeting from Search Console data.** This is the better half of the
idea and it is pure read. Queries where the property earns impressions but the
Ads account has no matching keyword are targeting candidates; queries where the
site already ranks in the top three organically *and* takes paid clicks are
negative candidates. Both are local SQL joins once Search Console and Ads sit in
the same database, so they need no AI at all. With Basic access you also now
have Keyword Planner for volumes, which Explorer would have blocked.

**Campaign improvement.** Deterministic parts first: wasted spend, disapprovals,
budget-limited campaigns, search-term waste share. Only the judgement calls go
to the model.

**The brain is the Claude API.** Yes. The existing app already has the interface
and two implementations behind `BRAIN=cli|api`; the hosted path is
`@anthropic-ai/sdk`. Swap in the Agent SDK for timeouts, cost caps and
structured errors, keep the Zod output contracts exactly as they are. The rule
from the original design does not change: **the model never computes a number.**
Code produces every figure, the model reads them and decides what matters. Its
outputs stay constrained to the closed action union plus prose.

### Scoring: deliberately not in Phase 1

**Dropped from the early build on the operator's call.** The original scoring
engine ranked a campaign against the *median CPA of other campaigns in the same
account*, which is a thin and unstable yardstick — a small account with three
campaigns has no meaningful median, and the number moves for reasons that have
nothing to do with the campaign being scored.

When scoring returns it should be built on **aggregated measurement across every
account in the system**, not within a single account. With a dozen accounts
synced there is a real distribution to compare against: CPA by vertical, CTR by
match type, conversion rate by campaign type. That is a benchmark worth scoring
against, and it only becomes possible once the data is there. So it comes after
Phase 1, not before it.

Until then the dashboards show measured numbers and nothing derived.

## 6. Superseded build order (original)

**Phase 0 (this week, no code):** Cloud project → External + In production →
brand verification → apply for Basic Ads access → create the service account
→ add it to the MCC and to one pilot client's GA4, GSC, GTM. Check the
"Google Ads API Overview" page to confirm the transferred access level. Move
the existing OAuth client out of Testing.

**Phase 1 (read-only core):** Postgres + migrations, `clients` model, four
connectors read-only, daily sync worker, pacing, alerts, access probes, one
dashboard. No AI, no writes. This alone replaces the morning routine.

**Phase 2 (analysis):** fixed scoring, tracking truth with GA4 comparison,
paid/organic overlap, landing pages, monthly report.

**Phase 3 (writes):** negatives / budget / pause with caps and dry runs;
ported launch builder with fixed defaults; GTM read-audit then provisioning.

**Phase 4 (brain):** weekly analysis per client, widened action union,
fixed hypothesis verdicts, client-update drafts.

---

## 7. Open items to verify yourself

- Whether the existing Cloud project's Ads access level transferred as Basic or
  Explorer (Cloud Console, Google Ads API Overview).
- ~~Whether Opteo `25.1.0-beta.1` makes `developer_token` optional.~~ **Answered:
  no.** It is still required, and the library cannot use a service account at
  all, so it is out of the design. See §4.8.
- Whether a service account can call `listAccessibleCustomers` in practice. The
  preflight answers this the moment you run it.
- Exact sensitivity classification of `analytics.edit` and `tagmanager.*` in
  the consent-screen Data Access page (lock icon).
- GTM accepting a service-account email as a user (established practice, no
  explicit Google sentence found).
