# Fast Export + Streaming Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 7-minute take renders in well under real time and its upload runs *while* it renders, so Save → share link takes ≈ max(render, upload) instead of render + upload.

**Architecture:** Replace the real-time `<video>` + `MediaRecorder` export with a WebCodecs pipeline built on `mediabunny`: demux + decode the raw take (`VideoSampleSink.samplesAtTimestamps`, `AudioBufferSink.buffers`), draw every output frame with the existing `drawFrame`, encode with the hardware encoder (`CanvasSource` avc → vp9 → vp8, `AudioBufferSource` aac → opus) into a **fragmented MP4**, whose bytes are written strictly in order. Those bytes go straight into a Drive resumable session opened with an *unknown* length (`Content-Range: bytes a-b/*`). The old exporter stays as the fallback when WebCodecs or a codec is missing.

**Tech Stack:** Next.js 16 client code, Electron 44 (Chromium, WebCodecs + VideoToolbox), `mediabunny@^1.58.1`, Google Drive resumable uploads, vitest (node env).

**Why:** Tyler's 7:26 take (2026-09-19) needed ~6:50 of real-time render before the upload even began, and a render that depends on 7 minutes of glitch-free playback is what stalled ("Playback stalled while rendering."). Frame-by-frame decode cannot stall and is not capped at 1×.

---

## Facts the engineer needs (verified 2026-09-19)

- `renderToBlob(sources, edits, opts)` — `src/lib/editor/export.ts:271`; only caller `src/lib/recording/use-recorder.ts` `finish` (~:790). Keep it: it becomes the fallback.
- `drawFrame(ctx, inputs, t, W, H)` — `src/lib/editor/render.ts:504`. `t` is **source seconds**; it never reads `currentTime`. From `inputs.screen/camera` it reads only `videoWidth`/`videoHeight` (:506, :613, :631) and passes them to `ctx.drawImage`. Shared with the live preview (`use-staging-player.ts:404`).
- Output size: `outputSize(w, h, edits)` in `render.ts`. Render inputs are built at `export.ts:314` (`cursorAt`, `smoothCursorAt`, `keysAt`) — copy that block verbatim.
- Cuts: `keptRanges(edits, durationS)`, `editedDurationIn(ranges)`, `editedToSourceIn(ranges, t)`, `sourceToEditedIn(ranges, t)` in `src/lib/editor/cuts.ts`. Ranges are half-open.
- Audio rides **only the primary file** (screen blob, or camera blob in camera mode); the camera file in `screen+camera` is video-only. No gain edits exist.
- Camera time = `sourceT + cameraOffsetMs/1000`.
- Source blobs may be webm (vp8/vp9 + opus) or mp4 (Safari). mediabunny `ALL_FORMATS` reads both.
- Upload: `POST /api/upload` requires `sizeBytes` (`src/app/api/upload/route.ts:21`) and `createResumableSession` always sends `X-Upload-Content-Length` (`src/lib/google-drive.ts:121`). `complete` stores mime/size from Drive, not the client. Everything downstream keys off the stored mime — mp4 flows through.
- `src/lib/upload-client.ts`: `putInit(sessionUri, contentRange, body, options, timeoutMs)`, `offsetFromRange`, `MAX_ATTEMPTS = 5`, `CHUNK_TIMEOUT_MS = 120_000`, `QUERY_TIMEOUT_MS = 30_000`, `CHUNK_SIZE_BYTES = 8 MiB`.
- mediabunny 1.58.1 API used here (from its `dist/mediabunny.d.ts`): `Input({source: new BlobSource(blob), formats: ALL_FORMATS})`, `input.getPrimaryVideoTrack()`, `input.getPrimaryAudioTrack()`, `new VideoSampleSink(track).samplesAtTimestamps(iterable)` → `AsyncGenerator<VideoSample|null>` (decodes each packet at most once for sorted timestamps), `VideoSample.toCanvasImageSource()`, `.close()`, `new AudioBufferSink(track).buffers(start?, end?)` → `{buffer, timestamp, duration}`, `new Output({format: new Mp4OutputFormat({fastStart: "fragmented"}), target: new StreamTarget(writable, {chunked: true, chunkSize})})` — fragmented output is **written monotonically**, `new CanvasSource(canvas, {codec, bitrate, keyFrameInterval})` `.add(timestampS, durationS)`, `new AudioBufferSource({codec, bitrate})` `.add(audioBuffer)` (buffers placed back to back), `canEncodeVideo(codec, {width, height, bitrate})`, `canEncodeAudio(codec)`, `output.start() / finalize() / cancel()`, `output.format.mimeType`.
- Tests: vitest `environment: "node"`, `src/**/*.test.ts` only. No WebCodecs in node → pure logic is unit-tested; the pipeline is verified in Electron (Task 10).
- Per `AGENTS.md`, this Next.js differs from training data: check `node_modules/next/dist/docs/` before touching route handlers.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/editor/fast-export/timeline.ts` (new) | Pure: output frame → source/camera time; thumbnail frame index. |
| `src/lib/editor/fast-export/audio-assembler.ts` (new) | Pure: lays decoded source audio onto the edited timeline (cuts removed, gaps silent), drains fixed blocks. |
| `src/lib/editor/fast-export/codecs.ts` (new) | Picks the best encodable video/audio codec pair, or null → fallback. |
| `src/lib/editor/fast-export/layer.ts` (new) | Adapts a decoded frame to the `VideoLayer` shape `drawFrame` reads. |
| `src/lib/editor/fast-export/render-fast.ts` (new) | The WebCodecs pipeline; emits ordered byte chunks + thumbnail. |
| `src/lib/editor/render.ts` (modify) | `RenderInputs.screen/camera` widened from `HTMLVideoElement` to `VideoLayer`. |
| `src/lib/streaming-upload.ts` (new) | Drive resumable upload fed incrementally, unknown total, retry/resume, keeps bytes for fallback. |
| `src/lib/upload-client.ts` (modify) | Export the shared helpers. |
| `src/lib/google-drive.ts`, `src/app/api/upload/route.ts` (modify) | Allow a session with no declared size. |
| `src/lib/recording/upload.ts` (modify) | Split into `beginUpload` / `completeUpload`; `uploadRecording` composes them. |
| `src/lib/recording/use-recorder.ts`, `src/components/recorder.tsx` (modify) | Fast path + fallback, one Cancel for render *and* upload. |

---

### Task 1: Add mediabunny and widen `drawFrame`'s video inputs

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src/lib/editor/render.ts:8-14, 49`
- Create: `src/lib/editor/fast-export/layer.ts`
- Test: `src/lib/editor/fast-export/layer.test.ts`

- [ ] **Step 1: Install**

Run: `npm install mediabunny@^1.58.1`
Expected: `package.json` gains `"mediabunny": "^1.58.1"` under `dependencies`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/editor/fast-export/layer.test.ts
import { describe, expect, it } from "vitest";
import { asLayer } from "./layer";

describe("asLayer", () => {
  it("exposes a decoded frame's display size as videoWidth/videoHeight", () => {
    const frame = { displayWidth: 2880, displayHeight: 1800 } as unknown as VideoFrame;
    const layer = asLayer(frame);
    expect(layer).toBe(frame); // same object: drawImage still gets the real frame
    expect(layer.videoWidth).toBe(2880);
    expect(layer.videoHeight).toBe(1800);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/editor/fast-export/layer.test.ts`
Expected: FAIL — cannot resolve `./layer`.

- [ ] **Step 4: Implement**

In `src/lib/editor/render.ts`, add above `RenderInputs` and change the two fields and `primary()`:

```ts
/**
 * What a video layer is drawn from: a live `<video>` (preview, legacy export)
 * or a decoded `VideoFrame` (fast export). `drawFrame` only needs pixels for
 * `drawImage` plus the intrinsic size.
 */
export type VideoLayer = CanvasImageSource & { readonly videoWidth: number; readonly videoHeight: number };
```

```ts
  screen: VideoLayer | null;
  camera: VideoLayer | null;
```

```ts
function primary(inputs: RenderInputs): VideoLayer | null {
```

Then:

```ts
// src/lib/editor/fast-export/layer.ts
import type { VideoLayer } from "../render";

/**
 * Give a decoded frame the two properties `drawFrame` reads. Defined on the
 * frame itself so `drawImage` still receives a genuine `VideoFrame`.
 */
export function asLayer(frame: VideoFrame): VideoLayer {
  Object.defineProperties(frame, {
    videoWidth: { value: frame.displayWidth, configurable: true },
    videoHeight: { value: frame.displayHeight, configurable: true },
  });
  return frame as unknown as VideoLayer;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/editor && npx tsc --noEmit -p . 2>&1 | grep -v "db.test.ts\|upload-client.test.ts"`
Expected: all editor tests PASS; no new type errors (the 3 pre-existing errors in `db.test.ts`/`upload-client.test.ts` are filtered out). If any other file reads `.currentTime` etc. off `inputs.screen`, tsc flags it — fix by keeping the `HTMLVideoElement` where it is really needed (the preview hook holds its own element refs).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/editor/render.ts src/lib/editor/fast-export/layer.ts src/lib/editor/fast-export/layer.test.ts
git commit -m "feat(export): let drawFrame paint decoded frames; add mediabunny"
```

---

### Task 2: Frame timeline

**Files:**
- Create: `src/lib/editor/fast-export/timeline.ts`
- Test: `src/lib/editor/fast-export/timeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/editor/fast-export/timeline.test.ts
import { describe, expect, it } from "vitest";
import { frameCount, sourceTimes, cameraTimes, thumbnailFrame } from "./timeline";

const ranges = [{ start: 0, end: 1 }, { start: 3, end: 4 }]; // a cut over [1,3)

describe("frame timeline", () => {
  it("counts whole output frames over the kept duration", () => {
    expect(frameCount(ranges, 30)).toBe(60);
  });

  it("maps each output frame to a monotonically increasing source time, skipping cuts", () => {
    const t = [...sourceTimes(ranges, 30)];
    expect(t).toHaveLength(60);
    expect(t[0]).toBe(0);
    expect(t[29]).toBeCloseTo(29 / 30);
    expect(t[30]).toBeCloseTo(3); // first frame after the cut
    expect(t[59]).toBeCloseTo(3 + 29 / 30);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });

  it("offsets camera times and clamps them at zero", () => {
    expect([...cameraTimes([0, 0.5, 1], -0.25)]).toEqual([0, 0.25, 0.75]);
  });

  it("picks the output frame for a thumbnail given in edited seconds", () => {
    expect(thumbnailFrame(1.5, 60, 30)).toBe(45);
    expect(thumbnailFrame(99, 60, 30)).toBe(59);
    expect(thumbnailFrame(-1, 60, 30)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/editor/fast-export/timeline.test.ts`
Expected: FAIL — cannot resolve `./timeline`.

- [ ] **Step 3: Implement**

```ts
// src/lib/editor/fast-export/timeline.ts
import { editedDurationIn, editedToSourceIn, type Range } from "../cuts";

/** Output frames needed to cover the kept ranges at `fps`. */
export function frameCount(ranges: Range[], fps: number): number {
  return Math.max(1, Math.round(editedDurationIn(ranges) * fps));
}

/**
 * Source second for every output frame, in order. Strictly increasing, which
 * is what lets `samplesAtTimestamps` decode each packet at most once.
 */
export function* sourceTimes(ranges: Range[], fps: number): Generator<number> {
  const n = frameCount(ranges, fps);
  for (let k = 0; k < n; k++) yield editedToSourceIn(ranges, k / fps);
}

/** Camera-file seconds for the given screen seconds (`cameraTime = screenTime + offset`). */
export function* cameraTimes(times: Iterable<number>, offsetS: number): Generator<number> {
  for (const t of times) yield Math.max(0, t + offsetS);
}

/** Output frame index for a thumbnail given in edited seconds. */
export function thumbnailFrame(thumbnailAt: number, frames: number, fps: number): number {
  return Math.min(frames - 1, Math.max(0, Math.round(thumbnailAt * fps)));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/editor/fast-export/timeline.test.ts`
Expected: PASS (4 tests). If `t[30]` is not exactly 3, check `editedToSourceIn`'s boundary rule ("a time at a cut boundary resolves to the start of the next range") — the test encodes that rule.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/fast-export/timeline.ts src/lib/editor/fast-export/timeline.test.ts
git commit -m "feat(export): output-frame timeline for the fast exporter"
```

---

### Task 3: Audio assembler

**Files:**
- Create: `src/lib/editor/fast-export/audio-assembler.ts`
- Test: `src/lib/editor/fast-export/audio-assembler.test.ts`

Design: one pass over the decoded source audio. Each decoded buffer carries a source timestamp; the assembler copies every sample that falls inside a kept range to its **edited** sample index, so cuts vanish and missing audio becomes silence. `drain(untilFrame)` hands back finished blocks so the exporter can interleave audio ahead of video.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/editor/fast-export/audio-assembler.test.ts
import { describe, expect, it } from "vitest";
import { AudioAssembler } from "./audio-assembler";

const SR = 10; // 10 Hz keeps the arithmetic readable
const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i);

describe("AudioAssembler", () => {
  it("drops samples inside a cut and closes the gap", () => {
    const a = new AudioAssembler([{ start: 0, end: 1 }, { start: 2, end: 3 }], SR, 1);
    a.push([ramp(0, 30)], 0); // source 0..3 s, sample value = source index
    const out = a.drain(20);
    expect(out.frames).toBe(20);
    expect(Array.from(out.channels[0])).toEqual([...Array.from(ramp(0, 10)), ...Array.from(ramp(20, 10))]);
  });

  it("fills missing audio with silence and only drains what was asked", () => {
    const a = new AudioAssembler([{ start: 0, end: 2 }], SR, 2);
    a.push([ramp(1, 5), ramp(1, 5)], 1); // only source 1.0–1.5 s present
    const first = a.drain(10);
    expect(Array.from(first.channels[0])).toEqual(new Array(10).fill(0));
    const second = a.drain(20);
    expect(Array.from(second.channels[1])).toEqual([1, 2, 3, 4, 5, 0, 0, 0, 0, 0]);
  });

  it("never drains past the edited end", () => {
    const a = new AudioAssembler([{ start: 0, end: 1 }], SR, 1);
    expect(a.drain(1000).frames).toBe(10);
    expect(a.drain(1000).frames).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/editor/fast-export/audio-assembler.test.ts`
Expected: FAIL — cannot resolve `./audio-assembler`.

- [ ] **Step 3: Implement**

```ts
// src/lib/editor/fast-export/audio-assembler.ts
import { editedDurationIn, sourceToEditedIn, type Range } from "../cuts";

export type AudioBlock = { channels: Float32Array[]; frames: number };

/**
 * Lays decoded source audio onto the edited timeline. Push buffers in any
 * order that is roughly chronological; drain blocks strictly in order. Pending
 * samples are held only between the drained edge and the furthest write, so
 * memory stays at a few seconds when the caller drains as it goes.
 */
export class AudioAssembler {
  private readonly total: number;
  private drained = 0; // edited frames already handed out
  private pending: Float32Array[]; // pending[c][i] = edited frame `drained + i`

  constructor(
    private readonly ranges: Range[],
    private readonly sampleRate: number,
    private readonly channelCount: number,
  ) {
    this.total = Math.round(editedDurationIn(ranges) * sampleRate);
    this.pending = Array.from({ length: channelCount }, () => new Float32Array(0));
  }

  /** `data[c]` holds channel c; `timestamp` is the first sample's source second. */
  push(data: Float32Array[], timestamp: number): void {
    const n = data[0]?.length ?? 0;
    if (n === 0) return;
    const end = timestamp + n / this.sampleRate;
    for (const r of this.ranges) {
      const from = Math.max(timestamp, r.start);
      const to = Math.min(end, r.end);
      if (to <= from) continue;
      const srcFrom = Math.round((from - timestamp) * this.sampleRate);
      const count = Math.min(n - srcFrom, Math.round((to - from) * this.sampleRate));
      const dst = Math.round(sourceToEditedIn(this.ranges, from) * this.sampleRate) - this.drained;
      if (count <= 0 || dst + count <= 0) continue;
      const skip = Math.max(0, -dst);
      this.ensure(dst + count);
      for (let c = 0; c < this.channelCount; c++) {
        const src = data[Math.min(c, data.length - 1)];
        this.pending[c].set(src.subarray(srcFrom + skip, srcFrom + count), dst + skip);
      }
    }
  }

  /** Hand out edited frames `[drained, min(untilFrame, total))`; unwritten samples are silence. */
  drain(untilFrame: number): AudioBlock {
    const frames = Math.max(0, Math.min(untilFrame, this.total) - this.drained);
    this.ensure(frames);
    const channels = this.pending.map((p) => p.slice(0, frames));
    this.pending = this.pending.map((p) => p.slice(frames));
    this.drained += frames;
    return { channels, frames };
  }

  private ensure(length: number): void {
    if (this.pending[0].length >= length) return;
    this.pending = this.pending.map((p) => {
      const grown = new Float32Array(Math.max(length, p.length * 2));
      grown.set(p);
      return grown;
    });
  }
}
```

Note: `slice(frames)` on a grown buffer keeps its capacity bounded because the caller drains every ~1 s.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/editor/fast-export/audio-assembler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/fast-export/audio-assembler.ts src/lib/editor/fast-export/audio-assembler.test.ts
git commit -m "feat(export): assemble source audio onto the edited timeline"
```

---

### Task 4: Drive sessions with an unknown size

**Files:**
- Modify: `src/lib/google-drive.ts:112-142` (`ResumableSessionInput.sizeBytes` optional)
- Modify: `src/app/api/upload/route.ts:10-23`
- Test: `src/lib/google-drive.test.ts` (create if absent; follow the existing `fetch` stub style in `src/lib/upload-client.test.ts`)

- [ ] **Step 1: Read the route-handler guide**

Run: `ls node_modules/next/dist/docs/ && grep -ril "route handler" node_modules/next/dist/docs | head -3`
Skim the route-handler doc for anything that changed `request.json()` / `NextResponse.json` semantics. No change expected.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/google-drive.test.ts  (add this describe; keep any existing ones)
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: () => "folder-id" }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("createResumableSession", () => {
  it("omits X-Upload-Content-Length when the size is not known yet", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200, headers: { location: "https://upload/session" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { createResumableSession } = await import("./google-drive");
    await createResumableSession({ name: "a.mp4", mimeType: "video/mp4", origin: "https://yoom.jtylerray.com" });
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["X-Upload-Content-Length"]).toBeUndefined();
    expect(headers["X-Upload-Content-Type"]).toBe("video/mp4");
  });
});
```

If `driveFetch` needs an access token, the existing tests for `google-drive.ts` (search `grep -rn "google-drive" src --include=*.test.ts`) show how it is mocked — reuse that mock instead of the bare `fetch` stub.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/google-drive.test.ts`
Expected: FAIL — type error or the header is `"undefined"`.

- [ ] **Step 4: Implement**

In `ResumableSessionInput` make `sizeBytes?: number`, then build headers:

```ts
      "X-Upload-Content-Type": input.mimeType,
      // Omitted for a streamed upload: the renderer is still producing bytes,
      // and the final chunk's Content-Range declares the total instead.
      ...(input.sizeBytes ? { "X-Upload-Content-Length": String(input.sizeBytes) } : {}),
```

In `src/app/api/upload/route.ts` replace the size check:

```ts
  // Absent for a streamed upload (the export is still rendering); when given
  // it must be sane.
  const sizeBytes = body.sizeBytes === undefined ? undefined : Number(body.sizeBytes);
  if (sizeBytes !== undefined && (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES)) {
    return NextResponse.json({ error: "Invalid sizeBytes" }, { status: 400 });
  }
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/google-drive.test.ts src/lib/recording/upload.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/google-drive.ts src/lib/google-drive.test.ts src/app/api/upload/route.ts
git commit -m "feat(upload): open a Drive session before the file size is known"
```

---

### Task 5: Streaming upload client

**Files:**
- Modify: `src/lib/upload-client.ts` (export `putInit`, `offsetFromRange`, `MAX_ATTEMPTS`, `CHUNK_TIMEOUT_MS`, `QUERY_TIMEOUT_MS`)
- Create: `src/lib/streaming-upload.ts`
- Test: `src/lib/streaming-upload.test.ts`

Behaviour:
- `write(data, position)` appends; `position` must equal bytes received so far (fragmented MP4 is monotonic — anything else is a bug, throw).
- Whenever ≥ `CHUNK_SIZE_BYTES` are unsent, PUT exactly one chunk `bytes a-b/*` (a multiple of 256 KiB, as Drive requires for non-final chunks).
- `write` resolves immediately unless more than `MAX_BUFFERED_BYTES` (64 MiB) are unsent — then it waits, which backpressures the encoder.
- `finish()` PUTs the remainder as `bytes a-(total-1)/total` (or `bytes */total` when nothing remains) and returns the Drive file id.
- A network error or 5xx asks Drive for the committed offset with `bytes */*` and resends from there. Every byte is kept in memory (same footprint as today's rendered Blob), so resends and a last-resort `blob()` fallback are always possible.
- Every request gets the 120 s / 30 s timeouts via `putInit`.

- [ ] **Step 1: Export helpers**

In `src/lib/upload-client.ts` prefix `export` on `MAX_ATTEMPTS`, `CHUNK_TIMEOUT_MS`, `QUERY_TIMEOUT_MS`, `putInit`, `offsetFromRange`. No behaviour change.

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/streaming-upload.test.ts
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
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/lib/streaming-upload.test.ts`
Expected: FAIL — cannot resolve `@/lib/streaming-upload`.

- [ ] **Step 4: Implement**

```ts
// src/lib/streaming-upload.ts
import {
  CHUNK_SIZE_BYTES,
  CHUNK_TIMEOUT_MS,
  MAX_ATTEMPTS,
  QUERY_TIMEOUT_MS,
  offsetFromRange,
  putInit,
  type UploadOptions,
} from "@/lib/upload-client";

/** Unsent bytes allowed before `write` makes the encoder wait. */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

type Options = UploadOptions & {
  onProgress?: (sentBytes: number) => void;
  /** Tests only: buffer without sending. */
  autoSend?: boolean;
};

/**
 * A Drive resumable upload fed while the file is still being produced. The
 * total is unknown until `finish`, so every chunk but the last says `/*`.
 */
export class StreamingUpload {
  /** One Blob per write: `new Blob(blobs)` references them, where `new Blob(uint8arrays)` would copy every byte again. */
  private readonly parts: Blob[] = [];
  private received = 0;
  private sent = 0; // bytes Drive has acknowledged
  private sending: Promise<void> = Promise.resolve();
  private failure: unknown = null;

  constructor(private readonly sessionUri: string, private readonly options: Options = {}) {}

  async write(data: Uint8Array, position: number): Promise<void> {
    if (this.failure) throw this.failure;
    if (position !== this.received) throw new Error(`Upload bytes out of order (${position} ≠ ${this.received})`);
    this.parts.push(new Blob([data as BlobPart]));
    this.received += data.byteLength;
    if (this.options.autoSend === false) return;
    if (this.received - this.sent >= CHUNK_SIZE_BYTES) this.kick();
    if (this.received - this.sent > MAX_BUFFERED_BYTES) await this.sending;
    if (this.failure) throw this.failure;
  }

  async finish(): Promise<{ id: string }> {
    await this.sending;
    if (this.failure) throw this.failure;
    return this.sendRest();
  }

  /** Everything received so far, for a whole-file retry. */
  blob(type: string): Blob {
    return new Blob(this.parts, { type });
  }

  private kick(): void {
    this.sending = this.sending.then(async () => {
      try {
        while (this.received - this.sent >= CHUNK_SIZE_BYTES) {
          await this.put(this.sent, this.sent + CHUNK_SIZE_BYTES, "*");
        }
      } catch (err) {
        this.failure = err;
      }
    });
  }

  private async sendRest(): Promise<{ id: string }> {
    const total = this.received;
    for (let attempts = 0; attempts < MAX_ATTEMPTS; ) {
      const id = await this.put(this.sent, total, String(total));
      if (id) return { id };
      if (this.sent >= total) attempts++; // all bytes acked but no id yet: ask again
    }
    throw new Error("Upload failed: Drive never confirmed the file");
  }

  /** PUT bytes [from, to) with total `total` ("*" while unknown). Returns the file id when Drive finishes. */
  private async put(from: number, to: number, total: string): Promise<string | null> {
    let attempts = 0;
    for (;;) {
      const range = to > from ? `bytes ${from}-${to - 1}/${total}` : `bytes */${total}`;
      const [url, init] = putInit(this.sessionUri, range, to > from ? this.slice(from, to) : undefined, this.options, CHUNK_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        if (this.options.signal?.aborted) throw err;
        if (++attempts >= MAX_ATTEMPTS) throw new Error("Upload failed after repeated network errors");
        from = await this.committed();
        continue;
      }
      if (res.status === 200 || res.status === 201) {
        const json = (await res.json()) as { id?: string };
        if (!json.id) throw new Error("Upload finished without a Drive file id");
        this.sent = this.received;
        this.options.onProgress?.(this.sent);
        return json.id;
      }
      if (res.status === 308) {
        this.sent = offsetFromRange(res.headers.get("range"));
        this.options.onProgress?.(this.sent);
        return null;
      }
      if (res.status === 404 || res.status === 410) throw new Error("Upload session expired.");
      if (++attempts >= MAX_ATTEMPTS) throw new Error(`Upload failed (${res.status})`);
      from = await this.committed();
    }
  }

  /** Ask Drive how much it has; resets `sent` to that. */
  private async committed(): Promise<number> {
    const [url, init] = putInit(this.sessionUri, "bytes */*", undefined, this.options, QUERY_TIMEOUT_MS);
    const res = await fetch(url, init);
    if (res.status === 404 || res.status === 410) throw new Error("Upload session expired.");
    this.sent = res.status === 308 ? offsetFromRange(res.headers.get("range")) : this.sent;
    return this.sent;
  }

  private slice(from: number, to: number): Blob {
    return this.blob("application/octet-stream").slice(from, to);
  }
}
```

Note: each write copies its bytes exactly once (into its own Blob). `slice` composes existing Blobs, which Chromium does by reference, so sending chunk N does not re-copy chunks 0..N-1.

After `committed()` rewinds `from`, the `while` loop in `kick` re-derives the next chunk from `this.sent`, so a partial commit resends the right bytes. `put` inside `sendRest` also uses the rewound `from` on retry.

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run src/lib/streaming-upload.test.ts src/lib/upload-client.test.ts`
Expected: PASS (4 new + 12 existing).

- [ ] **Step 6: Commit**

```bash
git add src/lib/streaming-upload.ts src/lib/streaming-upload.test.ts src/lib/upload-client.ts
git commit -m "feat(upload): stream bytes to Drive while the export is still rendering"
```

---

### Task 6: Codec selection

**Files:**
- Create: `src/lib/editor/fast-export/codecs.ts`
- Test: `src/lib/editor/fast-export/codecs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/editor/fast-export/codecs.test.ts
import { describe, expect, it, vi } from "vitest";

const can = { video: new Set<string>(), audio: new Set<string>() };
vi.mock("mediabunny", () => ({
  canEncodeVideo: async (c: string) => can.video.has(c),
  canEncodeAudio: async (c: string) => can.audio.has(c),
}));

import { pickCodecs } from "./codecs";

describe("pickCodecs", () => {
  it("prefers hardware-friendly avc + aac", async () => {
    can.video = new Set(["avc", "vp9"]); can.audio = new Set(["aac", "opus"]);
    await expect(pickCodecs(1920, 1080, true)).resolves.toEqual({ video: "avc", audio: "aac" });
  });
  it("falls back to vp9 + opus", async () => {
    can.video = new Set(["vp9"]); can.audio = new Set(["opus"]);
    await expect(pickCodecs(1920, 1080, true)).resolves.toEqual({ video: "vp9", audio: "opus" });
  });
  it("needs no audio codec for a silent take", async () => {
    can.video = new Set(["avc"]); can.audio = new Set();
    await expect(pickCodecs(1920, 1080, false)).resolves.toEqual({ video: "avc", audio: null });
  });
  it("returns null when nothing usable exists (caller uses the legacy exporter)", async () => {
    can.video = new Set(); can.audio = new Set(["aac"]);
    await expect(pickCodecs(1920, 1080, true)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/editor/fast-export/codecs.test.ts`
Expected: FAIL — cannot resolve `./codecs`.

- [ ] **Step 3: Implement**

```ts
// src/lib/editor/fast-export/codecs.ts
import { canEncodeAudio, canEncodeVideo } from "mediabunny";

/** Export bitrate. Screen content at this rate is visually lossless in H.264. */
export const VIDEO_BITRATE = 8_000_000;
export const AUDIO_BITRATE = 128_000;

export type CodecPair = { video: "avc" | "vp9" | "vp8"; audio: "aac" | "opus" | null };

/** Best encodable pair for this size, or null when the fast path cannot run. */
export async function pickCodecs(width: number, height: number, hasAudio: boolean): Promise<CodecPair | null> {
  let video: CodecPair["video"] | null = null;
  for (const c of ["avc", "vp9", "vp8"] as const) {
    if (await canEncodeVideo(c, { width, height, bitrate: VIDEO_BITRATE })) { video = c; break; }
  }
  if (!video) return null;
  if (!hasAudio) return { video, audio: null };
  for (const a of ["aac", "opus"] as const) {
    if (await canEncodeAudio(a, { bitrate: AUDIO_BITRATE })) return { video, audio: a };
  }
  return null;
}
```

Bitrate note: the old export ran at 10 Mbps VP9. 8 Mbps H.264 is ~20 % smaller for screen content at the same look, which directly shortens the upload. Tune after Task 10 if text looks soft.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/editor/fast-export/codecs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/fast-export/codecs.ts src/lib/editor/fast-export/codecs.test.ts
git commit -m "feat(export): choose the fastest encodable codec pair"
```

---

### Task 7: The fast render pipeline

**Files:**
- Create: `src/lib/editor/fast-export/render-fast.ts`

No node unit test: WebCodecs does not exist in node. Correctness of the pure parts is covered by Tasks 2, 3, 6; the pipeline is verified in Electron in Task 10.

- [ ] **Step 1: Implement**

```ts
// src/lib/editor/fast-export/render-fast.ts
import {
  ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, CanvasSource, Input,
  Mp4OutputFormat, Output, StreamTarget, VideoSampleSink,
  type StreamTargetChunk, type VideoSample,
} from "mediabunny";
import type { VideoEdits } from "@/lib/edits";
import { CHUNK_SIZE_BYTES } from "@/lib/upload-client";
import { keptRanges } from "../cuts";
import { loadBackground, releaseBackground, type RenderOptions, type RenderSources } from "../export";
import { drawFrame, outputSize, preloadOverlayImages, type RenderInputs } from "../render";
import { AudioAssembler } from "./audio-assembler";
import { AUDIO_BITRATE, VIDEO_BITRATE, pickCodecs } from "./codecs";
import { asLayer } from "./layer";
import { cameraTimes, frameCount, sourceTimes, thumbnailFrame } from "./timeline";

export type FastRenderOptions = RenderOptions & {
  /** Receives the output file's bytes strictly in order. Awaited (backpressure). */
  onChunk: (data: Uint8Array, position: number) => Promise<void>;
};
export type FastRenderResult = { mimeType: string; size: number; thumbnail: Blob | null; width: number; height: number };

/** Thrown when this machine cannot fast-export; the caller falls back to `renderToBlob`. */
export class FastExportUnsupported extends Error {}

const FPS = 30;
/** Audio is kept this far ahead of video so the muxer can interleave without buffering. */
const AUDIO_LEAD_S = 1;

export async function renderFast(sources: RenderSources, edits: VideoEdits, opts: FastRenderOptions): Promise<FastRenderResult> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") throw new FastExportUnsupported("no WebCodecs");
  const fps = opts.fps ?? FPS;
  const primaryBlob = sources.mode === "camera" ? sources.camera : sources.screen;
  if (!primaryBlob) throw new Error("Nothing to render");

  const inputs: Input[] = [];
  const open = (blob: Blob) => { const i = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }); inputs.push(i); return i; };
  let background: Awaited<ReturnType<typeof loadBackground>> = null;
  let output: Output | null = null;
  try {
    const primaryIn = open(primaryBlob);
    const video = await primaryIn.getPrimaryVideoTrack();
    if (!video) throw new Error("The recording has no video track");
    const audio = await primaryIn.getPrimaryAudioTrack();
    const cameraTrack = sources.mode === "screen+camera" && sources.camera ? await open(sources.camera).getPrimaryVideoTrack() : null;

    const { width, height } = outputSize(video.displayWidth, video.displayHeight, edits);
    const codecs = await pickCodecs(width, height, !!audio);
    if (!codecs) throw new FastExportUnsupported("no encodable codec");

    background = await loadBackground(edits);
    await preloadOverlayImages(edits);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false })!;

    // Same samplers as the legacy export — copy the block at export.ts:314.
    const renderInputs: RenderInputs = buildRenderInputs(sources, edits, background, opts);

    const ranges = keptRanges(edits, sources.durationMs / 1000);
    const frames = frameCount(ranges, fps);
    const thumbAt = thumbnailFrame(opts.thumbnailAt, frames, fps);

    let size = 0;
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: "fragmented" }),
      target: new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          write: async (c) => { size = Math.max(size, c.position + c.data.byteLength); await opts.onChunk(c.data, c.position); },
        }),
        { chunked: true, chunkSize: CHUNK_SIZE_BYTES },
      ),
    });
    const videoOut = new CanvasSource(canvas, { codec: codecs.video, bitrate: VIDEO_BITRATE, keyFrameInterval: 2 });
    output.addVideoTrack(videoOut, { frameRate: fps });

    let audioOut: AudioBufferSource | null = null;
    let assembler: AudioAssembler | null = null;
    let audioIter: AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }> | null = null;
    let sampleRate = 48_000;
    if (audio && codecs.audio) {
      audioOut = new AudioBufferSource({ codec: codecs.audio, bitrate: AUDIO_BITRATE });
      output.addAudioTrack(audioOut);
      sampleRate = audio.sampleRate;
      assembler = new AudioAssembler(ranges, sampleRate, audio.numberOfChannels);
      audioIter = new AudioBufferSink(audio).buffers(ranges[0]?.start ?? 0);
    }
    await output.start();

    let audioSourceEdge = 0; // source seconds of audio already pushed
    let audioDrained = 0; // edited frames handed to the encoder
    const pumpAudio = async (untilEditedS: number) => {
      if (!assembler || !audioIter || !audioOut) return;
      const untilFrame = Math.round(untilEditedS * sampleRate);
      // Pull decoded audio until the source edge passes the source time of `untilEditedS`.
      const needSource = ranges.length ? sourceAtEdited(ranges, untilEditedS) : 0;
      while (audioSourceEdge < needSource) {
        const next = await audioIter.next();
        if (next.done) { audioSourceEdge = Infinity; break; }
        const { buffer, timestamp } = next.value;
        assembler.push(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), timestamp);
        audioSourceEdge = timestamp + buffer.duration;
      }
      const block = assembler.drain(untilFrame);
      if (block.frames === 0) return;
      const ab = new AudioBuffer({ length: block.frames, numberOfChannels: block.channels.length, sampleRate });
      block.channels.forEach((ch, c) => ab.copyToChannel(ch, c));
      await audioOut.add(ab);
      audioDrained += block.frames;
    };

    const times = [...sourceTimes(ranges, fps)];
    const offsetS = (edits.cameraOffsetMs ?? 0) / 1000; // same source as export.ts:306
    const screenSamples = new VideoSampleSink(video).samplesAtTimestamps(times);
    const cameraSamples = cameraTrack ? new VideoSampleSink(cameraTrack).samplesAtTimestamps(cameraTimes(times, offsetS)) : null;

    let lastScreen: VideoSample | null = null;
    let lastCamera: VideoSample | null = null;
    let thumbnail: Blob | null = null;
    let reported = -1;
    for (let k = 0; k < frames; k++) {
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const editedT = k / fps;
      if (editedT + AUDIO_LEAD_S / 2 >= audioDrained / sampleRate) await pumpAudio(editedT + AUDIO_LEAD_S);

      const s = (await screenSamples.next()).value ?? null;
      if (s) { lastScreen?.close(); lastScreen = s; }
      if (cameraSamples) {
        const c = (await cameraSamples.next()).value ?? null;
        if (c) { lastCamera?.close(); lastCamera = c; }
      }
      // A missing frame (VFR gap, past the end) repeats the last one.
      const screenFrame = lastScreen ? (lastScreen.toCanvasImageSource() as VideoFrame) : null;
      const cameraFrame = lastCamera ? (lastCamera.toCanvasImageSource() as VideoFrame) : null;
      const primaryLayer = screenFrame ? asLayer(screenFrame) : null;
      renderInputs.screen = sources.mode === "camera" ? null : primaryLayer;
      renderInputs.camera = sources.mode === "camera" ? primaryLayer : cameraFrame ? asLayer(cameraFrame) : null;
      drawFrame(ctx, renderInputs, times[k], width, height);

      await videoOut.add(editedT, 1 / fps);
      if (k === thumbAt) thumbnail = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
      const pct = Math.min(99, Math.floor(((k + 1) / frames) * 100));
      if (pct !== reported) { reported = pct; opts.onProgress(pct); }
    }
    lastScreen?.close(); lastCamera?.close();
    await pumpAudio(Infinity);
    await output.finalize();
    opts.onProgress(100);
    return { mimeType: output.format.mimeType, size, thumbnail, width, height };
  } catch (err) {
    await output?.cancel().catch(() => undefined);
    throw err;
  } finally {
    for (const i of inputs) i.dispose();
    releaseBackground(background);
  }
}
```

Fill in the two helpers in the same file:

```ts
import { editedToSourceIn, type Range } from "../cuts";

/** Source second at an edited second, clamped to the last range's end. */
function sourceAtEdited(ranges: Range[], editedS: number): number {
  if (!Number.isFinite(editedS)) return Infinity;
  return editedToSourceIn(ranges, editedS);
}
```

`buildRenderInputs` — move the `RenderInputs` construction from `export.ts:314-325` into an exported function in `export.ts` (`export function buildRenderInputs(sources, edits, background, opts): RenderInputs`, leaving `screen`/`camera` null) and call it from both exporters. Pure move; run `npx vitest run src/lib/editor` after it.

**Before writing this file, verify against the installed types** (`node_modules/mediabunny/dist/mediabunny.d.ts`): `InputVideoTrack.displayWidth/displayHeight`, `InputAudioTrack.sampleRate/numberOfChannels`, and `Output.format.mimeType`. Adjust names; do not guess.

Camera offset comes from `edits.cameraOffsetMs` (`export.ts:306`), which staging keeps in the edit list.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "db.test.ts\|upload-client.test.ts"; npx eslint src/lib/editor/fast-export`
Expected: no output from either.

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/fast-export/render-fast.ts src/lib/editor/export.ts
git commit -m "feat(export): WebCodecs frame-by-frame exporter to fragmented MP4"
```

---

### Task 8: Split the upload into begin / complete

**Files:**
- Modify: `src/lib/recording/upload.ts`
- Test: `src/lib/recording/upload.test.ts`

- [ ] **Step 1: Write the failing test** (append to `upload.test.ts`, reusing its `fetch` stub helpers)

```ts
describe("beginUpload / completeUpload", () => {
  it("opens a session without a size for a streamed upload", async () => {
    const fetchMock = vi.fn(async () => Response.json({ sessionUri: "https://s", slug: "abc12345" }));
    vi.stubGlobal("fetch", fetchMock);
    const { beginUpload } = await import("./upload");
    const s = await beginUpload({ mimeType: "video/mp4", slug: "" });
    expect(s).toEqual({ sessionUri: "https://s", slug: "abc12345" });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.sizeBytes).toBeUndefined();
    expect(body.filename).toMatch(/\.mp4$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/recording/upload.test.ts`
Expected: FAIL — `beginUpload` is not exported.

- [ ] **Step 3: Implement** — extract, don't rewrite

Move the `/api/upload` block (`upload.ts:85-111`) into:

```ts
export async function beginUpload(input: { mimeType: string; sizeBytes?: number; slug: string; signal?: AbortSignal }): Promise<{ sessionUri: string; slug?: string }>
```

(body identical, `sizeBytes` sent only when defined, `extensionFor(mimeType)` for the filename). Move the `/api/upload/complete` + thumbnail block (`:124-156`) into:

```ts
export async function completeUpload(input: { driveFileId: string; reservedSlug?: string; durationMs: number; width: number | null; height: number | null; title: string; description: string; edits: VideoEdits; thumbnail: Blob | null; signal?: AbortSignal }): Promise<UploadRecordingResult>
```

`uploadRecording` becomes `beginUpload` → `onSlug` → `uploadToDrive` → `completeUpload`, same behaviour as now.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/recording/upload.test.ts`
Expected: all PASS, existing ones unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recording/upload.ts src/lib/recording/upload.test.ts
git commit -m "refactor(upload): split session start and completion"
```

---

### Task 9: Wire the fast path into Save, with fallback and one Cancel

**Files:**
- Modify: `src/lib/recording/use-recorder.ts` (`finish` ~:767-880, `cancelRender` ~:883, actions ~:1130)
- Modify: `src/components/recorder.tsx:153-181`

Flow in `finish`:
1. `RENDER`. Create one `AbortController` (`exportAbortRef`) for render **and** upload.
2. `beginUpload({mimeType: "video/mp4", slug: input.slug, signal})` → put the share link on the clipboard (existing `onSlug` logic).
3. `const up = new StreamingUpload(sessionUri, { signal, onProgress: (b) => dispatch({ type: "UPLOAD_PROGRESS", percent: … }) })`.
4. `renderFast(sources, input.edits, { …existing opts, signal, onChunk: (d, p) => up.write(d, p) })`.
5. `RENDER_DONE` → `teardown()` + `STREAM_ENDED` (as today) → `const { id } = await up.finish()`; upload percent = `sentBytes / result.size`.
6. `completeUpload({ driveFileId: id, reservedSlug, … })` → `clearStagingDraft()` → `UPLOAD_DONE` → `router.push` (unchanged).

Fallbacks:
- `FastExportUnsupported` thrown **before any byte was written** → run today's `renderToBlob` + `uploadRecording` path unchanged (it opens its own session; pass `slug: reservedSlug` so the copied link still works).
- Streaming upload fails after the render finished → `uploadRecording({ blob: up.blob(mimeType), slug: reservedSlug, … })` — no re-render.
- Any other render error → `RENDER_FAILED` (back to staging, edits kept by the draft fix `d28b9d0`).
- Abort → `RENDER_FAILED` / `UPLOAD_FAILED` with `error: ""`.

Log timings once per export so Task 10 can measure: `console.info("[Yoom] export", { path: "fast"|"legacy", codecs, renderMs, uploadTailMs, bytes })`.

- [ ] **Step 1: Implement `finish` per the flow above.**

Replace the body after the `sources` construction with the following. Keep the existing comments that still apply (clipboard activation, teardown rationale). Rename `renderAbortRef` → `exportAbortRef`, and `cancelRender` → `cancelExport` (update the `actions` type at ~:148 and the returned object).

```ts
      dispatch({ type: "RENDER" });
      const abort = new AbortController();
      exportAbortRef.current = abort;
      const { signal } = abort;
      const started = performance.now();
      copiedRef.current = false;
      const renderOpts = {
        thumbnailAt: input.thumbnailAt,
        onProgress: (percent: number) => dispatch({ type: "RENDER_PROGRESS", percent }),
        signal,
        cursor: toSeconds(cursorRef.current),
        keys: toSeconds(keysRef.current),
      };
      const copyLink = (slug: string | undefined) => {
        if (!slug) return;
        navigator.clipboard.writeText(shareUrl(slug)).then(() => { copiedRef.current = true; }).catch(() => undefined);
      };
      const done = (result: UploadRecordingResult, reserved: string | undefined) => {
        if (reserved && result.slug !== reserved) copiedRef.current = false; // clipboard link is stale
        clearStagingDraft();
        dispatch({ type: "UPLOAD_DONE", videoId: result.id, shareUrl: result.url });
        router.push(`/library/${result.id}${copiedRef.current ? "?new=1" : ""}`);
      };
      const failed = (type: "RENDER_FAILED" | "UPLOAD_FAILED", err: unknown) =>
        dispatch({ type, error: signal.aborted ? "" : err instanceof Error ? err.message : type === "RENDER_FAILED" ? "Render failed." : "Upload failed. Please try again." });
      const common = {
        durationMs: Math.round(editedDurationMs(input.edits, current.durationMs)),
        title: input.title, description: input.description, edits: input.edits, signal,
      };

      // --- fast path: render and upload overlap ---
      let session: { sessionUri: string; slug?: string };
      try {
        session = await beginUpload({ mimeType: "video/mp4", slug: input.slug, signal });
      } catch (err) {
        exportAbortRef.current = null;
        return failed("RENDER_FAILED", err);
      }
      copyLink(session.slug);
      const up = new StreamingUpload(session.sessionUri, { signal });
      let rendered: FastRenderResult;
      try {
        rendered = await renderFast(sources, input.edits, { ...renderOpts, onChunk: (d, p) => up.write(d, p) });
      } catch (err) {
        if (!(err instanceof FastExportUnsupported) || signal.aborted) {
          exportAbortRef.current = null;
          return failed("RENDER_FAILED", err);
        }
        // --- legacy path: this machine cannot fast-export ---
        console.info("[Yoom] export", { path: "legacy", reason: err.message });
        let blobResult: RenderResult;
        try {
          blobResult = await renderToBlob(sources, input.edits, renderOpts);
        } catch (e) {
          exportAbortRef.current = null;
          return failed("RENDER_FAILED", e);
        }
        dispatch({ type: "RENDER_DONE" });
        teardown();
        dispatch({ type: "STREAM_ENDED" });
        try {
          const result = await uploadRecording({
            ...common, blob: blobResult.blob, width: blobResult.width, height: blobResult.height,
            thumbnail: blobResult.thumbnail, slug: session.slug ?? input.slug,
            onProgress: (percent) => dispatch({ type: "UPLOAD_PROGRESS", percent }),
          });
          return done(result, session.slug);
        } catch (e) {
          return failed("UPLOAD_FAILED", e);
        } finally {
          exportAbortRef.current = null;
        }
      }
      const renderMs = performance.now() - started;
      dispatch({ type: "RENDER_DONE" });
      teardown();
      dispatch({ type: "STREAM_ENDED" });
      try {
        let driveFileId: string;
        try {
          ({ id: driveFileId } = await up.finish());
        } catch (err) {
          if (signal.aborted) throw err;
          // Streamed upload died; the bytes are all here, so retry whole-file without re-rendering.
          const result = await uploadRecording({
            ...common, blob: up.blob(rendered.mimeType), width: rendered.width, height: rendered.height,
            thumbnail: rendered.thumbnail, slug: session.slug ?? input.slug,
            onProgress: (percent) => dispatch({ type: "UPLOAD_PROGRESS", percent }),
          });
          return done(result, session.slug);
        }
        const result = await completeUpload({
          ...common, driveFileId, reservedSlug: session.slug,
          width: rendered.width, height: rendered.height, thumbnail: rendered.thumbnail,
        });
        console.info("[Yoom] export", { path: "fast", renderMs: Math.round(renderMs), uploadTailMs: Math.round(performance.now() - started - renderMs), bytes: rendered.size });
        done(result, session.slug);
      } catch (err) {
        failed("UPLOAD_FAILED", err);
      } finally {
        exportAbortRef.current = null;
      }
```

Imports to add: `beginUpload`, `completeUpload`, `type UploadRecordingResult` from `./upload`; `StreamingUpload` from `@/lib/streaming-upload`; `renderFast`, `FastExportUnsupported`, `type FastRenderResult` from `@/lib/editor/fast-export/render-fast`; `type RenderResult` from `@/lib/editor/export`; `shareUrl` from wherever `upload.ts` imports it.

Upload progress during the overlap: the render bar is the honest one while rendering. After `RENDER_DONE`, report the tail by passing `onProgress: (sent) => dispatch({ type: "UPLOAD_PROGRESS", percent: Math.min(99, Math.round((sent / Math.max(1, rendered.size)) * 100)) })` to the `StreamingUpload`. Because `rendered.size` is unknown until the render ends, create the progress callback as a closure over a `let totalBytes = 0` that you set after `renderFast` returns, and dispatch only when `totalBytes > 0`.

`uploadRecording` must accept `slug` so the fallback keeps the link that is already on the clipboard. It already does: `input.slug`.

- [ ] **Step 2: Cancel during upload.** In `recorder.tsx` drop the `{rendering && …}` guard so Cancel shows in both states and calls `actions.cancelExport`. While uploading, label the button "Cancel upload".

- [ ] **Step 3: Machine check.** `UPLOAD_FAILED` already returns to `staging` (`recorder-machine.ts:443-446`). Add a test that `UPLOAD_FAILED` with `error: ""` lands in staging with an empty error:

```ts
it("a cancelled upload returns to staging silently", () => {
  const s = { ...init(), status: "uploading" as const };
  const next = recorderReducer(s, { type: "UPLOAD_FAILED", error: "" });
  expect(next.status).toBe("staging");
  expect(next.error).toBe("");
});
```

Run: `npx vitest run src/lib/recording/recorder-machine.test.ts`
Expected: PASS.

- [ ] **Step 4: Full suite, typecheck, lint, build**

Run: `npx vitest run && npx tsc --noEmit -p . 2>&1 | grep -v "db.test.ts\|upload-client.test.ts"; npx eslint src; npm run build 2>&1 | tail -3`
Expected: all tests pass, no new type errors, no lint output, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recording/use-recorder.ts src/components/recorder.tsx src/lib/recording/recorder-machine.test.ts
git commit -m "feat(recorder): fast export streams into the upload; cancel works while uploading"
```

---

### Task 10: Verify in the real app

Follow `project-yoom-desktop-debugging` (memory): run the dev server, launch the dev Electron shell with `YOOM_DEV=1`, attach CDP on 9222.

- [ ] **Step 1:** Record a ~2 min screen+camera take with mic, add 2 cuts, a zoom, a blur, a text overlay, a camera move. Save.
- [ ] **Step 2:** Read the `[Yoom] export` console line. Pass criteria: `path: "fast"`, `codecs.video: "avc"`, `renderMs` < 50 % of the edited duration, upload finishes within ~15 s of render end on home wifi.
- [ ] **Step 3:** Open the share link. Check: plays from start, seeking works, audio in sync at start / after each cut / at the end (clap on camera near each cut when recording), cuts land where set, overlays/zoom/camera match the preview.
- [ ] **Step 4:** Download the file; open in QuickTime and Chrome. Both must play and seek (fragmented MP4 compatibility check).
- [ ] **Step 5:** Cancel mid-render and mid-upload: both return to staging with edits intact.
- [ ] **Step 6:** Force the fallback: in DevTools run `VideoEncoder = undefined` before Save → `path: "legacy"`, video uploads as before.
- [ ] **Step 7:** Then a 7-minute take, and record the numbers in the commit message of any tuning change.

If audio drifts after cuts: inspect `AudioAssembler` rounding at range edges first (per-range `Math.round` can accumulate ≤ 1 sample per cut — inaudible; anything more is a bug).
