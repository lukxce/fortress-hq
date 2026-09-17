/**
 * Keywords: what Keyword Planner's numbers mean, how match types, negatives and
 * keyword prioritization actually behave, and what the search terms report
 * leaves out.
 *
 * Built from Google's primary documentation (Google Ads help on Keyword Planner
 * metrics, keyword matching options, negative keywords, Low search volume,
 * keyword prioritization, the search terms report and its 2021 privacy update;
 * Google Ads API guides on historical metrics and keyword ideas, and the
 * KeywordPlanHistoricalMetrics / competition-level reference), Google's
 * 26 June 2024 query-matching announcement as reported by Search Engine
 * Journal, and one third-party measurement of hidden search-term spend (Seer
 * Interactive, 2020). Every claim was checked against those pages on
 * 2026-09-17; that pass dropped hidden-share figures from single-account
 * anecdotes and any negative-keyword claim beyond misspellings. The intent
 * section is heuristic and labelled as such. Nothing here is advice.
 */
export const KEYWORDS = `
## Keywords

### What the engine sees

Two Google Ads API calls. Historical metrics for the account's own keywords
and converting search terms, and keyword ideas seeded from up to ten of those
terms plus the site URL. Each row may carry: average monthly searches, a
12-month series, competition (LOW / MEDIUM / HIGH), competition index 0–100,
and low / high top-of-page bid. Ideas with zero volume are dropped before
storage; an own keyword the API returned nothing for is stored as 0. So a 0
on an own keyword means "no data returned", not "measured as zero searches".

### Average monthly searches (Google Ads help, Keyword Planner definitions; high)

- The average searches for a keyword **and its close variants**, for the
  chosen month range, locations and Search Network setting. The API averages
  the past 12 months (API historical metrics guide; high).
- **Rounded.** Google warns that volumes for several locations may not add up.
  A small city's figure is coarse: 10 versus 20 is not a meaningful gap.
- Location, language and network (Google Search only, or with search partners)
  change the number. Compare figures only when fetched with the same settings.
- If there is not enough data a metric is **null** (API guide; high). Null
  competition or bids is common on low-volume local terms and is not a signal.
- Because close variants are pooled, two spellings of one query often return
  the same number. Do not add them together as separate demand.

### Low search volume status (Google Ads help; high)

A keyword with very little or no search history on Google gets this status and
is **inactive: it will not trigger ads**. Google rechecks regularly and
reactivates it if queries increase even slightly. Many such keywords in a
local account are normal (narrow city + service combinations); the problem is
only when they are the ad group's main coverage.

### Competition and bids

- **Competition**: the number of advertisers that showed on the keyword
  relative to all keywords across Google (help; high). It measures advertiser
  density, not organic difficulty and not how hard the keyword is to win.
- **Competition index 0–100**: ad slots filled divided by total ad slots
  available; null if data is thin (API reference; high). Level bands: LOW
  0–33, MEDIUM 34–66, HIGH 67–100 (API competition-level enum; medium-high).
- **Top of page bid, low range**: roughly the **20th percentile** of what
  advertisers historically paid for a top-of-page bid. **High range**: roughly
  the **80th percentile** (help; high). Historical, for the chosen geo and
  network; a range, not a price quote, and not what this account will pay
  under Smart Bidding.

### Match types (Google Ads help, keyword matching options; high)

- **Exact**: searches with the same meaning or same intent as the keyword.
- **Phrase**: searches that include the meaning of the keyword, which may be
  implied or more specific.
- **Broad**: searches related to the keyword, which can lack its direct
  meaning. Uses the user's recent searches, landing page and asset content, and
  the other keywords in the ad group. Google calls Smart Bidding with broad
  match critical, because bids should reflect each query's auction-time
  signals; broad without Smart Bidding lacks that (inference; medium).

### Negative keywords (Google Ads help; high unless stated)

- Negatives **do not match close variants or other expansions**; plurals and
  synonyms must be added separately in Search campaigns.
- Casing and **misspellings are handled automatically**. Announced 26 June
  2024 alongside misspelling aggregation in the search terms report (Google via
  Search Engine Journal; high).
- Negative broad blocks searches containing all the terms in any order;
  negative phrase, the terms in order; negative exact, the terms in order with
  no extra words.
- A negative after the 16th word of a long query may not apply.

### Search terms report is a sample

- Only terms searched by a significant number of people are shown; terms
  without enough query activity are omitted for privacy (help; high). Since
  the September 2020 change, and a partial restore covering data from
  1 February 2021, the threshold is volume across all Google searches (help;
  high). The gap appears as an "other search terms" line.
- Search terms insights group all queries, including hidden ones, into themes
  (help; high). Use them when the visible report looks thin.
- Size of the gap: Seer Interactive compared search-term totals with campaign
  totals across 30+ advertisers on 31 Aug vs 1 Sep 2020 and found visible cost
  fell about 28% and visible clicks about 20% (low confidence: 2020, before
  the 2021 and 2024 restores, agency accounts not local services). Small local
  accounts plausibly hide more, because long-tail queries rarely clear a
  volume threshold. Measure it per account, never assume.

### Keyword prioritization (Google Ads help, keyword prioritization; high)

When several keywords in one account can match a search, only one enters the
auction: they **do not compete with each other**, so overlap is not the
account bidding against itself. Order:
1. An exact-match keyword identical to the search term.
2. A phrase or broad keyword (or PMax search theme) identical to the term.
3. AI relevance across the search term, all keywords in the ad group and the
   landing page.
4. Highest Ad Rank among equals.
Spell-corrected searches count as identical; plurals and synonyms do not.
Keywords that are Low search volume, budget-limited, disapproved or excluded
by targeting are skipped. Overlap still matters for control: the wrong ad
group, ad or landing page can win.

### Intent in local service searches (heuristics; medium)

Likely buying: city + service ("klima servis niš"), "near me" / "u blizini",
price words ("cena", "cenovnik", "price"), urgency ("hitno", "0-24",
"emergency"), a brand the business sells or services.
Likely not buying: "how" / "kako", "what is" / "šta je", jobs ("posao",
"oglasi za posao", "plata"), DIY ("sam", "uradi sam"), manuals, courses,
wholesale or parts-only queries for a labour business.
A heuristic tags a query; conversions decide. A "kako" term with conversions
is a buying term for that account.

### Signatures

| If you see | Suspect |
|---|---|
| Many own keywords at 0 or null volume | Over-narrow city + service variants; many are likely Low search volume and inactive. Check whether a broader keyword already covers the same searches before adding more |
| A search term with conversions that is not a keyword | Coverage gap: add it as exact match so priority 1 routes it to the right ad group and landing page |
| High Planner volume but few impressions on the keyword | Volume is for close variants, all networks or a wider geo than the campaign targets; or budget, bid or Ad Rank limits; or another keyword wins priority |
| Visible search terms cover a small share of cost | Privacy threshold hiding long-tail queries; read search terms insights and do not conclude "no waste" from the visible rows |
| URL-seeded ideas mostly irrelevant | Seed page is thin, generic or the home page; Google expands to the domain when the page gives little. Seed from converting terms instead |
| Brand terms dominate converting searches | Conversions from people who already know the business; non-brand performance is weaker than the total implies. Separate brand before judging keywords |
`;
