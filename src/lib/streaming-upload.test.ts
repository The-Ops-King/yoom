import { afterEach, describe, expect, it, vi } from "vitest";
import { CHUNK_SIZE_BYTES } from "@/lib/upload-client";
import { StreamingUpload } from "@/lib/streaming-upload";

const SESSION = "https://www.googleapis.com/upload/drive/v3/files?upload_id=s";
const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);
const rangeOf = (init: RequestInit) => (init.headers as Record<string, string>)["Content-Range"];

afterEach(() => vi.unstubAllGlobals());

describe("StreamingUpload", () => {
  it("sends full chunks with an unknown total, then the tail with the real total", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const r = rangeOf(init);
      seen.push(r);
      if (r.endsWith("/*")) {
        const end = Number(/bytes \d+-(\d+)/.exec(r)![1]);
        return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
      }
      return Response.json({ id: "drive-1" }, { status: 200 });
    }));
    const up = new StreamingUpload(SESSION);
    await up.write(bytes(CHUNK_SIZE_BYTES), 0);
    await up.write(bytes(1000), CHUNK_SIZE_BYTES);
    await expect(up.finish()).resolves.toEqual({ id: "drive-1" });
    expect(seen).toEqual([
      `bytes 0-${CHUNK_SIZE_BYTES - 1}/*`,
      `bytes ${CHUNK_SIZE_BYTES}-${CHUNK_SIZE_BYTES + 999}/${CHUNK_SIZE_BYTES + 1000}`,
    ]);
  });

  it("rejects out-of-order writes", async () => {
    const up = new StreamingUpload(SESSION);
    await expect(up.write(bytes(10), 5)).rejects.toThrow(/out of order/);
  });

  it("resumes from Drive's committed offset after a network error", async () => {
    let calls = 0;
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const r = rangeOf(init);
      seen.push(r);
      calls++;
      if (calls === 1) throw new TypeError("network down");
      if (r === "bytes */*") return new Response(null, { status: 308 }); // nothing committed
      return Response.json({ id: "drive-2" }, { status: 201 });
    }));
    const up = new StreamingUpload(SESSION);
    await up.write(bytes(500), 0);
    await expect(up.finish()).resolves.toEqual({ id: "drive-2" });
    expect(seen).toEqual(["bytes 0-499/500", "bytes */*", "bytes 0-499/500"]);
  });

  it("keeps every byte so the caller can fall back to a whole-file upload", async () => {
    const up = new StreamingUpload(SESSION, { autoSend: false });
    await up.write(bytes(3, 7), 0);
    await up.write(bytes(2, 9), 3);
    const blob = up.blob("video/mp4");
    expect(blob.size).toBe(5);
    expect(blob.type).toBe("video/mp4");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([7, 7, 7, 9, 9]),
    );
  });

  // --- the corruption case: Drive acks fewer bytes than we sent ---

  it("resends from a partial commit without skipping or duplicating bytes", async () => {
    const half = CHUNK_SIZE_BYTES / 2;
    const seen: string[] = [];
    let chunkPuts = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const r = rangeOf(init);
      seen.push(r);
      if (r.endsWith("/*")) {
        chunkPuts++;
        // First chunk is only half committed; later ones commit fully.
        const end = chunkPuts === 1 ? half - 1 : Number(/bytes \d+-(\d+)/.exec(r)![1]);
        return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
      }
      return Response.json({ id: "drive-3" }, { status: 200 });
    }));
    const up = new StreamingUpload(SESSION);
    await up.write(bytes(2 * CHUNK_SIZE_BYTES), 0);
    await expect(up.finish()).resolves.toEqual({ id: "drive-3" });
    expect(seen).toEqual([
      `bytes 0-${CHUNK_SIZE_BYTES - 1}/*`,
      `bytes ${half}-${half + CHUNK_SIZE_BYTES - 1}/*`,
      `bytes ${half + CHUNK_SIZE_BYTES}-${2 * CHUNK_SIZE_BYTES - 1}/${2 * CHUNK_SIZE_BYTES}`,
    ]);
    // Every non-final chunk is a multiple of 256 KiB, as Drive requires.
    for (const r of seen.filter((s) => s.endsWith("/*"))) {
      const [, a, b] = /bytes (\d+)-(\d+)/.exec(r)!;
      expect((Number(b) + 1 - Number(a)) % (256 * 1024)).toBe(0);
    }
  });

  it("rewinds to the committed offset after a 5xx, then resends the right bytes", async () => {
    const seen: string[] = [];
    let chunkPuts = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const r = rangeOf(init);
      seen.push(r);
      if (r === "bytes */*") {
        // Drive kept the first 256 KiB of the failed chunk.
        return new Response(null, { status: 308, headers: { Range: "bytes=0-262143" } });
      }
      if (r.endsWith("/*")) {
        chunkPuts++;
        if (chunkPuts === 1) return new Response(null, { status: 503 });
        const end = Number(/bytes \d+-(\d+)/.exec(r)![1]);
        return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
      }
      return Response.json({ id: "drive-4" }, { status: 200 });
    }));
    const up = new StreamingUpload(SESSION);
    const total = 2 * CHUNK_SIZE_BYTES;
    await up.write(bytes(total), 0);
    await expect(up.finish()).resolves.toEqual({ id: "drive-4" });
    expect(seen).toEqual([
      `bytes 0-${CHUNK_SIZE_BYTES - 1}/*`,
      "bytes */*",
      // Resumed from the 256 KiB Drive kept, re-sending the bytes it dropped.
      `bytes 262144-${262144 + CHUNK_SIZE_BYTES - 1}/*`,
      `bytes ${262144 + CHUNK_SIZE_BYTES}-${total - 1}/${total}`,
    ]);
  });

  // --- finish() cannot spin forever, nor claim success without an id ---

  it("gives up instead of looping when Drive keeps answering 308", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      calls++;
      const end = Number(/bytes \d+-(\d+)/.exec(rangeOf(init)) ?? [, , "-1"][2]);
      return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
    }));
    const up = new StreamingUpload(SESSION);
    await up.write(bytes(500), 0);
    await expect(up.finish()).rejects.toThrow(/never confirmed|stalled/i);
    expect(calls).toBeLessThanOrEqual(10);
  });

  it("refuses a 200 that carries no Drive file id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 200 })));
    const up = new StreamingUpload(SESSION);
    await up.write(bytes(500), 0);
    await expect(up.finish()).rejects.toThrow(/without a Drive file id/);
  });

  it("treats 410 as an expired session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 410 })));
    const up = new StreamingUpload(SESSION);
    await up.write(bytes(500), 0);
    await expect(up.finish()).rejects.toThrow(/session expired/i);
  });

  it("refuses to finish when nothing was written", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const up = new StreamingUpload(SESSION);
    await expect(up.finish()).rejects.toThrow(/Nothing to upload/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // --- concurrency: a background failure must not become an unhandled rejection ---

  it("surfaces a background chunk failure to the next write and to finish", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const up = new StreamingUpload(SESSION);
    await up.write(bytes(CHUNK_SIZE_BYTES), 0); // kicks a background PUT that 404s
    // Give the queued PUT a turn to fail.
    await new Promise((r) => setTimeout(r, 0));
    await expect(up.write(bytes(10), CHUNK_SIZE_BYTES)).rejects.toThrow(/session expired/i);
    await expect(up.finish()).rejects.toThrow(/session expired/i);
    // The bytes are still available for a whole-file fallback.
    expect(up.blob("video/mp4").size).toBe(CHUNK_SIZE_BYTES);
  });

  it("never runs two PUTs on the session at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const r = rangeOf(init);
      seen.push(r);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((res) => setTimeout(res, 1));
      inFlight--;
      if (r.endsWith("/*")) {
        const end = Number(/bytes \d+-(\d+)/.exec(r)![1]);
        return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
      }
      return Response.json({ id: "drive-5" }, { status: 200 });
    }));
    const up = new StreamingUpload(SESSION);
    // Three overlapping writes: each one kicks while the previous PUT is in flight.
    await Promise.all([
      up.write(bytes(CHUNK_SIZE_BYTES), 0),
      Promise.resolve().then(() => up.write(bytes(CHUNK_SIZE_BYTES), CHUNK_SIZE_BYTES)),
    ]);
    await up.write(bytes(CHUNK_SIZE_BYTES), 2 * CHUNK_SIZE_BYTES);
    await expect(up.finish()).resolves.toEqual({ id: "drive-5" });
    expect(maxInFlight).toBe(1);
    // No chunk sent twice, none skipped. Everything went out as a whole chunk,
    // so `finish` only has to declare the total.
    expect(seen).toEqual([
      `bytes 0-${CHUNK_SIZE_BYTES - 1}/*`,
      `bytes ${CHUNK_SIZE_BYTES}-${2 * CHUNK_SIZE_BYTES - 1}/*`,
      `bytes ${2 * CHUNK_SIZE_BYTES}-${3 * CHUNK_SIZE_BYTES - 1}/*`,
      `bytes */${3 * CHUNK_SIZE_BYTES}`,
    ]);
  });

  it("makes write wait once more than 64 MiB are unsent", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let started = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      started++;
      await gate;
      const end = Number(/bytes \d+-(\d+)/.exec(rangeOf(init))![1]);
      return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
    }));
    const up = new StreamingUpload(SESSION);
    let settled = false;
    let position = 0;
    // 9 x 8 MiB = 72 MiB unsent, past the 64 MiB watermark.
    const writes = (async () => {
      for (let i = 0; i < 9; i++) {
        await up.write(bytes(CHUNK_SIZE_BYTES), position);
        position += CHUNK_SIZE_BYTES;
      }
      settled = true;
    })();
    await new Promise((r) => setTimeout(r, 5));
    expect(started).toBe(1);
    expect(settled).toBe(false); // backpressure is holding the encoder
    release();
    await writes;
    expect(settled).toBe(true);
  });

  it("reports progress as Drive acknowledges bytes", async () => {
    const progress: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const r = rangeOf(init);
      if (r.endsWith("/*")) {
        const end = Number(/bytes \d+-(\d+)/.exec(r)![1]);
        return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
      }
      return Response.json({ id: "drive-6" }, { status: 200 });
    }));
    const up = new StreamingUpload(SESSION, { onProgress: (n) => progress.push(n) });
    await up.write(bytes(CHUNK_SIZE_BYTES), 0);
    await up.write(bytes(10), CHUNK_SIZE_BYTES);
    await up.finish();
    expect(progress).toEqual([CHUNK_SIZE_BYTES, CHUNK_SIZE_BYTES + 10]);
  });
});
