import { afterEach, describe, expect, it } from "vitest";
import { allowedOrigins, env, appUrl, shareBaseUrl } from "@/lib/env";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("env", () => {
  it("returns the value when set", () => {
    process.env.SOME_KEY = "value";
    expect(env("SOME_KEY")).toBe("value");
  });

  it("throws when missing", () => {
    delete process.env.SOME_KEY;
    expect(() => env("SOME_KEY")).toThrow("Missing environment variable: SOME_KEY");
  });

  it("throws when empty", () => {
    process.env.SOME_KEY = "";
    expect(() => env("SOME_KEY")).toThrow("Missing environment variable: SOME_KEY");
  });
});

describe("appUrl", () => {
  it("strips a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://yoom.vercel.app/";
    expect(appUrl()).toBe("https://yoom.vercel.app");
  });

  it("falls back to localhost when unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    expect(appUrl()).toBe("http://localhost:3000");
  });
});

describe("shareBaseUrl", () => {
  it("defaults to the public share domain, never the serving origin", () => {
    delete process.env.NEXT_PUBLIC_SHARE_BASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(shareBaseUrl()).toBe("https://jtylerray.com");
  });

  it("uses the configured share origin", () => {
    process.env.NEXT_PUBLIC_SHARE_BASE_URL = "https://jtylerray.com/";
    expect(shareBaseUrl()).toBe("https://jtylerray.com");
  });
});

describe("allowedOrigins", () => {
  it("splits, trims and drops empties", () => {
    process.env.ALLOWED_ORIGINS = "https://a.com, https://b.com ,";
    expect(allowedOrigins()).toEqual(["https://a.com", "https://b.com"]);
  });

  it("returns an empty list when unset", () => {
    delete process.env.ALLOWED_ORIGINS;
    expect(allowedOrigins()).toEqual([]);
  });
});
