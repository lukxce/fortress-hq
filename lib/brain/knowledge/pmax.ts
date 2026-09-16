/**
 * Performance Max mechanics.
 *
 * Most guidance about PMax is assertion. This is restricted to what Google
 * documents or what a named study with a sample size measured, because the gap
 * between the two is unusually wide here and the confident numbers circulating
 * are mostly invented.
 *
 * Re-verified from scratch on 2026-09-16, trusting nothing in the previous
 * version, after the original research ran out of search budget. Corrected: the
 * "30 floor / 60 healthy" thresholds are one source (smec, retail target ROAS),
 * not two converging datasets, and the −100%..+400% range is one account; the
 * no-feed share is ~36% of campaigns, not 55%; the brand-exclusion figures
 * conflated two tables and ignored causal geo tests pointing the other way; only
 * an identical *exact-match* keyword beats PMax outright; a Shopping/text split
 * inside Google Search does exist; and the "1.3 to 3 times incremental" range had
 * no source and is removed.
 */
export const PMAX = `
## Performance Max

### Asset groups have no economics of their own

An asset group has no budget, no bid, no target, no negatives, no location and
no schedule. Money reaches it only by winning auctions. So a conclusion that
"this asset group is starved" must first be checked against the campaign budget
and Ad Rank. After that, check the asset group's own inputs: Google picks between
asset groups partly on relevance (search themes, final URLs), and some channels
need specific assets, such as a location asset for Maps. An asset group can lose
traffic through what it contains, but never through budget or bids it does not
have.

Google states plainly that asset groups with a worse cost per conversion still
contribute to the campaign goal and **should not be removed on that basis**.
Never recommend deleting one on its own efficiency figures. **Merging asset
groups to pool thin signal is a different thing** and is often the most useful
recommendation on a small account: twenty conversions a month spread across four
asset groups gives none of them anything to learn from.

### Asset-level numbers are not what they look like

Asset metrics are **non-summable by construction**. If an ad with a headline, a
description and an image produces one conversion, all three assets are credited
with one conversion — so the asset-level total is three against a campaign total
of one. Judge performance at asset group or campaign level; Google itself warns
that assets with fewer conversions may still be helping the campaign. Assets
showing zero are expected rather than broken: not everything eligible serves.

Ad Strength is also gameable. It counts Google-generated text equally with your
own, so a strong score on a campaign with text customisation enabled is not
evidence of creative depth. Separate advertiser-supplied assets from
automatically created ones before judging.

The useful signal is the machine-readable coverage gap, which names exactly
which asset types are missing and how many, including which video aspect ratios.
That is actionable in a way the strength rating is not.

### Search themes and audience signals: the evidence is thin and mostly misread

Search themes carry the same auction priority as your phrase and broad keywords,
which is real and documented. On measured performance the evidence is thin. The
largest study (Optmyzr, October 2024, 9,199 accounts, e-commerce and lead
generation, accounts spending $1k–$5M a month) found accounts using search themes
had 17% lower return and 24% higher cost per conversion. They also had 34% higher
cost per click, which explains most of that gap, and a slightly *higher*
conversion rate. It is correlational and the cohorts chose themselves. The only
published positive result is a single-brand vendor test (ROI Revolution, 2025:
+37% conversions over six weeks, not randomised). The honest statement is that
**no reliable evidence exists either way**.

For a local service business that is not a reason to skip them: service-plus-city
themes are one of the very few ways to steer Performance Max toward the queries
that matter. "Unproven" is not "don't use".

The audience-signal comparison from the same study should not be used at all.
The no-signal group was under 10% of campaigns, with a conversion rate 63% higher
than the rest — that is cohort composition, not a targeting effect.

Google is unusually explicit that audience signals are **not targeting**: ads may
serve outside the signal whenever the model predicts it helps. The popular claim
that signals stop mattering once learning ends has no published test behind it
that we could find — treat it as unproven, not as false.

### Brand cannibalisation: know which part is expected

Google's priority order: an **exact-match** keyword identical to the query comes
first and beats Performance Max outright. Next come phrase and broad keywords
identical to the query, **on the same tier as identical Performance Max search
themes**, with Ad Rank breaking the tie. So only exact match guarantees a keyword
wins — a broad brand keyword can still lose to an asset group holding the same
search theme. Brand protection means an **exact-match** brand keyword in a Search
campaign that is not budget-limited.

Two further exceptions matter:

**Ad format.** The priority rule governs only the Search text-ad slot. A Shopping
ad can serve on a query you hold an exact-match keyword for. So Shopping-format
overlap on brand terms is **documented expected behaviour, not cannibalisation**,
and scoring it as a problem is wrong.

**AI surfaces.** On searches arriving via AI Overviews, AI Mode, Lens or
autocomplete, Google says keywords "may not automatically be prioritized" because
the query is not technically identical, so brand protection is weaker on those
surfaces.

Priority also weakens when the Search campaign is budget-limited: Google says
Performance Max "may occasionally serve on exact match terms" then. So before
calling anything cannibalisation, check whether the Search campaign was starved —
a confound that published cannibalisation analyses rarely control for.

**On brand exclusions, the evidence conflicts — present it that way.** In
Optmyzr's October 2024 dataset about 96% of accounts used no brand exclusion
list, and the few that did looked flat on platform metrics: cost per conversion
about 3% higher, return about 7% higher. That is correlational and measured on
Google's own attribution. Haus geo experiments (2024, e-commerce, a small number
of brands) are causal, and there excluding brand terms lowered new-customer
acquisition cost in every test, though total incremental revenue went either way.
What exclusions reliably buy is **honest measurement of what Performance Max does
beyond brand**; an efficiency gain is plausible but not proven, and nothing here
comes from lead-generation accounts. For a local business, where a large share of
Performance Max conversions may be people searching the business's own name, that
measurement honesty is usually worth having.

Campaign and account negative keywords reach **Search and Shopping inventory
only**. Brand exclusions reach Search, Shopping **and YouTube search**, with an
option to let Shopping ads keep serving on excluded brands. Display, YouTube feeds
and video, Discover, Gmail and Maps are out of reach of both, and need
account-level placement or content suitability exclusions instead.

### Volume floors — and whose data they come from

The best-known thresholds come from Smarter Ecommerce (smec), and all of smec's
data is **retail e-commerce on Target ROAS**. smec states "at least 30 monthly
conversions, ideally 60 or more". Its underlying 2024 analysis (14,000 data
points, first half of 2023) is less generous: below 30, targets are missed more
often than hit; at 60–90 it is still roughly a coin flip; only at 150+ are
targets hit consistently. Optmyzr (October 2024, e-commerce and lead generation)
found campaigns under 60 conversions a month did worse on every metric except
click-through rate.

Treat 30 as the point below which judging whether a **target** is being met is
noise, and do not call 60 "healthy". No threshold has been published for
lead-generation Performance Max on Maximise Conversions **without a target** — and
a campaign with no target cannot miss one. Do not flag such a campaign as noise
merely for being under 30.

Performance Max supports only Maximise Conversions (with an optional target CPA)
and Maximise Conversion Value (with an optional target ROAS). Never recommend
Maximise Clicks or Manual CPC for it. The low-volume remedies available are
removing the target, consolidating asset groups or campaigns, and fixing what is
counted as a conversion.

**On budget, Google does publish a rule.** Both the Help Center and the API
documentation say to try a daily budget of **at least three times your cost per
conversion**, and warn that a budget too low relative to it produces a slower
ramp and fewer conversions. It is phrased as a suggestion and carries no dataset.
On a small local account it is often unaffordable — at a €20 cost per lead it
means €60 a day. Present it as the reason learning will be slow below that level,
**never as a demand for more budget**.

There is **no absolute currency floor** anywhere official. Any specific "minimum
spend per day" figure is invented, and so is the "Google recommends 10× CPA" that
circulates on content farms.

### Before concluding anything about Shopping

**A large share of Performance Max runs without a product feed**: about a third of
campaigns and about half of advertisers in Optmyzr's 2024 dataset, and every
lead-generation account is in that group. Read \`campaign.feed_types\` rather than
assuming. A feedless campaign never appears in Shopping reporting, so "no Shopping
cannibalisation" is meaningless until you have checked.

Brand guidelines are irreversible once enabled, they move the logo and business
name off the asset group onto the campaign, and they are **switched on by default
for new Performance Max campaigns**. An asset-completeness check that counts only
asset-group assets will wrongly report a missing logo on most recent campaigns.

### What you cannot see, and why that matters

Placement reporting for Performance Max carries **impressions and nothing else**
— no clicks, no cost, no conversions. So you can see where the ads showed and can
never prove what any placement cost. When junk placements are suspected, that
asymmetry is itself the finding: say that the cost cannot be established rather
than implying it can.

Also unavailable: performance labels for assets (removed in API v22), any metric
on asset combinations, and any metric on signals. Search Partners and Display
**cannot be turned off** in Performance Max by a general advertiser — that control
remains in a closed alpha — though account-level placement exclusions still work.

A Shopping-versus-other split *is* available: segment by "ads using product data"
(\`segments.ad_using_product_data\`). Within Google Search that effectively
separates Shopping from text. Note that "Display" appears as CONTENT in network
reporting, and that Google Search excludes Maps and Discover.

Channel-level data **does not exist before 1 June 2025** at any API version, and
the breakdown needs API v23 or later. Earlier dates come back as a single mixed,
cross-network row rather than an error: totals stay correct, but any per-channel
comparison reaching back past that date shows those channels as zero. Clamp or
refuse such windows for channel questions only.

### How much of what Performance Max reports is actually incremental

Published geo-holdout work on Performance Max is scarce and comes from companies
selling incrementality measurement. The one named case (Caraway, via Haus, 2024)
found Google's reporting overstated Performance Max **with brand terms** by about
a third. Vendor "directional" tables suggest brand and remarketing inventory are
the most overstated, and YouTube can be under-reported. None of this is a
multiplier to apply to anyone's numbers.

Statistical power is the useful part. As a rough illustration from the same
vendor, about 1,000 conversions a week might detect a 10% lift, while about 100
might only detect changes above 25%; the real threshold depends on the number of
regions, test length and noise. On an account doing twenty conversions a month,
no incrementality claim in either direction is measurable. Say that rather than
implying a test would settle it.
`;
