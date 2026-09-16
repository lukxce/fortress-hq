/**
 * Running and judging accounts below the volume floors — which is most of the
 * accounts this analyst sees.
 *
 * Researched 2026-09-16 (Google help pages and API reference read as raw text;
 * the statistics computed with scipy and checked by simulation). The existing
 * knowledge was calibrated to larger accounts; this is what comes after the
 * floors. The same statistics now gate the engine's findings (lib/engine/stats),
 * so figures in the context pack already reflect them.
 */
export const SMALL_ACCOUNTS = `
## Accounts below the floors

"Sub-floor" here means fewer than 30 conversions in 30 days on the bidding goal.
Most accounts you see are sub-floor. That changes what can be concluded and what
can be recommended.

### What Google actually says about low volume

- Target CPA can start "with no conversion history". Fifteen conversions in 30
  days, at account level, is Google's **recommendation** for the bidding goal and
  its stated requirement for Target ROAS — not a gate on conversion bidding
  generally. For judging a Target CPA, Google asks for a period holding at least
  30 conversions.
- For thin data Google's lead-generation guidance says to "consider removing
  tCPA or starting with Maximize Conversions". It gives no numeric threshold for
  choosing Maximise Clicks or Manual CPC instead, so never claim Google recommends
  switching at a specific count. Enhanced CPC no longer exists on Search.
- Google defines "Limited by data" only in the API — "not enough conversion
  traffic over the past weeks" — with no number.
- For Performance Max lead generation with low volume, Google allows **up to six
  weeks** before major changes.
- Google gives no numbers for how Smart Bidding borrows query-level data when an
  account has little of its own, and nothing shows portfolio strategies learn
  faster than standalone ones on the same total conversions.

The one large study (Optmyzr, 14,584 accounts, 2024) found that **setting a
target was more likely to hurt than help**, and that 50+ conversions a month is
where every strategy becomes predictable. It excluded accounts spending under
$1,500 a month and is observational — but it points the same way as Google's own
low-volume advice. No controlled comparison of bid strategies at 10–40
conversions a month has been published. Say so rather than citing a number.

### Statistical honesty

At low volume the numbers on the page are much less certain than they look.

- A segment with 5 conversions has a true cost per conversion anywhere from
  **0.43× to 3.1×** what it shows (exact 95% interval). At 10 conversions,
  0.54×–2.1×; at 20, 0.65×–1.6×; at 50, 0.76×–1.35×.
- Two segments with equal spend, one with 5 conversions and one with 0, are
  **not** significantly different.
- Detecting a genuine 2× difference between two halves of an account takes about
  75 conversions in total; 1.5× takes about 210. At 20 conversions a month that
  is roughly four months and ten months, with nothing else changing — which never
  happens.
- A segment with no conversions is evidence only once it has spent several times
  the account's cost per conversion: about 3× if it is the only thing examined,
  4× across devices, 5× across weekdays, 6× across hours, 7× across fifty
  keywords. Below that, zero is what chance produces.

Findings in the input have already passed these tests. Findings labelled "not
yet evidence" or "early signal" have not: report them as things to re-check, never
as things to act on. When you reason from the raw segment or monthly figures
yourself, apply the same discipline — do not call a segment worse because its
cost per conversion is higher on a handful of conversions.

When volume is too low to judge something, the correct finding is "not enough
data to judge this yet, and here is when there will be", not a verdict.

### Never recommend these to a sub-floor account

1. **Splitting** campaigns or ad groups by match type, device, geography or hour.
   Each split lowers the data behind every piece, and Google says device splitting
   is redundant.
2. **Adding a target "to control costs"**, above all on a budget-limited campaign:
   since 17 August 2026 such a campaign spends toward its target. The exception is
   an existing target close to the real historical cost per conversion on a
   campaign that is not budget-limited.
3. **Value-based bidding** for lead generation without genuinely different lead
   values. An invented value per lead rescales the count and adds nothing.
4. **Ad, bid-strategy or Performance Max experiments** that could not finish
   within about 90 days at current volume. Google itself says to run experiments
   on high-volume campaigns.
5. **Pausing** keywords, ads, devices, days or hours for zero conversions before
   they have spent enough for zero to mean something (above).
6. **Several changes inside one conversion cycle, or any change during learning.**
   Budget, conversion-goal and campaign-composition changes can restart learning;
   target changes do not.
7. **Switching the bidding goal to a micro-conversion** — a phone-number tap,
   directions, a page view — to get over a threshold. The bidder learns to buy the
   cheapest instances of it. One small published dataset found a phone-click action
   left as primary made Performance Max look 10× cheaper per lead than Search; the
   real gap was 2×.
8. **Cross-account conversion tracking between different clients.** It is built
   for one business split across accounts. Pooling separate businesses feeds each
   client's bidding another business's conversions, and switching moves campaigns
   onto the manager account's default goals.
9. **Starting or scaling Performance Max** when the daily budget is under three
   times a realistic cost per lead, when the only primary conversions are proxies,
   or while the Search campaigns are still budget-limited.
10. **Treating missing search terms as waste** or "Low search volume" as a quality
    problem. Google hides low-volume terms for privacy at a threshold it does not
    publish, judged across all of Google search — and "Low search volume" is
    judged on *worldwide* volume over twelve months, unrelated to bids, quality or
    ads. In a small city a large share of cost will never be attributable to a
    visible search term.
11. **Switching a small city to "presence" targeting, or widening the radius,
    without measuring the trade-off.** No credible figure exists for how much
    "presence or interest" leaks for local services; the account's own location
    reports show it. Google warns that small areas can have too little reach.

### Budget and impression share at low volume

Before recommending more budget from lost impression share, turn the share into
conversions: extra conversions ≈ impressions × (lost share ÷ current share) ×
click-through rate × conversion rate. At 400 impressions a month, 50% share and
20% lost to budget, with 8% CTR and 10% conversion rate, that is about **1.3
conversions a month**. If the gain is under two a month, say so in absolute terms.
Google says lost impression share to budget is not meaningful for Maximise
Conversions or Maximise Conversion Value, which are limited by budget by design.
Where spend has risen before, the account's own **marginal** cost per conversion —
what the extra conversions cost, not the average — is the number that decides it.

In a thin auction, Ad Rank thresholds rather than competitors set the price. An ad
that is the only one eligible still pays the reserve price, which depends on ad
and landing-page quality. Improving quality lowers cost more directly than bid
changes.

### Performance Max overlap is the default, not an edge case

In Optmyzr's study of 503 accounts, 91% had Performance Max serving on search
terms identical to their Search campaigns' keywords — exact match included —
despite Google's stated priority. The likely cause is the Search campaign being
ineligible at that moment (budget, location, schedule), though that was not
tested. Assume brand and core terms leak into Performance Max and check.

### Serbia

- Google has **96.5%** of Serbian search (StatCounter, August 2026). Bing is
  irrelevant here.
- **Campaign language targeting is being removed from Search in late September
  2026**; Search ads will match on the language of the ad. Stop flagging a
  language setting on Search after that; ad copy and its script become the
  control. The setting still applies to Performance Max's non-Search inventory.
- Close variants include accents in every language, so "nis" and "niš" match.
  Serbian is **not** on Google's list for reordered, function-word or implied-word
  variants. **Google says nothing about Cyrillic versus Latin**: whether "клима"
  matches "klima" is unknown. Check the account's own search terms for Cyrillic
  queries before assuming either way.
- Not available for Serbian accounts: call reporting and calls-from-ads
  conversions, call recording, Local Services Ads, Shopping and Merchant Center
  (Serbia and the dinar are not supported). Lead form assets are very probably
  unavailable too — Google's country table is ambiguous, so say "verify in the
  interface" rather than asserting. All of these are available to the US account.
- Customer Match can only be used for observation and exclusion by accounts under
  $50,000 lifetime spend, which is every account in this portfolio. Never
  recommend targeting with customer lists.
`;
