/**
 * AI Max for Search — live migration knowledge.
 *
 * Campaign-level broad match and automatically created assets are being
 * auto-migrated during September 2026 with no opt-out, so this is happening to
 * these accounts right now. Everything here is either Google's own
 * documentation or a named measured study, with the two kept apart because the
 * gap between them is large.
 */
export const AI_MAX = `
## AI Max, which is migrating right now

Campaign-level broad match and automatically created assets are being converted
to AI Max through September 2026. There is no opt-out of the conversion itself.
Dynamic Search Ads follow in February 2027.

### What it changes

Broad match expanded outward from a keyword's text. AI Max matches on inferred
intent, through two separate arms: expansion seeded by your keywords, and
keywordless matching derived from landing page content and ad assets with no
keyword involved at all. Those two arms run roughly half and half.

**Keywords become hints, with one exception.** On a query literally identical to
an exact-match keyword, that keyword still wins. Everything else is decided by
AI ad-group selection, and Google's own documentation says keywords "may not
automatically be prioritized" once a search is not technically identical — which
includes anything arriving via AI Overviews, AI Mode, Lens or autocomplete.

Measured erosion, from the largest study available (383 million impressions,
European e-commerce): exact-match impressions fell from effectively all of them
to about 71%, meaning **roughly 29% of what reports as exact match is actually
AI Max expansion**. Most of that shift happened in four months.

### The trap that catches people remediating it

bundling_required is a one-way ratchet. Once a campaign has used AI Max,
**turning the master toggle back off also disables your brand inclusions and
exclusions**, and causes URL inclusions and exclusions to be ignored.

So the intuitive fix — switch AI Max off to get back to normal — silently
removes the guardrails that were containing it. The correct containment is to
leave the master toggle on and disable search term matching per ad group
instead. Reverting also leaves converted keywords in a removed state that must
be reinstated by hand at their original match types.

### The two migration cohorts land differently

Campaigns arriving from automatically created assets get **both search term
matching and text customisation switched on**. Campaigns arriving from
campaign-level broad match get search term matching only. So the first cohort is
a substantive change and the second is closer to relabelling, and an account
will contain both. Do not assume uniform settings across campaigns.

### What the evidence actually says

Google has published four uplift figures against four different baselines — 14%,
27%, 7% and 15% — none with a disclosed sample size or method, and **every one
excludes retail**. The 7% is not a revision of the 14%; it compares the full
feature set against search-term-matching alone, not against keyword search.

The best-controlled independent study (23 tests, 16 mature advertisers, nine
months) found 7% more conversion value at campaign level, but **54% of the
"new" queries were already being captured by other campaigns in the same
account**. True account-level incremental uplift was around **3%**.

The negative headlines — 35% lower return, more than double the cost per
conversion — are real measurements, but nearly all of them compare match types
*within* a campaign, and that method is unsound precisely because AI Max traffic
is mis-booked onto exact and phrase rows. Treat roughly 3% incremental as the
honest anchor, not the marketing figure and not the horror stories.

### What it does to small, low-volume accounts

This matters more than the headline numbers for these accounts. In a
fourteen-month parallel test on a low-volume local services account, AI Max
delivered **$158 of $10,457 total spend**. It did not damage the account; it
barely participated in it.

Two documented reasons. Google states AI Max is ineffective on a campaign
limited by budget, because it spends what is left after existing keywords serve.
And below roughly 30 conversions a month its behaviour is erratic, with 100+ a
month needed for a reliable read.

So on a small local account the realistic prior is **inert rather than
destructive**. Monitor what share of spend it actually takes before recommending
anything drastic. One single-account report did find cost per conversion staying
elevated even after switching AI Max off, which would mean the bid model keeps
favouring what it learned — worth watching for, but it is one account and
unconfirmed.

### What breaks for diagnosis

Since May 2026 the search terms report shows **inferred intent rather than the
string the user typed** for AI-derived searches. Google has not said how much
interpretation happens or whether modelled terms are distinguishable. Any
analysis keyed on literal query text is now working on approximations of unknown
fidelity, and should say so rather than implying precision.

Negative keywords still work, but the precise formulation matters: they are
**under-inclusive, not circumvented**. A negative reliably blocks the literal
string it matches and cannot block an intent that resurfaces under different
wording. Negative keyword management therefore becomes the primary targeting
mechanism rather than a cleanup task, and high-value queries need their
misspellings added explicitly.

### Containment that actually works

Disabling search term matching per ad group. Setting branded searches to
unbranded-only on non-brand campaigns. Manual cost-per-click, which Google
confirms limits AI Max's capabilities outright. And keeping the Search Partner
Network share in view — the normal range is 3–8% of impressions, and one
documented campaign put half its impressions there converting at 0.07% against
3.04% on Google search proper.

**Do not cut budget during migration.** AI Max is inert on a budget-limited
campaign, so starving it produces an uninterpretable test rather than a safer
one. Tighten targets instead.
`;
