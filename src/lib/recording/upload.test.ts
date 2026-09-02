import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above the module scope, so the spy has to be hoisted too.
const { uploadToDrive } = vi.hoisted(() => ({ uploadToDrive: vi.fn() }));
vi.mock("@/lib/upload-client", () => ({ uploadToDrive }));

import { defaultRecordingTitle, uploadRecording } from "./upload";

const blob = new Blob([new Uint8Array(16)], { type: "video/webm" });

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  uploadToDrive.mockReset();
  uploadToDrive.mockResolvedValue({ id: "drive-1" });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaultRecordingTitle", () => {
  it("is generated client-side so it reflects the local time zone", () => {
    const title = defaultRecordingTitle(new Date("2026-09-02T15:04:05Z"));
    expect(title.startsWith("Recording — ")).toBe(true);
    expect(title.length).toBeGreaterThan("Recording — ".length);
  });
});

describe("uploadRecording", () => {
  it("walks the three-step flow and returns the share URL", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionUri: "https://drive/session" }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "vid-1", slug: "abc12345", url: "https://jtylerray.com/v/abc12345" }),
      );

    const onProgress = vi.fn();
    const result = await uploadRecording({
      blob,
      durationMs: 12_345,
      width: 1920,
      height: 1080,
      thumbnail: null,
      onProgress,
    });

    expect(result).toEqual({
      id: "vid-1",
      slug: "abc12345",
      url: "https://jtylerray.com/v/abc12345",
    });

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe("/api/upload");
    expect(JSON.parse(firstInit.body)).toMatchObject({
      mimeType: "video/webm",
      sizeBytes: blob.size,
    });
    expect(JSON.parse(firstInit.body).filename).toMatch(/^yoom-.*\.webm$/);

    expect(uploadToDrive).toHaveBeenCalledWith(blob, "https://drive/session", onProgress);

    const [secondUrl, secondInit] = fetchMock.mock.calls[1];
    expect(secondUrl).toBe("/api/upload/complete");
    expect(JSON.parse(secondInit.body)).toMatchObject({
      driveFileId: "drive-1",
      durationMs: 12_345,
      width: 1920,
      height: 1080,
    });
    expect(JSON.parse(secondInit.body).title).toContain("Recording — ");
  });

  it("posts the thumbnail after completing and tolerates its failure", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionUri: "s" }))
      .mockResolvedValueOnce(jsonResponse({ id: "vid-1", slug: "s1", url: "u" }))
      .mockRejectedValueOnce(new Error("thumb down"));

    const thumbnail = new Blob([new Uint8Array(4)], { type: "image/jpeg" });
    const result = await uploadRecording({
      blob,
      durationMs: 1,
      width: 2,
      height: 3,
      thumbnail,
      onProgress: () => {},
    });

    expect(result.id).toBe("vid-1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/upload/thumbnail");
    expect(fetchMock.mock.calls[2][1].body).toBeInstanceOf(FormData);
  });

  it("skips the thumbnail request when there is no thumbnail", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionUri: "s" }))
      .mockResolvedValueOnce(jsonResponse({ id: "v", slug: "s", url: "u" }));

    await uploadRecording({
      blob,
      durationMs: 1,
      width: null,
      height: null,
      thumbnail: null,
      onProgress: () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a readable error when the session request fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false));
    await expect(
      uploadRecording({
        blob,
        durationMs: 1,
        width: null,
        height: null,
        thumbnail: null,
        onProgress: () => {},
      }),
    ).rejects.toThrow("Failed to start the upload");
  });

  it("throws a readable error when completing fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionUri: "s" }))
      .mockResolvedValueOnce(jsonResponse({}, false));
    await expect(
      uploadRecording({
        blob,
        durationMs: 1,
        width: null,
        height: null,
        thumbnail: null,
        onProgress: () => {},
      }),
    ).rejects.toThrow("Failed to save the recording");
  });

  it("rejects an empty recording before touching the network", async () => {
    await expect(
      uploadRecording({
        blob: new Blob([], { type: "video/webm" }),
        durationMs: 0,
        width: null,
        height: null,
        thumbnail: null,
        onProgress: () => {},
      }),
    ).rejects.toThrow("Recording captured no data");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
