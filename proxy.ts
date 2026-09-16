import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { verifyToken, SESSION_COOKIE } from "@/lib/session";

// Two gates, stacked, answering different questions.
//
// The shared password answers "may this browser reach the app at all". It is
// the outer door and it stays, because it is what protects the installation
// while identity is still being set up.
//
// Identity answers "which person is this". It only exists once Clerk is
// configured; with no publishable key this file behaves exactly as it did
// before, and the app runs single-operator on the password alone. Same
// convention Watchtower uses, and it means the keys can be added to a live
// deployment without a flag day.
const identityConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

// Public deliberately, and must stay that way. Google's brand verification
// fetches the landing page and the privacy policy, the privacy URL is
// registered on the OAuth consent screen, and a home page behind a password
// would fail the check that its relevance to the app "must be clear".
// /api/jobs is reached by Vercel Cron, which has no session; the route checks
// CRON_SECRET itself and refuses everything else.
const PUBLIC = ["/login", "/api/login", "/privacy.html", "/sign-in", "/sign-up", "/api/jobs"];
const PUBLIC_EXACT = ["/"];

const isPublic = (pathname: string) =>
  PUBLIC_EXACT.includes(pathname) ||
  PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));

// Built once at module load. clerkMiddleware() is only reachable when a key
// exists, so an unconfigured deployment never pulls Clerk into the request
// path at all.
const withIdentity = identityConfigured
  ? (async () => {
      const { clerkMiddleware } = await import("@clerk/nextjs/server");
      return clerkMiddleware(async (auth, req) => {
        if (isPublic(req.nextUrl.pathname)) return;
        const { userId } = await auth();
        if (userId) return;
        if (req.nextUrl.pathname.startsWith("/api/")) {
          return NextResponse.json({ error: "Not signed in." }, { status: 401 });
        }
        const url = req.nextUrl.clone();
        url.pathname = "/sign-in";
        url.search = `?redirect_url=${encodeURIComponent(req.nextUrl.pathname)}`;
        return NextResponse.redirect(url);
      });
    })()
  : null;

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  // Outer door first. Failing here means the request never reaches identity,
  // so an unauthenticated probe cannot make Clerk do work on our behalf.
  const ok = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!ok) {
    // An API call gets a status it can act on; a page gets redirected.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (withIdentity) return (await withIdentity)(req, event);
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
