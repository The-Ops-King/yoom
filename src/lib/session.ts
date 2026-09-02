import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "yoom_session";
/** 30 days, in seconds. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

function sign(timestamp: number): string {
  return createHmac("sha256", env("SESSION_SECRET"))
    .update(String(timestamp))
    .digest("hex");
}

/** Returns a `<issuedAtSeconds>.<hexHmac>` cookie value. */
export function signSession(): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  return `${issuedAt}.${sign(issuedAt)}`;
}

export function verifySession(cookie: string | undefined | null): boolean {
  if (!cookie) return false;
  const dot = cookie.indexOf(".");
  if (dot <= 0 || dot === cookie.length - 1) return false;

  const timestampPart = cookie.slice(0, dot);
  const signaturePart = cookie.slice(dot + 1);
  if (!/^\d+$/.test(timestampPart)) return false;
  if (!/^[0-9a-f]{64}$/.test(signaturePart)) return false;

  const issuedAt = Number(timestampPart);
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + 60) return false;
  if (now - issuedAt > SESSION_MAX_AGE) return false;

  let expected: string;
  try {
    expected = sign(issuedAt);
  } catch {
    return false;
  }

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signaturePart, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Header the Electron shell attaches to every request to the app origin. */
export const DESKTOP_TOKEN_HEADER = "x-yoom-desktop-token";

/**
 * True when the request carries the shared desktop secret. This is what lets the
 * Mac app skip the password gate while the website stays gated. Unset or empty
 * `DESKTOP_TOKEN` disables the whole path — a deployment that never provisions
 * the secret can never be signed into by header alone.
 */
export function desktopTokenMatches(
  header: string | null | undefined,
): boolean {
  const expected = process.env.DESKTOP_TOKEN;
  if (!expected) return false;
  if (!header) return false;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
