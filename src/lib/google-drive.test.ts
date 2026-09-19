import { afterEach, describe, expect, it, vi } from "vitest";

// `env()` is called for both the OAuth refresh (client id/secret/refresh
// token) and the Drive folder id; a single stub value satisfies whichever key
// is asked for since these tests only care about the resumable-session call.
vi.mock("@/lib/env", () => ({ env: () => "test-value" }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/**
 * `createResumableSession` goes through `driveFetch`, which first refreshes
 * an access token against Google's OAuth endpoint before POSTing to the
 * upload endpoint. The mock has to answer both: a JSON token response for
 * the former, and a `location` header for the latter (mirroring Drive's real
 * resumable-session response).
 */
function stubFetch(uploadResponse?: () => Response) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (uploadResponse) return uploadResponse();
    return new Response(null, { status: 200, headers: { location: "https://upload/session" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function uploadCallHeaders(fetchMock: ReturnType<typeof stubFetch>): Record<string, string> {
  const call = fetchMock.mock.calls.find(([url]) => (url as string).includes("/upload/drive"));
  if (!call) throw new Error("upload endpoint was never called");
  return (call as unknown as [string, RequestInit])[1].headers as Record<string, string>;
}

describe("createResumableSession", () => {
  it("omits X-Upload-Content-Length when the size is not known yet", async () => {
    const fetchMock = stubFetch();
    const { createResumableSession } = await import("./google-drive");

    await createResumableSession({
      name: "a.mp4",
      mimeType: "video/mp4",
      origin: "https://yoom.jtylerray.com",
    });

    const headers = uploadCallHeaders(fetchMock);
    expect(headers["X-Upload-Content-Length"]).toBeUndefined();
    expect(headers["X-Upload-Content-Type"]).toBe("video/mp4");
  });

  it("sends X-Upload-Content-Length when the size is known", async () => {
    const fetchMock = stubFetch();
    const { createResumableSession } = await import("./google-drive");

    await createResumableSession({
      name: "a.mp4",
      mimeType: "video/mp4",
      sizeBytes: 123_456,
      origin: "https://yoom.jtylerray.com",
    });

    const headers = uploadCallHeaders(fetchMock);
    expect(headers["X-Upload-Content-Length"]).toBe("123456");
    expect(headers["X-Upload-Content-Type"]).toBe("video/mp4");
  });

  it("returns the session location Drive echoes back", async () => {
    stubFetch();
    const { createResumableSession } = await import("./google-drive");

    const location = await createResumableSession({
      name: "a.mp4",
      mimeType: "video/mp4",
      origin: "https://yoom.jtylerray.com",
    });

    expect(location).toBe("https://upload/session");
  });

  it("treats an explicit zero size as invalid, not unknown", async () => {
    const fetchMock = stubFetch();
    const { createResumableSession } = await import("./google-drive");

    await createResumableSession({
      name: "a.mp4",
      mimeType: "video/mp4",
      sizeBytes: 0,
      origin: "https://yoom.jtylerray.com",
    });

    const headers = uploadCallHeaders(fetchMock);
    expect(headers["X-Upload-Content-Length"]).toBe("0");
  });

  it("throws a DriveError with the response body when the session POST fails", async () => {
    stubFetch(() => new Response("quota exceeded", { status: 403 }));
    const { createResumableSession } = await import("./google-drive");

    await expect(
      createResumableSession({
        name: "a.mp4",
        mimeType: "video/mp4",
        origin: "https://yoom.jtylerray.com",
      }),
    ).rejects.toThrow(/Failed to start resumable upload: quota exceeded/);
  });

  it("sends the Origin header so Drive returns CORS headers on the session URI", async () => {
    const fetchMock = stubFetch();
    const { createResumableSession } = await import("./google-drive");

    await createResumableSession({
      name: "a.mp4",
      mimeType: "video/mp4",
      origin: "https://yoom.jtylerray.com",
    });

    const headers = uploadCallHeaders(fetchMock);
    expect(headers["Origin"]).toBe("https://yoom.jtylerray.com");
  });
});
