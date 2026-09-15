# fortress-hq-site

Two static pages for `fortress-hq.com`. Their only job right now is to satisfy
Google's brand verification, which requires a reachable application home page
and a privacy policy hosted on the domain you verify.

```
index.html     holding page
privacy.html   the privacy policy — this is the one Google's reviewer reads
styles.css     Glass system: grey scene, teal-green sheet, one highlighter
```

No build step, no dependencies.

## Before you deploy — two things to fix

1. ~~Contact address must receive mail.~~ **Done.** `fortress-hq.com` has no MX
   records, so the original `privacy@fortress-hq.com` would have bounced. The
   policy now uses `luka@digitl.rs`, which resolves to Google Workspace. Switch
   it back to a branded address once mail is set up on this domain.
2. **Check the facts.** The policy states Digitl is the operator, based in Niš,
   and describes retention as "engagement plus twelve months". Correct anything
   that is not true of how you actually intend to run it. It has to match
   reality, not aspiration.

## Deploy

Any static host works. Vercel, since the rest of your stack is there:

```bash
npx vercel --prod
```

Then point `fortress-hq.com` at it. The domain currently resolves to a parking
IP and serves nothing over HTTPS, so DNS needs changing and the certificate
needs to issue before verification will pass.

Confirm both pages are live over HTTPS before submitting:

```bash
curl -sI https://fortress-hq.com/ | head -1
curl -sI https://fortress-hq.com/privacy.html | head -1
```

## Then, in Google Auth Platform

- **Branding** — app name, support email, the home page `https://fortress-hq.com`,
  and the privacy policy `https://fortress-hq.com/privacy.html`.
- **Audience** — External, then publish to production. Leaving it in Testing
  expires every refresh token after seven days.
- **Verification Center** — submit brand verification.
- Verify `fortress-hq.com` in Search Console first, or the domain check fails.

## Brand verification: the prerequisite people miss

Google will not complete brand verification until the **top private domain**
(`fortress-hq.com`, not `www.`) is verified in Search Console by an owner. Until
that is done, applying for Basic access returns "you haven't completed brand
verification" every time, which reads like a rejection but is just the chain not
being finished.

Nameservers are Vercel, so the TXT record goes in the Vercel dashboard under
Domains, not at the registrar.

The home page is also checked for relevance to the app under review. It states
what the application does, rather than what it is not, for that reason. Do not
re-add `noindex` or language describing the page as a placeholder while
verification is pending.

## Note on this domain's future

If `fortress-hq.com` later becomes the Fortress HQ product marketing site, this
holding page gets replaced. Keep `/privacy.html` at the same URL when that
happens, or re-point the Google Auth Platform branding at wherever it moves.
The page carries `noindex` so it will not compete with a future product site in
search results.
