/**
 * What a number means — with provenance attached.
 *
 * A benchmark stated without a source is an opinion with a decimal point. Each
 * entry below carries where it came from and how far to trust it, and the
 * negative findings are as important as the positive ones: several
 * widely-circulated benchmark families turned out to be fabricated, and knowing
 * that is what stops the analysis inventing a number to sound authoritative.
 */
export const BENCHMARKS = `
## Benchmarks, and how much to trust them

Use these only for sanity-checking whether a figure is wildly out of range.
Never present one as a target. The operator's own economics decide what good
looks like, and an account's own history is a better comparator than any
external table.

### Reliable enough to reason with

**US search, all industries** (LocaliQ, ~13,500 campaigns, Apr 2025–Mar 2026):
cost per click $5.42, click-through rate 6.64%, conversion rate 8.18%, cost per
lead $66.69. Caveat the aggregators strip out: the dataset mixes Google and
Microsoft Ads, is US-only and skews to small business.

Relevant verticals from the same set — home improvement $8.33 CPC / 8.05%
conversion / $90.92 per lead; dentists $8.00 / 10.67% / $72.97; personal
services $7.17 / 12.34% / $54.60; physicians $4.76 / 12.43% / $40.04; legal
$9.87 / 5.55% / $131.63.

**Home services, the best dataset available** (SearchLight, 816 contractors,
$14.9M spend, 143,000 leads, Jan 2026). Cost per lead by campaign type: branded
search $34, non-branded search $149, Performance Max $72, blended $104. Booking
rate 41.7% blended. A second credible source (99 Calls) puts HVAC median cost
per lead at $190–335, so **treat non-brand HVAC as a band of roughly $100–350
rather than a point**, and never judge it without knowing the brand/non-brand
split first.

**Return on ad spend by campaign type** (Focus Digital, 5,000+ accounts, median):
Search 5.17x, Performance Max 3.12x, Shopping 2.88x, Video 0.52x, Display 0.12x.
Moving numbers, not constants — the same report gave Performance Max 2.57x a
year earlier.

**Market baseline 2026** (Optmyzr, 21,425 accounts): paid impressions fell about
11% year on year as AI Overviews compressed inventory, while click-through rate
rose about 21% and return on ad spend stayed flat. A broad impression decline is
the expected baseline, not an account defect.

### Do not use — these circulate widely and are fabricated

**Mobile versus desktop conversion rates by vertical.** No credible source
exists. The figures in circulation trace to sites citing a "Statista Device
Performance Report 2026" and a "WordStream Industry Benchmarks Q1 2026" —
**neither publication exists**. Compute device deltas from the account's own
data and compare the account against itself.

**Conversion lag by vertical.** No rigorous published distribution exists from
any credible source. Anyone quoting "B2B is X days, e-commerce is Y days" is
quoting a number nobody measured. Lag must be measured per account.

**Quality Score to cost-per-click discount tables.** The "score of 10 gives a
50% discount" family traces to a 2013 reverse-engineering exercise built on a
formula that is not Google's. Google publishes no discount figure.

**Any Serbian or Balkan cost-per-click benchmark.** The entire published corpus
is AI-generated filler contradicting itself by an order of magnitude. There is
no verified data for these markets. Say so rather than inventing one.

### The honest position

Where no reliable benchmark exists, say that. "There is no trustworthy external
benchmark for this, so here is how the account compares against itself" is a
better sentence than a confident number nobody measured.
`;
