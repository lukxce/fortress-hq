# Fortress HQ — how the whole thing works

A Google Ads tool for an agency running many small accounts, that also reads Google Analytics, Search Console and Tag Manager. It does four jobs:

1. **Tells you what to change**, in instructions specific enough to act on without a follow-up question — and makes five kinds of change itself, behind a confirmation that names the change and the money.
2. **Checks whether it was right**, by turning predictions into experiments with an honest verdict.
3. **Sets up conversion tracking properly**, writing the tags into Tag Manager or handing back an import file.
4. **Builds campaigns with you**, from demand the business can already be shown to have.

It lives at www.fortress-hq.com on Vercel with Neon Postgres, and never changes anything in Google Ads without an explicit confirmation.

It started from the Ads Copilot design — the screens, the "AI explains, never calculates" rule, the recommendation cards, the learning loop, the five guarded actions — and differs in three deliberate ways: every judgement is **tested for chance** (these accounts do 10–40 conversions a month, where fixed thresholds fire on noise), it reads **four Google products**, and it runs **many clients and many users**.

---

## Contents

- [The screens](#the-screens)
- [Architecture](#architecture)
- [The data](#the-data)
- [The findings engine](#the-findings-engine) ← where every number comes from
- [Statistical honesty](#statistical-honesty)
- [The brain](#the-brain)
- [The learning loop](#the-learning-loop)
- [What it can change by itself](#what-it-can-change-by-itself)
- [Conversion tracking and Tag Manager](#conversion-tracking-and-tag-manager)
- [The campaign builder](#the-campaign-builder)
- [Ask](#ask)
- [Reporting](#reporting)
- [Users and access](#users-and-access)
- [Design system](#design-system)
- [Safety rails, in one list](#safety-rails-in-one-list)
- [Known limits](#known-limits)
- [File map](#file-map)

---

## The screens

**All clients** (`/overview`) — every client against the previous period, how many recommendations are open, when it last synced, and every campaign across the portfolio in one filterable table.

Per client (`/clients/[id]/…`), from the sidebar, with a client switcher that keeps you on the same page:

- **Overview** — opens with a sentence assembled from the same figures as the cards under it, so it cannot disagree with them: *"You spent 46,031 RSD and got 20 conversions — 2,304 RSD each. That's 27% more expensive than the 30 days before."* Four stat cards with arrows, spend per day with zero-conversion days in grey, the top three things needing attention, and every campaign — filterable by status, type and health, sortable — with health as *good / okay / poor* and the reason on hover. Clicks with no conversions says so outright and links to tracking.
- **What to change** — roughly what is on the table per month, the analysis's one-line summary, then cards grouped by area (tracking first). Each card: severity (*do first / worth doing / when you have time*), worth per month, time, by when, why, numbered steps, the table of numbers behind it, and — where one exists — a button that makes the change.
- **Experiments** — *suggested, not started* / *running now* / *finished*, kept apart.
- **Conversion tracking** — the audit in fix order, every conversion action, a four-question builder, and goals created so far with their import files.
- **New campaign** — drafts, and the seven-step builder.
- **Reports** — week over week, no AI.
- **Brain** — how a recommendation is made, the track record, current focus, what data it can see with row counts and dates, blind spots, and this client's brand words, website and targets.
- **Ask** — a bubble on every client page.

---

## Architecture

```
Google Ads · Analytics · Search Console · Tag Manager
      │  sync: one operation per query regardless of rows, so it reads generously
      ▼
┌──────────────────────────────────────────────────────────────┐
│  Neon Postgres                                                │
│  campaigns · ad groups · ads · keywords · search terms       │
│  daily metrics · hour×day · device/network/geo · negatives   │
│  conversion actions · GA4 by day and landing page · GSC     │
│  GTM tags · placements · monthly shape                       │
└──────────────────────────────────────────────────────────────┘
      │
      ├─► findings engine   ← ALL arithmetic, and every test for chance
      │         │
      │         ▼
      │     the brain       ← explains, sequences, proposes; invents no figure
      │         │
      │         ▼
      │     recommendations → actions → experiments → verdicts
      │
      ├─► report.ts         ← week over week, no AI
      └─► snapshot.ts       ← what the brain and Ask are allowed to know
```

---

## The data

Migrations live in `lib/migrations`, applied automatically on first query.

**Structure** — campaigns (with impression share lost to budget and to rank, kept apart), ad groups, ads with their headlines, keywords with quality score components, existing negatives at campaign, ad group and shared-list level.

**Performance** — daily metrics for 365 days (campaign) and 90 days (ad group), search terms for 90 days (standard and Performance Max, without double counting), hour × day × campaign, device, network, country, landing pages, placements, conversion mix by month.

**Other products** — GA4 sessions and key events by day and channel, and by landing page and channel; Search Console queries by day; the live Tag Manager container.

**The loop** — recommendations, experiments, action log, analysis runs, drafts, launch steps, site summaries.

**Sync** (`lib/jobs/sync.ts`, `structure.ts`, `segments.ts`) — every step independent, so one failure cannot take the rest down. Daily at 04:00 UTC via Vercel Cron (`/api/jobs/daily`, guarded by `CRON_SECRET`), and on demand from any page.

---

## The findings engine

`lib/engine/*`. Every figure the tool ever shows comes from here. Everything is judged against the account's own cost per conversion; nothing is compared with an external benchmark.

**If there are no conversions at all, the brain stops and says so.** There is no yardstick, so every judgement would be meaningless.

What it finds, by area:

| Area | Findings |
|---|---|
| Tracking | nothing counted · counting every submission · weak actions primary · enquiry and qualified lead both primary · more than three primary · GA4 import and Ads tag double counting · a primary action gone quiet for 14+ days · auto-tagging off · call reporting in a country without forwarding numbers · Ads and Analytics disagreeing · no live Ads tag or linker in Tag Manager |
| Wasted spend | search terms with no conversions (a ceiling, with the proven subset separated) · keywords spending with no conversions · devices, networks and placements with no conversions · junk-app and cheap-click floods · campaigns with no conversions |
| Hours and days | the time band that costs more · the band that costs less · the day of the week that costs more |
| Budget | when performance changed and what each additional conversion cost (the marginal cost) · campaigns capped by budget while beating the account · campaigns significantly more expensive · budget under 3× cost per conversion · pacing |
| Bidding | targets below the volume floor · Google's own bid-strategy status · value bidding on identical values · AI Max migration state · keywords that convert at too high a cost · devices and networks significantly worse |
| Opportunities | **searches that convert but are not keywords** — usually the biggest win · **Search Console queries the site ranks 4–20 for with no ads** · paying for queries already ranked top-three organically |
| Ads and pages | thin ads · **landing pages where paid visitors stop engaging** (Analytics against Ads spend) · low quality scores with the component that drags them |

**Money on the table.** Only spend above what the conversions were worth counts, over the window the finding covers, scaled to a month:

```
monthlyImpact = max(0, spend − conversions × accountCpa) ÷ windowDays × 30.4
```

**Brand protection.** Brand words are derived from the client's name and domain — excluding trade and city words, because "Klima Servis Niš" is a service-plus-city phrase, not a brand — and editable on the Brain page. Any search term or keyword containing one is removed from waste findings, and refused as a negative.

---

## Statistical honesty

`lib/engine/stats.ts`. The single largest departure from Ads Copilot.

At 20 conversions a month, a segment with 5 conversions has a true cost per conversion anywhere from 0.43× to 3.1× what it shows. In simulation, "at least 5 conversions and cost per conversion 1.3× the average" flagged a segment with no real difference 20–36% of the time. A fixed spend floor of "50" is about €0.43 in a dinar account.

So:

- **"This segment is worse"** — an exact binomial test of the segment's conversions against its share of spend, corrected for how many segments were examined, and only when at least 3 conversions were expected.
- **"This segment converts nothing"** — only once it has spent −ln(0.05 ÷ K) times the account's cost per conversion: 3.0× alone, 4.1× across devices, 4.9× across weekdays, 6.2× across hours, about 7× across fifty keywords.
- **"Cost per conversion is above target"** — only when even the top of the exact 95% interval on the conversion count still misses.
- **When performance changed** — every split point tested, corrected for the number tried; the current, still-filling month excluded.
- Below the thresholds, a pattern is shown once as **"not yet evidence"**, with when to look again — never as something to act on.

The tables in the research note were reproduced to the decimal.

---

## The brain

`lib/brain/recommend.ts`, Claude Opus 5.

> **The AI is never asked to find a number. Only to explain one.**

It receives the findings already computed, the baseline, the brand words, campaign settings, previous recommendations and the track record, behind a knowledge layer (`lib/brain/knowledge/`) that was fact-checked claim by claim against Google's documentation in September 2026: operating context for small Balkan accounts, low-volume accounts, bidding and reporting mechanics, lead-generation measurement, Performance Max, AI Max, benchmarks with provenance, and diagnostic reasoning.

It writes, per recommendation: title, area, severity, the ids of the findings it rests on, why, numbered steps naming exact menu items, days until it should be done (respecting learning periods), effort, at most one action, an optional direction-only prediction, and an optional campaign plan.

**The monthly figure on a card is summed by code from the findings it cites** — never taken from the model.

Hard rules, in the prompt and enforced again in code: never negative a converting search or a close variant; never anything with a brand word; only terms that are non-converting searches in this account.

**Tolerant parsing.** Each item is validated on its own. A bad action loses its button; a bad plan loses the plan; only an item missing its title or steps is skipped. The run records how many were written, skipped, and how many proposed buttons the guards refused.

---

## The learning loop

```
recommendation with a prediction
        │
        ▼
   experiment created          applied_at = NULL   ← no clock yet
        │
        │  started: by the button, or "I did it myself"
        ▼
   baseline snapshotted        60 days before, excluding the last 3
        │
        ▼
   check date                  long enough to collect ~20 conversions at the
        │                      baseline rate (14–90 days), plus 7 for lag
        ▼
   verdict                     same exact test as the findings:
                               confirmed / refuted / inconclusive
```

A fortnight and "CPA moved 10%" is a coin flip on these accounts, so the check date is sized to the account. Confirmed and refuted require the change to be unlikely under chance; everything else is honestly inconclusive. Dismissing a recommendation withdraws its un-started experiment; running ones are kept. The Brain page counts only started tests, and says plainly when there is no track record.

---

## What it can change by itself

Five actions, and only five (`lib/actions`).

| Action | Guard |
|---|---|
| Pause campaign | Confirmation names the campaign and its 30-day spend |
| Add negative keywords | The three hard rules; existing negatives skipped; Search campaigns only |
| Change budget | ±30% per step; the new figure computed by code; shared budgets warned |
| Ad schedule | Always a full week; "adjust" only on Manual CPC or Maximise Clicks, otherwise exclusion |
| Device bid adjustment | Full range only on Manual CPC, Maximise Clicks or Target CPA; otherwise −100% only; never Performance Max |

Every action is validated against the live account when the brain proposes it and again when applied. **Preview** returns the summary and a token signed over exactly that action; **apply** runs only the action the token was issued for, so what was confirmed is what runs. Every change is recorded in the action log with Google's response.

**The ad-schedule trap.** Google treats ad schedules as an allowlist: one criterion on its own takes the campaign dark for every other hour. `fullWeekSchedule()` always writes a complete week, replaces any existing schedule, handles bands that wrap midnight, and respects six entries per day by giving back the weakest adjustment first. Tested in `tests/schedule.test.ts`.

---

## Conversion tracking and Tag Manager

The audit runs first on the Tracking page, in the order to fix things.

The builder asks four questions — what counts as a win, how we know it happened (thank-you page, dataLayer event, or a tap on the phone number), what it is called and whether it has a value, and whether bidding should optimise toward it — then creates the conversion action in Google Ads. **Counting is locked to the answer to the first question**: once per click for leads, every time for sales.

Tags go straight into Tag Manager's default workspace — the Ads conversion tag, a **conversion linker** if the workspace has none, and the matching **GA4 event** (marked analysis-only, so it is never imported into Ads as a second primary action) — or come back as an **import file**. Nothing is published; the result screen says the goal records nothing until you publish.

The signal that feeds bidding goes browser → Ads, not through Analytics: an imported GA4 key event arrives up to a day late, on a different attribution model.

---

## The campaign builder

Seven steps, one decision per screen, saved as you go.

| Step | What happens |
|---|---|
| 1 Your business | Reads the site and says what it sells, to whom, where — never inventing a service, place or phone number |
| 2 What counts as a win | The primary conversions the campaign will chase; stale or missing ones push you to Tracking first |
| 3 Where to advertise | Google's own location suggestions; "people in these places" vs "also people interested" in plain words |
| 4 What people search | Groups seeded from **Search Console queries and searches that already converted**, each keyword labelled with its source |
| 5 Your ads | Headlines and descriptions with counters that turn red at 30 and 90, and a live Google result preview |
| 6 Your budget | Monthly equivalent as you type; no target CPA on purpose |
| 7 Check and launch | Problems in plain words with the step to fix each, then the confirmation |

Match types are written as *"This exact search" / "Searches containing this" / "Related searches too"*.

**Launch** (`lib/jobs/launch.ts`) is a resumable state machine: budget → campaign (paused; Search only) → locations → negatives → [ad group → keywords → ad] per group → enable. Every step is logged with its resource before the next, so a failure leaves a paused campaign and relaunching resumes rather than duplicating.

A campaign proposed by the brain becomes a draft with landing pages from the account's existing ads and **headlines left visibly empty**.

---

## Ask

One snapshot, one prompt, one answer on Claude Sonnet 5 — not a tool-calling loop, which keeps replies to seconds. Answers only from the snapshot, names the window of every figure, explains jargon in the same breath, says when a figure is not there, and points to the page that can change things.

---

## Reporting

`lib/report.ts` — no AI. The two most recent complete Monday–Sunday weeks (today never included), every metric with its arrow, the hour-by-hour shape over 90 days coloured against the account's own cost per conversion (green cheaper, amber up to double, red double or nothing after a conversion's worth of spend), day of week, devices, campaign movement, and eight weeks of daily spend.

Arrows always show the real direction; lower-is-better flips only the colour.

---

## Users and access

A shared password is the outer door (`proxy.ts`). Behind it, identity through Clerk when configured — each user connects their own Google account and sees only their own clients plus anything shared with them. Every client-scoped route resolves the client through that scope, so a client you cannot see is a 404. Background jobs run for nobody and see every client.

---

## Design system

White, grey and blue, with neon yellow used strictly as a highlighter pen:

```css
.mark { background: linear-gradient(180deg, transparent 58%, var(--marker) 58%); }
```

| Token | Value | Use |
|---|---|---|
| `--paper` / `--ground` | `#ffffff` / `#f4f6fa` | Cards / page |
| `--ink` … `--ink-4` | `#0d1420` → `#a6b1c2` | Text, blue-biased |
| `--blue` | `#1d5fd1` | The single accent |
| `--marker` | `#e2ff3c` | Highlighter only, never a fill |
| `--ok` / `--warn` / `--bad` | green / amber / red | Semantic only |

Light only. Instrument Sans (display), Inter (body), Geist Mono (figures). Every component is a class — `.card`, `.btn`, `.field`, `.pill`, `.table-wrap` — in `app/globals.css`. Dialogs render into `document.body`, because a fixed overlay inside an animated element is positioned against that element, not the window.

---

## Safety rails, in one list

1. Nothing reaches Google Ads without a confirmation that names the change and the money.
2. What was confirmed is what runs: apply only accepts the action its signed token was issued for, re-validated against the live account.
3. Only five action types exist; anything else stays written steps.
4. Budget changes capped at ±30% per step.
5. Ad schedules are always written as a full week.
6. Negatives cannot touch converting searches, close variants or brand words.
7. Schedule and device adjustments are only offered where the bid strategy honours them.
8. The AI never produces a number; card figures are summed by code.
9. Every "worse" is tested for chance; below the threshold it is "not yet evidence".
10. A malformed AI field costs one button, never the whole run.
11. Experiments get no clock until started, and inconclusive is reported as inconclusive.
12. Campaign launches start paused and resume rather than duplicate.
13. Tag Manager changes are never published by Fortress.
14. Generated drafts leave headlines visibly empty rather than inventing ad copy.
15. Ask is read-only and says when it does not know.
16. A client you cannot see is a 404.

---

## Known limits

- **Offline conversion import** is recommended but not built: new integrations must use Google's Data Manager API.
- **Calls** cannot be recorded from ads in Serbia; only taps on the phone number are countable.
- **Performance Max placements** show where ads ran, never what they cost.
- **Estimated call-asset conversions** in countries without forwarding numbers: Google's own help page contradicts itself.
- **Cyrillic vs Latin keyword matching** is undocumented by Google.
- **Clerk** identity is wired but has not been exercised with real keys.
- The analysis costs roughly $0.15–0.25 per run on Opus 5.

---

## File map

```
lib/
  engine/        findings.ts · actionable.ts · segments.ts · forensics.ts · bidding.ts
                 stats.ts (the tests) · brand.ts (brand words, close variants) · metrics.ts
  brain/         recommend.ts · snapshot.ts · chat.ts · knowledge/
  actions/       kinds.ts (validation) · apply.ts (preview, apply) · schedule.ts (full week)
  jobs/          sync.ts · structure.ts · segments.ts · evaluate.ts · launch.ts
  tracking/      audit.ts
  builder/       draft.ts · site.ts · suggest.ts
  google/        ads.ts · goals.ts · auth.ts · discovery.ts
  report.ts      week over week and overview, no AI
app/(app)/       overview · clients/[id]/{insights, experiments, tracking, builder, reports, brain}
app/api/         sync · analyse · actions · recommendations · experiments · chat · goals
                 drafts · builder · clients/settings · jobs/[name]
components/      shell (Sidebar, AskBubble) · overview · insights · experiments
                 tracking · builder · brain · ui
tests/           schedule.test.ts
```
