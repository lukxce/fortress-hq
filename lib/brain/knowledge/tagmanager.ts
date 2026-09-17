/**
 * Tag Manager and the conversion plumbing: how a click becomes a counted
 * conversion, and every place the chain breaks.
 *
 * Written against what the engine can actually observe — the live container
 * version (tag types googtag, gaawc, gaawe, awct, gclidw, sp, html; their
 * parameters, firing and blocking triggers, paused flag and consent settings),
 * the version's first-seen date, and a site check that reads the page HTML and
 * the public gtm.js. Fact-checked claim by claim on 2026-09-17 against the Tag
 * Manager help centre (publishing, pausing, triggers, conversion linker, consent
 * settings), the Google Ads help centre (counting, windows, transaction IDs,
 * auto-tagging, consent-mode modelling, enhanced conversions, EEA consent
 * update), Google's tag-platform developer docs (consent mode, server-side
 * tagging, tag gateway), business.safety.google's cookie table, WebKit's
 * tracking-prevention page and Mozilla's query-stripping docs. Two common
 * practitioner claims were dropped as unverifiable: a "5% uplift" for enhanced
 * conversions with no Google source, and Firefox stripping the gclid (Mozilla's
 * own list does not include it).
 */
export const TAG_MANAGER = `
## Tag Manager and the conversion plumbing

### What the site actually runs

The snippet on the page loads \`googletagmanager.com/gtm.js?id=GTM-…\`, and that
file is the **live version** of the container — nothing else. Edits sit in a
workspace as a draft; "Publish" freezes the draft into a version and makes it
live (Tag Manager help: changes must be published "to make those changes
operational"). A tag that exists only in a workspace does nothing, however
correct; a published container whose snippet is not on the page also does
nothing. Preview runs the *draft*, so "it works in preview" says nothing about
live. Pausing is itself a change — Google says paused/unpaused tags must be
saved **and published** — so a paused flag in the live version means off.
Built-in triggers (All Pages, Initialization, Consent Initialization) never
appear in the trigger list; in the API their IDs are at or above 2147479000. A
tag whose only firing trigger is any other ID that no longer exists is dead.

### The three IDs and the Google tag

- **GTM-…** is a container: a delivery mechanism, not a destination.
- **G-…** is a GA4 web stream's measurement ID. It is also the Google tag's tag
  ID: since early September 2023 the GA4 Configuration tag (gaawc, keyed by
  measurementId) was auto-migrated to the Google tag (googtag, keyed by tagId),
  and one Google tag can carry Google Ads as a second destination.
- **AW-…** is an Ads account's conversion tracking ID; each conversion action
  adds a label. Tag Manager stores the AW number without its prefix.

Ads conversion tags run on top of the Google tag, which Tag Manager loads
before an awct fires. A Google tag installed twice doubles exactly what fires
twice: each load sends a **page_view**, so views,
engagement and any key event defined from page views double, and anything
imported from those key events into Ads doubles with them. A GA4 event tag
(gaawe) doubles only if it is duplicated too, or if the container snippet is on
the page twice — then every tag inside fires twice. Hard-coded gtag.js plus a
Google tag for the same G- in the container is the usual shape.

### The Ads conversion tag (awct)

Parameters: conversionId, conversionLabel, optional value and currency, and
transaction ID. Two dedup mechanisms solve different problems. **Count** is per
action: "Every" counts each conversion after an ad interaction, "One" counts one
per ad click — Google recommends Every for sales and One for leads (a reload or
second form after the same click is not a second lead). **Transaction ID**
deduplicates the same order across tags and imports: Google keeps the first and
discards later ones with the same ID, so a static ID makes every conversion
after the first look like a duplicate. Windows (Google Ads help):
click-through default **30 days**, range 1–90; view-through default **1 day**;
engaged-view 3 days. View-through does not exist for Search — it is Display,
Video and App only — so a Search lead account is 100% click-attributed.
Only **primary** actions enter the Conversions column and steer bidding;
secondary ones sit in All conversions — except inside a custom goal, where any
action is bid on regardless of flag.

### Conversion linker, gclid and auto-tagging

Auto-tagging appends \`?gclid=…\` to the final URL at click time. The conversion
linker (gclidw) reads it on the landing page and writes first-party cookies
(\`_gcl_aw\`, \`_gcl_gs\`, plus local storage \`_gcl_ls\`); Google's cookie table
lists every \`_gcl_*\` cookie at **90 days**, which is also how long Google keeps a
gclid for uploads. A container that loads a Google tag on every page needs no
separate linker (Tag Manager help); one with awct tags but neither an all-pages
Google tag nor a linker attributes nothing. Redirects that drop query parameters
break the chain before the linker runs: Google's auto-tagging page requires the
gclid to reach the final landing page and notes a small percentage of sites
reject unknown parameters outright. Cross-domain journeys need the linker's
"enable linking across domains", which carries the click ID in \`_gl\`. URL
passthrough is the consent-mode variant: with consent denied, gclid, dclid,
gclsrc, _gl and wbraid are appended to same-domain links so a later page can
still attribute without a cookie.

### Browsers

WebKit (Safari, all iOS browsers): all third-party cookies blocked; cookies and
storage written by script expire after **7 days** without a site visit, and when
the landing URL carries link decoration from a domain classified as a tracker,
cookies written by script on that page are capped at **24 hours**. A gclid
landing is exactly that pattern (confidence: high on the rule, medium on it
applying to every Google referral). A 30-day click window is therefore honoured
only where the browser keeps the cookie; on Safari a lead that returns a week
later is unattributed, so Safari-heavy audiences under-report. Firefox strips
query parameters only in ETP *Strict* (off by default), and its list excludes
gclid.

### Consent Mode v2

Four consent types: \`ad_storage\`, \`analytics_storage\`, and since November 2023
\`ad_user_data\` and \`ad_personalization\`. Google's EEA update requires consent
signals for measurement, personalisation and remarketing from EEA end users;
Serbia is outside the EEA, so a Serbian site with Serbian traffic is not
covered, but any site with EEA visitors is. **Basic** implementation blocks Google
tags until consent, so nothing is sent for the denied — modelling then uses a
general model. **Advanced** loads tags with denied defaults and sends cookieless
pings, which enables advertiser-specific modelling; but Ads modelling needs
**700 ad clicks a day over 7 days per country-and-domain grouping** (Google Ads
help), which none of these accounts reaches. Without consent mode, EEA users who
decline produce no conversion at all. Per-tag settings map to the API's
consentStatus: NOT_SET ("no additional consent checks"), NOT_NEEDED, and NEEDED,
which fires only if every listed consent type is granted at trigger time. Google
Ads and GA4 tags already carry built-in checks; NEEDED is a second gate, and a
NEEDED awct behind a banner most people ignore is a tag that rarely fires.

### Enhanced conversions

For web: hashed (hex SHA-256) email, phone, name or address sent with the
conversion so Google can match a signed-in user when cookies cannot. For leads:
the hash captured at form submit is matched to the same hash uploaded later with
the offline outcome; uploads more than 63 days after the click are dropped.
Google's figure (blog, 10 Sep 2026): an average **11% more Search conversions**
than standard imports — a self-reported average, not a controlled result;
confidence medium, and unmeasurable in a 20-lead-a-month account.

### Triggers that matter here

Page View fires as the container loads, DOM Ready after the HTML is parsed,
Window Loaded after images and scripts — a tag that reads page elements needs
DOM Ready or later. Click – Just Links with Click URL starting \`tel:\` is the
one reliable call trigger on a mobile site. Form Submission listens for the
browser's submit event, so forms sent by JavaScript (AJAX, most page builders)
never fire it, and without "Check validation" it fires on failed attempts too;
Google's own answer for such forms is a Custom Event pushed to the dataLayer.
Element Visibility (default 50% visible, "Observe DOM changes" on) catches an
inline thank-you message. A thank-you page trigger is the most
reliable of all because a redirect cannot be half-done — but it fails wherever
there is no redirect (single-page apps, inline success messages) and
over-counts wherever the page is reachable by URL or reload with Count = Every.
History Change is the SPA substitute. A blocking trigger beats any firing
trigger: "All Pages" with the thank-you URL as an exception never fires there.

### What the site check cannot see

Server-side Tag Manager runs on the operator's own domain: the browser sends
events there and the server forwards them, so the page shows no AW- or G- hits,
and gtm.js may be served from a first-party path (Google tag gateway, generally
available since May 2025, can even hide the container ID). Consent platforms
that inject tags after acceptance are equally invisible to a plain fetch. An ID
not found on the page while conversions or sessions still arrive is "receiving
but not seen", not missing.

### Signatures

| What you see | What to suspect |
|---|---|
| Conversions fall or stop within a day or two of a container version's first-seen date | The publish. Diff the versions: a trigger renamed, a tag paused, a consent gate added, a Google tag removed |
| GA4 key event fires, matching Ads conversion does not | Separate tags: the gaawe has a trigger, the awct has none, is paused, or is NEEDED behind consent. If the Ads action is an Analytics import, allow 24 hours first |
| Exactly 2× per lead, or two actions with identical daily counts | Same submission counted twice: two awct tags, an import plus a tag, or Count = Every on a reloadable thank-you page |
| Conversion rate implausibly high, conversions ≈ clicks | The awct fires on All Pages or a Page View trigger with no URL condition |
| Ads conversions arrive, GA4 shows no sessions | The Google tag is missing or carries the wrong ID; the awct only needs the linker to work |
| awct tags present, no gclidw and no all-pages Google tag | Nothing links the click to the conversion; direct-typed and Safari journeys vanish first |
| Live tag with no firing trigger, or only a deleted trigger ID | Configured, never runs. An awct or googtag here is a measurement hole; html is usually harmless |
| A G- in the page HTML and the same G- as a googtag in the container | Double page views; GA4 engagement and page-view key events inflated, and anything imported from them |
| consentModeSeen false on a site with EEA traffic | Declined EEA users produce no conversion; the gap is real loss, not modelling |
`;
