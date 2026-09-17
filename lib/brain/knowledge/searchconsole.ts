/**
 * Google Search Console: what the numbers are, and how to read a change.
 *
 * Product behaviour is taken from Google's own documentation — the Performance
 * report help pages, the Page indexing report page, the Search Analytics API
 * reference, the October 2022 "data filtering and limits" and December 2024
 * "recent data" Search Central posts, the core-updates and page-experience
 * docs — and fact-checked against them on 2026-09-17. Click-curve figures come
 * from Backlinko, Sistrix, First Page Sage, Advanced Web Ranking and Seer
 * Interactive, each dated and sized below. Paid/organic overlap comes from the
 * Google ad-pause studies (2011, 2012), Blake/Nosko/Tadelis (eBay, 2015),
 * Coviello/Gneezy/Goette (Edmunds, 2017) and Simonov/Nosko/Rao (Bing, 2018).
 * That pass dropped every "striking distance" case-study figure (vendor
 * numbers with no method) and kept only the mechanism.
 * Every entry is a mechanism, a number with provenance, or a detection pattern.
 */
export const SEARCH_CONSOLE = `
## Search Console: what the numbers are

### Definitions (Google help, high confidence)

An **impression** is a link to the site the user saw or could have seen. A
**click** is any click that leaves Google. **CTR** is clicks ÷ impressions.
**Position** is the *topmost* position any link to the property (or page)
occupied for that impression, then averaged across impressions. Two queries at
positions (2,4,6) and (3,5,9) give an average position of 2.5, not 4.8. Every
SERP element occupies one position whether it holds one link or many.

Consequences:

- **Sitelinks.** A sitelinks card is one element at one position: one
  impression grouped by property, one per URL grouped by page. Brand queries
  therefore show inflated impressions in the Pages view.
- **Property vs page.** Three pages at positions 1, 2, 3 are position 1 and one
  impression for the property, but average position 2 and three impressions
  for the pages. Never compare a page-level position with a property-level one.
- **Carousels.** An item registers an impression only when scrolled into view,
  and every item inherits the carousel's position. Image results count one
  impression per URL per query. Image and video impressions are high-volume,
  low-click and share nothing with web positions.
- All data is attributed to the **Google-selected canonical**, so a redirected
  or duplicate URL's traffic appears under its target.

### Freshness, retention and the two ways data goes missing

The newest data is preliminary (dotted line) and "may change in the next few
hours"; Google states no fixed final-data delay, cut the average delay by
almost half in 2024, and the API has hourly rows for the last 10 days (April
2025). Practitioners see two to three days before figures settle (medium
confidence). Retention is **16 months**; nothing older survives unless exported.

**Anonymised queries** (Google, Oct 2022): a query "not issued by more than a
few dozen users over a two-to-three month period" is dropped from every query
table but kept in chart totals — *unless a query filter is applied*, in which
case it vanishes from the total too. Google's example: "contains fiction" shows 175
clicks, "excludes fiction" 275, the unfiltered total 550. Ahrefs (April 2025, 22bn clicks, 887,534 properties): 46.77% of clicks are
anonymised, per-site mode 45–80%, smallest sites lose most. Say so before quoting any query-level share.

**Row limits.** The interface shows 1,000 rows. The API defaults to 1,000,
takes rowLimit up to 25,000, and pages with startRow to 50,000 per day per site
per search type. Dimensions without query or URL return everything; Google
states requests with page and/or query dimensions may have rows dropped, so a
query×page table undercounts further than either alone.

### Properties and search types (Google help, high confidence)

A **domain property** covers every subdomain and protocol (DNS verification
only); a **URL-prefix property** covers only that exact protocol and prefix, so
it misses http://, www-less and subdomain traffic. The search-type filter
defaults to **Web**; image, video and news (the News tab) are separate
selections. **Discover** and **Google News** are separate reports and API
searchType values; "news" is not "googleNews". Check the type before calling
anything a drop.

## Click-through rate by position

### What the studies say, and why they disagree (low-to-medium confidence)

| Study | Sample | P1 | P2 | P3 | P10 |
|---|---|---|---|---|---|
| Backlinko, updated Apr 2025 | 4M results, 12.2M queries | 27.6% | 15.1% | 11.4% | ~2% |
| Sistrix 2020, mobile only | 80M keywords | 28.5% | 15.7% | 11.0% | 2.5% |
| First Page Sage, May 2025 (meta-analysis, no sample) | — | 39.8% | 18.7% | 10.2% | 1.6% |

Backlinko: top three take 54.4%; #2→#1 is +74.5% relative, #10→#9 only +11%.
Sistrix shows why no single curve works: position-1 CTR is 46.9% with
sitelinks, 34.2% pure organic, 23.3% under a featured snippet, 16.7% beside a
knowledge panel, ~18.8% under ads, 13.7% under Shopping. Advanced Web Ranking's GSC-derived curves moved −9.03
to +7.05 points at position 1 across industries in one quarter (Q1 2026).
Seer (Sep 2025; 3,119 informational queries, 42 organisations, 25.1M
impressions): organic CTR fell 61% (1.76% → 0.61%) under an AI Overview, 41%
without one.

Backlinko and Sistrix pool brand navigation, every intent and every layout;
First Page Sage averages other studies. **The site's own CTR per position
bucket, brand excluded, over 3–6 months, is the only yardstick that holds
layout, brand mix and market constant.** Published curves say only whether a
bucket is wildly off.

### "Striking distance" — positions 8–20 (practitioner concept)

The leverage comes from the curve: ~2% at position 8 to ~10% at position 3 is
roughly five-fold clicks at constant impressions. What is *not* demonstrated is
that on-page work reliably moves a page: no controlled study exists, and vendor
case studies carry no method. Google says positions "aren't static" and a 2→4
move is normal fluctuation. So treat a query at 8–20 with real impressions as
*demonstrated relevance and unclaimed clicks*; promise no position, and never
judge one query's weekly move.

### Cannibalisation in query×page data

Google (Mueller, Sep 2025): several pages ranking for one query is not a
problem in itself; it is when they serve the *same intent* and dilute each
other. Harmful signature: filter one query, open Pages, two URLs with split
impressions whose positions **alternate by date**, combined clicks below what
one earned alone at the better position. Fine: a shop page and a guide both
ranking (intent split), or both inside the top three.

## Reading a change

### Decompose a clicks drop before naming a cause

1. **Position fell, impressions similar** → ranking: core-update dates, a
   content or template change, lost internal links, a canonical flip.
2. **Impressions fell, position similar** → demand or eligibility: seasonality
   (16 months allows year-over-year), pages dropped from the index, a
   search-type or country mix change.
3. **CTR fell, position and impressions similar** → the SERP changed around
   the site (ads, AI Overview, featured snippet) or the snippet did (title
   rewrite, lost sitelinks). Check Search appearance.

Isolate brand first: the brand name and its misspellings are usually the
largest query, at position 1 with CTR above any curve, so blended CTR says
nothing about acquisition. Compare brand-filter to *exclude*-brand, never to
the total, because query filters drop anonymised traffic.

**Core updates** (Google): several a year, rollout "may take up to 2 weeks",
wait a full week after completion before comparing. Recovery "could take
several months" or the next core update. A 2→4 drop needs no action; 4→29
does. **Redirected** page: its rows fall to zero, the target's rise, the
property total holds. **Deindexed**: rows and property total both fall.

### Page indexing states that matter on a small site (Google help)

- **Crawled – currently not indexed**: fetched and declined. On a small site
  almost always a quality or thinness judgement, not a bug.
- **Discovered – currently not indexed**: Google says it expected crawling to
  overload the site; implausible at a few hundred pages, so read it as low
  crawl priority (medium confidence).
- **Duplicate without user-selected canonical**: Google chose another URL,
  "working as intended". Set canonicals if the wrong one won.
- **Soft 404**: a 200 Google reads as "nothing here" — empty listings, thin
  location pages. Return a real 404 or add content.

## Paid brand and paid/organic overlap

Google ad-pause studies (Chan et al. 2011, >400 experiments): 89% of paid
clicks were not replaced by organic when ads paused. The 2012 follow-up (390
studies): only **50%** of ad clicks are incremental when the advertiser ranks
organic #1, 82% at 2–4, 96% at 5+. Blake/Nosko/Tadelis (eBay, Econometrica
2015): on brand keywords 99.5% of the traffic arrived anyway.
Coviello/Gneezy/Goette (Edmunds, 2017): more than half of paid traffic was
lost when paid stopped — far less substitution than eBay. Simonov/Nosko/Rao
(Bing, Marketing Science 2018, thousands of brands): brand ads add 1–4% clicks
with no competitor bidding, more for lesser-known brands; competitor ads on
the brand term crowd out the organic result.
**Medium confidence**: Google's studies are the vendor's own and predate AI
Overviews; eBay is a dominant brand. For a small business at organic #1 on its
name, the case *for* paid brand is competitor bidding; the case *against* is
that half or more of those clicks were coming anyway. Brand query CTR before
and after an ad change is the test.

## Page experience and Core Web Vitals (Google docs, updated Dec 2025)

"There is no single signal"; Core Web Vitals "are used by our ranking
systems" but Google shows "the most relevant content, even if the page
experience is sub-par", and other aspects "don't directly help your website
rank higher". At launch it mattered "much more" only between pages with
*similar content*; Mueller: "more than a tie-breaker" but "relevance is still
by far much more important". Thresholds: LCP 2.5 s, INP 200 ms, CLS 0.1. Never
offer CWV as the first explanation of a drop.

## Signatures

| What you see | What to suspect |
|---|---|
| Impressions spike, clicks flat, position worsens | New long-tail or image/Discover exposure, not a loss; check search type |
| Position improves while clicks fall | Fewer queries impressed (average of survivors); demand or indexing loss |
| Brand CTR drops, position 1 held | A competitor's or your own ad appeared above; check paid brand change dates |
| CTR down on informational queries only, position held | AI Overview or featured snippet; check Search appearance |
| Query clicks sum far below page clicks | Anonymisation; normal |
| Two URLs swap position by date for one query | Same-intent cannibalisation |
| Whole-site drop over 1–2 weeks | Core update; wait a week after rollout, then compare |
| One page to zero, total holds | Redirect or canonical moved; find where it landed |
| One page to zero, total falls | Deindexed; check Page indexing and noindex |
| Prefix property below domain property | Subdomain or protocol traffic; not a loss |
`;
