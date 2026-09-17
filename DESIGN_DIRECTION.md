# Fortress HQ — design direction, September 2026

Grounded in `DESIGN_REVIEW.md`, `HOW_IT_WORKS.md`, `app/globals.css`, `components/shell/Sidebar.tsx` and `app/(app)/clients/[id]/page.tsx`, then checked against what Vercel, Linear, Stripe, Mixpanel, PostHog, Optmyzr, Adalysis, Google Ads/GA4, Ahrefs, Semrush, AgencyAnalytics and GitHub Copilot actually ship. Where I could only find a third-party summary rather than the product's own words, I say so.

The one-line thesis: **Fortress is not a reporting dashboard, it is a to-do list with evidence.** Every tool in the category that added AI in 2025 converged on "plain-language summary → what needs attention → act" (Optmyzr's 2025 recap describes exactly that; Google's Recommendations page has been that shape for years; GA4 moved AI insights to the top of Home). Fortress already has the strongest version of that idea (the sentence, the tested findings, the guarded Apply). The design job is to stop the interface presenting it like a generic analytics dashboard with a recommendations page bolted on.

---

## 1. Navigation model for many projects × many products

### What the best tools do

- **Sidebar is the scope, not a menu of everything.** Vercel replaced horizontal tabs with a "resizable sidebar that can be hidden when not needed", with "consistent tabs for unified navigations across both team and project levels" and "projects as filters so you can switch between team and project versions of the same page in one click". Mixpanel removed its top bar in April 2025 and put "project switching, creating new content, search, and quick links" at the top of the left panel, boards in the middle, "Settings, Help" at the bottom; it collapses with a keyboard shortcut and Cmd+K opens search. Stripe's sidebar: a fixed first block (Home, Balances, Transactions, Customers, Product catalog), then **Shortcuts** ("your pinned and most recently visited pages"), then Products, then **More**.
- **When products outgrow the sidebar, show a subset and put the full list in a searchable menu.** PostHog: "more products means we're hitting the point where they don't all fit in the nav menu", so the sidebar now shows pinned shortcuts and "the full list of products is now available in the new searchable Products menu".
- **Merging sections can hide them.** Mixpanel's own A/B test: folding Experiments and Feature Flags into one section caused "a 70.06% drop" in visits to those pages, so they reverted that piece while keeping the rest (+12.43% core-report creation). Collapse with a label and a count; never fold two jobs into one unlabeled item.
- **Chrome recedes.** Linear: "Don't compete for attention you haven't earned" and "Structure should be felt not seen"; the sidebar was made "a few notches dimmer" so "the main content area — where users work — [takes] precedence". The "inverted L" (sidebar + header) is the only global chrome.
- **Agency PPC tools put portfolio and account at different levels.** Optmyzr's All Accounts Dashboard is a table (health dot red/yellow/green checked at 24 h / 7 d / 21 d, optimisation-suggestion count, audit score, alert-coloured metric cells, pacing) with a header holding Ask AI, date range, comparison, scope filters, column chooser and an alerts bell; clicking in goes to the Account Dashboard with its own three tabs. Adalysis Q3 2025 rebuilt its home as four columns (Critical, Errors, Structure issues, Performance issues) with hover summaries. Google Ads (2023–25) has a five-section left rail (Campaigns, Goals, Tools, Billing, Admin) plus a top search.
- **Global search is table stakes.** Vercel's universal search (top right) indexes "Teams, Projects, Deployments (by branch), Pages, Settings"; Mixpanel Cmd+K; Linear Cmd+K; Stripe `?` for shortcuts.

### Recommendation for Fortress

Keep the left sidebar (244px is right; Linear/Stripe are in the 220–250 range) but make it **strictly one project's workspace**, in the order people work, with portfolio and admin moved to the switcher and an account menu. Adopt Vercel's *project-as-filter* rule literally: `/overview`, `/clients/[id]` and `/insights` should be the same page shapes at two scopes, so "All projects" in the switcher from What to change gives a cross-project What to change (the review's 3.1 asks for it; this is the mechanism).

```
┌─ 244px ──────────────────────┐
│ ■ Fortress HQ                │
│                              │
│ ┌──────────────────────────┐ │  ← button, not <select>. Opens a searchable
│ │ ● Optimal25         ⌘K ▾ │ │    list: All projects · then each project
│ └──────────────────────────┘ │    with health dot + "3 to do first".
│ Synced 3 h ago · Sync        │  ← text; button only if > 24 h or missing
│                              │
│ Overview                     │
│ What to change            3  │  ← red count = do-first only
│ Experiments                  │
│ Reports                      │
│                              │
│ SOURCES                      │  ← collapsed by default except current
│ ▾ Tracking ·············  2  │     section; count = open findings
│     Tags on the site         │
│     Conversions              │
│ ▸ Google Ads ············ 4  │
│ ▸ Analytics ············· 1  │
│ ▸ Search Console             │
│ ▸ Website                    │
│   Business Profile · Connect →  │  ← muted row, after connected ones
│                              │
│ ─────────────────────────────│
│ ⚙ Project settings           │
│ ▦ Admin ▸  (Brain · People)  │  ← admins only
│ luka@…            Sign out ▾ │
└──────────────────────────────┘
```

Rules that go with the sketch:

- **Switcher = Cmd+K.** One control does project switching *and* page search ("search terms", "tags", "settings"), like Vercel/Mixpanel. Rows show name, health dot, do-first count, last sync. "All projects", "Add a project" and "Connections" live in this menu, not the sidebar body.
- **Sections by job, in work order**: Tracking first (the review's 2.3 is right; Optmyzr and Adalysis both lead with health/critical), then Google Ads, Analytics, Search Console, Website. Collapsed sections keep their label and count visible (the Mixpanel lesson). The current page's section is open.
- **Counts only for judged problems** (`severity <> 'info'`), never totals. Google's "score uplift" numbers are the cautionary tale: a number on every item stops meaning anything.
- **No top bar on desktop.** Page header carries eyebrow (= sidebar label), h1, meta line (window, sync time) and the date-range segmented control. The review's 2.6 rule applies. Move "Sync now" out of every header into the switcher/meta line (review §5).
- Dim the sidebar one notch (`--ink-3` labels, `--ink-2` links, active = `--blue-wash`) so the content wins, per Linear.

---

## 2. The overview page

### What the strongest examples put first

- **A sentence, then the numbers.** Optmyzr's Account Dashboard puts Performance Metrics first, then Metric Comparison with "Summarize with AI", then **Sidekick**, which "presents one key account strength, one improvement area, and one focused recommendation". Its 2025 recap: "plain-language summaries across dashboards, audits, and charts that highlight what's working, what needs attention, and where to act next". GA4 moved "AI-generated insights" to the top of Home (third-party summary; Google's own Home help lists the Overview card first, then Realtime, Recently accessed, Suggested for you, Insights & recommendations).
- **Trend as small paired lines, not legends.** GA4's Overview card is "a trendline (solid line) with a data point for each day in the last 7 days compared to data points for the previous 7 days (dashed line)". Stripe Home is a grid of chart widgets with three dropdowns: preset/custom range, time unit, comparison range; the user adds/removes widgets. Ahrefs Rank Tracker leads with five progress graphs (Visibility, Average position, Traffic, Positions distribution, SERP features) and pins the filters at the top "since any filtering will cause all five graphs to change" — one date/scope control governs the whole page.
- **Alerts and to-dos sit on the home page, not in a separate tab.** Stripe Home "surfaces important notifications, like unresolved disputes or identity verifications". Adalysis home is four count columns with hover summaries.
- **Multi-source pages weight sources unequally.** AgencyAnalytics' dashboard template is ten sections (form submissions, calls, rank changes, organic traffic, reviews, PPC spend, PPC clicks, conversion rate, CPA, goals) — outcomes first, channels second. Whatagraph's guidance: the KPI snapshot "should always be placed at the very top". NN/g: use length and 2D position for quantities; "color should not be used to communicate information about quantitative values or magnitude"; the test is whether users can "glance at the dashboard and immediately see answers".

### Recommendation

Google Ads is the spine; the other four sources are (a) one status line each and (b) contributors to What to change. Don't give Analytics a stat grid on the overview; give it a tile. The order becomes: sentence → the three things to do → the four Ads figures with sparklines → sources strip → spend chart → campaigns (8 rows).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ OVERVIEW                                         [7][14][30 ✓][90]  ⋯     │
│ Optimal25                                                                │
│ Google Ads, last 30 days · synced 3 h ago                                │
│                                                                          │
│ You spent 46,031 RSD and got 20 conversions — 2,304 RSD each.            │
│ That's ▓27% more expensive than the 30 days before.▓   ← the ONE marker  │
│                                                                          │
│ ┌ Do first ─────────────────────────────────────────────── All 6 → ┐    │
│ │ ● Tracking   Nothing counted for 14 days on "Lead form"   by 24 Sep│    │
│ │ ● Waste      12 search terms spent 9,400 RSD, 0 conv.   ≈ 8,100/mo│    │
│ │ ● Budget     "Brand" capped 6 of 7 days, beats account   ≈ 3,200/mo│    │
│ └───────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│ ┌ Spend ──────┐ ┌ Conversions ─┐ ┌ Cost / conv. ─┐ ┌ Clicks ──────┐    │
│ │ 46,031 RSD  │ │ 20           │ │ 2,304 RSD     │ │ 1,214        │    │
│ │ ▁▂▃▂▅▆▃ +4% │ │ ▃▂▁▂▂▁▁ −18% │ │ ▂▃▃▅▆▆▇ +27%  │ │ ▃▃▄▃▅▄▃ +6%  │    │
│ └─────────────┘ └──────────────┘ └───────────────┘ └──────────────┘    │
│   solid = this window · dashed = previous window (GA4 pattern)          │
│                                                                          │
│ ● Analytics 1,840 sessions +9% · ● Organic 312 clicks −3% ·             │
│ ● Tags 4 live, 1 problem · ○ Business Profile not connected · Connect → │
│                                                                          │
│ ┌ Spend per day ───────────────────────┐ ┌ Open findings by area ─────┐ │
│ │ ▌▌▌▌▌▌ ▌▌▌ ▌▌▌▌ ▌ ▌▌▌▌▌▌▌▌ ▌▌▌▌▌    │ │ Tracking 2  Waste 3        │ │
│ │ grey = days with no conversion       │ │ Budget 1    Opportunities 2│ │
│ └──────────────────────────────────────┘ └────────────────────────────┘ │
│                                                                          │
│ Campaigns · 8 of 14                                   All campaigns →   │
│ [Running ✓][Paused][All]  [Health ▾]                                     │
│ Name            Status  Spend      Conv  CPA      Health      7d       │
│ ...                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

Specifics:

- **Do-first block goes above the stats.** It is the product. Each row: area dot (colour = severity, not product), title, evidence fragment in the title itself, do-by date or monthly worth on the right. Three rows, "All 6 →".
- **Stat cards get a 7-point sparkline and the delta on one line.** Value in the display face at 24px 600 with `tabular-nums` (see §5), not Geist Mono. One caption under the row explains solid/dashed once.
- **Sources strip is one line of tiles, not cards**, always rendered, with the not-connected ones as hollow dots plus "Connect →". This replaces the product strip that the review's 1.5 flagged (the current code hides the strip when fewer than two products have data; the line version makes the absence part of the same sentence, which is better).
- **"Open findings by area"** (the Adalysis four-column idea) replaces "Needs attention" as the second card next to the chart, because the three do-first rows now sit at the top. Each count links to What to change filtered.
- Health tooltip: move the "judged against this account's own cost per conversion…" sentence to an `(i)` on the Health header (review 3.2).
- Keep 7/14/30/90 as the single control for the page (Ahrefs rule). The GA4/Search Console tiles currently use a fixed 28 days; show "28 d" in the tile if it cannot follow the control.

---

## 3. Presenting AI recommendations

### What Google Ads does well and badly

- The card is simple: "score uplift" (%), description, **View** and **Apply**; dismiss is an X on hover in the top-right; "Dismiss all" per type; "A dismissed recommendation can reappear after a certain period if it becomes relevant then". The API model behind it is worth copying: `impact.base_metrics` vs `impact.potential_metrics` (impressions, clicks, cost, conversions), with the honest caveat that "metrics availability varies depending on the recommendation type".
- Badly: the score rewards dismissal as much as application ("The quickest way to improve your score is by dismissing irrelevant recommendations each week" — Kickpoint), auto-apply is on by default for some types and practitioners say "you should not enable the auto-apply setting", and the cards give a percentage with no evidence of where it came from. The 2025 Results tab attributes lift "to specific recommendations" but against "an estimated baseline of what would have happened without the change", not a controlled test. Fortress's experiments are the genuinely better answer; the UI should say so.

### What Copilot review does

Severity labels "High, Medium, or Low" in the "top-right corner" of each comment; "groups like comments together" so the same finding is not repeated; a "Fix with Copilot" dialog that lets you "apply the change directly to your pull request or open a new pull request", pick a model and add instructions; "Fix batch with Copilot" for several at once; and a stated disclaimer: "Sometimes it will make mistakes. Always validate Copilot's feedback carefully." Two principles fall out: **one card per problem, not per occurrence**, and **the apply step shows and lets you shape the exact change before it runs.**

### Recommendation: card anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│ DO FIRST   ⟨Tracking⟩ ⟨Google Ads⟩                  ≈ 8,100 RSD/mo  │
│ Add 12 non-converting search terms as negatives                      │
│ 9,400 RSD over 90 days on searches with no conversion, each past     │
│ 3× the account's cost per conversion — beyond chance (K = 50).       │
│                                                                       │
│ Steps (4) ▸        Numbers behind this (2 findings) ▸    Track record ▸│
│ Effort 10 min · by 24 Sep · similar changes: 3 confirmed, 1 refuted   │
│                                                                       │
│ [ Apply… ]   Done   Start experiment                        Dismiss ▾ │
└──────────────────────────────────────────────────────────────────────┘
```

- **Severity is the header word** (Do first / Worth doing / When you have time), left, in colour; area and product are **outlined** pills (review 4.6). The monthly figure sits top-right in the display face, tabular, with "≈" and the caveat that it is summed from findings, on hover.
- **The first paragraph is the evidence**, in the AI's words but with the engine's numbers, and it names the test ("beyond chance", "not yet evidence"). This is what Google's cards lack and it is Fortress's whole pitch.
- **Three disclosures, closed by default**: Steps (numbered, exact menu names), Numbers behind this (the findings table, with finding ids), Track record (started experiments of the same action type: confirmed / refuted / inconclusive; "no track record yet" in plain words).
- **Button hierarchy**: Apply is the only `.btn-primary`; Done is `.btn`; Start experiment is a text link; Dismiss is `.btn-quiet` with a reason menu (Not relevant · Already did it · Wrong) — the reason is the learning-loop input, and there is no score to game.
- **Apply opens the confirmation the app already has**, but modelled on the Copilot dialog: the exact objects (12 terms listed, campaign names), the money, a "run as an experiment" checkbox on by default when a prediction exists, and the signed-token summary. Never a one-click apply from the card face.
- **"Not yet evidence" is a separate, quieter list** at the bottom of What to change with a "look again on [date]" column, not mixed into cards.
- **Grouping**: order by severity then monthly worth; product and area are filter chips in the toolbar, not section headers. This differs from the review's 3.3 (product-primary grouping). Reason: an operator works the list top-down by consequence; the Adalysis home, Copilot severity and Optmyzr's health dots all put judged priority first and taxonomy second. A product chip row gives the same filtering with no second taxonomy on screen.
- The "Roughly on the table" banner becomes a stat-sized figure with the caveat as the sentence (review 3.3), placed as the first line of the page: "About 14,000 RSD a month is spent above what conversions were worth. Below, in order."

---

## 4. Data tables

### What I could verify

- Pencil & Paper's enterprise-table study: density steps of **40 / 48 / 56 px** (condensed / regular / relaxed) switched by "an icon switcher outside the table"; "Right-align numeric columns"; sticky header "to allow the user to keep context"; freeze the leftmost column on horizontal scroll; 1px light-grey row lines, no zebra; checkboxes appear on hover, bulk actions only when rows are selected.
- Filters: pills/chips when "filters need to be additive"; a horizontal bar of dropdowns "is limited to the page width"; show active-filter counts "(3)" on the label; live filtering for small lists, an Apply button "for very heavy datasets"; show result counts at the input level.
- Linear: filters open with `F`, support "is / is not / is either of / includes any, all…", and "The applied filters are also reflected in the browser URL", so views are shareable.
- Semrush Position Tracking: a gear-icon Table Settings with column selection and a "normal or compact" row height, four filter presets (All changes, Improved, Declined, Changes on SERP), sort by "biggest positive or negative difference" — this is from a third-party summary and the Landing Pages manual; I could not confirm the gear icon from Semrush's own KB text.
- Ahrefs: "shared filter presets" on Top Pages, "paste multiple URLs into Page filters", "nested tables for easier previews", all reports in the sidebar. I could **not** verify from their docs how they paginate or virtualise very large reports; do not cite a row count.
- Stripe: right-aligned numerals, tabular figures, muted gridlines in reports (third-party reconstructions of the Sail system; Sail itself is private).

### Recommendation

- **Two densities**, 40px compact and 48px regular, one toggle in the tools row, remembered per user. Default compact on Search terms and Keywords (900 rows), regular on Campaigns.
- **Sticky header at the card top; first column sticky on horizontal scroll** (the phone fix in review 1.1 is the prerequisite).
- **Numbers**: right-aligned, `tabular-nums`, 13px, in Inter (see §5); header abbreviations (Spend, Conv., CPA, Searches/mo) with the long name in `title`.
- **Filters as a chip row, not selects**: "Filter ▾" button opens a menu; chosen filters become removable chips (`Status: Running ×`, `Health: poor ×`); chips are in the URL. Keep Running/Paused/All as the one preset segmented control because it is the one filter everyone uses (Semrush's four presets are the same idea).
- **Search box + "12 of 895" count together on the left**; density, column chooser (gear) and export on the right.
- **One sparkline column only where the trend is the decision**: Campaigns gets a 7-day spend sparkline (60×16 px, `--ink-4`, no axis). Search terms does not; it gets the coloured short-label Result column (Converted / No conversion / Brand).
- **Large tables**: server-side sort/filter, 50 rows a page with "Load 50 more" (not infinite scroll — the fixed Ask bubble and a footer count need a stable bottom). A "paste a list" filter for search terms is the Ahrefs pattern worth copying.
- Bulk actions appear only after a checkbox is ticked: "Add 12 as negatives…" opens the same confirmation as a card.

---

## 5. Visual system

### What the reference products do

- Base UI size: Stripe 14px, Vercel 14px, Linear 13px (third-party token reconstructions; consistent across sources). Linear uses "Inter Display… for our headings" and "regular Inter for the rest"; its palette is generated from "three: base color, accent color, and contrast" in LCH, and it deliberately limited "how much chrome (blue in our case) was used".
- Figures: Stripe, Linear and Vercel set numbers in their sans with `tnum` (Stripe: "tnum for tabular numbers on financial data and captions"), and use monospace (Sohne Mono, Geist Mono) for code, IDs and technical labels — **not** for KPI values. Vercel's Geist docs treat dark as canonical, ship a Light/System/Dark switcher "placed once per app, in the footer or settings", and advise supporting dark "only when the app already has it or the user asks for it".
- Linear's refresh removed "colored team icon backgrounds", made dividers rounder and lower-contrast, and shrank icons.
- NN/g: colour is for category, never magnitude; lengths and positions carry quantity.

### Recommendation (keeping white/blue, Instrument Sans + Inter + Geist Mono)

- **Type scale, eight steps, nothing else**: 11 label (600, +0.06em, caps) · 12.5 meta · 13 table figures · 13.5 UI/table text · 14 body · 15.5 h3 · 19 h2 · 24 stat value · 28 h1 (and the 23px sentence is a display-face h2-sized paragraph; fine). Delete the 34px `.impact-banner .big` and the 17px `.rec-title` (use h3).
- **Monospace**: narrow Geist Mono's role to what the reference products use it for — IDs (`GTM-XXXX`, AW-…, campaign ids), code snippets, the import file, keyboard hints. Headline and stat figures go to Instrument Sans 600 with `font-variant-numeric: tabular-nums`; table figures go to Inter with `tabular-nums`. This is a stronger version of the review's 4.1: mono is the odd one out at every size in Stripe/Linear/Vercel, and Inter has proper tabular figures. Losing `--font-mono` from `.num`, `.stat-value`, `.delta`, `td.num`, `.rec-facts b` and `.bar-axis` is about eight lines of CSS. If the operator likes the terminal feel in tables, the review's compromise (mono at 13px inside tables only) is acceptable; nowhere at 24px.
- **Colour semantics**: `--ok / --warn / --bad` only for *judged* states (health, severity, tracking status, delta direction where lower-is-better has been resolved). Blue only for interactive and the active state. Product pills outlined in `--ink-3`. Never a filled coloured background larger than a pill; the notice-bad banner keeps its wash because it is a judged alarm.
- **Highlighter**: exactly one `.mark` per page, on the sentence's bad news, and `.pill-marker` is retired. The Ask bubble's yellow dot can stay; it is the same "pen" motif at 8px.
- **Density**: keep 14px body; tables and sidebar at 13.5; card padding 20/22 is fine. Cut the sidebar to `--ink-2` links and `--ink-3` labels so it reads a notch dimmer than content.
- **Dark mode**: not yet. The tokens are ready but 211 inline styles are not; add `@media (prefers-color-scheme: dark)` values after the utility-class pass (review 4.4), and expose a Light/System/Dark switch once, in account settings, per Geist. The highlighter on dark needs `--ink` text and a 70% lightness marker.

---

## 6. Mobile

### What admin tools do on a phone

- Vercel's redesign: "Optimized for mobile with floating bottom bar optimized for one-handed use."
- Linear Mobile: a bottom toolbar you can "personalize… to prioritize the features you use the most", with "Pin to tab bar" for projects, initiatives and documents.
- Stripe's app: bottom tabs Home, Payments, Customers, Balances, and a global "+" for create; Home is editable charts; push notifications for "Daily summary, New payments, New customers, Disputed payments"; it "only displays live mode data" and some roles are read-only. Detail screens have an "action bar at the bottom" (Refund, Send receipt).
- Google's own Ads app lets you "Review high-impact recommendations across all of your accounts", "Create, edit, and pause ads", and "Set up custom notifications", so applying a recommendation from a phone is an accepted norm in this category.
- General guidance (third-party): B2B admin panels stay responsive web/PWA, not native.

### Recommendation

Responsive web, phone-first for four screens only: **Overview** (sentence, do-first, four stats), **What to change** (cards with Apply → the same confirmation sheet), **Tracking** (the alarm that matters when a client calls), **Ask**. Tables render as two-line list rows (name + two figures) with a "Full table on desktop" note; Builder, Brain and Admin are desktop-only with a polite notice.

```
┌──────────────────────────────┐
│ ● Optimal25 ▾          ⌘  ≡  │  ← switcher (sheet), search, menu
├──────────────────────────────┤
│ You spent 46,031 RSD …       │
│ ▓27% more expensive▓         │
│ ┌ Do first ────────────────┐ │
│ │ ● Nothing counted 14 d   │ │
│ │ ● 12 terms, 0 conv  8.1k │ │
│ └──────────────────────────┘ │
│ Spend 46,031  ▁▂▃▅  +4%      │
│ Conv.     20  ▃▂▁▁  −18%     │
│ …                            │
├──────────────────────────────┤
│  ◫ Overview  ☰ To change  ◎ Tracking  ✦ Ask │  ← floating bottom bar
└──────────────────────────────┘
```

Below 900px: `.app` becomes a single column with a 52px top bar and the floating 4-item bottom bar (Vercel/Linear), the sidebar sections open in a sheet from "≡", and the Ask bubble becomes the fourth tab instead of a floating pill. The review's 1.1–1.3 fixes are the prerequisites; 1.2's "Menu button + two visible tabs" becomes this bar. A weekly summary email (not push) is the Stripe "daily summary" equivalent for an agency.

---

## 7. Empty states and onboarding (connect → sync → analyse)

### Best examples

- Vercel's new project: connect GitHub/GitLab/Bitbucket, "select a repo, and click Deploy", then a live build log; the project page shows the deployment as soon as it exists. The flow is three named steps with progress visible during the slow one.
- Stripe Home surfaces to-dos ("unresolved disputes or identity verifications") in the same place metrics will later appear.
- Mixpanel offers a demo dataset so the product can be explored before an SDK is installed (third-party summary; not verified on Mixpanel's own pages).
- Checklist guidance from onboarding vendors (Candu, Appcues; not primary research): three to five items tied to activation, phrased as outcomes — "Connect your first data source" beats "Explore the integrations tab".

### Recommendation

The project overview, before data, is a **three-step checklist card in the exact position the sentence will occupy**, with the future page ghosted behind it:

```
┌ Set up Optimal25 ──────────────────────────────────────────────┐
│ 1 ✓ Connect Google       Ads · Tag Manager connected           │
│                          Analytics, Search Console — Connect → │
│ 2 ● Pull the data        campaigns ✓  search terms …  hours ○  │
│                          GA4 ○  Search Console ○  tags ✓       │
│ 3 ○ Work out what to change   runs about a minute after 2       │
└─────────────────────────────────────────────────────────────────┘
┌ Spend ──────┐ ┌ Conversions ─┐ ┌ Cost / conv. ┐ ┌ Clicks ─────┐
│ — — —       │ │ — — —        │ │ — — —        │ │ — — —       │   ← ghosted
```

- Step 2 shows the sync's independent steps as they complete (the sync already runs them independently; expose that), Vercel-build-log style, so a partial failure reads as "Search Console failed — retry" not as a blank page.
- Step 3 starts automatically after the first sync and the card turns into the sentence. If `ANTHROPIC_API_KEY` is missing, step 3 reads "Analysis is not set up on this installation — ask the admin" (review 3.3).
- Per-product empty pages: three ghosted stat cards with real metric names plus one button that opens the binding picker in a dialog (review 3.7), and the reason in the h3 ("Analytics is not connected" vs "Analytics is connected — nothing pulled yet").
- For a brand-new user with no projects: an "Open the sample project" link (read-only copy of one of the two existing projects) so the sentence, cards and evidence tables can be seen before any Google grant, which is the Mixpanel demo-data idea at zero build cost.

---

## 8. Ten changes with the biggest effect, in order

1. **Move the three do-first items above the stat cards on Overview**, with area dot, evidence in the title and worth/do-by on the right — the page then leads with the product's actual value.
2. **Replace the `<select>` switcher with a Cmd+K button** that searches projects and pages, shows health dot + do-first count per project, and holds All projects / Add / Connections.
3. **Restructure the sidebar to one project's workspace**: Work (4 links), Sources by job with Tracking first, collapsed-with-counts, unconnected as muted "Connect →" rows; settings/admin/account to the footer.
4. **Re-anatomise the recommendation card**: severity word + outlined area/product pills, evidence paragraph naming the test, three closed disclosures (Steps, Numbers, Track record), one primary Apply, Dismiss with reason; sort by severity then worth, filter by chips.
5. **Ship the phone layout**: single column, 52px top bar with switcher, floating four-item bottom bar (Overview, To change, Tracking, Ask), tables as list rows.
6. **Figures out of monospace**: Instrument Sans 600 tabular for sentence and stat values, Inter tabular in tables, Geist Mono only for IDs/code; delete the 34px banner figure.
7. **Table pass**: 40/48px density toggle, sticky header + first column, right-aligned numbers, abbreviated headers, filter chips in the URL, search + count on the left, 50-row paging with "Load more".
8. **Turn the product strip into a one-line sources strip** (dots + figure + delta, hollow dot + Connect → for absent products) placed under the stats, and add an "Open findings by area" count card beside the spend chart.
9. **Onboarding checklist card** (Connect → Pull → Analyse) in the sentence's slot with ghosted stat cards behind it and live sync-step progress.
10. **Enforce one highlighter and one primary button per page**, pills split into pill/status/badge, card-head meta limited to counts and dates with an `(i)` for explanations.

Items 1–5 change what the operator sees every day; 6–10 make it look like one product.

---

## Sources

Primary (product's own pages)
- Vercel — [New dashboard navigation available](https://vercel.com/changelog/new-dashboard-navigation-available), [Redesign now the default](https://vercel.com/changelog/dashboard-navigation-redesign-rollout), [Universal search](https://vercel.com/changelog/dashboard-universal-search), [Getting started (import flow)](https://vercel.com/docs/getting-started-with-vercel), [Geist Theme Switcher](https://vercel.com/geist/theme-switcher)
- Linear — [Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh), [How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui), [Customize your navigation in Linear Mobile](https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile), [Filters](https://linear.app/docs/filters)
- Stripe — [Web Dashboard basics](https://docs.stripe.com/dashboard/basics), [Mobile app](https://docs.stripe.com/dashboard/mobile), [Home page charts](https://support.stripe.com/questions/customize-your-dashboard-home-page-charts-for-better-business-insights)
- Mixpanel — [New left-side navigation](https://community.mixpanel.com/x/announcements/msg_xUtF5y0Vwkcl/introducing-mixpanels-new-left-side-navigation-for), [Side-nav experiment results](https://mixpanel.com/blog/navigation-experiment-results/)
- PostHog — [Redesigned nav menu](https://posthog.com/blog/redesigned-nav-menu)
- Optmyzr — [Account Dashboard guide](https://help.optmyzr.com/en/articles/5904076-account-dashboard-user-guide), [All Accounts Dashboard guide](https://help.optmyzr.com/en/articles/7892969-all-accounts-dashboard-user-guide), [2025 recap](https://www.optmyzr.com/blog/optmyzr-2025-ppc-feature-updates/), [Sidekick guide](https://help.optmyzr.com/en/articles/12505157-optmyzr-sidekick-about-user-guide)
- Adalysis — [Q3 2025 product updates](https://docs.adalysis.com/product/product-updates/q3-2025), [Q1 2025](https://docs.adalysis.com/product/product-updates/q1-2025)
- Google — [About optimization score](https://support.google.com/google-ads/answer/9061546?hl=en), [Recommendations API](https://developers.google.com/google-ads/api/docs/recommendations), [GA4 Home page](https://support.google.com/analytics/answer/11197963?hl=en), [Google Ads mobile app](https://business.google.com/us/ad-tools/google-ads-app/)
- GitHub — [Copilot code review comment improvements](https://github.blog/changelog/2026-05-12-copilot-code-review-comment-experience-improvements/), [Fix with Copilot](https://github.blog/changelog/2026-05-19-easily-apply-copilot-code-review-feedback-with-copilot-cloud-agent/), [About Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Ahrefs — [New Rank Tracker](https://ahrefs.com/blog/new-rank-tracker-release/), [Rank Tracker overview (Academy)](https://ahrefs.com/academy/how-to-use-ahrefs/rank-tracker/overview), [October 2025 features](https://ahrefs.com/blog/new-features-oct-2025/)
- Semrush — [Position Tracking](https://www.semrush.com/kb/32-position-tracking), [Landing Pages manual](https://www.semrush.com/kb/552-position-tracking-landing-pages-manual)
- AgencyAnalytics — [Marketing dashboard](https://agencyanalytics.com/feature/marketing-dashboard)
- NN/g — [Dashboards: making charts and graphs easier to understand](https://www.nngroup.com/articles/dashboards-preattentive/)
- Pencil & Paper — [Enterprise data tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables), [Enterprise filtering](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering)

Secondary (third-party; used only where flagged)
- [Kickpoint — Managing Google Ads recommendations](https://kickpoint.ca/managing-google-ads-recommendations/); [Search Engine Land — Google Ads recommendations and auto-apply](https://searchengineland.com/google-ads-recommendations-auto-apply-465909) (403 on fetch; used via search summary only); [TechWyse — Google Ads Results tab](https://www.techwyse.com/news/platform-updates/google-ads-results-tab-ai-text-guidelines-update); [Search Engine Land — new Google Ads design](https://searchengineland.com/google-ads-new-design-launching-august-443067); [Open Design — Stripe tokens](https://open-design.ai/plugins/design-system-stripe/), [Vercel tokens](https://open-design.ai/plugins/design-system-vercel/), [Linear tokens](https://open-design.ai/plugins/design-system-linear-app/); [Groas — Adalysis review 2026](https://www.groas.com/post/adalysis-review-2026-is-it-still-worth-it-and-whos-it-actually-for); [Whatagraph — web analytics dashboard examples](https://whatagraph.com/blog/articles/web-analytics-dashboard-examples); [Candu — onboarding checklists](https://www.candu.ai/blog/best-saas-onboarding-examples-checklist-practices-for-2025); [SaaSUI — onboarding flows](https://www.saasui.design/blog/saas-onboarding-flows-that-actually-convert-2026); [Amplitude — new navigation](https://community.amplitude.com/product-updates/meet-our-new-navigation-1593) (page did not load; top-bar description is from search summary and unverified).

Could not verify and therefore not claimed: Ahrefs' or Semrush's pagination/virtualisation for 10,000-row reports; the exact Semrush gear-icon table settings; Stripe's May 2024 navigation changelog text; Amplitude's current nav layout; any Google Ads Recommendations-page screenshot from 2025.
