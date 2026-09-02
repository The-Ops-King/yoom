import { beforeEach, describe, expect, it } from "vitest";
import { corsHeaders, preflight, withCors } from "@/lib/cors";

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://yoom.vercel.app";
  process.env.ALLOWED_ORIGINS = "https://jtylerray.com,https://www.jtylerray.com";
});

describe("corsHeaders", () => {
  it("echoes an allowed origin", () => {
    const headers = corsHeaders("https://jtylerray.com");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://jtylerray.com");
    expect(headers["Vary"]).toBe("Origin");
  });

  it("echoes the app origin", () => {
    expect(corsHeaders("https://yoom.vercel.app")["Access-Control-Allow-Origin"]).toBe(
      "https://yoom.vercel.app",
    );
  });

  it("omits the allow-origin header for a foreign origin", () => {
    const headers = corsHeaders("https://evil.example");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Vary"]).toBe("Origin");
  });

  it("omits the allow-origin header when there is no Origin", () => {
    expect(corsHeaders(null)["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("advertises the methods and headers the view routes need", () => {
    const headers = corsHeaders("https://jtylerray.com");
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET, HEAD, POST, OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type, Range");
    expect(headers["Access-Control-Expose-Headers"]).toBe(
      "Content-Range, Content-Length, Accept-Ranges, ETag",
    );
  });
});

describe("preflight", () => {
  it("returns 204 with CORS headers", () => {
    const res = preflight(
      new Request("https://yoom.vercel.app/api/view/start", {
        method: "OPTIONS",
        headers: { origin: "https://jtylerray.com" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://jtylerray.com");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });
});

describe("withCors", () => {
  it("copies CORS headers onto an existing response", () => {
    const req = new Request("https://yoom.vercel.app/api/view/start", {
      headers: { origin: "https://jtylerray.com" },
    });
    const res = withCors(req, Response.json({ ok: true }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://jtylerray.com");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("leaves the body intact", async () => {
    const req = new Request("https://yoom.vercel.app/api/view/start");
    const res = withCors(req, Response.json({ ok: true }));
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("does not mutate a response with immutable headers", async () => {
    const req = new Request("https://yoom.vercel.app/api/view/start", {
      headers: { origin: "https://jtylerray.com" },
    });
    const original = new Response("x", {
      status: 206,
      headers: { "x-a": "1" },
    });
    const res = withCors(req, original);
    expect(res).not.toBe(original);
    expect(res.status).toBe(206);
    expect(res.headers.get("x-a")).toBe("1");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://jtylerray.com",
    );
  });
});
