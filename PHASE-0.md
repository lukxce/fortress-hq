# Phase 0 — access, before any code

*Revised 15 Sep 2026. Single-operator tool, used on accounts you already manage,
nobody else ever logs in.*

## Status: access chain COMPLETE ✅

**Basic access is approved** on project `388604482965`. That chain went:

| | |
|---|---|
| Privacy policy + home page | live at `fortress-hq.com`, repo [`lukxce/fortress-hq`](https://github.com/lukxce/fortress-hq) |
| Domain verified in Search Console | done (TXT on Vercel DNS) |
| Brand verification | approved |
| **Google Ads API access** | **Basic — 15,000 ops/day** |

What Basic gives you over Explorer: 15,000 operations a day instead of 2,880,
plus Keyword Planner, account creation, user management, and billing/invoice
data. None of it is load-bearing for Phase 1, but the invoice data is worth
having in the monthly report and the quota headroom means mutations never
need rationing.

**Steps 1 and 2 below are done. Go to step 3.**

---

## Why this got shorter

Two facts, both confirmed against Google's access-levels page:

- **Explorer access needs no brand verification.** Brand verification is a
  prerequisite for *Basic* only. You apply for Explorer in Cloud Console and
  Google "may automatically upgrade your project's API access level to Explorer
  after you submit your application."
- **Explorer gives 2,880 production operations per day.** A full daily sync of
  one account costs roughly 20 operations, so that ceiling is somewhere around
  **140 accounts**. Even at double the op cost it is 70.

And because a service account has no consent screen, the OAuth consent screen,
the privacy policy, the verified domain and the seven-day token expiry all stop
being your problem. They exist to protect *other people* consenting to *your*
app. There are no other people.

**What you give up at Explorer**, and why none of it matters here:

| Blocked | Used by this design? |
|---|---|
| Keyword Planner, Reach Planner, Audience Insights | No. The campaign builder generates keywords from a site crawl and a model, not from Keyword Planner. |
| Account creation (`CreateCustomerClient`) | No. You create client accounts in the UI. |
| User access management | No. |
| Billing, account budgets, invoices | Only a nice-to-have on the monthly report. Read them in the UI. |

Everything the tool actually does — sync, pacing, alerts, scoring, negatives,
budget changes, pausing, campaign launches — is available at Explorer.

---

## The five steps

### 1. Pick or create the Cloud project ✅ done

You said you are making a new one. Fine: both existing projects are at Explorer
anyway, so there is nothing to inherit.

Name it something you will recognise later. Not "My First Project".

### 2. Apply for access ✅ done — Basic granted

Cloud Console → **Google Ads API Overview** → Apply for access.

Google may grant it automatically on submission. If the flow asks you to
complete a basic sign-up or fill in minimal consent-screen fields first, do the
minimum it asks for and stop there. You are not pursuing verification.

Check the page afterwards and confirm it reads Explorer, not Test. Test cannot
touch production accounts at all, and in v25 that failure surfaces as
`CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`.

### 3. Enable the five APIs

Cloud Console → APIs & Services → Library, in that project:

```
googleads.googleapis.com
analyticsadmin.googleapis.com
analyticsdata.googleapis.com
searchconsole.googleapis.com
tagmanager.googleapis.com
```

All five hostnames verified against Google's live discovery directory. A missing
one fails at runtime with `SERVICE_DISABLED`, which the preflight names.

### 4. Create the service account and grant it access

Cloud Console → IAM & Admin → Service Accounts → Create. No IAM roles needed on
the project. Create a JSON key and save it outside the repo; it is shown once.

Then four grants. Ads at the **manager** level, the rest on one pilot client.

| Product | Where | Level |
|---|---|---|
| Google Ads | Your MCC → Admin → Access and security → Users | Standard |
| GA4 | Property → Admin → Property access management | Viewer |
| Search Console | Property → Settings → Users and permissions | Full |
| Tag Manager | Admin → User management | Read |

Add the service account to the **manager account**, not to each client. Access
inherits down, and it sidesteps the 20-accounts-per-email cap. Service accounts
cannot hold Admin or Email access levels in Google Ads.

Watch for: the Google Ads user flow normally sends an email invitation the
invitee accepts, which a service account cannot do. If the invite sits pending,
that is the friction point. The preflight catches it immediately because
`listAccessibleCustomers` comes back empty.

### 5. Run the preflight ← the real gate

```bash
cd preflight
npm install
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
export ADS_MCC_ID=123-456-7890
cp clients.example.json clients.json   # fill in the pilot client
npm run check
```

Green across all four products means Phase 1 starts.

---

### 6. A Postgres to point at

*Added 15 Sep 2026 — this was missing, and Phase 1 cannot start without it.*

This machine has no Postgres, no Docker and no Homebrew. Pick one:

**Neon free tier (recommended).** Browser signup, copy the connection string,
done in about three minutes. No install. It is the same hosted Postgres the
architecture already targets for deployment, so `DATABASE_URL` is the only
difference between local and hosted, and there is never a "works locally, breaks
in prod" dialect surprise. The tool talks to Google APIs constantly anyway, so
offline development was never a real scenario.

**Postgres.app** if you want it fully local. Download, drag to Applications,
click start. No terminal, no password prompt, no Homebrew.

Avoid installing Homebrew or Docker Desktop just for this. Both are large
installs that want your password, and neither buys anything the two options
above do not.

Either way the app only ever sees:

```
DATABASE_URL=postgres://...
```

## The one input that is not a click

Per account, is the goal a **cost per acquisition** or a **return on ad spend**,
and what is the target number. Scoring is goal-aware, so without this a campaign
score is measured against an account median that means nothing for an
e-commerce account. A text file is enough.

---

## Appendix: how the Basic chain was completed (for reference)

Kept because the same sequence applies to any future Cloud project. The order
is strict, and applying out of order returns "you haven't completed brand
verification" which reads like a rejection but is just an unfinished chain.

The trigger conditions that made Basic worth pursuing:

- You pass roughly 100 accounts, or start making enough daily mutations that
  2,880 operations begins to bind. `quota_usage` in the app will tell you.
- You want invoice or account-budget data in the monthly report.
- You want Keyword Planner volumes rather than model-generated keywords.

The path, which is the old Phase 0:

1. Consent screen to **External**, publishing status **In production**.
2. Verify a domain in Search Console.
3. **Brand verification**: app name, support email, logo, home page, and a
   privacy policy URL on that domain.
4. Apply for Basic. Auto-approved within minutes once brand verification passes.

The site for step 3 is built, deployed and pushed to
[`lukxce/fortress-hq`](https://github.com/lukxce/fortress-hq) — a holding page
and a privacy policy covering all four scopes with Google's required Limited Use
wording. It needs deploying, DNS pointing at it, and the contact address made to
deliver mail. None of that is needed today.

Do not apply for Standard unless 15,000 operations a day binds. It is a manual
review with a design questionnaire and a compliance framework attached.
