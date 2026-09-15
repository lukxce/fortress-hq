# Phase 0 preflight

Proves that one identity can read all four Google products for your clients,
before any of the real app gets built. Read-only.

## Two ways to authenticate

**Your own Google account (recommended for a single operator).** One consent
screen and you reach every account you already manage. Nothing to grant.

```bash
npm install
# Cloud Console → Google Auth Platform → Clients → Create client → Desktop app
export OAUTH_CLIENT_ID='...apps.googleusercontent.com'
export OAUTH_CLIENT_SECRET='...'
node auth.mjs                         # opens Google, writes token.json
export ADS_MCC_ID=123-456-7890        # your manager account
cp clients.example.json clients.json  # then edit
npm run check
```

**Service account.** Never expires and is not tied to a personal login, but must
be added as a user on the Ads manager account and on each GA4 property, Search
Console property and GTM container.

```bash
npm install
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
export ADS_MCC_ID=123-456-7890
cp clients.example.json clients.json
npm run check
```

`token.json` takes precedence if both are present. Delete it to fall back to the
service account.

### Which to pick

| | Your account | Service account |
|---|---|---|
| Setup | one consent | a grant per property, per product |
| Expiry | breaks on revoke, password change, or 6 months unused | never |
| Tied to you personally | yes | no |
| Best for | running it yourself, locally | unattended on a server, or a team |

Start with your own account. Switch later if re-authenticating gets annoying or
the tool moves to a server.

With no `clients.json` it still runs the agency-level checks: can this identity
list Ads accounts, traverse the manager hierarchy, and see GA4, Search Console
and Tag Manager at all.

## See what you can actually reach

```bash
npm run inventory
```

Runs the same checks, then enumerates everything the credential can see across
all four products and writes it to `inventory.json`:

- **Google Ads** — the whole manager tree, managers marked so you can ignore
  them; only non-manager accounts are spendable and therefore selectable
- **GA4** — every property, grouped by account
- **Search Console** — every property with its permission level and domain
- **Tag Manager** — every container with its public `GTM-XXXX` id

This is the pick list. In the app it becomes the connect screen: sign in once,
see all of it, tick what you want, and nothing syncs until you do. An unselected
account costs nothing; a selected one costs about 20 operations a day forever.

GTM enumeration is deliberately slow, one account per 1.5 seconds, because the
Tag Manager API allows only 25 requests per 100 seconds per project.

## What each check proves

| Check | Proves |
|---|---|
| `listAccessibleCustomers` | the identity is attached to at least one Ads account |
| `customer_client` traversal | the MCC grant works and the sync can enumerate clients |
| `campaign` + metrics query | the Cloud project has production access, not Test |
| GA4 `accountSummaries` | the identity is on at least one GA4 account |
| GA4 `runReport` | the property is readable, and whether key events exist at all |
| GSC `sites.list` / `searchanalytics` | property access and a real query round-trip |
| GTM `accounts.list` / live version | container access, plus a consent-settings count |

## Where IDs come from

- **Ads customer id** — top left in the Google Ads UI, dashes are fine.
- **GA4 property id** — Admin → Property details, the numeric id, not `G-XXXX`.
- **GSC site url** — exactly as it appears in `sites.list`. Domain properties
  are `sc-domain:example.com`; URL-prefix properties keep the trailing slash.
- **GTM account and container id** — the numeric ids in the GTM URL, not the
  public `GTM-XXXX`.

## Notes

- Developer tokens were sunset on 9 September 2026. Access level now comes from
  the Google Cloud project behind your credentials. The header is only sent if
  you set `ADS_DEVELOPER_TOKEN`, and the API ignores it.
- The Ads checks use the REST API directly. This is not just for isolation: the
  Opteo `google-ads-api` library cannot authenticate with a service account at
  all, so the real app uses this same REST transport. See §4.8 of
  `../ARCHITECTURE-V2.md`. Treat this script as the transport prototype.
- Over REST, enums come back as names (`"ENABLED"`, not `2`) and int64 fields
  come back as JSON strings, which is why spend is parsed with `Number()`.
- `ADS_VERSION` at the top of the script is `v25`. Bump it for the v26 cutover.
- Search Console data lags two to three days, so the query deliberately samples
  a window that has already finalised.
