/**
 * How the machinery behaves. Mechanisms and thresholds, never advice.
 *
 * Everything here is either from Google's own documentation or from a named
 * practitioner study. Where guidance is genuinely contested, that is stated
 * rather than hidden, because an analysis that presents a contested question as
 * settled is worse than one that says the question is open.
 *
 * Fact-checked claim by claim on 2026-09-16 against Google's help pages and the
 * v25 API reference. That pass found seven outright errors in the previous
 * version, including three that were backwards for small local accounts: bid
 * adjustments under Maximise Clicks (all types work, not device only), hour-only
 * ad schedules (not affected by the June 2026 pacing change, which covers whole
 * days only), and seasonality adjustments (conversion rate, not cost per click,
 * and Target CPA/ROAS only). The "−100% to +400%" attainment range turned out to
 * come from one retail account, not a multi-thousand-campaign dataset.
 */
export const MECHANICS = `
## How the machinery actually behaves

### Smart Bidding volume floors

Google's only hard volume requirement on Search is for **Target ROAS: 15
conversions in the past 30 days, counted across the whole account's conversion
tracking**, not per campaign. Target CPA and Maximise Conversions have no
published minimum. For *evaluating* results, Google recommends a period
containing at least 30 conversions (50 for Target ROAS), stretching the period
beyond a month if needed.

Practitioners set higher floors, mostly from ecommerce. Mike Ryan (Smarter
Ecommerce, retail Performance Max on Target ROAS) says 30 a month minimum and
ideally 60+. SavvyRevenue wants at least 100 a month before splitting a
campaign, on ecommerce Shopping and Performance Max. Neither was measured on
local lead generation.

Working lines, which are judgement rather than Google rules:

- Under ~15 conversions a month: conversion-based bidding has very little to
  learn from. Many practitioners prefer Manual CPC or Maximise Clicks with a
  maximum CPC here, while Google says Smart Bidding can borrow account-level
  data. Treat it as a judgement call (see "This is contested" below). If
  Maximise Clicks is used, watch search terms closely — it optimises for click
  volume, not lead quality, and cheap clicks are where junk comes from.
- 15–30: Maximise Conversions without a target is a common choice.
- 30+ in the evaluation window: Target CPA becomes judgeable.
- 50+ with genuinely differentiated values: Target ROAS.

A target CPA on an account doing 8 conversions a month has almost nothing to
calibrate against, and Google's own tool will not even suggest a target below 7
conversions. Expect erratic delivery.

**This is contested.** One camp (LGG Media) argues automation should start
immediately because it gathers signal faster. Another (Laura Schiele, Search
Engine Land, September 2026) argues for manual control below 30 conversions a
month. The reconciliation is that the real question is confidence in the
conversion tracking: if tracking is verified, automating is defensible; if
tracking is unproven, feeding a bad signal to Smart Bidding is worse than feeding
none. Bad conversions can be retracted, but a retraction only counts for bidding
if it lands within 7 days of the conversion being recorded, and a tracking fault
can only be covered with a data exclusion if it is caught within about 14 days.

### The August 2026 target-bidding change

Between 17 and 27 August 2026 Google changed how Target CPA and Target ROAS (and
Target CPC on Demand Gen) behave on **budget-limited** campaigns in Search,
Shopping, Performance Max, Demand Gen and Travel. Before, some of these campaigns
beat their target by a wide margin. They now deliver much closer to it.

This inverts older advice. "Set a generous target to give Smart Bidding
breathing room" was safe before August and is now an instruction to spend up to
that target. **Any budget-limited campaign whose target was set before August
2026 should have it reviewed — a lower Target CPA, or a higher Target ROAS, if
the old target was loose.** Note the direction differs: a stricter ROAS target is
a *higher* number. Google's Bid Target Adjustment Tool gives no suggested target
for campaigns under 7 conversions, so on small campaigns the new target has to
be set by hand. If you see a generous target on a budget-constrained campaign,
say so.

### Ad schedules and budget

Since 1 June 2026, a campaign whose ad schedule switches off **whole days** still
paces toward 30.4 times its average daily budget per month. A Monday–Friday
schedule therefore concentrates the monthly budget into fewer days rather than
saving money — up to the hard limit of twice the daily budget on any one day.
For those campaigns the daily budget should be the monthly target divided by
30.4, not by working days.

Schedules that only switch off **hours** within a day were not changed: the
campaign still aims at about one daily budget per day, spread over the open
hours. Switching off 22:00–07:00 does not raise monthly spend; it pushes the same
daily spend into the open hours.

A schedule is mainly an availability control. It is right when nobody answers
the phone at 22:00, because an ad at 22:00 buys a voicemail. It is not a reliable
way to reduce spend — lower the budget for that.

### Which bid adjustments each strategy honours

Under Target ROAS, Maximise Conversions and Maximise Conversion Value, ad
schedule, location, audience, call and demographic adjustments are ignored, and
device adjustments work only at −100% (an opt-out). **Target CPA is the exception
for devices**: a device adjustment across the full range is accepted, and it
changes the CPA target for that device. **Maximise Clicks and Manual CPC support
every adjustment type** — device, location, ad schedule, audience, calls and
demographics.

Never recommend a bid adjustment the campaign's bid strategy cannot honour, and
never tell a Maximise Clicks or Manual CPC account that its location or hour
adjustments are inert — on those strategies they are the main controls a small
account has. Where genuinely different economics by time, place or device need
expressing under a strategy that ignores adjustments, that requires separate
campaigns — which collides with the consolidation point below, and that tension
should be named rather than glossed over.

### Consolidation beats segmentation at low volume

At low volume, prefer as few campaigns as the business genuinely needs. Every
split divides an already thin signal. There is no published cut-off; as a
working heuristic, below about 60 conversions a month, more than two or three
campaigns needs a reason.

Documented but uncontrolled single-account consolidations: an ecommerce account
merged 44 non-brand Search campaigns into 7 (+345% conversion value, +22% ROAS,
2020); a lead-generation account merged 19 into 4 (+253% conversions, −60% cost
per conversion). Treat them as illustrations, not measured effects.

Legitimate reasons to split: a different bid strategy or objective, a budget
that must be ring-fenced, a separate market with different economics (another
city with its own prices or capacity), a different primary conversion action, or
a business constraint the algorithm cannot know. Not legitimate on their own:
match type, device, or finer location and demographic cuts inside one market —
Smart Bidding already uses those as signals.

Always *report* brand and non-brand separately, because blending them inflates
apparent performance and hides what non-brand is really doing. Splitting them
into separate *campaigns* is contested at low volume: brand conversions may be
most of the data Smart Bidding has. Where brand is kept in the same campaign,
exclude or segment it in the analysis.

### Conversion windows

The default click window is 30 days. On a business that converts same-day —
emergency AC repair, a burst pipe, an electrician — a long window adds little.
It is not shown to slow Smart Bidding, which already weights recent data by the
length of the conversion cycle; a shorter window is mainly a decision about which
late conversions should count. The one published test (a direct-to-consumer
retailer with a 2.2-day cycle, 30 days to 7: +42.9% conversions, −6.3% cost) was
compared against a holiday period with other changes made at the same time, and
its author disclaims the attribution.

Raise the window only if the lag report shows late conversions the business does
not believe. On a low-volume account, first check that shortening it will not
push the conversion count below the levels bidding relies on.

### Seasonality adjustments are for days, not seasons

Google's own guidance: seasonality adjustments are ideal for events of 1–7 days
and may not work as well beyond 14. They suit a three-day heatwave, not "summer".
**Set the modifier to the expected change in conversion rate** — that is what the
field is (\`conversion_rate_modifier\`) — not the change in cost per click. On
Search they only apply to Target CPA and Target ROAS: Maximise Conversions and
Maximise Clicks campaigns cannot use them.

Data exclusions are for outages and tracking breakages, not seasons, and only
for problems less than about 14 days old on Search (60 on Shopping). Google warns
against using them often or for long periods.

Smart Bidding learns *recurring* seasonality from history, but cannot know that a
one-off event — a heatwave starting Thursday — is coming. For a short,
predictable spike, Google's tools are a seasonality adjustment, a temporary
target change on the day, or Promotion Mode (beta, Search and Performance Max).
Make sure the budget has headroom *before* the spike rather than raising it once
it has started. There is no agreed evidence for ramping budget weeks in advance,
and on a small budget that spends money in low-demand weeks.

### Spam and junk conversions

When junk traffic produces conversions, Smart Bidding treats them as real and
moves spend toward similar traffic. Adding a negative stops the query but does
not remove the conversions already learned from. The fix is to **retract** those
conversions — which only counts for bidding within 7 days of recording — or to
use a data exclusion if the cause was a tracking fault. On a small account a week
of spam is a large share of all the data the bidder has.

This is why cheap junk traffic matters more than its cost suggests, why detection
speed matters more than cleanup thoroughness, and why a lead-generation account
benefits so much from importing lead outcomes: it is the one mechanism that lets
junk be taken back out of the signal.
`;

/**
 * Reporting and measurement mechanics — the traps that make a number mean
 * something other than what it appears to mean. Separated from bidding because
 * these apply to every figure on the page, not just the bid strategy.
 */
export const REPORTING = `
## What the numbers actually are

### Conversions are dated to the click, not the conversion

A conversion that happens today is written back onto the date of the click that
caused it, up to 90 days earlier depending on the conversion window. Three
consequences:

- **Recent days always look artificially bad**, and keep filling in for as long
  as the business's conversion cycle. Never diagnose a fall in the last few days
  as performance.
- The default columns are correct for judging efficiency, because spend and
  conversions then share a date.
- Reconciling to Analytics or a finance system needs the by-conversion-time
  columns instead. Mixing the two in one comparison manufactures a discrepancy.

### Targets do not reset learning, whatever you have read

Google is explicit: changing a target "won't trigger a 'learning' status, and
won't reset anything Smart Bidding has already learned", and advertisers should
"feel comfortable changing CPA and ROAS targets as frequently as you would like".
Google also says to avoid more than one Target ROAS change within a single
conversion cycle, and notes that ad-group target changes on Shopping can show
"Learning".

This is **contested in practice** — Optmyzr's tooling defaults to a 14-day
cooldown between changes anyway. The defensible position is that targets can move
without fear of a reset, but that moving them faster than the conversion cycle
means you never observe the result of the last move.

What does restart learning, per the API's status values: a new or reactivated
strategy, a setting change, a budget change, a composition change (campaigns
added or removed), and a conversion-setting or conversion-type change.

Learning length is not measured in days. Google says it can take **up to** around
50 conversion events or three conversion cycles, and often less. For a same-day
business, three cycles is a few days. For a business with a two-week lead cycle
doing 20 conversions a month, it is several weeks. Estimate it from the account's
own conversion lag, not the 50.

### Two different conversion-volume floors get conflated

Fifteen conversions in thirty days, counted account-wide, is what Google requires
to *permit* Target ROAS on Search and Shopping. Google's own guidance for
*evaluating* results is a period with at least 30 conversions (50 for Target
ROAS), and practitioners put reliable performance higher still. These are
different quantities, and the gap between them is where most bad advice lives.

How unreliable low volume is: in one heavily segmented retail Performance Max
account analysed by Smarter Ecommerce, campaigns with few monthly conversions
missed or beat their ROAS target by anywhere from about −100% to +400%, with
accuracy improving as volume rose. Across thousands of retail Performance Max
campaigns, the same team found hitting target became roughly even odds at 60–90
conversions a month and reliable only around 150. That is retail ROAS bidding,
not lead generation, but the direction generalises.

**Gate every target-related conclusion on conversion volume in the window being
judged.** If the window holds fewer than about 30 conversions, widen it. If even
a widened window cannot reach 30, the correct finding is "there is not enough
data to judge this", not a verdict.

### Value bidding on uniform values is count bidding wearing a costume

If every conversion carries the same value, maximising conversion value is
algebraically identical to maximising conversion count, and a target return is
exactly that value divided by a target cost per conversion (value 100, target
CPA 20 → target ROAS 500%). Google's own requirement for value bidding is two or
more different values — either varying values on one goal, or different fixed
values on different goals.

So an account running target return-on-ad-spend where every conversion has the
same value is not doing value bidding. It is doing cost-per-conversion bidding
with extra moving parts and a misleading column. Worth saying plainly.

### Impression share is censored at both ends

Share metrics are reported in the range 0.1 to 1: **anything below 10% is
reported as 0.0999**. Lost-share metrics run 0 to 0.9: **anything above 90% is
reported as 0.9001**. You cannot tell 2% impression share from 9.9%, and a
campaign collapsing from 9% to 1% shows no change at all.

Treat those two values as "unknown", never as measurements, and never average or
trend across them. Outside the censored ranges, impression share plus lost to
rank plus lost to budget should come to about 100%; when one of them is censored
the sum stops meaning anything.

One more trap: at **ad-group level**, lost impression share to rank is hidden if
the campaign ran out of budget at any point in the period, so its absence there
points to a budget problem rather than missing data. It is still shown at
campaign level.

### Performance Max and Search impression share

Practitioners (Adalysis, citing a Google representative) report that when
Performance Max wins a query instead of a Search campaign, the Search campaign
counts as not eligible for that auction rather than as having lost it. If so, a
Search campaign can show **fewer impressions and a higher impression share at
the same time**. Exact-match keywords that match the query still win over
Performance Max, so the effect is limited to phrase and broad traffic. Read
impression-share trends across a Performance Max launch as suspect, and compare
absolute impressions instead.

### Quality Score is a diagnostic, not an auction input

Google states it plainly: Quality Score "is not a key performance indicator and
should not be optimized", and is not an input in the ad auction. The visible 1–10
number is computed from exact searches of the keyword over the last 90 days, so
under broad match and Smart Bidding it describes a shrinking slice of the
traffic.

The *components* — expected click-through rate, ad relevance, landing page
experience — are the same qualities the auction judges, but the auction uses its
own real-time estimates; the statuses shown are 90-day historical comparisons.
Never recommend chasing the score. Treat a falling trend as a check-engine light
worth investigating, not a problem in itself.

The same applies to Ad Strength, which Google has confirmed is not used in the
auction. In the largest published study (Optmyzr, 1M+ ads, 2024) it showed no
positive link with performance: ads rated "Average" had the best cost per
conversion and conversion rate.

### Things sitting in the Conversions column that people do not expect

Engaged-view conversions — a non-click event — are in the main Conversions
column for Video, App, Display, Demand Gen **and Performance Max**. The "Ad event
type" conversion segment separates click-through from engaged-view conversions;
use it before drawing conclusions on any account running YouTube or Performance
Max. Cross-device conversions have their own metric. Modelled conversions are the
part that cannot be separated out.

### Conversion lag is measured from the impression

By Google's definition, not from the click — though on Search the two are almost
always the same day. The account's own lag distribution is the best source, and
we know of no credible published benchmark by vertical. Use it to set how far
back a reporting window must end before the data is stable. Consent-mode
modelling only applies once a country and domain reach about 700 ad clicks a
week, so most small accounts have no modelled conversions to wait for.
`;
