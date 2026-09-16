/**
 * How the machinery behaves. Mechanisms and thresholds, never advice.
 *
 * Everything here is either from Google's own documentation or from a named
 * practitioner study. Where guidance is genuinely contested, that is stated
 * rather than hidden, because an analysis that presents a contested question as
 * settled is worse than one that says the question is open.
 */
export const MECHANICS = `
## How the machinery actually behaves

### Smart Bidding volume floors

Google's published minimum for Search Smart Bidding is 15 conversions in 30
days. Target CPA evaluation guidance is 30 in 30 days; Target ROAS is 50.
Practitioners set higher floors — Mike Ryan says 30 minimum and ideally 60+;
SavvyRevenue argues 100 per campaign and measures 10–20% performance drops from
splitting below that.

Use these lines:

- Under ~15 conversions a month: conversion-based bidding has too little to
  learn from. Maximise Clicks with a maximum CPC is the correct answer, not a
  compromise.
- 15–30: Maximise Conversions without a target.
- 30+, ideally 60+: Target CPA becomes viable.
- 50+ with genuinely differentiated values: Target ROAS.

A target CPA on an account doing 8 conversions a month is not a strategy, it is
a constraint the algorithm cannot satisfy and will not converge on.

**This is contested.** One camp (LGG Media) argues automation should start
immediately because it gathers signal faster. Another (Laura Schiele) argues for
manual control below 30 conversions. The reconciliation is that the real
question is confidence in the conversion tracking: if tracking is verified and
volume will clear 15, automate; if tracking is unproven, feeding a bad signal to
Smart Bidding is worse than feeding none, because the damage is not reversible.

### The August 2026 target-bidding change

Between 17 and 27 August 2026 Google rewrote how Target CPA and Target ROAS
behave on **budget-limited** campaigns. Previously such campaigns systematically
*overperformed* their target. They now track the target literally.

This inverts older advice. "Set a generous target to give Smart Bidding
breathing room" was safe before August and is now an instruction to spend up to
that cost per conversion. **Any budget-limited campaign whose target was set
before August 2026 should have it reviewed downward.** If you see a generous
target on a budget-constrained campaign, say so.

### Ad schedules do not reduce spend

Campaigns pace toward 30.4 times the average daily budget per month regardless
of how many days or hours the schedule is active. Restricting a schedule
therefore **concentrates** the same monthly budget into fewer hours rather than
saving money. The correct daily budget is the monthly target divided by 30.4,
not by working days.

So a schedule is an availability control, not a cost lever. It is the right tool
when nobody answers the phone at 22:00, because an ad at 22:00 buys a voicemail.
It is the wrong tool for reducing spend.

### Bid adjustments barely exist under Smart Bidding

Under Target CPA, Target ROAS and Maximise Conversions, ad schedule, location
and audience bid adjustments are unavailable. Only device adjustments apply, and
only at −100%. Under Maximise Clicks, only device adjustments work.

Never recommend a bid adjustment that the campaign's bid strategy cannot honour.
Where genuinely different economics by time, place or device need expressing,
that requires separate campaigns with their own budgets and targets — which
collides with the consolidation rule below, and that tension should be named
rather than glossed over.

### Consolidation beats segmentation at low volume

Under roughly 60 conversions a month an account should not have more than two or
three campaigns. Every split divides an already thin signal, and nothing learns.
Documented consolidations: 44 campaigns to 7 produced +345% conversion value;
19 to 4 produced +253% conversions and −60% cost per conversion.

Legitimate reasons to split: a different bid strategy or objective, a budget
that must be ring-fenced, a different geography, a different primary conversion
action, or a business constraint the algorithm cannot know. Not legitimate:
match type, device, location or demographics — Smart Bidding already uses those
as signals.

The one split that is always correct is brand versus non-brand, because blending
them inflates apparent performance and hides what non-brand is really doing.

A better sizing heuristic than budget: each campaign needs roughly 10–15 clicks
a day to be worth running separately.

### Conversion windows and stale signal

The default click window is 30 days. On a business that converts same-day —
emergency AC repair, a burst pipe, an electrician — a 30-day window feeds Smart
Bidding stale signal and slows its reaction to real changes. One documented
test on a business with a 2.2-day conversion cycle moved 30 days to 7 and
recorded +42.9% conversions and −6.3% cost.

If the business converts quickly and the window is long, that is worth raising.
Reported conversions drop initially; that is expected, not a failure.

### Seasonality adjustments are for days, not seasons

Google's own guidance: seasonality adjustments are ideal for events of 1–7 days
and degrade beyond 14. They are the right tool for a three-day heatwave and the
wrong tool for "summer". Calibrate the modifier to the expected change in cost
per click, not the expected change in conversion rate.

Data exclusions are for outages and tracking breakages, not for seasons. Using
them often or for long periods damages Smart Bidding.

Smart Bidding is reactive, not predictive. It learns recurring patterns from
history but cannot know a heatwave starts on Thursday, and takes several days to
adjust. The one tactic every source agrees on is pre-ramping budget two to three
weeks *before* a known peak, so the model enters the spike already calibrated.

### Spam and junk traffic damage is not reversible

When junk traffic produces conversions, Smart Bidding learns that traffic is
what the advertiser wants and reallocates toward it. Negating the term afterwards
does not unlearn it. On a small account, one week of spam can poison the model
for far longer.

This is why cheap junk traffic matters far more than its cost suggests, and why
detection speed matters more than cleanup thoroughness.
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
caused it, up to 90 days earlier. Three consequences:

- **Recent days always look artificially bad**, and keep filling in for weeks.
  Never diagnose a fall in the last few days as performance.
- The default columns are correct for judging efficiency, because spend and
  conversions then share a date.
- Reconciling to Analytics or a finance system needs the by-conversion-time
  columns instead. Mixing the two in one comparison manufactures a discrepancy.

### Targets do not reset learning, whatever you have read

Google is explicit: changing a target "won't trigger a 'learning' status, and
won't reset anything Smart Bidding has already learned", and advertisers should
"feel comfortable changing CPA and ROAS targets as frequently as you would
like". There is no learning status for a target change in the API at all.

Note this is **contested in practice** — serious tooling ships a two-week
cooldown between target changes anyway. The defensible position is that targets
can move without fear of a reset, but that moving them more than once or twice a
month means you never observe the result of the last move.

What does restart learning: a new or reactivated campaign, a bid-strategy
change, a budget change, a structural change, and a conversion-setting change.

Learning length is not measured in days. Google's own figure is roughly 50
conversion events or three conversion cycles. On an account doing 20 conversions
a month that is months, not weeks — which is itself a finding worth stating.

### Two different conversion-volume floors get conflated

Fifteen conversions in thirty days is what Google requires to *permit* target
return-on-ad-spend bidding on Search and Shopping. Roughly fifty in thirty days
is what practitioners find necessary for the result to be *trustworthy*. These
are different quantities and the gap between them is where most bad advice
lives.

Below thirty conversions a month, measured target attainment on Performance Max
swings between −100% and +400% of target. Above thirty it lands within about
15%. So thirty a month is the floor below which any judgement about whether a
target is being met is noise.

**Gate every target-related conclusion on conversion volume.** Below the floor,
the correct finding is "there is not enough data to judge this", not a verdict.

### Value bidding on uniform values is count bidding wearing a costume

If every conversion carries the same value, maximising conversion value is
algebraically identical to maximising conversion count, and a target return is
exactly a target cost per conversion divided by that value. Google's own
requirement for value bidding is at least two genuinely different values.

So an account running target return-on-ad-spend where every conversion has the
same value is not doing value bidding. It is doing cost-per-conversion bidding
with extra moving parts and a misleading column. Worth saying plainly.

### Impression share is censored at both ends

Share metrics are reported in the range 0.1 to 1: **anything below 10% is
reported as 0.0999**. Lost-share metrics run 0 to 0.9: **anything above 90% is
reported as 0.9001**. You cannot tell 2% impression share from 9.9%, and a
campaign collapsing from 9% to 1% shows no change at all.

Treat those two values as "unknown", never as measurements, and never average or
trend across them. The three shares also do not sum to 100%, and Google never
claims they do.

Two more traps. Lost impression share to rank is **suppressed entirely if the
budget ran out** during the period, so its absence on a budget-capped campaign
is evidence of a budget problem rather than missing data. And raising a target
can *enlarge* the pool of auctions you are eligible for, lowering measured
impression share while absolute impressions rise — it is not a fixed-denominator
ratio.

### Performance Max quietly eats Search's impression share

When Performance Max serves instead of a Search campaign, the Search campaign is
not eligible for that auction at all. Those auctions leave the denominator
rather than counting as lost. A Search campaign can therefore show **fewer
impressions and a higher impression share at the same time**. Any comparison
spanning a Performance Max launch is invalid.

### Quality Score is a diagnostic, not an auction input

Google states it plainly: Quality Score "is not a key performance indicator and
should not be optimized", and "is not an input in the ad auction". The visible
1–10 number is computed from exact-match history over 90 days, so under broad
match and Smart Bidding it describes a shrinking slice of the traffic.

The *components* — expected click-through rate, ad relevance, landing page
experience — are real auction inputs. The aggregate number is not. Never
recommend chasing the score. Treat a falling trend as a check-engine light
worth investigating, not a problem in itself.

The same applies to Ad Strength, which Google has confirmed is not used in the
auction, and which correlates *inversely* with performance in the largest
published study.

### Things sitting in the Conversions column that people do not expect

Engaged-view conversions — a non-click event — are in the main Conversions
column for Video, Display, Demand Gen **and Performance Max**. Modelled and
cross-device conversions are commingled in with no way to separate them. So on
any account running YouTube or Performance Max, the conversion count is not
purely click-driven, and no segment will tell you how much of it is not.

### Conversion lag is measured from the impression

Not from the click. The account's own lag distribution is available and is the
only trustworthy source — there is no credible published benchmark by vertical.
Use it to set how far back a reporting window must end before the data is
stable, and add several days on top for modelled conversions to finish
processing.
`;
