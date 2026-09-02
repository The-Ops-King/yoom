import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_TOKEN_HEADER,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  desktopTokenMatches,
  signSession,
  verifySession,
} from "@/lib/session";

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-value-0123456789abcdef";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.DESKTOP_TOKEN;
});

describe("session", () => {
  it("exposes the cookie name and 30-day max age", () => {
    expect(SESSION_COOKIE).toBe("yoom_session");
    expect(SESSION_MAX_AGE).toBe(60 * 60 * 24 * 30);
  });

  it("round trips a freshly signed cookie", () => {
    expect(verifySession(signSession())).toBe(true);
  });

  it("produces a ts.sig shape", () => {
    const [ts, sig] = signSession().split(".");
    expect(Number.isInteger(Number(ts))).toBe(true);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects undefined", () => {
    expect(verifySession(undefined)).toBe(false);
  });

  it("rejects a malformed cookie", () => {
    expect(verifySession("nodot")).toBe(false);
    expect(verifySession("123.")).toBe(false);
    expect(verifySession(".abc")).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const [ts] = signSession().split(".");
    expect(verifySession(`${ts}.${"0".repeat(64)}`)).toBe(false);
  });

  it("rejects a tampered timestamp", () => {
    const [ts, sig] = signSession().split(".");
    expect(verifySession(`${Number(ts) + 1}.${sig}`)).toBe(false);
  });

  it("rejects an expired cookie", () => {
    const cookie = signSession();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (SESSION_MAX_AGE + 60) * 1000);
    expect(verifySession(cookie)).toBe(false);
  });

  it("rejects a cookie signed with a different secret", () => {
    const cookie = signSession();
    process.env.SESSION_SECRET = "a-completely-different-secret-value";
    expect(verifySession(cookie)).toBe(false);
  });
});

describe("desktopTokenMatches", () => {
  const TOKEN = "desktop-token-value-0123456789abcdef";

  it("exposes the header name the shell sends", () => {
    expect(DESKTOP_TOKEN_HEADER).toBe("x-yoom-desktop-token");
  });

  it("accepts an exact match", () => {
    process.env.DESKTOP_TOKEN = TOKEN;
    expect(desktopTokenMatches(TOKEN)).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    process.env.DESKTOP_TOKEN = TOKEN;
    expect(desktopTokenMatches("x".repeat(TOKEN.length))).toBe(false);
  });

  it("rejects a token of a different length", () => {
    process.env.DESKTOP_TOKEN = TOKEN;
    expect(desktopTokenMatches(`${TOKEN}extra`)).toBe(false);
    expect(desktopTokenMatches(TOKEN.slice(0, -1))).toBe(false);
  });

  it("rejects a missing or empty header", () => {
    process.env.DESKTOP_TOKEN = TOKEN;
    expect(desktopTokenMatches(null)).toBe(false);
    expect(desktopTokenMatches(undefined)).toBe(false);
    expect(desktopTokenMatches("")).toBe(false);
  });

  it("is disabled when DESKTOP_TOKEN is unset", () => {
    delete process.env.DESKTOP_TOKEN;
    expect(desktopTokenMatches(TOKEN)).toBe(false);
    expect(desktopTokenMatches("")).toBe(false);
  });

  it("is disabled when DESKTOP_TOKEN is empty", () => {
    process.env.DESKTOP_TOKEN = "";
    expect(desktopTokenMatches("")).toBe(false);
    expect(desktopTokenMatches(TOKEN)).toBe(false);
  });
});
