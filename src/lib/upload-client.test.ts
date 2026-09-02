import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_SIZE_BYTES,
  PROXY_CHUNK_SIZE_BYTES,
  uploadToDrive,
} from "@/lib/upload-client";

const SESSION_URI = "https://www.googleapis.com/upload/drive/v3/files?upload_id=x";

function blobOf(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: "video/webm" });
}

function resumeIncomplete(rangeEnd: number): Response {
  return new Response(null, { status: 308, headers: { Range: `bytes=0-${rangeEnd}` } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chunk sizes", () => {
  it("are multiples of 256 KiB", () => {
    expect(CHUNK_SIZE_BYTES).toBe(8 * 1024 * 1024);
    expect(CHUNK_SIZE_BYTES % (256 * 1024)).toBe(0);
    expect(PROXY_CHUNK_SIZE_BYTES).toBe(4 * 1024 * 1024);
    expect(PROXY_CHUNK_SIZE_BYTES % (256 * 1024)).toBe(0);
  });
});

describe("uploadToDrive", () => {
  it("uploads a single small blob and returns the file id", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "drive-abc" }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadToDrive(blobOf(1024), SESSION_URI);
    expect(result).toEqual({ id: "drive-abc" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("PUT");
    expect(headers["Content-Range"]).toBe("bytes 0-1023/1024");
  });

  it("sends sequential chunks and reports progress", async () => {
    const size = CHUNK_SIZE_BYTES + 1024;
    const ranges: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      ranges.push(headers["Content-Range"]);
      return ranges.length === 1
        ? resumeIncomplete(CHUNK_SIZE_BYTES - 1)
        : Response.json({ id: "drive-abc" }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const progress: number[] = [];
    await uploadToDrive(blobOf(size), SESSION_URI, (p) => progress.push(p));

    expect(ranges).toEqual([
      `bytes 0-${CHUNK_SIZE_BYTES - 1}/${size}`,
      `bytes ${CHUNK_SIZE_BYTES}-${size - 1}/${size}`,
    ]);
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((p) => p >= 0 && p <= 100)).toBe(true);
  });

  it("accepts 201 as a successful final response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "drive-201" }, { status: 201 })),
    );
    await expect(uploadToDrive(blobOf(512), SESSION_URI)).resolves.toEqual({
      id: "drive-201",
    });
  });

  it("queries the committed offset and resumes after a transport error", async () => {
    const size = 2048;
    const calls: (string | undefined)[] = [];
    let attempt = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push(headers["Content-Range"]);
      attempt += 1;
      if (attempt === 1) throw new TypeError("network error");
      if (attempt === 2) return resumeIncomplete(1023); // offset query
      return Response.json({ id: "drive-resumed" }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadToDrive(blobOf(size), SESSION_URI)).resolves.toEqual({
      id: "drive-resumed",
    });
    expect(calls[1]).toBe(`bytes */${size}`);
    expect(calls[2]).toBe(`bytes 1024-2047/${size}`);
  });

  it("treats a 404 on the offset query as a dead session", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError("network error");
        return new Response("gone", { status: 404 });
      }),
    );
    await expect(uploadToDrive(blobOf(512), SESSION_URI)).rejects.toThrow(
      "Upload session expired",
    );
  });

  it("rejects an empty blob", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(uploadToDrive(blobOf(0), SESSION_URI)).rejects.toThrow(
      "Nothing to upload",
    );
  });

  it("gives up after the retry budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("server error", { status: 500 })),
    );
    await expect(uploadToDrive(blobOf(512), SESSION_URI)).rejects.toThrow(
      "Upload failed",
    );
  });

  it("does not lose a completed upload discovered via the offset query", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("network error");
      const headers = init.headers as Record<string, string>;
      expect(headers["Content-Range"]).toBe("bytes */512");
      return Response.json({ id: "drive-late" }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadToDrive(blobOf(512), SESSION_URI)).resolves.toEqual({
      id: "drive-late",
    });
  });

  it("does not skip bytes on a 308 without a Range header", async () => {
    const size = 2048;
    const ranges: string[] = [];
    let attempt = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      ranges.push(headers["Content-Range"]);
      attempt += 1;
      if (attempt <= 2) return new Response(null, { status: 308 });
      if (attempt === 3) return resumeIncomplete(1023);
      return Response.json({ id: "drive-final" }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadToDrive(blobOf(size), SESSION_URI)).resolves.toEqual({
      id: "drive-final",
    });
    expect(ranges).toEqual([
      `bytes 0-${size - 1}/${size}`,
      `bytes 0-${size - 1}/${size}`,
      `bytes 0-${size - 1}/${size}`,
      `bytes 1024-${size - 1}/${size}`,
    ]);
  });

  it("resets the retry budget after each acknowledged chunk", async () => {
    const size = 4096;
    const advances = [100, 200, 300, 400, 500, 600];
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call <= 12) {
        if (call % 2 === 1) throw new TypeError("network error");
        const next = advances[call / 2 - 1];
        return new Response(null, {
          status: 308,
          headers: { Range: `bytes=0-${next - 1}` },
        });
      }
      return Response.json({ id: "drive-final" }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadToDrive(blobOf(size), SESSION_URI)).resolves.toEqual({
      id: "drive-final",
    });
    expect(fetchMock).toHaveBeenCalledTimes(13);
  });
});
