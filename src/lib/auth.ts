import "server-only";
import { cookies, headers } from "next/headers";
import {
  DESKTOP_TOKEN_HEADER,
  SESSION_COOKIE,
  desktopTokenMatches,
  verifySession,
} from "@/lib/session";

/**
 * True when the request carries a valid owner session cookie, or the shared
 * desktop secret. The cookie is checked first so the browser path costs no
 * extra request-time API; `headers()` is async in Next 16.
 */
export async function isOwner(): Promise<boolean> {
  const cookieStore = await cookies();
  if (verifySession(cookieStore.get(SESSION_COOKIE)?.value)) return true;

  const headerStore = await headers();
  return desktopTokenMatches(headerStore.get(DESKTOP_TOKEN_HEADER));
}
