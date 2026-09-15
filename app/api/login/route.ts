import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
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
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    // Covers the apex and www together; without it the cookie is host-only and
    // moving between them logs you out.
    domain: sessionCookieDomain(),
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const jar = await cookies();
  // Must match the attributes it was set with, or the browser keeps it.
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    domain: sessionCookieDomain(),
  });
  return NextResponse.json({ ok: true });
}
