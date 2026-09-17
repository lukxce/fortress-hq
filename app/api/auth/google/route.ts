import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authUrl, oauthConfigured } from "@/lib/google/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set." },
      { status: 500 }
    );
  }

  // CSRF: the state we send must come back unchanged.
  const state = randomBytes(16).toString("base64url");
  const jar = await cookies();
  jar.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const business = new URL(req.url).searchParams.get("with") === "business";
  return NextResponse.redirect(authUrl(state, { business }));
}
