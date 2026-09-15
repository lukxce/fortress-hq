# Fortress HQ

Advertising and analytics operations across Google Ads, Analytics, Search
Console and Tag Manager, for the accounts under Digitl's management.

Deployed at **fortress-hq.com**.

## Routes

| Path | Access | What |
|---|---|---|
| `/` | public | Landing page. Public on purpose: Google's brand verification checks that the app's home page is reachable and clearly relevant. |
| `/privacy.html` | public | Privacy policy. This exact URL is registered on the OAuth consent screen — do not move it. |
| `/login` | public | The password gate. |
| `/overview` | gated | Setup state, counts, what to do next. |
| `/connect` | gated | Discovery and the account pick list. |

## Environment

See `.env.example`. Five variables in production: `DATABASE_URL`,
`ENCRYPTION_KEY`, `APP_PASSWORD`, `NEXT_PUBLIC_APP_URL`, and the Google
client pair.

`ENCRYPTION_KEY` encrypts the Google refresh token at rest. Changing it makes
every stored token unreadable and forces a reconnect. It must be identical
anywhere that shares the same database.

## Local

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3020
```

## Documents

- `ARCHITECTURE-V2.md` — the design, and why each decision went the way it did
- `DEPLOY.md` — deployment
- `PHASE-0.md` — the Google access chain (done: Basic access approved)
- `preflight/` — standalone access checker; also the Ads REST transport prototype
