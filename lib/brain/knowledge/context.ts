/**
 * The operating context these accounts actually live in.
 *
 * Almost all published Google Ads guidance assumes enterprise budgets, hundreds
 * of conversions a month, and a mature English-language auction. None of that
 * describes a €500/month klima servis in Niš, and applying that guidance
 * unaltered is how these accounts get broken. This block exists so the analysis
 * never recommends something that is structurally impossible here.
 *
 * Fact-checked 2026-09-16 against Google's call-conversion and Local Services
 * country pages, IAB Serbia AdEx 2025 and Serbian VAT guidance. The main
 * correction: calls are only *partly* untrackable here — two click-based call
 * conversion types need no forwarding number.
 */
export const OPERATING_CONTEXT = `
## The accounts you are analysing

Small local service businesses, mostly Serbia and the wider Balkans: air
conditioning installation and service, electricians, painters, heating, dentists,
cleaning. Budgets run from a few hundred to a few thousand euros a month.
Conversion volume is typically 10–40 a month, sometimes less.

That combination invalidates most published advice. Weight the following facts
above anything general you know.

### Phone calls can only be partly tracked natively in Serbia

Google forwarding numbers are **not available in Serbia, Croatia, Bosnia,
Montenegro, North Macedonia, Slovenia, Bulgaria or Greece**. Call assets work and
display the real number. What does not work is call reporting (call details and
duration), the "calls from ads" and "calls to a website number" conversion types,
and call-conversion import — all of those need a forwarding number.

Two native options do work without one: **clicks on call ads and assets**, where
Google estimates whether a meaningful call followed, and **clicks on a phone
number on the mobile website**. Both count taps or estimated calls, not answered
calls, and neither knows the call's length or outcome.

Balkan tradesmen are typically contacted by phone — treat that as an assumption
to confirm with the operator, not a measured fact. So unless calls are counted,
through one of those click-based actions or through third-party call tracking
with number insertion, the account is optimising against part of its real
pipeline and the conversion figures understate performance by an unknown amount.
Never diagnose "low conversions" without establishing whether calls are counted
at all, and how. Where they are not, say so explicitly — it reframes every
efficiency number on the page. And where a phone-tap action is the only phone
signal, never recommend demoting it just because it dominates the count.

Consent rules split this region. Slovenia, Croatia, Bulgaria and Greece are in
the EEA, where Google's EU user consent policy and Consent Mode apply. Serbia,
Bosnia, Montenegro and North Macedonia are not. Only attribute a conversion drop
to consent for traffic from the EEA.

Local Services Ads do not exist anywhere in the Balkans either. Ignore any
reasoning that depends on them unless the account is in one of the specific
markets Google lists: the US, Canada, the UK, Ireland, Austria, Belgium, France,
Germany, Italy, the Netherlands, Spain or Switzerland.

### The auction is frequently empty, and volume is the binding constraint

Serbian paid search is roughly €31.6M a year across the whole country (IAB
Serbia AdEx 2025, up 17% on 2024), about €5 per internet user annually. Spot
checks in September 2026 showed no ads on high-intent trade queries such as
"servis klima uređaja niš" and "vodoinstalater beograd hitno", while dentistry
appeared more competitive. A live search is weak evidence — ads can be missing
because of schedules, exhausted budgets or location — so confirm with Auction
Insights, Ad Preview and Keyword Planner bid ranges before asserting that an
auction is empty.

Where the auction is thin, the usual playbook inverts: clicks are cheap because
few are bidding, and the scarce resource is search volume, not budget.
Recommendations premised on competitive pressure, aggressive bid ceilings or
squeezing CPC then solve a problem the account does not have, and restricting
targeting further can reduce it to no traffic at all. The market is growing,
though, so check Auction Insights rather than assuming the auction is still
empty.

### Value-added tax can make clicks 20% more expensive than they look

Google invoices Serbian advertisers from Ireland without VAT. The Serbian buyer
owes 20% VAT on it themselves — including a *paušalac* outside the VAT system,
who cannot deduct it. For them the effective cost per click is 1.2× the auction
price, and the VAT never appears on the Google invoice. It is recoverable only
if whoever pays the Google invoice is VAT-registered, which in an agency or
rank-and-rent arrangement may not be the tradesman. Any break-even or target-CPA
reasoning should account for this when the operator raises it.

### "Klima Servis Niš" is not a brand

Names like Klima Servis Niš, Moler Pro Niš and Elektro Servis Niš are
service-plus-city phrases, not brands. Traffic on them is genuinely contested
generic demand, not free clicks the business would have won anyway.

Two consequences. Bidding on them is defensible in a way that true brand bidding
usually is not. And their low cost per conversion must never be used as evidence
that the account is efficient — report them as non-brand, and if they are
inflating a blended figure, say so.
`;
