# Deploying to Vercel

Five steps. The app is built to run hosted, so nothing here is a workaround.

---

## 1. Create the database first

Vercel dashboard → **Storage** → Create → **Postgres**. Any region near you.

Once created, open it → **.env.local** tab → copy the `POSTGRES_URL` value. That
string is what goes into `DATABASE_URL`. Migrations run automatically on the
first request, so there is nothing to apply by hand.

## 2. Push the repo and import it

```bash
cd ~/Documents/GitHub/ads-copilot-v2
git remote add origin https://github.com/lukxce/fortress-hq-app.git
git push -u origin main
```

Then Vercel → Add New → Project → import that repo. Framework detection handles
the rest; there is no build configuration to set.

## 3. Set the environment variables

Project → Settings → Environment Variables. All five, for Production:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the `POSTGRES_URL` from step 1 |
| `ENCRYPTION_KEY` | 64 hex characters — `openssl rand -hex 32` |
| `APP_PASSWORD` | your own, at least 8 characters |
| `APP_URL` | your deployed origin, no trailing slash |
| `GOOGLE_CLIENT_ID` | from step 4 |
| `GOOGLE_CLIENT_SECRET` | from step 4 |

`ENCRYPTION_KEY` encrypts the Google refresh token at rest. **Changing it later
makes every stored token undecryptable** and you will have to reconnect Google.
Generate it once and keep it.

`APP_PASSWORD` is the gate on the app itself. Without it the app refuses to
serve, deliberately: a public Vercel URL with no lock is open to anyone who
finds it, and this app can read and eventually spend real ad budget.

## 4. Create the OAuth client — after you know the URL

This is why it comes fourth. The redirect URI has to match your deployed origin
exactly, so you need the Vercel URL first.

Cloud Console → **Google Auth Platform** → **Clients** → Create client →
**Web application**.

Authorised redirect URI, exactly one, no trailing slash:

```
https://<your-app>.vercel.app/api/auth/google/callback
```

If you later put a custom domain on it, add that URI too and update
`APP_URL`. Google matches redirect URIs literally — a missing `www`
or a trailing slash fails with `redirect_uri_mismatch`.

Paste the id and secret into Vercel, then redeploy so the new variables are
picked up.

## 5. Sign in and discover

1. Open the deployed URL. You get the password gate.
2. The overview page shows a checklist; everything should read ready.
3. **Connect Google.** Expect a passkey prompt — since 5 August 2026 Google
   requires passkey authentication to issue a new refresh token.
4. **Run discovery** on the Connect page. It reads what your account can reach
   across all four products and costs a handful of API operations.
5. Tick the accounts you want. Nothing syncs until you do.

---

## Notes

**Preview deployments.** Every branch gets its own URL, and none of them will be
in your OAuth client's redirect list, so Google sign-in only works on
production. That is the safe default — leave it.

**The database is shared across deployments.** A preview build points at the same
Postgres as production. Be careful with destructive changes on a branch.

**Re-running discovery is safe.** It upserts on the provider's own id, marks
newly-appeared rows so they surface, and marks disappeared rows revoked rather
than deleting them, so historical metrics keep their parent.

**If Google sign-in stops working** and the app says to reconnect, the refresh
token is dead — revoked, password changed, or unused for six months. Sign in
again; nothing else is lost.
