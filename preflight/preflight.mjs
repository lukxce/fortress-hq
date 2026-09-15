#!/usr/bin/env node
/**
 * Phase 0 preflight.
 *
 * Verifies that ONE identity (a service account, or your user OAuth creds)
 * can actually read Google Ads, GA4, Search Console and Tag Manager for the
 * clients you list. Read-only: it never writes anything anywhere.
 *
 *   node preflight.mjs
 *
 * Config, in order of precedence:
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the service account JSON key
 *   ./service-account.json          fallback location
 *   ADS_MCC_ID                      your manager account id (dashes ok)
 *   ./clients.json                  optional per-client probes, see clients.example.json
 *
 * Exit code 0 if every configured probe passed, 1 otherwise.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

// Google Ads API major version. Bump when you cut over; v26 lands Oct 2026 and
// removes campaign-level broad match and legacy auto-created assets.
const ADS_VERSION = "v25";

const SCOPES = [
  // Full set requested up front. Adding a scope later forces re-authentication,
  // and the roadmap needs writes: conversion actions in Ads, key events in GA4,
  // tags in Tag Manager. Phase 1 only reads, but the grant is already correct.
  "https://www.googleapis.com/auth/adwords",

  // GA4 needs BOTH: the Data API (runReport) only accepts analytics.readonly
  // or analytics — it does NOT accept analytics.edit, which is Admin-API only.
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/analytics.edit",

  "https://www.googleapis.com/auth/webmasters.readonly",

  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.publish",
];

// ---------------------------------------------------------------- output ----

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

const results = [];
const inventory = [];   // everything discovery found, for --inventory

function record(provider, providerId, displayName, extra = {}) {
  inventory.push({ provider, provider_id: String(providerId), display_name: displayName ?? "", ...extra });
}

function pass(product, subject, detail) {
  results.push({ ok: true, product, subject });
  console.log(`  ${c.green}✓${c.reset} ${product.padEnd(16)} ${subject}` +
    (detail ? `\n      ${c.dim}${detail}${c.reset}` : ""));
}

function fail(product, subject, error, remedy) {
  results.push({ ok: false, product, subject });
  console.log(`  ${c.red}✗${c.reset} ${product.padEnd(16)} ${subject}`);
  console.log(`      ${c.red}${error}${c.reset}`);
  if (remedy) console.log(`      ${c.yellow}→ ${remedy}${c.reset}`);
}

function skip(product, subject, why) {
  console.log(`  ${c.dim}– ${product.padEnd(16)} ${subject}  (${why})${c.reset}`);
}

function heading(text) {
  console.log(`\n${c.bold}${text}${c.reset}`);
}

// ------------------------------------------------------------------ util ----

const digits = (id) => String(id ?? "").replace(/\D/g, "");

/** Pull the most useful sentence out of a Google API error. */
function describe(err) {
  const gerr = err?.response?.data?.error ?? err?.errors?.[0] ?? err;
  const adsErr = err?.adsError;
  if (adsErr) return `${adsErr.code}: ${adsErr.message}`;
  const msg = gerr?.message ?? err?.message ?? String(err);
  const status = err?.response?.status ?? gerr?.code;
  return status ? `${status} ${msg}` : msg;
}

/** Map well-known failures to the thing you actually have to go and click. */
function remedyFor(product, err) {
  const text = JSON.stringify(err?.adsError ?? err?.response?.data ?? err?.message ?? "");
  if (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|DEVELOPER_TOKEN_NOT_APPROVED|ACTION_NOT_PERMITTED/.test(text))
    return "This Cloud project is at Test access. Apply for Basic on the Google Ads API Overview page in Cloud Console (auto-approved after brand verification).";
  if (/USER_PERMISSION_DENIED|CUSTOMER_NOT_FOUND/.test(text))
    return "The service account is not a user on this Google Ads account. Add it in Google Ads → Admin → Access and security → Users, on the MANAGER account.";
  if (/NOT_ADS_USER/.test(text))
    return "This identity has never been attached to any Google Ads account.";
  if (/PERMISSION_DENIED|403/.test(text)) {
    if (product === "GA4") return "Add the service account email in GA4 → Admin → Property access management (Viewer is enough).";
    if (product === "Search Console") return "Add the service account email in Search Console → Settings → Users and permissions (Full).";
    if (product === "Tag Manager") return "Add the service account email in GTM → Admin → User management, on the account or container.";
  }
  if (/SERVICE_DISABLED|has not been used in project|is disabled/.test(text))
    return "Enable this API in the Cloud project: APIs & Services → Library.";
  if (/invalid_grant|unauthorized_client/.test(text))
    return "Credential problem. Check the key file is the right one and not revoked.";
  return null;
}

// ------------------------------------------------------------- ads (REST) ---

/**
 * The Opteo Node library is built around user OAuth, so the preflight talks to
 * the Ads REST API directly. A service account gets a normal bearer token and
 * REST accepts it, which keeps this check independent of client-library choice.
 */
async function adsRequest(token, path, { method = "GET", body, loginCustomerId, projectId } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  // Google's own Ads client sends the quota project for service-account auth.
  // Without it some projects answer with a quota/consumer error instead of data.
  if (projectId) headers["x-goog-user-project"] = projectId;
  // Developer tokens were sunset on 9 Sep 2026: access level now comes from the
  // Cloud project. The header is still accepted but ignored, so it is only sent
  // if you explicitly set one.
  if (process.env.ADS_DEVELOPER_TOKEN) headers["developer-token"] = process.env.ADS_DEVELOPER_TOKEN;
  if (loginCustomerId) headers["login-customer-id"] = digits(loginCustomerId);

  const res = await fetch(`https://googleads.googleapis.com/${ADS_VERSION}/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const first = Array.isArray(data) ? data[0] : data;
    const detail = first?.error?.details?.[0]?.errors?.[0];
    const err = new Error(detail?.message ?? first?.error?.message ?? `HTTP ${res.status}`);
    err.adsError = {
      code: detail ? Object.values(detail.errorCode ?? {})[0] ?? res.status : res.status,
      message: detail?.message ?? first?.error?.message ?? text.slice(0, 300),
    };
    err.response = { status: res.status, data };
    throw err;
  }
  return data;
}

async function checkGoogleAds(token, mccId, clients, projectId) {
  heading("Google Ads");

  if (!mccId) {
    skip("Google Ads", "manager account", "ADS_MCC_ID not set");
    return;
  }

  // 1. Does this identity see any Ads account at all?
  let accessible = [];
  try {
    const out = await adsRequest(token, "customers:listAccessibleCustomers", { projectId });
    accessible = (out?.resourceNames ?? []).map((rn) => rn.split("/")[1]);
    pass("Google Ads", `listAccessibleCustomers → ${accessible.length} account(s)`,
      accessible.join(", ") || "none");
  } catch (err) {
    fail("Google Ads", "listAccessibleCustomers", describe(err), remedyFor("Google Ads", err));
    return;
  }

  if (!accessible.includes(digits(mccId))) {
    fail("Google Ads", `manager ${mccId} directly accessible`,
      "The MCC is not in listAccessibleCustomers.",
      "Add the service account as a user on the manager account itself, not on each client.");
  }

  // 2. Can it traverse the hierarchy? This is the call the sync actually makes.
  let children = [];
  try {
    const chunks = await adsRequest(token, `customers/${digits(mccId)}/googleAds:searchStream`, {
      method: "POST",
      loginCustomerId: mccId,
      projectId,
      body: {
        query: `
          SELECT customer_client.id,
                 customer_client.descriptive_name,
                 customer_client.manager,
                 customer_client.currency_code,
                 customer_client.time_zone
          FROM customer_client
          WHERE customer_client.status = 'ENABLED'
        `.trim(),
      },
    });
    for (const chunk of chunks ?? []) {
      for (const row of chunk.results ?? []) children.push(row.customerClient);
    }
    const live = children.filter((c) => !c.manager);
    for (const ch of children) {
      record("ads", ch.id, ch.descriptiveName, {
        is_manager: Boolean(ch.manager),
        currency: ch.currencyCode ?? null,
        timezone: ch.timeZone ?? null,
        parent_id: digits(mccId),
      });
    }
    pass("Google Ads", `customer_client traversal → ${live.length} client account(s)`,
      live.slice(0, 8).map((c) => `${c.id} ${c.descriptiveName ?? ""}`.trim()).join(" · ") +
      (live.length > 8 ? ` … +${live.length - 8} more` : ""));
  } catch (err) {
    fail("Google Ads", "customer_client traversal", describe(err), remedyFor("Google Ads", err));
    return;
  }

  // 3. Can it actually read metrics for each configured client account?
  for (const client of clients) {
    if (!client.ads_customer_id) continue;
    const cid = digits(client.ads_customer_id);
    try {
      const chunks = await adsRequest(token, `customers/${cid}/googleAds:searchStream`, {
        method: "POST",
        loginCustomerId: mccId,
        projectId,
        body: {
          query: `
            SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros
            FROM campaign
            WHERE segments.date DURING LAST_7_DAYS
          `.trim(),
        },
      });
      let rows = 0, cost = 0;
      for (const chunk of chunks ?? []) {
        for (const row of chunk.results ?? []) {
          rows++;
          cost += Number(row.metrics?.costMicros ?? 0);
        }
      }
      pass("Google Ads", `${client.name} · metrics readable`,
        `${rows} campaign-day rows, ${(cost / 1e6).toFixed(2)} spend last 7 days`);
    } catch (err) {
      fail("Google Ads", `${client.name} · metrics readable`, describe(err), remedyFor("Google Ads", err));
    }
  }
}

// -------------------------------------------------------------------- ga4 ---

async function checkGa4(auth, clients) {
  heading("Google Analytics 4");
  const admin = google.analyticsadmin({ version: "v1beta", auth });

  let summaries = [];
  try {
    const res = await admin.accountSummaries.list({ pageSize: 200 });
    summaries = res.data.accountSummaries ?? [];
    const props = summaries.flatMap((s) => s.propertySummaries ?? []);
    for (const acc of summaries) {
      for (const pr of acc.propertySummaries ?? []) {
        record("ga4", (pr.property ?? "").replace("properties/", ""), pr.displayName, {
          parent_id: (acc.account ?? "").replace("accounts/", ""),
          parent_name: acc.displayName ?? null,
        });
      }
    }
    pass("GA4", `accountSummaries → ${summaries.length} account(s), ${props.length} propert(ies)`,
      props.slice(0, 6).map((p) => `${p.property?.replace("properties/", "")} ${p.displayName}`).join(" · ") +
      (props.length > 6 ? ` … +${props.length - 6} more` : ""));
  } catch (err) {
    fail("GA4", "accountSummaries", describe(err), remedyFor("GA4", err));
    return;
  }

  const data = google.analyticsdata({ version: "v1beta", auth });
  for (const client of clients) {
    if (!client.ga4_property_id) continue;
    const prop = `properties/${digits(client.ga4_property_id)}`;
    try {
      const res = await data.properties.runReport({
        property: prop,
        requestBody: {
          dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }, { name: "keyEvents" }],
          limit: 10,
        },
      });
      const rows = res.data.rows ?? [];
      const sessions = rows.reduce((n, r) => n + Number(r.metricValues?.[0]?.value ?? 0), 0);
      const keyEvents = rows.reduce((n, r) => n + Number(r.metricValues?.[1]?.value ?? 0), 0);
      pass("GA4", `${client.name} · runReport`,
        `${sessions} sessions, ${keyEvents} key events last 7 days` +
        (keyEvents === 0 ? `  ${c.yellow}(no key events — check conversion setup)${c.reset}` : ""));
    } catch (err) {
      fail("GA4", `${client.name} · runReport`, describe(err), remedyFor("GA4", err));
    }
  }
}

// ---------------------------------------------------------------- console ---

async function checkSearchConsole(auth, clients) {
  heading("Search Console");
  const sc = google.searchconsole({ version: "v1", auth });

  let sites = [];
  try {
    const res = await sc.sites.list({});
    sites = res.data.siteEntry ?? [];
    for (const site of sites) {
      const u = site.siteUrl ?? "";
      record("gsc", u, u, {
        permission: site.permissionLevel ?? null,
        // sc-domain:example.com → example.com ; https://www.x.com/ → www.x.com
        domain: u.startsWith("sc-domain:") ? u.slice(10)
              : (() => { try { return new URL(u).hostname; } catch { return null; } })(),
      });
    }
    pass("Search Console", `sites.list → ${sites.length} propert(ies)`,
      sites.slice(0, 6).map((s) => `${s.siteUrl} (${s.permissionLevel})`).join(" · ") +
      (sites.length > 6 ? ` … +${sites.length - 6} more` : ""));
  } catch (err) {
    fail("Search Console", "sites.list", describe(err), remedyFor("Search Console", err));
    return;
  }

  // Data lags 2-3 days, so ask for a window that is definitely final.
  const day = (back) => new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);

  for (const client of clients) {
    if (!client.gsc_site_url) continue;
    try {
      const res = await sc.searchanalytics.query({
        siteUrl: client.gsc_site_url,
        requestBody: {
          startDate: day(10), endDate: day(4),
          dimensions: ["query"],
          rowLimit: 5,
        },
      });
      const rows = res.data.rows ?? [];
      const clicks = rows.reduce((n, r) => n + (r.clicks ?? 0), 0);
      pass("Search Console", `${client.name} · searchanalytics`,
        `top ${rows.length} queries, ${clicks} clicks in the sampled window`);
    } catch (err) {
      fail("Search Console", `${client.name} · searchanalytics`, describe(err),
        remedyFor("Search Console", err));
    }
  }
}

// ------------------------------------------------------------ tag manager ---

async function checkTagManager(auth, clients) {
  heading("Tag Manager");
  const gtm = google.tagmanager({ version: "v2", auth });

  let accounts = [];
  try {
    const res = await gtm.accounts.list({});
    accounts = res.data.account ?? [];
    // GTM quota is 25 requests per 100s per project, so walk accounts slowly.
    let containerCount = 0;
    for (const a of accounts) {
      try {
        const cl = await gtm.accounts.containers.list({ parent: `accounts/${a.accountId}` });
        for (const ct of cl.data.container ?? []) {
          containerCount++;
          record("gtm", ct.containerId, ct.name, {
            parent_id: a.accountId,
            parent_name: a.name ?? null,
            public_id: ct.publicId ?? null,
            usage: (ct.usageContext ?? []).join(","),
          });
        }
        await new Promise((r) => setTimeout(r, 1500));
      } catch { /* an account we can list but not read is not fatal */ }
    }
    pass("Tag Manager", `accounts.list → ${accounts.length} account(s), ${containerCount} container(s)`,
      accounts.slice(0, 6).map((a) => `${a.accountId} ${a.name}`).join(" · "));
  } catch (err) {
    fail("Tag Manager", "accounts.list", describe(err), remedyFor("Tag Manager", err));
    return;
  }

  for (const client of clients) {
    if (!client.gtm_account_id || !client.gtm_container_id) continue;
    const path = `accounts/${client.gtm_account_id}/containers/${client.gtm_container_id}`;
    try {
      const container = await gtm.accounts.containers.get({ path });
      const live = await gtm.accounts.containers.versions.live({ parent: path });
      const v = live.data;
      const tags = v.tag ?? [];
      const consentAware = tags.filter(
        (t) => t.consentSettings && t.consentSettings.consentStatus !== "notSet"
      ).length;
      pass("Tag Manager", `${client.name} · live container`,
        `${container.data.publicId} "${container.data.name}", version ${v.containerVersionId}, ` +
        `${tags.length} tags, ${consentAware} with consent settings`);
    } catch (err) {
      fail("Tag Manager", `${client.name} · live container`, describe(err),
        remedyFor("Tag Manager", err));
    }
  }
}

// ------------------------------------------------------------------ main ----

async function main() {
  console.log(`${c.bold}${c.cyan}Ads Copilot v2 — Phase 0 preflight${c.reset}`);
  console.log(`${c.dim}Read-only. Nothing is created, changed or published.${c.reset}`);

  // Two ways in. User OAuth (your own Google account, reaches everything you
  // already have access to) or a service account (never expires, but must be
  // granted on each property). token.json wins if both are present.
  const tokenFile = existsSync("./token.json") ? "./token.json" : null;
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    (existsSync("./service-account.json") ? "./service-account.json" : null);

  if (!tokenFile && !keyFile) {
    console.log(`\n${c.red}No credentials found.${c.reset}`);
    console.log(`Pick one:`);
    console.log(`  ${c.bold}Your own Google account${c.reset} (simpler — reaches everything you already manage)`);
    console.log(`    OAUTH_CLIENT_ID=... OAUTH_CLIENT_SECRET=... node auth.mjs`);
    console.log(`  ${c.bold}Service account${c.reset} (never expires — must be granted per property)`);
    console.log(`    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`);
    process.exit(1);
  }

  const mode = tokenFile ? "user OAuth" : "service account";
  let identity = "(unknown)";
  if (tokenFile) {
    identity = "your Google account (refresh token)";
  } else {
    try {
      identity = JSON.parse(readFileSync(keyFile, "utf8")).client_email ?? identity;
    } catch { /* a non-JSON credential source is fine */ }
  }

  const mccId = process.env.ADS_MCC_ID ?? null;
  const clients = existsSync("./clients.json")
    ? JSON.parse(readFileSync("./clients.json", "utf8"))
    : [];

  console.log(`\n${c.dim}auth      ${c.reset}${mode}`);
  console.log(`${c.dim}identity  ${c.reset}${identity}`);
  console.log(`${c.dim}manager   ${c.reset}${mccId ?? "not set"}`);
  console.log(`${c.dim}clients   ${c.reset}${clients.length ? clients.map((x) => x.name).join(", ") : "none configured (agency-level checks only)"}`);

  let auth = null, token, authClient;
  try {
    if (tokenFile) {
      const t = JSON.parse(readFileSync(tokenFile, "utf8"));
      const oauth = new OAuth2Client({ clientId: t.client_id, clientSecret: t.client_secret });
      oauth.setCredentials({ refresh_token: t.refresh_token });
      const at = await oauth.getAccessToken();
      token = at?.token ?? at;
      authClient = oauth;
    } else {
      auth = new GoogleAuth({ keyFile, scopes: SCOPES });
      token = await auth.getAccessToken();
      authClient = await auth.getClient();
    }
  } catch (err) {
    const msg = err?.message ?? String(err);
    console.log(`\n${c.red}Could not get a token for this credential.${c.reset}`);
    console.log(`  ${msg}`);
    if (/account not found|invalid_grant/i.test(msg)) {
      console.log(`  ${c.yellow}→ The service account in this key file does not exist, or the key was deleted. Check you copied the right JSON out of the right Cloud project.${c.reset}`);
    } else if (/invalid_client|unauthorized_client/i.test(msg)) {
      console.log(`  ${c.yellow}→ The credential is malformed or the client is not authorised for these scopes.${c.reset}`);
    } else if (/invalid_grant/i.test(msg) && tokenFile) {
      console.log(`  ${c.yellow}→ The refresh token is no longer valid (revoked, password changed, or unused 6+ months). Re-run: node auth.mjs${c.reset}`);
    } else if (/ENOENT|no such file/i.test(msg)) {
      console.log(`  ${c.yellow}→ Key file not found at ${keyFile}.${c.reset}`);
    }
    process.exit(1);
  }

  let projectId = null;
  try { if (auth) projectId = await auth.getProjectId(); } catch { /* optional */ }

  await checkGoogleAds(token, mccId, clients, projectId);
  await checkGa4(authClient, clients);
  await checkSearchConsole(authClient, clients);
  await checkTagManager(authClient, clients);

  if (process.argv.includes("--inventory")) {
    const byProvider = {};
    for (const it of inventory) (byProvider[it.provider] ??= []).push(it);
    writeFileSync("./inventory.json", JSON.stringify(byProvider, null, 2));

    heading("Inventory");
    for (const [prov, items] of Object.entries(byProvider)) {
      const label = { ads: "Google Ads", ga4: "GA4", gsc: "Search Console", gtm: "Tag Manager" }[prov];
      const spendable = prov === "ads" ? items.filter((i) => !i.is_manager) : items;
      console.log(`  ${c.bold}${label}${c.reset} — ${spendable.length} selectable`);
      for (const i of spendable.slice(0, 40)) {
        console.log(`    ${c.dim}${i.provider_id.padEnd(22)}${c.reset}${i.display_name}`);
      }
      if (spendable.length > 40) console.log(`    ${c.dim}… +${spendable.length - 40} more${c.reset}`);
    }
    console.log(`\n  ${c.dim}written to ./inventory.json — this is the pick list${c.reset}`);
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);

  console.log(`\n${c.bold}${passed.length} passed, ${failed.length} failed${c.reset}`);
  if (failed.length) {
    console.log(`${c.yellow}Fix the arrows above, then run again.${c.reset}`);
    process.exit(1);
  }
  console.log(`${c.green}Phase 0 access is in place. Phase 1 can start.${c.reset}`);
}

main().catch((err) => {
  console.error(`\n${c.red}Preflight crashed:${c.reset} ${err?.stack ?? err}`);
  process.exit(1);
});
