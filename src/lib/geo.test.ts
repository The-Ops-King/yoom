import { beforeEach, describe, expect, it } from "vitest";
import { readViewerContext } from "@/lib/geo";

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-value-0123456789abcdef";
});

function req(headers: Record<string, string>): Request {
  return new Request("https://yoom.vercel.app/api/view/start", { headers });
}

describe("readViewerContext", () => {
  it("hashes the first x-forwarded-for entry", () => {
    const a = readViewerContext(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }));
    const b = readViewerContext(req({ "x-forwarded-for": "1.2.3.4" }));
    expect(a.ipHash).toBe(b.ipHash);
    expect(a.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different IPs", () => {
    const a = readViewerContext(req({ "x-forwarded-for": "1.2.3.4" }));
    const b = readViewerContext(req({ "x-forwarded-for": "5.6.7.8" }));
    expect(a.ipHash).not.toBe(b.ipHash);
  });

  it("salts with SESSION_SECRET", () => {
    const a = readViewerContext(req({ "x-forwarded-for": "1.2.3.4" }));
    process.env.SESSION_SECRET = "another-secret-entirely-000000000";
    const b = readViewerContext(req({ "x-forwarded-for": "1.2.3.4" }));
    expect(a.ipHash).not.toBe(b.ipHash);
  });

  it("returns null ipHash when there is no forwarded IP", () => {
    expect(readViewerContext(req({})).ipHash).toBeNull();
  });

  it("reads user agent and Vercel geo headers", () => {
    const ctx = readViewerContext(
      req({
        "user-agent": "Mozilla/5.0 (Macintosh)",
        "x-vercel-ip-country": "US",
        "x-vercel-ip-city": "Salt%20Lake%20City",
      }),
    );
    expect(ctx.userAgent).toBe("Mozilla/5.0 (Macintosh)");
    expect(ctx.country).toBe("US");
    expect(ctx.city).toBe("Salt Lake City");
  });

  it("returns nulls for absent geo headers", () => {
    const ctx = readViewerContext(req({}));
    expect(ctx.userAgent).toBeNull();
    expect(ctx.country).toBeNull();
    expect(ctx.city).toBeNull();
  });

  it("falls back to x-real-ip", () => {
    expect(readViewerContext(req({ "x-real-ip": "9.9.9.9" })).ipHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
