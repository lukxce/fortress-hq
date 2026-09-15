#!/usr/bin/env node
/**
 * One-time user OAuth. Opens Google's consent screen, catches the redirect on
 * localhost, and writes ./token.json with a refresh token the preflight and the
 * app reuse forever (until you revoke it or change your password).
 *
 *   OAUTH_CLIENT_ID=... OAUTH_CLIENT_SECRET=... node auth.mjs
 *
 * The OAuth client must be of type "Desktop app" so the loopback redirect is
 * allowed. Web clients reject http://localhost unless you register it.
 */

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { OAuth2Client } from "google-auth-library";
import { exec } from "node:child_process";

const CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const PORT = Number(process.env.OAUTH_PORT ?? 4180);

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

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
Missing credentials.

  1. Cloud Console → Google Auth Platform → Clients → Create client
  2. Application type: Desktop app
  3. Then:

     export OAUTH_CLIENT_ID='...apps.googleusercontent.com'
     export OAUTH_CLIENT_SECRET='...'
     node auth.mjs
`);
  process.exit(1);
}

const redirectUri = `http://localhost:${PORT}/callback`;
const client = new OAuth2Client({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri });

const url = client.generateAuthUrl({
  access_type: "offline",   // without this Google returns no refresh token
  prompt: "consent",        // forces a refresh token even on re-authorisation
  scope: SCOPES,
});

const server = createServer(async (req, res) => {
  if (!req.url.startsWith("/callback")) { res.writeHead(404).end(); return; }

  const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("code");
  const err = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("error");

  const page = (title, body) =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
     <body style="font:16px ui-sans-serif,system-ui;margin:56px;color:#142522">
     <h2 style="margin:0 0 8px">${title}</h2><p style="color:#404d4a">${body}</p></body>`;

  if (err || !code) {
    res.writeHead(400, { "Content-Type": "text/html" })
       .end(page("Authorisation failed", err ?? "No code returned."));
    console.error(`\nFailed: ${err ?? "no code returned"}`);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "Google returned no refresh token. Revoke the app at " +
        "myaccount.google.com/permissions and run this again."
      );
    }
    writeFileSync("./token.json", JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      scopes: SCOPES,
      obtained: new Date().toISOString(),
    }, null, 2));

    res.writeHead(200, { "Content-Type": "text/html" })
       .end(page("Authorised", "Token saved to token.json. You can close this tab."));
    console.log("\n✓ Refresh token saved to ./token.json");
    console.log("  Now run: npm run check");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/html" })
       .end(page("Token exchange failed", String(e.message ?? e)));
    console.error(`\nToken exchange failed: ${e.message ?? e}`);
    server.close();
    process.exit(1);
  }
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`\nOpening Google's consent screen.`);
  console.log(`If nothing opens, paste this into a browser:\n\n${url}\n`);
  console.log(`Waiting on http://localhost:${PORT}/callback ...`);
  exec(`open "${url}"`);   // macOS
});
