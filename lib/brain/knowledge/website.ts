/**
 * Website performance and landing pages: what the PageSpeed numbers mean, how
 * much speed is worth, and what a landing page must do for a paid click.
 *
 * Built from Google's primary documentation (web.dev metric and optimisation
 * guides, Lighthouse scoring and variability docs, CrUX methodology, PageSpeed
 * Insights API notes, Search Central's page-experience page, Google Ads help on
 * Quality Score, ad quality and Ad Rank), the conversion evidence Google itself
 * publishes (Google/Deloitte 2020, Google/SOASTA 2017, the Vodafone A/B test)
 * and two form-length datasets. Every claim was checked against those pages on
 * 2026-09-17; that pass dropped a "4% per extra field" rule with no traceable
 * origin and the folklore that Below average landing-page experience halves
 * eligibility, which Google nowhere states. Mechanisms, sourced numbers and
 * detection patterns only. Nothing here is advice.
 */
export const WEBSITE = `
## Website performance and landing pages

### Two kinds of number, never to be mixed

The speed input carries a **lab** run and, where it exists, **field** data.

- Lab: one Lighthouse run from Google's servers on a simulated mid-tier phone
  (Moto G4 class, CPU slowed 4x, 1.6 Mbps / 150 ms "slow 4G"; Lighthouse
  throttling docs, high). Repeatable, but a simulation.
- Field: what real Chrome users got over a **28-day rolling window** at the
  **75th percentile** — 75% of loads were at least this good (CrUX API docs;
  high). This is what Google's page-experience systems use.

**Core Web Vitals thresholds** (web.dev/vitals; high): LCP good ≤ 2.5 s, poor
> 4 s. INP good ≤ 200 ms, poor > 500 ms. CLS good ≤ 0.1, poor > 0.25. INP
replaced FID on 12 March 2024. TTFB is not a vital; its own bands are ≤ 0.8 s
good, > 1.8 s poor. A page "passes" when LCP, CLS and INP are all Good at p75;
with no INP data it passes on LCP and CLS alone (PSI API docs; high).

### Field data on a small site

CrUX only publishes a URL once it clears an undisclosed popularity threshold,
and the origin once the whole site does (CrUX methodology; high). PageSpeed
then falls back to origin data and flags it (\`origin_fallback\`); the input
labels this \`fieldScope: site\`. A site-level figure is the traffic-weighted
mix of every page, not the landing page's number. No field data at all means
too few Chrome visitors to measure — it says nothing about speed. A fix takes
up to 28 days to show fully in the field.

### The Lighthouse score

Weights (Lighthouse 10+; high): TBT 30%, LCP 25%, CLS 25%, FCP 10%, Speed
Index 10%. Bands: 0–49 red, 50–89 orange, 90–100 green. So the score is mostly
main-thread blocking and the largest paint; a page can score badly while its
field vitals pass.

Google's variability doc rates page nondeterminism, network and client
contention as **high** variance sources even on PageSpeed's servers, and says
the median of five runs is only "twice as stable as one run". Treat one run
as ± several points: **50 versus 60 from single runs is not a finding**; a
20-point move, or a band change confirmed in the field, is.

### When lab and field disagree (web.dev lab-and-field; high)

Lab worse than field: real visitors have warm caches and bfcache restores;
the throttled phone is slower than most of the audience; field LCP stops at
the first interaction while lab waits for the full load. Typical of
desktop-heavy or repeat traffic — the lab number overstates the problem.

Field worse than lab: slow networks or low-end devices; a different largest
element per viewport; shifts and long tasks that only happen on scroll or tap
(lab measures TBT; nobody taps). Poor field INP with low lab TBT puts the cost
in interaction handlers or late scripts, not startup. Field is what users had;
lab explains why.

### Ranking

Search Central (page-experience doc, updated Dec 2025): Core Web Vitals "are
used by our ranking systems", there is "no single signal", and Google "always
seeks to show the most relevant content, even if the page experience is
sub-par" — page experience "can contribute" where lots of helpful content
competes. John Mueller, Aug 2021: "more than a tie-breaker, but it also
doesn't replace relevance" (high). Attribute a ranking move to CWV only when
content and links are unchanged and a vital crossed a threshold.

### Conversion

- Google/Deloitte "Milliseconds Make Millions", 2020: 37 retail, travel,
  luxury and lead-gen brands, 30 M sessions, 30 days, no redesigns. Per 0.1 s
  faster mobile load: retail conversion +8.4%, travel +10.1%, lead-gen form
  progression +21.6%. **Correlational** — fast pages may simply be the
  better-run sites (medium for direction, low for magnitude).
- Vodafone A/B test, 2021 (web.dev): 50/50 split of paid traffic, 31% better
  LCP → sales +8%, lead-to-visit +15%. Causal but one site (medium).
- Google/SOASTA 2017, ML model over 11 M ad landing pages: bounce probability
  +32% from 1 s to 3 s, +123% from 1 s to 10 s. Modelled, nine years old,
  and bounce is not conversion (medium for direction only).

All of it is retail-heavy; evidence for local lead-gen is thin. Speed is
evidenced to matter where a mobile-heavy page is already poor (> 4 s LCP,
poor INP); trimming 2.0 s to 1.6 s on a contact page has no evidenced payoff.

### Landing page experience in Google Ads (help pages; high)

One of three Quality Score components, defined by "the usefulness and
relevance of information", "ease of navigation", "the number of links on the
page" and "the expectations users have based on the clicked ad"; Google's
guidance adds mobile-friendliness and load speed. Speed is one input among
several, with no published weights. Quality Score itself is "not an input in
the ad auction", but the same components feed Ad Rank: ads must "meet a
certain level of quality in order to be shown", "higher quality ads typically
cost less per click", and some assets need enough quality to appear. Below
average means those effects are plausibly in play; Google gives no size.

### What the page itself must do — evidence versus folklore

- **Message match**: Google's factor list includes ad expectations and its
  guidance says the page should "closely match your ad and keywords" (high
  as a mechanism). The 10–30% lift figures are vendor claims (low).
- **Form length**: HubSpot's 40,000-page dataset found conversion falls only
  "slightly" with more single-line fields but sharply with textareas and
  dropdowns. Unbounce's data shows a fall from 1 to 7 fields then a rise at
  10 — longer forms can self-qualify. The famous 11→4 fields "+120%" is
  Imagescape's own single test. A field count is not a diagnosis; textareas
  and dropdowns are (medium).
- **Click-to-call on mobile**: Google says call assets "can significantly
  increase clickthrough rates" and publishes no conversion figure. For a
  service business whose money action is a call, a phone number that is not
  a tap target on mobile is a mechanical defect, not a preference (high).
- **Above the fold**: NN/g eyetracking, 2018: 57% of viewing time is in the
  first screenful, 74% in the first two. The primary action belongs there;
  content below is seen by a minority (high for the pattern).

### What the opportunities mean (web.dev optimise guides; high)

| Lighthouse says | Cause in plain terms | Metric hit |
|---|---|---|
| Image elements do not have explicit width and height | Images without dimensions; page reflows as they arrive | CLS |
| Eliminate render-blocking resources | CSS/JS in <head> that must load before anything paints | FCP, LCP |
| Reduce JavaScript execution time / Minimise main-thread work / Reduce the impact of third-party code | Chat widgets, consent banners, GTM tag bloat, embeds | TBT, INP |
| Largest Contentful Paint element / Preload LCP image | Hero image too big, lazy-loaded, or only referenced from CSS; TTFB is ~40% of a good LCP | LCP |
| Serve static assets with an efficient cache policy / Use a CDN | No caching headers, single distant origin | repeat LCP, TTFB |
| Ensure text remains visible during webfont load | Fonts swap in and change size; font-display and size-adjust fix it | CLS, FCP |
| Reduce initial server response time | Hosting, no page cache, slow CMS — not the front end | TTFB → LCP |

### Signatures

| What you see | What to suspect |
|---|---|
| Mobile converts far worse than desktop, and only the mobile run is slow | Speed is a live suspect. If mobile is fast too, it is the form, tap targets or the call button |
| High CLS on a page with a form | Late-injected consent banner, font swap or unsized image pushing the form; fields move under the thumb |
| INP went poor after a chat widget, popup or tracking tag was added (GTM version history dates it) | Third-party main-thread work on interaction; confirm with the third-party audit |
| Lab LCP poor, field LCP good | Throttled simulation overstates it; audience is on desktop or fast mobile. Low priority |
| Field LCP or INP poor, lab fine | Real-network and real-device cost, or interaction-time work the lab never triggers. Higher priority than the score suggests |
| TTFB > 0.8 s, and LCP poor | Server or hosting problem; no front-end change fixes it. Cheap hosting, no cache layer, or a heavy CMS |
| Score dropped after a container publish | A tag added in that version. Diff GTM versions before touching the site |
| Poor score, but conversion rate normal for the vertical | Speed is not the bottleneck. Do not lead with it |
`;
