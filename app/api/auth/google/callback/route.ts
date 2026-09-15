import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { completeAuth } from "@/lib/google/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const expected = jar.get("oauth_state")?.value;
  jar.delete("oauth_state");

  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/connect?error=${encodeURIComponent(msg)}`, url.origin));

  if (error) return fail(error === "access_denied" ? "You declined the consent screen." : error);
  if (!code) return fail("Google returned no authorisation code.");
  if (!state || state !== expected) return fail("State mismatch — start the sign-in again.");

  try {
    await completeAuth(code);
  } catch (err) {
    return fail((err as Error).message ?? "Token exchange failed.");
  }

  return NextResponse.redirect(new URL("/connect?connected=1", url.origin));
}
