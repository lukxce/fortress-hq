/**
 * Lead-generation measurement: what a local service account can and cannot
 * count, and the mistakes that corrupt the number bidding steers by.
 *
 * Researched 2026-09-16 against the Google Ads API v25 reference, the Data
 * Manager API docs and Google's help pages. The previous knowledge base had no
 * coverage of offline conversion import or enhanced conversions at all, which
 * for a lead-generation portfolio is the single most consequential gap: it is
 * the only mechanism that tells bidding which leads became paying jobs.
 */
export const LEADGEN = `
## Measuring leads

### The one-stage rule

A lead account has a funnel — form or call, qualified lead, booked job — and
Google says to bid toward **one** stage of it, not several. Every stage can be
recorded; only one should be primary. Two biddable stages double-count the same
customer and teach bidding that the account converts twice as well as it does.

Primary actions feed the Conversions column and bidding; secondary actions sit in
All conversions only. **Exception:** any action inside a custom goal is biddable
whether it is marked primary or not, so check custom goals before trusting the
primary flags.

### Mistakes that corrupt the signal, in rough order of how often they occur

- **The same form counted twice**: a GA4-imported key event and a Google Ads tag
  both primary for one submission, or a CMS plugin tag plus a hand-placed tag.
  Google says one primary only. The tell is two lead actions whose daily counts
  move together.
- **Thank-you page reloads** counted again. Fixed by counting "One" per click and
  a transaction ID. Google states "One" is the right counting for leads — except
  for imported conversions carrying the app-click identifiers (gbraid/wbraid),
  which require "Every".
- **Phone-number taps counted as leads.** A click-to-call conversion counts
  **taps, not calls**: no duration, no answer, no outcome. Where it is the only
  phone signal it is still worth keeping (see the operating context), but it must
  never be described as calls.
- **Contact-page views, directions requests and outbound clicks** marked primary.
  A page view is not a submitted lead, and for a service-area business a
  directions request on Google Maps is not a lead either.
- **WhatsApp and Viber link clicks counted as conversations.** A click opens the
  app; whether a message was sent is unknown. Google's native message assets cover
  WhatsApp and SMS but not Viber, are in beta, and are unconfirmed for Serbia.
- **Spam form submissions.** Every junk submission is a conversion bidding learns
  from. Google recommends reCAPTCHA, server-side validation and lead-specific
  categories. No published figure exists for how much of a typical account's lead
  volume is spam — look for sudden conversion-rate spikes without a matching rise
  in real enquiries.

### Calls

Google forwarding numbers exist in 29 countries, not including Serbia or any
other ex-Yugoslav state; they do include the US. Without them there is no call
duration, no "calls from ads" with a minimum length, no website call conversions
and no call import.

Google's help page on call conversions contradicts itself on whether a country
without forwarding numbers still gets **estimated** call conversions from call
assets. Treat that as unresolved for Serbian accounts: if a call-asset conversion
action exists and is recording, it is an estimate of calls, not a count.

For the US account, forwarding numbers work, so there is no reason not to count
calls from ads with a sensible minimum length.

### Offline conversion import — telling bidding which leads became jobs

This is the highest-leverage measurement improvement available to a lead account
that has a CRM or even a spreadsheet of booked jobs, because it is the only way
to stop bidding from treating a spam lead and a paying customer as equal — and the
only way to take junk back out of the signal after the fact.

What it involves: the site keeps the click identifier (gclid) with each lead, the
business marks which leads qualified or became jobs, and those are uploaded to
conversion actions in the QUALIFIED_LEAD or CONVERTED_LEAD categories.

Constraints worth knowing before recommending it:
- **New integrations must use Google's Data Manager API.** Since 15 June 2026 the
  Ads API's click-conversion upload refuses credentials that were not already
  uploading between December 2025 and June 2026.
- Uploads are refused if the click is **more than 90 days old** (63 days for
  enhanced conversions for leads) or **less than about 6 hours old**, and if the
  click is older than the conversion action's own lookback window. A window
  shorter than the business's real lead-to-job time silently rejects the
  conversions that matter most.
- Google says to upload daily, that late uploads are deprioritised by bidding, and
  to keep a new import action **secondary for the first 2–3 weeks** (1–2
  conversion cycles) before making it primary.
- Values can be restated or conversions retracted for up to **54 days**, and not
  earlier than 24 hours after the conversion. Retractions only count for bidding
  if made within 7 days.
- The upload health is readable in the API (a status of excellent, good, needs
  attention, or no recent upload). A diagnostic that says "good" can still hide
  enhanced-conversion uploads whose clicks were never found — Google counts those
  as successful.

Whether bidding toward qualified leads fits a small account depends on volume at
that stage: Google's guidance for value-based bidding is **at least 15 conversions
in 30 days at the biddable stage and at least two genuinely different values**.
Below that, bid toward form or call leads and use the imported outcomes for
measurement, or use Target CPA on qualified leads if they alone clear the volume.
No published study shows value bidding beating cost-per-lead bidding at 10–40
leads a month.

### Enhanced conversions

Enhanced conversions send hashed customer details (email, phone) alongside a
conversion so Google can match it to a signed-in user. For leads, the hashed
details captured at form submission are matched against the hashed details
uploaded later with the outcome. Google now calls click-identifier-only import a
legacy approach, though the gclid is still strongly recommended.

Since June 2026 enhanced conversions are a single on/off setting per account,
accepting data from the tag, the Data Manager API and the Ads API at once. It
requires accepting Google's customer data terms. Phone numbers must be in
international format before hashing (a Serbian number becomes +381 without the
leading zero), and for Gmail addresses the dots and any "+suffix" are removed.

Its diagnostics are only in the Google Ads interface — **there is no match-rate
field in the API** — and Google shows no alerts below about 20 conversions in 7
days, which is most of these accounts. Absence of a warning is not evidence it
works.

### Consent

Google's EU user consent policy covers the EEA, the UK and Switzerland. **Serbia
is outside it**; whether Serbian law (ZZPL) separately requires cookie consent is
disputed and a question for a Serbian lawyer, not for this analysis. Consent-mode
conversion modelling needs about **700 ad clicks over 7 days per country and
domain**, so these accounts have no modelled conversions — never explain a
conversion gap by modelling. The US account is not subject to Google's consent
requirement either.
`;
