/**
 * What a number means — with provenance attached.
 *
 * A benchmark stated without a source is an opinion with a decimal point. Each
 * entry below carries where it came from and how far to trust it, and the
 * negative findings are as important as the positive ones: several
 * widely-circulated benchmark families turned out to be fabricated, and knowing
 * that is what stops the analysis inventing a number to sound authoritative.
 *
 * Traced to the original publications on 2026-09-16. Every figure matched its
 * source; the corrections were to scope and trust — the "home services" dataset
 * is HVAC and plumbing only, the ROAS-by-campaign-type figures come from an
 * agency with an undisclosed method and are now marked directional, and the
 * HVAC cost-per-lead band's lower bound was too low.
 */
export const BENCHMARKS = `
## Benchmarks, and how much to trust them

Use these only for sanity-checking whether a figure is wildly out of range.
Never present one as a target. The operator's own economics decide what good
looks like, and an account's own history is a better comparator than any
external table.

**None of the figures below transfer to Serbia.** They are US data. Do not compare
a Serbian account's cost per click or cost per lead against them, not even as a
sanity check — the auctions, prices and competition are not comparable.

### Reliable enough to reason with (US)

**US search, all industries** (LocaliQ, 13,474 US campaigns, April 2025–March
2026; the published "averages" are medians): cost per click $5.42, click-through
rate 6.64%, conversion rate 8.18%, cost per lead $66.69. Caveat the aggregators
strip out: the dataset mixes Google and Microsoft Ads, is US-only and comes from
LocaliQ's own small-business client base.

Relevant verticals from the same set — home improvement $8.33 CPC / 8.05%
conversion / $90.92 per lead; dentists $8.00 / 10.67% / $72.97; personal
services $7.17 / 12.34% / $54.60; physicians $4.76 / 12.43% / $40.04; legal
$9.87 / 5.55% / $131.63.

**Home trades, the largest disclosed dataset found** (SearchLight: HVAC and
plumbing only, Google Ads only, 816 US contractors, $14.9M spend, 143,008 leads,
January 2026 — one vendor's client base, one month). Cost per lead by campaign
type: branded search $34, non-branded search $149, Performance Max $72, blended
$104. Booking rate 41.7% blended — but 55.3% branded, 37.6% non-branded and 32.2%
Performance Max, so **a cheaper lead is not automatically a cheaper job**.

A second, weaker source (99 Calls, an agency reporting only on campaigns it
manages, sample size undisclosed, data through June 2026) puts typical HVAC cost
per lead at $190–335. SearchLight's non-branded HVAC figures run $144–231 by
service. So **treat non-brand HVAC as a band of roughly $140–340 rather than a
point**, and never judge it without knowing the brand/non-brand split first.

### Directional only

**Return on ad spend by campaign type** (Focus Digital, an agency, "5,000+
accounts", median, March 2025–April 2026; the data blends platform feeds, agency
client data and unnamed studies, with geography and method undisclosed): Search
5.17x, Performance Max 3.12x, Shopping 2.88x, Video 0.52x, Display 0.12x. The
Video and Display figures mostly show how conversions get credited, not what
those channels are worth. The same page gave Performance Max 2.57x a year
earlier.

**Market baseline 2026** (Optmyzr, 21,425 accounts, Q1 2025 to Q1 2026): paid
impressions fell about 11%, click-through rate rose about 21%, return on ad spend
held steady and cost per acquisition rose about 4%. Most of the impression fall
was Display and Video; Search fell about 4%. Optmyzr puts this alongside AI
Overviews and changing results pages — a correlation, not a measured cause — in
an account base of undisclosed geography. In English-language markets with ads
in AI Overviews, a broad Display or Video impression decline is a reasonable
baseline. For Serbian-language campaigns there is no evidence either way: look
for a campaign- or account-level cause before blaming the market.

### Do not use — these circulate widely and are fabricated

**Mobile versus desktop conversion rates by vertical.** No credible source
exists. The figures in circulation trace to sites citing a "Statista Device
Performance Report 2026" and a "WordStream Industry Benchmarks Q1 2026" —
**neither publication exists**. Do not confuse them with the genuine
LocaliQ/WordStream 2026 benchmark report (published on both sites as "Google Ads
Benchmarks 2026"), which is real, is the source of the US figures above, and
contains no device split. Compute device deltas from the account's own data and
compare the account against itself.

**Conversion lag by vertical.** We know of no rigorous published distribution
from any credible source. Anyone quoting "B2B is X days, e-commerce is Y days" is
quoting a number nobody measured. Lag must be measured per account.

**Quality Score to cost-per-click discount tables.** The "score of 10 gives a 50%
discount" family traces to a 2013 WordStream analysis. It applied the simplified
"Ad Rank = bid × Quality Score" formula that Google itself used for teaching
around 2009 and has long since dropped. Google now describes Quality Score as a
diagnostic, not an auction input, and publishes no discount figure.

**Any Serbian or Balkan cost-per-click benchmark.** What little exists is either
AI-generated filler that contradicts itself by an order of magnitude, or stale
country-level indices (such as WordStream's relative-to-US country table) far too
coarse to judge a single account. Keyword Planner bid ranges for the actual
keywords and the account's own history are the only defensible comparators. Say
so rather than inventing one.

### The honest position

Where no reliable benchmark exists, say that. "There is no trustworthy external
benchmark for this, so here is how the account compares against itself" is a
better sentence than a confident number nobody measured.
`;
