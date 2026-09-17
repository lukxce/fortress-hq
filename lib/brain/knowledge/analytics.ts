/**
 * Google Analytics 4: how the property counts, attributes and hides things,
 * and how to read it next to the linked Google Ads account.
 *
 * Built from Google's own GA4 and Google Ads help pages — sessions and
 * engagement, reporting identity, key events, attribution settings, default
 * channel groups, unwanted referrals and cross-domain measurement, thresholds,
 * sampling, retention, behavioural modelling, the consent mode developer
 * guide, and the Ads troubleshooters for click-versus-session and conversion
 * discrepancies — checked claim by claim on 2026-09-17. Rules of thumb Google
 * does not state are marked practitioner consensus and carry low confidence.
 * Dropped in that pass: a "10–20% click-to-session gap is normal" figure
 * (third-party, no methodology) and every engagement-rate and conversion-rate
 * benchmark found. Every entry is a mechanism, a number or a detection
 * pattern. Nothing here is advice.
 */
export const ANALYTICS = `
## Google Analytics 4: what the numbers are, and where they lie

### Sessions and engaged sessions

A session starts on a page view with no session active and ends after 30
minutes of inactivity, adjustable up to 7 h 55 min (Google help, high). It does
**not** restart at midnight or when new campaign parameters arrive mid-session
(Google help, high): two ad clicks inside 30 minutes are one session and two
Ads clicks.

An engaged session lasts longer than 10 seconds, **or** has a key event, **or**
has 2+ page views. Engagement rate is engaged sessions over sessions; bounce
rate is its complement; engagement time accrues only while the page is in focus
(Google help, high). A call-only landing page where the user dials in 8
seconds is a "bounce"; a near-universal event marked key makes every session
"engaged". The metric measures the tag's view of the visit, not intent.

Key events count once per event by default; "once per session" is an option
(Google help, high) and the Universal Analytics behaviour.

### Users and the reporting identity

Reports default to **Active users** (had an engaged session or a first_visit or
engagement event), not Total users (Google help, high). **Blended** identity
uses User-ID, then device ID, then modelling; **Observed** User-ID then device
ID; **Device-based** the device ID only. Google signals is no longer an identity
space; the switch is non-destructive and applies everywhere (Google help,
high). Under Device-based one person on two devices is two users.

### Key events, conversions and the Google Ads import

Since the 2024 rename a **key event** is an important action in GA4; a
**conversion** is a Google Ads conversion created from a key event in a linked
account, visible in the Advertising section only (Google help, high); at most
30 per property. The import needs the link, auto-tagging on, and a gclid that
redirects do not strip (Google Ads help, high).

Why the Ads Conversions column and the GA4 key-event count differ (Google Ads
help, high, unless noted):

- **Date.** Ads reports on the click date, GA4 on the event date, so a past
  Ads day keeps rising. **Import lag** up to 24 hours.
- **Window.** Ads click-through window defaults to 30 days, range 1–90; GA4
  uses its lookback — 90 days default for non-acquisition key events (options
  30, 60), 30 for first_visit (option 7) (Google help, high).
- **Model.** The imported action is "Google paid channels" or "paid and
  organic"; under the latter an Ads click followed by an organic click credits
  organic and never reaches the Ads column.
- **View-through** never exists for imported key events; **cross-device** in
  Ads needs Google signals on. Only **primary** actions sit in Conversions.
- **Modelling.** Modelled key events flow into the conversions built from them
  and can be revised for up to 12 days; GA4 reattributes for up to 7 (Google
  help, high).

### Attribution and session sourcing

Models: **data-driven** (recommended), **paid and organic last click** (100%
to the last clicked channel; direct ignored unless the whole path is direct),
**Google paid channels last click** (last Ads click, else paid-and-organic
last click). First click, linear, time decay and position-based were removed
in November 2023. The setting changes only event-scoped traffic dimensions in
key-event reports, retroactively; Session source and First user source are
untouched (Google help, high).

Session source is fixed at session_start (gclid, UTM, referrer) and follows
last-non-direct-click logic: a later direct session inherits the earlier
referrer (Google help, high; the window is not stated). With gclid and UTMs
both present the auto-tagged values win; a partial UTM set on a manual URL
yields (not set) for the missing dimensions (Google help, high).

### Default channel grouping

Auto-tagged Ads traffic is classified by network and campaign type: Search and
Search Partners → Paid Search; Display and Google TV → Display; Performance
Max, Demand Gen and Smart Shopping → **Cross-network**; Social → Paid Social
(Google help, high), so "Paid Search sessions versus Ads clicks" undercounts
by the PMax and Demand Gen share.

Manual rules (Google help, high): Paid Search = source in the search-site list
**and** medium matching ^(.*cp.*|ppc|retargeting|paid.*)$; Paid Other = that
medium with an unrecognised source; Referral = medium referral, app or link;
Direct = source (direct) with medium (none) or (not set); **Unassigned** = no
rule matched. utm_medium=cpc on google is Paid Search, on facebook Paid Social;
utm_medium=googleads is Unassigned. A session with source/medium (not set) is
Unassigned; the usual cause is a missing session_start because the config tag
is not on Tag Manager's Initialization trigger (Google help, high).

### Self-referrals, unwanted referrals, cross-domain

Analytics never treats the current domain, its subdomains, or a configured
cross-domain as a referrer; anything else on the path — a payment gateway, a
booking widget — is one (Google help, high). A return within 30 minutes does
not split the session, but a purchase fired on return can be sourced to the
gateway, and last-non-direct-click then hands later direct sessions to it
(Google help, high). Up to 50 unwanted referrals per stream.

Without cross-domain measurement (the _gl linker, same G- ID on both domains)
each domain sets its own cookies: one person becomes two users and two
sessions, and the second domain records a referral from the first (Google
help, high) — a measurement fault, never a traffic source.

### Thresholds, (other), sampling, retention

**Thresholds** are system-defined, unadjustable, and withhold whole rows (not
into (other)) where Google-signals demographics, User-ID, or low user counts
could identify someone; a data-quality icon flags it and a wider date range
reduces it (Google help, high). **(other)** is cardinality: the table exceeded
its row limit, and any dimension with 500+ values is high-cardinality (Google
help, high) — page path with query string is the usual victim. **Sampling**
starts at 10 million events per request on a standard property, shown as a
percentage in the data-quality icon; standard reports run on aggregated tables
that answer common requests unsampled (Google help, high). A small business
never reaches it.

**Retention** is 2 or 14 months and governs event-level data in explorations
and funnels only (Google help, high); new properties start at 2 (practitioner
consensus, medium), so a 13-month exploration silently shows 2.

### Consent Mode v2 and behavioural modelling

Consent types: ad_storage, analytics_storage, ad_user_data, ad_personalization;
the last two are the "v2" additions and are required for enhanced conversions
(Google help, high; the "v2" label is practitioner usage). **Basic** mode
blocks tags until consent and sends nothing. **Advanced** mode loads tags with
denied defaults and sends cookieless pings — consent state, timestamp, user
agent, referrer, full URL with ad-click parameters, a per-page random number —
while neither reading nor writing analytics cookies (Google developers, high).

Behavioural modelling needs 1,000+ events per day with analytics_storage
denied for 7+ days **and** 1,000+ daily consented users on 7 of the previous
28 days, plus Blended identity; training may take longer and can still fail
(Google help, high). Below that, denied visitors are simply absent (medium):
at a few hundred daily users, consent denial is a coverage error in every
ratio.

### (not set) landing pages, URLs and IDs

Landing page is the page path of a session's first page_view and is (not set)
when the session has none (Google help, high) — typically a session restarted
by a scroll or engagement event after timing out with the tab open
(practitioner consensus, medium). page_location is the full URL; page_path
drops domain and query; Landing page + query string keeps the query (Google
help, high), so gclid, fbclid and UTMs multiply rows into (other). A
measurement ID (G-…) identifies one web data stream; the property ID is
numeric and identifies the property (Google, high).

### Signatures worth recognising

| What you see | What to suspect |
|---|---|
| A key event drops to zero on a date | Renamed, un-flagged, tag or trigger changed, consent banner changed, site release. Look for it under a new name |
| Sessions up, key events flat | Composition: a new placement or channel, referral spam, rising Unassigned, or the event not firing on a new template. Read key event rate by landing page |
| Engagement rate collapses on one channel only | That channel's landing page broke, or its new placements are low-intent. All channels at once is a tag or timer change; above 90% is a duplicate page_view or a near-universal key event |
| Mobile converting far below desktop | Form or consent banner unusable on mobile, or mobile users call and tel: clicks are not a key event — coverage, not device |
| Unassigned or Direct share rising | UTM values outside the regex, session_start missing, server-side events without session context, consent denial, untagged email or app links |
| GA4 Paid Search sessions well above Ads clicks | utm_medium=cpc on other engines, gclid persisting in bookmarks and shares, last-non-direct reattribution, invalid clicks Ads filtered |
| GA4 Paid Search sessions well below Ads clicks | Auto-tagging off, a redirect stripping gclid, tag not firing before exit, JavaScript blocked, consent denied — or PMax and Demand Gen sitting in Cross-network |
| Referral from own domain or a payment gateway | Cross-domain gap or missing unwanted-referral entry |
| Ads conversions for a past date keep rising | Click-date reporting, import lag, modelling revisions — not new conversions |

### Benchmarks: none are used here

Engagement rate depends on the timer, the key-event set, duplicate tags and
the consent rate; conversion rate on which events are key. Published GA4
benchmarks pool self-selected accounts with no stated methodology, so none is
given; compare a property with its own history, by channel and device.
`;
