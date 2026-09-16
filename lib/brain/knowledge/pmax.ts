/**
 * Performance Max mechanics.
 *
 * Most guidance about PMax is assertion. This is restricted to what Google
 * documents or what a named study with a sample size measured, because the gap
 * between the two is unusually wide here and the confident numbers circulating
 * are mostly invented.
 */
export const PMAX = `
## Performance Max

### Asset groups have no economics of their own

An asset group has no budget, no bid, no target, no negatives, no location and
no schedule. Money reaches it only by winning auctions. So any conclusion of the
form "this asset group is starved" must resolve to the campaign budget or to Ad
Rank losses — never to the asset group itself.

Google states plainly that asset groups with a worse cost per conversion still
contribute to the campaign goal and **should not be removed on that basis**.
Never recommend deleting one on its own efficiency figures.

### Asset-level numbers are not what they look like

Asset metrics are **non-summable by construction**. If an ad with a headline, a
description and an image produces one conversion, all three assets are credited
with one conversion — so the asset-level total is three against a campaign total
of one. Google's own guidance is to judge at asset group or campaign level, and
to treat asset ratios as directional only. Assets showing zero are expected
rather than broken: not everything eligible serves.

Ad Strength is also gameable. It counts Google-generated text equally with your
own, so a strong score on a campaign with text customisation enabled is not
evidence of creative depth. Separate advertiser-supplied assets from
automatically created ones before judging.

The useful signal is the machine-readable coverage gap, which names exactly
which asset types are missing and how many, including which video aspect ratios.
That is actionable in a way the strength rating is not.

### Search themes and audience signals: the evidence is thin and mostly misread

Search themes carry the same auction priority as your phrase and broad keywords,
which is real and documented. But on measured performance there is **exactly one
study**, from October 2024 across 9,199 accounts, and it found accounts using
search themes had 17% worse return and 24% higher cost per conversion — while
also having 34% higher cost per click, which mechanically explains most of the
gap. It is correlational, the cohorts self-selected, and the direction is
inconsistent across metrics. No study at any scale has ever measured a positive
lift. The honest statement is that **no reliable evidence exists either way**.

The audience-signal comparison from the same study should not be used at all.
The control group was under 10% of the sample with a conversion rate 63% higher
than the treatment group — that is cohort composition, not a targeting effect.

Google is unusually explicit that audience signals are **not targeting**: ads may
serve outside the signal whenever the model predicts it helps. And the claim that
signals stop mattering after learning has no supporting evidence anywhere.

### Brand cannibalisation: know which part is expected

The priority rule is that a Search keyword whose **text** matches the query beats
Performance Max. Match type is irrelevant — a broad keyword with identical text
also wins. Two exceptions matter enormously:

**Ad format.** The priority rule governs only the Search text-ad slot. A Shopping
ad can serve on a query you hold an exact-match keyword for. So Shopping-format
overlap on brand terms is **documented expected behaviour, not cannibalisation**,
and scoring it as a problem is wrong.

**AI surfaces.** On searches arriving via AI Overviews, AI Mode, Lens or
autocomplete, Google says keywords "may not automatically be prioritized" because
the query is not technically identical. Brand protection therefore degrades on a
growing share of volume.

There is also no priority at all when the Search campaign is budget-limited —
Google says Performance Max may then serve on exact-match terms. So before
calling anything cannibalisation, check whether the Search campaign was starved,
which is the confound the published studies did not test.

**On brand exclusions, the largest dataset says they do not improve performance.**
Across 9,199 accounts, 97% used none at all, and 58% performed flat or slightly
better without them. Median cost per conversion was actually worse with
exclusions. They buy **measurement honesty, not efficiency** — branded searchers
would largely have converted anyway. Say that rather than implying a performance
win.

Brand exclusions and campaign negative keywords reach **Search and Shopping
inventory only**. Display, YouTube, Discover, Gmail and Maps are unreachable by
either, and need account-level content suitability exclusions instead.

### Volume floors, which are unusually well evidenced here

Two independent large datasets converge: **30 conversions a month is the floor,
60 is healthy**. Below 30, measured attainment against a target swings between
−100% and +400%, which means any judgement about whether a target is being met
is noise. One of those studies excludes sub-30 campaigns from its analysis
entirely for that reason.

**On budget, Google does publish a rule, just not where people look.** The API
documentation says to try a daily budget of **at least three times your cost per
conversion**, and warns that a budget too low relative to it produces a slower
ramp and fewer conversions. That is the sourced original of the "three times
target" rule the industry repeats without attribution. It is phrased as a
suggestion and carries no dataset, but it is a real Google statement rather than
folklore.

There is still **no absolute currency floor** anywhere official. Any specific
"minimum spend per day" figure is invented.

### Before concluding anything about Shopping

**Roughly 55% of Performance Max campaigns run without a product feed at all.**
A feedless campaign never appears in Shopping reporting, so "no Shopping
cannibalisation" is meaningless until you have checked whether a feed exists.

Brand guidelines are also irreversible once enabled, and they move the logo and
business name off the asset group. An asset-completeness check that counts only
asset-group assets will report a missing logo on every such campaign, wrongly.

### What you cannot see, and why that matters

Placement reporting for Performance Max carries **impressions and nothing else**
— no clicks, no cost, no conversions. So you can see where the ads showed and can
never prove what any placement cost. When junk placements are suspected, that
asymmetry is itself the finding: say that the cost cannot be established rather
than implying it can.

Also unavailable: performance labels for assets, any metric on asset
combinations, any metric on signals, and any split between Shopping and text ads
inside the reported "Google Search" channel. Search Partners and Display
**cannot be turned off** in Performance Max by a general advertiser — that
control remains in a closed alpha.

Note that "Display" appears as CONTENT in network reporting, and that Google
Search bundles Shopping and text ads together while excluding Maps and Discover.

Channel-level data **does not exist at all before June 2025**, at any API
version. Any comparison reaching further back silently under-reports rather than
erroring, so a window crossing that date must be clamped or refused.

### How much of what Performance Max reports is actually incremental

Vendor geo-holdout work suggests platform-reported Performance Max conversions
are plausibly **1.3 to 3 times true incremental**, with one published case
finding platform reporting overstated impact by about a third, and branded
campaigns worst affected. Those come from companies selling incrementality
measurement, so treat them as order-of-magnitude priors rather than a multiplier
to apply to anyone's numbers.

The useful part is the detection floor that comes with them: at around 100
conversions a week you can only reliably detect effects above 25%; detecting a
10% lift needs roughly 1,000 a week. On an account doing twenty conversions a
month, no incrementality claim in either direction is measurable. Say that
rather than implying a test would settle it.
`;
