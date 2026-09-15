/**
 * The operating context these accounts actually live in.
 *
 * Almost all published Google Ads guidance assumes enterprise budgets, hundreds
 * of conversions a month, and a mature English-language auction. None of that
 * describes a €500/month klima servis in Niš, and applying that guidance
 * unaltered is how these accounts get broken. This block exists so the analysis
 * never recommends something that is structurally impossible here.
 */
export const OPERATING_CONTEXT = `
## The accounts you are analysing

Small local service businesses, mostly Serbia and the wider Balkans: air
conditioning installation and service, electricians, painters, heating, dentists,
cleaning. Budgets run from a few hundred to a few thousand euros a month.
Conversion volume is typically 10–40 a month, sometimes less.

That combination invalidates most published advice. Weight the following facts
above anything general you know.

### Phone calls cannot be tracked natively in Serbia

Google forwarding numbers are **not available in Serbia, Croatia, Bosnia,
Montenegro, North Macedonia, Slovenia, Bulgaria or Greece**. Call *assets* work
and display the real number; call *reporting* and *call conversions* do not.

Balkan tradesmen are contacted overwhelmingly by phone. So unless third-party
call tracking with number insertion is running, the account is optimising
against a minority of its real pipeline, and the conversion figures understate
performance by an unknown amount. Never diagnose "low conversions" without
establishing whether calls are counted at all. Where they are not, say so
explicitly — it reframes every efficiency number on the page.

Local Services Ads do not exist anywhere in the Balkans either. Ignore any
reasoning that depends on them unless the account is in the US, Canada, UK,
Ireland, or Western Europe.

### The auction is frequently empty, and volume is the binding constraint

Serbian paid search is roughly €31.6M a year across the whole country (IAB
Serbia AdEx 2025), about €5 per internet user annually. Live checks in
September 2026 returned **zero ads** on high-intent trade queries such as
"servis klima uređaja niš" and "vodoinstalater beograd hitno". Dentistry is the
exception and has real competition.

The consequence inverts the usual playbook: clicks are cheap because nobody is
bidding, and the scarce resource is search volume, not budget. Recommendations
premised on competitive pressure, aggressive bid ceilings or squeezing CPC are
usually solving a problem this account does not have. Restricting targeting
further in a thin auction can reduce an account to no traffic at all.

### Value-added tax makes clicks 20% more expensive than they look

Most of these businesses are *paušalac* and outside the VAT system, so the 20%
Serbian VAT on advertising is unrecoverable. Their effective cost per click is
1.2× the auction price. Any break-even or target-CPA reasoning should account
for that when the operator raises it.

### "Klima Servis Niš" is not a brand

Names like Klima Servis Niš, Moler Pro Niš and Elektro Servis Niš are
service-plus-city phrases, not brands. Traffic on them is genuinely contested
generic demand, not free clicks the business would have won anyway.

Two consequences. Bidding on them is defensible in a way that true brand bidding
usually is not. And their low cost per conversion must never be used as evidence
that the account is efficient — report them as non-brand, and if they are
inflating a blended figure, say so.
`;
