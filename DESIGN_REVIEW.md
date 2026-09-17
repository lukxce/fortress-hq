# Fortress HQ — design, layout, UI and UX review

17 September 2026. Reviewed against the live code at commit `4cdff91`, on a 1440×900 desktop
viewport and a 375-wide phone viewport, signed in as the admin with the Optimal25 project.

State of the build before the review: typecheck clean, tests pass, production build compiles,
findings recompute on both projects (6 on Optimal25, 8 on DOT Consortium), learning pass runs
(18 portfolio patterns, 0 judged changes — no live sync has run since change history was added).

The list is in priority order within each section. **Bug** means it is broken today; **Change**
means it works but should be different.

---

## 1. Things that are broken

### 1.1 Bug · Phone layout has horizontal page scroll on every table page
On a phone, `Search terms & keywords`, `Campaigns`, `Tags & health` and every DataTable page push
the whole page wider than the screen (measured 835px page on a 711px viewport). The table's
`.table-wrap` is `overflow-x: auto`, but the grid cell it sits in has no `min-width: 0`, so the
table widens the column instead of scrolling inside it.
- Fix: `.main { min-width: 0; }` and `.card { min-width: 0; }`. One line each.

### 1.2 Bug · Phone: the menu takes the whole first screen
On a phone the sidebar becomes a wrapping row of all 18 links and section labels, ~700px tall,
before any content. The user scrolls past the entire menu on every page.
- Fix: below 900px, collapse to a top bar with the project picker and a "Menu" button that opens
  the sections in a sheet. Keep Overview / What to change as two visible tabs in the bar.

### 1.3 Bug · The headline sentence overflows on a phone
"You spent 44,657 RSD and got…" is clipped at the right edge on a phone because `.sentence` is
23px with `max-width: 60ch` inside a container that is already narrower than that; the
highlighter span does not wrap cleanly.
- Fix: `.sentence { font-size: clamp(18px, 5vw, 23px); max-width: none; }` below 900px.

### 1.4 Bug · Dev console shows "1 issue" on every page
The pg driver's SSL-mode warning is logged as a server console *error*, so Next's dev overlay
badges every page with an issue. Harmless in production, but it hides real errors in development.
- Fix: append `sslmode=verify-full` to the Neon connection string (it is already what the driver
  does), or pass `ssl: { rejectUnauthorized: true }` in `lib/db.ts`.

### 1.5 Bug · Empty product strip on the project Overview
When only Tag Manager is connected, the Overview shows a lone "4 live tags" card sitting in a
three-column grid with two empty columns, *above* the headline sentence. It reads as a broken
layout and demotes the most important line on the page.
- Fix: move the strip below the four Ads stats; render it only when two or more products have
  data; otherwise show one inline line: "Analytics and Search Console are not connected — connect
  them in settings" with a link.

### 1.6 Bug · Two "Not checked yet" states disagree
`Tags & health` says "IDs pulled from Google" while the Google Ads row says "Could not ask Google
for the ID" (the local sign-in is stale). Both are technically true but the header claims success.
- Fix: when `idsUnavailable` is set, the header line should say "Could not reach Google for the
  IDs — reconnect on Connections" and the table pills should all read "Unknown".

---

## 2. Navigation and information architecture

### 2.1 Change · The sidebar is too long and flat
Eighteen links across nine section labels, plus Portfolio and Admin, plus the account line and
Sign out. At 900px tall the sidebar already scrolls on desktop. Every section is always expanded.
- Collapse product sections by default; expand the one that matches the current page. A section
  header shows a small count of open findings for that product (e.g. "Analytics · 2").
- Move **Portfolio** (All projects, Add or manage projects, Connections) and **Admin** out of the
  sidebar body into the project picker's dropdown and a small gear/avatar menu at the bottom.
  The sidebar body should only be *this project*.
- Drop the section label for the unnamed top group and for the lone "Project settings" — put
  settings as a gear icon next to the project name instead.

### 2.2 Change · "connect" for unconnected products is invisible
An unconnected Analytics or Search Console section shows only its label with a tiny grey
"connect" link at 11px. It looks like an empty heading, not an action.
- Render the section as a single muted row: "Analytics — not connected · Connect →" with the
  same padding as a link, and show it *after* the connected sections.

### 2.3 Change · Product sections are not in the order people work
Current order: top jobs, Google Ads, Analytics, Search Console, Tag Manager, Website, settings.
Tracking is the thing the whole app says to check first, yet it is fifth.
- Order: Overview · What to change · Reports — **Tracking** (Tags & health, Conversion
  tracking) — Google Ads — Analytics — Search Console — Website. Tracking is a job, not a
  product; "Tag Manager" as a section name is the product, not the job.

### 2.4 Change · Duplicate entry points
"Campaigns" under Google Ads and the campaigns table on Overview show the same table; "Search
terms & keywords" and "Keyword research" are two pages about keywords; "Conversion tracking"
and "Tags & health" both check tracking.
- Merge Keyword research into "Search terms & keywords" as a third tab (Search terms · Keywords
  · Ideas). Keep the Overview campaigns table but cap it at 8 rows with "All campaigns →".
  Make Tags & health the parent and Conversion tracking a tab within it.

### 2.5 Change · The project picker looks like a form field
A native `<select>` styled as an input, above the nav. It is the most-used control in the app
and it has no visual weight and no keyboard search.
- Replace with a button that opens a searchable list showing each project's name, a coloured
  health dot and the "to do first" count. Show the current project's name in display type.

### 2.6 Change · Breadcrumb/eyebrow inconsistency
Eyebrows read "Overview · Google Ads last 30 days", "What to change", "Google Ads", "Tag
Manager", "Project settings", "Admin". Some are section names, some are product names, some
carry a time range.
- Rule: eyebrow = section name (the sidebar label); time range and sync time go in the meta
  line under the h1. Never put a product name in the eyebrow when the sidebar calls it something
  else.

---

## 3. Page by page

### 3.1 All projects (portfolio overview)
- **Change:** the page is a bare table plus a campaign table. It is the landing page for every
  login and it says nothing about *what to do*. Add a top strip: total spend, conversions, cost per
  conversion across projects, and a "to do first" total that links to a cross-project
  What-to-change list.
- **Change:** the Health column shows a coloured pill with no text on small widths; always show
  the word.
- **Change:** "Signed in as email" under the h1 is noise on the busiest page; it belongs in the
  sidebar footer only (already there).
- **Change:** the 7/14/30/90-day tabs sit in the page header but the campaign table below has its
  own Running/Paused/All tabs styled identically. Two identical tab strips on one screen; make the
  time range a segmented control with a calendar icon, keep the table filters as plain chips.

### 3.2 Project Overview
- **Bug:** see 1.5 (empty product strip).
- **Change:** four stat cards use monospace 26px numbers; the sentence uses display type 23px;
  the h1 is 28px. Three type systems within 200px of each other. Keep mono for table cells and
  small figures; stat card values should be the display face, like the sentence.
- **Change:** "Needs attention" shows three recommendation titles with no product badge and no
  do-by date. Add the product pill and "by 24 Sep".
- **Change:** the spend chart legend ("Spend on days with conversions / Days with no conversions")
  is longer than the chart is tall. Put it as a caption under the axis in one line.
- **Change:** the Campaigns section note ("Health is judged against this account's own cost per
  conversion…") repeats on Campaigns page too. Show it once as a tooltip on the Health header.

### 3.3 What to change
- **Change:** the product filter tabs and the area grouping are two competing taxonomies. A card
  is grouped by area (Tracking, Wasted spend…) *and* filterable by product; users have to know
  both. Make product the primary grouping when a filter is not set (Google Ads / Analytics /
  Tag Manager…), with the area as a pill on the card.
- **Change:** the "Roughly on the table" banner is a large figure with a small caveat under it.
  The caveat is the important part. Reduce the figure to stat-card size and make the caveat the
  sentence.
- **Change:** empty state shows the raw env-var name `ANTHROPIC_API_KEY` to the operator. Say
  "Analysis is not set up on this installation — ask the admin" and show the env name only to
  admins.
- **Change:** cards have four buttons of the same weight (Done, Dismiss, Start experiment,
  Apply). Apply should be primary, Done secondary, Dismiss quiet text, Start experiment a link.

### 3.4 Campaigns / Search terms / any DataTable page
- **Bug:** phone overflow (1.1).
- **Change:** the meta line "90 days" is the only indication of window; the h1 says nothing.
  Put the window in the eyebrow row as a chip ("Last 90 days") so it survives scrolling.
- **Change:** column headers wrap to two lines ("Monthly searches", "Cost / conv.") and shift
  the number alignment. Abbreviate in the header (Searches/mo, CPA) with the full name in
  `title`.
- **Change:** the "Result" column values ("Clicked, no conversion") are sentences in a table.
  Use short labels with colour: Converted (green), No conversion (grey), Brand (blue).
- **Change:** the "12 of 895" counter is at the far right of the tools row, easy to miss. Put
  it next to the search box.
- **Change:** row height is generous for 900-row tables. Tighten `td` padding by 2px vertically
  and offer a density toggle in the tools row.

### 3.5 Keyword research
- **Change:** the header tabs read "New ideas · 0" and "Volumes for what you have · 0" before
  any sync. Zero counts look like a failure; hide counts until data exists.
- **Change:** the explanatory paragraph under the header is three lines of small grey text
  before the empty state. Fold it into the empty state.

### 3.6 Tags & health
- **Change:** the "Google tags on the website" card and the "What stands out" card both have
  card-heads with an h2 and a right-aligned meta line; the meta lines are full sentences and get
  cut off at 1100px. Meta in a card-head should be ≤ 6 words; put explanations in a `(i)` tooltip.
- **Change:** the table's "On the site?" cell mixes a pill, a two-line note and a button in one
  cell, so rows are three different heights. Move the note under the ID in the first column and
  keep the status cell to pill + button.
- **Change:** "Versions seen" is a full card for a two-row table. Make it a footer line under the
  tags table ("Live version 13 since 16 Sep · 3 earlier versions").
- **Change:** the audit list under the tags table repeats the consent-banner caveat on every
  render even when nothing is missing. Show it only when something is Not found.

### 3.7 Analytics / Search Console (not connected)
- **Change:** the empty state is a card in the middle of an otherwise blank page. Use the space:
  show three greyed placeholder stat cards with the metric names ("Sessions", "Key events",
  "Engaged") so the user sees what connecting gives them, then the connect button.
- **Change:** "Choose one in project settings" is a detour. Open the binding picker in a dialog
  right there.

### 3.8 Project settings
- **Change:** the Google products block lists four `<select>`s at 320px with helper text on the
  left. Each select's current value is truncated ("Optimal25 active account — optimal25.rs").
  Show the bound account as a row (name, ID, domain, "Change" button) and open a searchable
  picker on Change.
- **Change:** Delete project is a red-outlined card at the bottom with a type-to-confirm input
  always visible. Keep the card but show only a "Delete project…" button; the confirm input
  appears in a dialog.
- **Change:** "What the analysis can see" table has 11 rows with "Not connected" pills for
  products that are not bound. Group rows by product with the product's connection state once in
  the group header.
- **Change:** Industry select shows "Not detected yet" as a selectable option. Make it a
  placeholder.

### 3.9 Admin → Brain
- **Change:** the page is ten cards long. Split into tabs: **Learning** (what it learns from,
  drafts to approve, Learn now), **Evidence** (change effects, words, benchmarks, prevalence),
  **Lessons** (teach it, list), **Runs** (recent analyses, cost), **Knowledge** (modules).
- **Change:** "Apply its own lessons without asking" is a checkbox in a header row next to a
  primary button. It is the most consequential setting in the app. Give it its own row with a
  one-line consequence under it, and make it a switch.
- **Change:** four empty "nothing yet" cards on a fresh install read as broken. Collapse empty
  evidence cards into one line each ("Words that waste: needs 3+ accounts — 2 connected").
- **Change:** the knowledge modules render as `<pre>` blocks inside `<details>`. Render the
  markdown.

### 3.10 Admin → People & access
- **Change:** role is an inline `<select>` in a table cell; changing it saves immediately with no
  confirmation. Make role changes confirm ("Make Luka an admin?").
- **Change:** "Share a project" is a row of four selects and two buttons. Turn it into a dialog
  launched from a "Share…" button on each project row in a projects table, which the page does
  not currently have.
- **Change:** the yellow "Separate sign-in is not switched on yet" notice is permanent while
  Clerk keys are missing. Fine, but it should link to the setup steps.

### 3.11 Connect
- **Change:** the Google access card and the account groups are both `.sheet` panels of the same
  weight. The access card is setup; the groups are the working list. Make the access card
  collapsible once all four are granted (one line: "Google access · all granted · Re-authorise").
- **Change:** the "Connected · Project name" pill plus a Disconnect button per row is right, but
  Connect is a filled blue button on every unconnected row — 20 blue buttons on one screen. Make
  Connect the ghost style and reserve blue for the one primary action per screen.
- **Change:** manager accounts (folders) are listed inline with a "manager" pill and no button.
  Indent their child accounts under them instead of listing all flat.

### 3.12 Projects (Add or manage)
- **Change:** a single project card sits alone top-left with 90% empty page. Show the cards in
  a list with the same columns as All projects, and put "Add a project" as a primary button in
  the header rather than only in the empty state.

---

## 4. Visual system

### 4.1 Change · Three number styles
Stat values are Geist Mono 26px; the sentence's numbers are Instrument Sans 600; table cells are
mono 13px. Decide: **display face for headline figures (sentence, stat cards), mono only inside
tables.** Mono at 26px reads as a terminal, not a dashboard.

### 4.2 Change · Highlighter is overused
The `#e2ff3c` highlighter appears on the sentence's bad news, on "no track record", on empty
states and on notices. It was meant for the one line per page that matters. Restrict to one use
per page: the sentence.

### 4.3 Change · Card-head meta lines are sentences
Almost every `card-head` has a right-aligned `.meta` with a full explanatory sentence ("Measured
from the data; nothing here is written by the AI."). They wrap or truncate below 1200px and read
as disclaimers. Move explanations to an info icon with a tooltip; keep meta to counts and dates.

### 4.4 Change · 211 inline `style={{}}` attributes
Spacing, widths and colours are set inline across pages (`marginBottom: 12`, `width: 320`,
`gap: 8`). This is why the same pattern looks slightly different on each page. Add utilities:
`.mt-2 .mt-3 .mb-2 .mb-3`, `.w-select` (320px), `.row-tight` (gap 6). Replace inline styles
page by page; the settings and admin pages first.

### 4.5 Change · Empty states have no illustration or hierarchy
Every empty state is h3 + paragraph + button centred in a card. Fine once, dull the tenth time.
Give each product's empty state a small line drawing of what the page will show (a bar chart,
a table skeleton) in `--ink-4`, and put the reason it's empty ("not connected" vs "not synced
yet") in the h3 rather than in the paragraph.

### 4.6 Change · Pills carry too many meanings
`.pill` is used for status (Live/Paused), severity (Do first), product (Analytics), counts (3),
tags (manager), and actions (the "importing" label). Split into `.pill` (neutral label),
`.status` (coloured dot + word), `.badge` (count). Severity pills keep colour; product pills
should be outlined, not filled, so they do not compete with severity.

### 4.7 Change · Button hierarchy is flat
`.btn`, `.btn-primary`, `.btn-accent`, `.btn-ghost`, `.btn-quiet`, `.btn-sm` exist, but pages
use `.btn` for everything from "Sync now" to "Delete". Rule per screen: one `.btn-primary`;
destructive actions use `.btn-danger` (does not exist yet — add it: red text, red border on
hover); everything else `.btn` or `.btn-quiet`.

### 4.8 Change · Dark mode is absent
`prefers-color-scheme: dark` is not handled; tokens exist but only for light. Not urgent for an
internal tool, but the token structure is ready: add the dark values under
`@media (prefers-color-scheme: dark)` for `--paper --ground --ground-2 --line --ink*` and check
the highlighter (`#e2ff3c` on dark needs `--ink` text).

### 4.9 Change · The Ask bubble covers table rows
The fixed "Ask about this account" pill sits over the bottom-right of every table. On the
search-terms page it hides the last row's numbers. Give `.main` a bottom padding equal to the
bubble height (already 96px, but the bubble is right-aligned over content, not below it) or
move the bubble into the sidebar footer on desktop.

---

## 5. Copy and tone

- **Change:** section names mix product names and jobs: "Tags & health", "Conversion tracking",
  "Traffic & channels", "Searches", "Page speed". Use the job consistently: *Tags on the site*,
  *Conversions*, *Traffic*, *Organic searches*, *Speed*.
- **Change:** "Sync now" appears in every page header. It is a rare action. Put it in the project
  picker menu and show "Synced 3 h ago" as text; the button appears only when data is older than
  a day or missing.
- **Change:** the phrase "this account" is used on Analytics and Search Console pages where the
  thing is a property or a site. Use "this project" everywhere outside Google Ads.
- **Change:** "Do first / Worth doing / When you have time" is good. "critical / warning / info"
  leaks through on the product pages' finding lists as "!" and "▲" marks with no legend. Use the
  same three words there.
- **Change:** error text `ANTHROPIC_API_KEY is not set` and `invalid_client` reach the UI verbatim
  in three places. Map them: "Analysis is not set up", "Google sign-in has lapsed — reconnect".

---

## 6. Order of work

1. Phone fixes (1.1, 1.2, 1.3) — half a day, and the app is usable on a phone.
2. Sidebar restructure (2.1–2.3, 2.5) — one day; every page gets shorter.
3. Overview strip and What-to-change grouping (1.5, 3.2, 3.3) — half a day.
4. Visual system pass (4.1, 4.3, 4.4, 4.6, 4.7) — one to two days, mechanical.
5. Admin Brain tabs and People dialogs (3.9, 3.10) — one day.
6. Empty states and copy (4.5, section 5) — as pages are touched.

Items 1–3 change what users see every day; 4–6 are polish.
