/**
 * AI Max for Search — live migration knowledge.
 *
 * Search campaigns still using campaign-level broad match or automatically
 * created assets are being auto-upgraded during September 2026, so for accounts
 * with either setting this is happening right now; campaigns with neither are
 * untouched. Sources range from Google's own documentation, to named agency
 * studies, to single-account anecdotes; each claim says which, because the gap
 * between them is large.
 *
 * Fact-checked 2026-09-16. Corrected: keyword priority has a second tier
 * (identical phrase/broad keywords and PMax search themes) before AI relevance;
 * the broad-match cohort is not a relabel; one of Google's four uplift figures
 * does not exclude retail; and the "inert rather than destructive on small
 * accounts" prior misread its own evidence — the small-account anecdotes lean
 * negative. The "tighten targets instead of cutting budget" advice was removed as
 * unsourced and harmful at low volume.
 */
export const AI_MAX = `
## AI Max, which is migrating right now

Search campaigns still using **campaign-level broad match or automatically
created assets** are being converted to AI Max through September 2026; campaigns
with neither setting are not in scope. The conversion cannot be declined once it
is scheduled, but AI Max can be switched off afterwards — with the side effects
below. Dynamic Search Ads begin converting in February 2027.

AI Max is available in Serbian: text customisation supports every Google Ads
language. None of the evidence below comes from Serbian-language or local
lead-generation accounts, though. Say so when applying it.

### What it changes

Broad match expanded outward from a keyword's text. AI Max matches on inferred
intent, through two separate arms: expansion seeded by your keywords, and
keywordless matching derived from landing page content and ad assets with no
keyword involved at all. The two can be told apart in the match-source report.
Smarter Ecommerce's e-commerce sample saw them split roughly half and half, but
says it "can vary wildly" by account — read the split from the account rather
than assuming it.

**Keywords become hints, with two exceptions.** On a query identical to an
exact-match keyword, that keyword wins. Next come phrase or broad keywords (AI
Max included) and Performance Max search themes that are identical to the query.
Only after that does AI relevance decide, then Ad Rank. That second tier matters
for small accounts running both a Search campaign and Performance Max: an
identical search theme competes with the Search campaign's keyword before any AI
selection happens.

Google's prioritisation documentation — which covers the whole account, not only
AI Max — adds that searches via AI Overviews, AI Mode, Lens or autocomplete are
"not considered technically identical to a keyword", so keywords "may not
automatically be prioritized" there.

Measured erosion (Smarter Ecommerce, 383 million impressions, EMEA e-commerce
Search campaigns that opted into AI Max voluntarily, January 2025–July 2026):
exact-match keyword impressions that resolved as genuine exact matches fell from
effectively all of them to about 71%, read from the published chart. **Roughly
29% of what reports as exact match was AI Max expansion.** About two-thirds of
that shift came in the last four months. Retail, EMEA and early adopters — treat
the direction as general and the size as unproven for local lead generation.

### The trap that catches people remediating it

The API marks a ratchet: once a Search campaign has adopted AI Max,
\`campaign.ai_max_setting.bundling_required\` reads REQUIRED, meaning text
customisation and brand lists only serve while AI Max is on. So **turning the
master toggle off disables brand inclusions and exclusions** (Google says they
come back as they were if AI Max is turned on again). Separately, Google's Help
Center says existing URL inclusions and exclusions are ignored while AI Max is
off.

So the intuitive fix — switch AI Max off to get back to normal — silently removes
the guardrails that were containing it. The correct containment is to leave the
master toggle on and set \`disable_search_term_matching\` per ad group. In
campaigns that came from automatically created assets, text customisation stays
on and needs turning off separately.

Campaigns that came from the campaign-level broad match setting already had their
original exact and phrase keywords set to "Removed" when that setting was first
enabled — before AI Max. Restoring those match types is a manual job whatever you
do with AI Max.

### The two migration cohorts land differently

Campaigns arriving from automatically created assets get **both search term
matching and text customisation switched on**. Campaigns arriving from
campaign-level broad match get search term matching only — but that is **not a
relabel**. Their keywords lose the exact-match priority the broad match setting
gave them on identical queries, and search term matching adds keywordless,
landing-page-based matching that broad match never had. Both cohorts change
targeting. Do not assume uniform settings across campaigns.

### What the evidence actually says

Google has published four uplift figures against four different baselines — 14%,
27%, 7% and 15% — none with a disclosed sample size or method. Three of them
explicitly exclude retail. The fourth (15%, from Alphabet's July 2026 earnings
call) lumps AI Max together with Performance Max. The 7% is not a revision of the
14%; it compares the full feature set against search term matching alone, not
against keyword search.

The most carefully analysed agency study (Brainlabs: 23 tests, 16 mature
advertisers, nine months) found 7% more conversion value at campaign level, but
**54% of the "new" queries were already being captured by other campaigns in the
same account**. True account-level incremental uplift was around **3%**.

The negative headlines — 35% lower return, more than double the cost per
conversion — are real measurements, but nearly all of them compare match types
*within* a campaign, and that method is unsound precisely because AI Max traffic
is mis-booked onto exact and phrase rows. For large, mature accounts, roughly 3%
incremental is a better anchor than either the marketing figure or the horror
stories. For low-volume accounts no comparable measurement exists, and the
anecdotes below lean negative.

### What it does to small, low-volume accounts

The evidence is thin and anecdotal, and none of it supports assuming AI Max is
harmless.

- A Pittsburgh home-services account (HBT Digital) ran AI Max next to manually
  managed keywords for fourteen months. AI Max spent $158 of $10,457, took 0.5 of
  36.5 conversions at a higher cost per acquisition, and 964 of its 993 matched
  search terms got no clicks. The agency pulled it back and said performance
  re-stabilised. That account averaged under three conversions a month.
- A B2B lead-generation account with roughly a dozen conversions a month tripled
  its clicks under AI Max while conversions fell 38% and cost per lead went from
  about $493 to about $850. Cost per acquisition stayed above $800 even after AI
  Max was switched off, so a relearning period should be expected.

Google says only that AI Max "won't be effective" on a campaign limited by
budget, without explaining why. Practitioners report erratic behaviour below
about 30 conversions a month; that is experience, not a measured threshold.

So on a small lead-generation account, AI Max may take little spend, or may
redirect spend to worse queries. Measure its share of spend **and** its cost per
lead against the keyword-matched traffic within the first few weeks, and assume
nothing either way.

### What breaks for diagnosis

Since at least May 2026 Google's documentation says that for searches via AI
Overviews, AI Mode, Lens and autocomplete, the search terms report shows "the
best approximation of the user's intent" rather than necessarily the string typed
— account-wide, not only under AI Max. Google has not said how much
interpretation happens or whether modelled terms are distinguishable. Any
analysis keyed on literal query text is working on approximations of unknown
fidelity for those searches, and should say so rather than implying precision.

Negative keywords still work, but the precise formulation matters: they are
**under-inclusive, not circumvented**. A negative reliably blocks the literal
string it matches and cannot block an intent that resurfaces under different
wording. Negative keywords therefore become the main targeting control rather
than a cleanup task. Because negatives do not extend to close variants, add the
misspellings and variants of every term being blocked — for Serbian, that
includes Latin and Cyrillic spellings and forms with and without diacritics.

### Containment that actually works

- Disabling search term matching per ad group.
- Setting branded searches to unbranded-only on non-brand campaigns, where the
  setting is available (it has been rolling out since about June 2026 without a
  formal announcement). Note that unbranded-only blocks *all* branded queries,
  competitors included, and brand lists depend on the business being in Google's
  brand database, which small Serbian businesses often are not.
- Manual cost-per-click, under which Google says search term matching "will not
  work". Effective, but on a campaign that was on conversion-based bidding it is
  a large bidding change on a thin conversion stream — a deliberate choice, not a
  quick fix.
- Keeping the Search Partner Network share in view. Smarter Ecommerce reports
  3–8% of impressions as typical, and one documented campaign put half of nearly
  500,000 monthly impressions there, converting at 0.07% against 3.04% on Google
  search proper.

**Treat budget and targets carefully during migration.** Being limited by budget
will blur any before/after read, but it is not dangerous in itself. On a
low-volume account, do not tighten Target CPA or Target ROAS to "contain" AI Max:
that throttles lead volume. Contain it with search term matching per ad group,
negatives, brand settings and Search Partners instead, and change one thing at a
time.
`;
