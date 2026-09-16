import { NextResponse, type NextRequest } from "next/server";
import {
  checkPassword, issueToken, passwordConfigured, sessionCookieDomain,
  SESSION_COOKIE, SESSION_MAX_AGE,
} from "@/lib/session";

export const runtime = "nodejs";

// Crude but effective against scripted guessing on a single-user app.
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: NextRequest) {
  if (!passwordConfigured()) {
    return NextResponse.json(
      { error: "APP_PASSWORD is not set (minimum 8 characters)." },
      { status: 500 }
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rec = attempts.get(ip);
  if (rec && rec.until > Date.now()) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!(await checkPassword(password))) {
    const n = (rec?.n ?? 0) + 1;
    attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  attempts.delete(ip);

  const res = NextResponse.json({ ok: true });

  // Before the session cookie carried a Domain it was host-only. Anyone who
  // signed in during that window still has that cookie, and the browser sends
  // BOTH — so a fresh sign-in can still be read as the stale one and the user
  // bounces straight back to the password box. Expiring the host-only variant
  // costs nothing and makes that state unrecoverable by accident.
  //
  // Both cookies are written onto this response directly rather than through
  // the cookies() jar: two cookies of the same name cannot be expressed in one
  // jar entry, and mixing the jar with a hand-built response is ambiguous.
  const secure = process.env.NODE_ENV === "production";
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`
  );

  const domain = sessionCookieDomain();
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${await issueToken()}; Path=/; Max-Age=${SESSION_MAX_AGE}` +
      `; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}${domain ? `; Domain=${domain}` : ""}`
  );

  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  const domain = sessionCookieDomain();
  // Clear both shapes: a cookie is only removed by a Set-Cookie whose Domain
  // matches the one it was stored under, so signing out has to cover the
  // host-only variant as well as the current domain-wide one.
  for (const d of [undefined, domain]) {
    res.headers.append(
      "set-cookie",
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` +
        `${secure ? "; Secure" : ""}${d ? `; Domain=${d}` : ""}`
    );
  }
  return res;
}
