import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/** True when the request carries a valid owner session cookie. */
export async function isOwner(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifySession(cookieStore.get(SESSION_COOKIE)?.value);
}
