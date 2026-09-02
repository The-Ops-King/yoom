import { NextResponse, type NextRequest } from "next/server";
import {
  DESKTOP_TOKEN_HEADER,
  SESSION_COOKIE,
  desktopTokenMatches,
  verifySession,
} from "@/lib/session";

/**
 * Owner-only surfaces. API routes get a hard 401. Owner pages are rewritten to
 * the password gate at `/` (URL preserved, so signing in lands you back where
 * you were). The pages ALSO check `isOwner()` themselves: a layout-level gate
 * is not an auth boundary — Next still renders sibling page segments into the
 * RSC payload, so every page must refuse before touching the database.
 *
 * The Electron shell sends `x-yoom-desktop-token` on every request to the app
 * origin, which counts as the owner: the Mac app has no password screen.
 */
export function proxy(request: NextRequest) {
  const authed =
    verifySession(request.cookies.get(SESSION_COOKIE)?.value) ||
    desktopTokenMatches(request.headers.get(DESKTOP_TOKEN_HEADER));
  if (authed) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.rewrite(new URL("/", request.url));
}

export const config = {
  matcher: ["/api/upload/:path*", "/api/videos/:path*", "/library/:path*", "/settings"],
};
