import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, SESSION_COOKIE } from "@/lib/session";

// Everything is behind the gate except: the login page and endpoint, the public
// landing, and the privacy policy.
//
// The last two are public deliberately and must stay that way. Google's brand
// verification fetches both, the privacy policy URL is registered on the OAuth
// consent screen, and a home page behind a password would fail the check that
// "the relevance of your home page to the app under review must be clear".
const PUBLIC = ["/login", "/api/login", "/privacy.html"];
const PUBLIC_EXACT = ["/"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  const ok = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  // An API call gets a status it can act on; a page gets redirected.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
