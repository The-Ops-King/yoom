import fixWebmDuration from "fix-webm-duration";
import type { VideoEdits } from "@/lib/edits";
import type { CursorSample, KeySample, RecordingMode } from "@/lib/recording/types";
import { getWallpaperBlob } from "@/lib/wallpapers";
import { CURSOR_TAU_S, createCursorSampler } from "./cursor-path";
import { createKeySampler } from "./render-input";
import { editedToSource, keptRanges } from "./cuts";
import { drawFrame, outputSize, preloadOverlayImages, type RenderInputs } from "./render";

export interface RenderSources {
  screen: Blob | null;
  camera: Blob | null;
  mode: RecordingMode;
  durationMs: number;
}

export interface RenderOptions {
  /** Edited-timeline second for the thumbnail. */
  thumbnailAt: number;
  onProgress: (percent: number) => void;
  signal: AbortSignal;
  /** Canvas capture rate; defaults to 30 fps. */
  fps?: number;
  /**
   * The take's cursor track (`t` in SOURCE seconds), for `follow` zooms. It
   * lives in memory only — it is never part of `videos.edits` — so the export
   * has to be handed it explicitly or follow zooms burn in on their stored
   * rects. Omit it for a browser take, which has no track.
   */
  cursor?: CursorSample[];
  /**
   * The take's key track (`t` in SOURCE seconds), for the `keys` overlay's
   * badge. In memory only, exactly like `cursor`: an export that is not handed
   * one burns in the overlay's span with no keycaps on it.
   */
  keys?: KeySample[];
}

export interface RenderResult { blob: Blob; thumbnail: Blob | null; width: number; height: number }

const CODECS = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

/** Camera drift past this many seconds is corrected with a hard seek. */
const RESYNC_S = 0.08;

/** How long a seek, or the playhead, may stall before we give up. */
const STALL_MS = 4000;

/** How long a decoder may take to report metadata before we call it dead. */
const DECODE_TIMEOUT_MS = 15_000;

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function stallError(): Error {
  return new Error("Playback stalled while rendering.");
}

/**
 * Milliseconds between draws for a capture rate, clamped to something a timer
 * can actually honour. `captureStream(fps)` only emits a frame when the canvas
 * is redrawn, so this interval IS the output frame rate.
 */
export function frameIntervalMs(fps: number): number {
  const rate = Number.isFinite(fps) && fps > 0 ? Math.min(120, Math.max(1, fps)) : 30;
  return 1000 / rate;
}

/** Watchdog state: the last playhead we saw, and when we saw it. */
export interface StallWatch {
  time: number;
  at: number;
}

/**
 * Advance the watchdog. Progress is measured on the PLAYHEAD, not on callback
 * delivery: a loop that ticks happily while `currentTime` is frozen is still a
 * stall, and a loop whose callbacks are slow but whose video is advancing is
 * not. Movement in either direction counts — a resync seek is progress.
 */
export function tickStall(prev: StallWatch, time: number, now: number, epsilon = 1e-3): StallWatch {
  return Math.abs(time - prev.time) > epsilon ? { time, at: now } : prev;
}

/** True once the playhead has been frozen for `limitMs`. */
export function isStalled(watch: StallWatch, now: number, limitMs = STALL_MS): boolean {
  return now - watch.at >= limitMs;
}

/**
 * Has the render loop reached the end of the kept range it is playing?
 *
 * Ranges are half-open — `[start, end)`, the same convention `keptRanges` and
 * `zoomAt` use — so the frame AT `end` is already cut material and must not be
 * drawn, let alone encoded.
 */
export function rangeDone(t: number, end: number, ended: boolean): boolean {
  return t >= end || ended;
}

/**
 * Chromium only advances a `<video>`'s frame pipeline for elements the
 * compositor can see. A detached element (or a `display:none` one) falls back
 * to "background rendering" — roughly one frame every 250 ms — and
 * `requestVideoFrameCallback` fires at that same crawl. Parking the decoder in
 * the document at 1×1 with zero opacity keeps it composited without showing
 * anything.
 *
 * This is an optimisation, never a correctness dependency: the draw loops here
 * and in the staging player run off their own clock and force a fresh frame
 * through `drawImage`, so they still produce full-rate output if this element
 * somehow is not composited.
 */
export function mountOffscreen(el: HTMLElement): void {
  el.setAttribute(
    "style",
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1",
  );
  // It is a decoder, not content: keep it out of the accessibility tree and out
  // of the tab order, or a screen reader announces a stray media element and
  // Tab lands on an invisible 1×1 target.
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  document.body?.appendChild(el);
}

/**
 * @param muted load-bearing: the primary element must stay unmuted, because a
 * muted element also silences the `MediaElementAudioSourceNode` we record from.
 * Its output is routed into a `MediaStreamDestination` and never to the
 * speakers, so an unmuted primary is still silent to the user. Secondary
 * (camera) elements are muted — their audio is not part of the render.
 */
function makeVideo(blob: Blob, muted: boolean): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    const url = URL.createObjectURL(blob);
    el.src = url;
    el.muted = muted; el.playsInline = true; el.preload = "auto";
    mountOffscreen(el);
    // A decoder that reports neither metadata nor an error would leave the
    // whole export awaiting this promise forever, so cap the wait. Nothing
    // downstream holds a reference yet — this path owns the cleanup.
    const fail = () => {
      clearTimeout(timer);
      el.onloadedmetadata = null;
      el.onerror = null;
      URL.revokeObjectURL(url);
      el.remove();
      reject(new Error("Could not decode the recording."));
    };
    const timer = setTimeout(fail, DECODE_TIMEOUT_MS);
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      // Past this point the caller owns the element; a late `error` must not
      // revoke its URL out from under a live render. The stall watchdog is
      // what notices a decoder that dies mid-render.
      el.onerror = null;
      resolve(el);
    };
    el.onerror = fail;
  });
}

function seek(el: HTMLVideoElement, t: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    if (Math.abs(el.currentTime - t) < 0.02) return resolve();
    const timer = setTimeout(() => { off(); reject(stallError()); }, STALL_MS);
    const off = () => {
      clearTimeout(timer);
      el.removeEventListener("seeked", onSeeked);
      signal.removeEventListener("abort", onAbort);
    };
    const onSeeked = () => { off(); resolve(); };
    const onAbort = () => { off(); reject(abortError()); };
    el.addEventListener("seeked", onSeeked, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    el.currentTime = t;
  });
}

/**
 * Backgrounds whose `src` we minted ourselves from a saved wallpaper, so
 * `releaseBackground` knows which object URLs are ours to revoke. A `WeakSet`
 * because the element is the only thing that keeps the entry alive.
 */
const mintedBackgrounds = new WeakSet<HTMLElement>();

/** Mint a fresh object URL for a saved wallpaper, or null when the id is gone. */
async function mintWallpaperUrl(wallpaperId: string | undefined): Promise<string | null> {
  if (!wallpaperId) return null;
  const blob = await getWallpaperBlob(wallpaperId).catch(() => null);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function loadBackground(edits: VideoEdits): Promise<HTMLImageElement | HTMLVideoElement | null> {
  const bg = edits.frame?.enabled ? edits.frame.background : undefined;
  if (!bg || (bg.kind !== "image" && bg.kind !== "video")) return null;
  // A stored background carries a `wallpaperId` and a blob: `src` that is dead
  // in any document but the one that minted it. Prefer the src we were given,
  // and fall back to the stored bytes when it is missing or will not decode.
  let src = bg.src ?? null;
  let minted = false;
  if (!src) {
    src = await mintWallpaperUrl(bg.wallpaperId);
    minted = !!src;
  }
  if (!src) return null;

  if (bg.kind === "video") {
    const v = document.createElement("video");
    v.src = src; v.loop = true; v.muted = true; v.playsInline = true; v.crossOrigin = "anonymous";
    if (minted) mintedBackgrounds.add(v);
    mountOffscreen(v);
    await v.play().catch(() => {});
    return v;
  }

  // The URL to revoke if this all comes to nothing — only ever one we minted.
  let mintedUrl = minted ? src : null;
  let img = new Image(); img.crossOrigin = "anonymous"; img.src = src;
  let ok = await img.decode().then(() => true, () => false);
  if (!ok && !minted && bg.wallpaperId) {
    // The src was a blob: URL from a previous session. Re-mint and retry.
    const fresh = await mintWallpaperUrl(bg.wallpaperId);
    if (fresh) {
      img = new Image(); img.crossOrigin = "anonymous"; img.src = fresh;
      mintedUrl = fresh;
      ok = await img.decode().then(() => true, () => false);
    }
  }
  // Nothing beats a broken element: `drawBackground` reads a zero natural size
  // and draws nothing from it on every frame, while the caller goes on
  // believing it has a background — so say so instead, and let it fall back.
  if (!ok) {
    if (mintedUrl) URL.revokeObjectURL(mintedUrl);
    return null;
  }
  if (mintedUrl) mintedBackgrounds.add(img);
  return img;
}

/**
 * Fully release a decoded background: revoke the object URL if we minted it
 * from a saved wallpaper, and tear a video decoder down so it stops holding
 * its source. Images need nothing beyond the revoke — dropping the reference
 * leaves them to the GC.
 */
export function releaseBackground(el: HTMLImageElement | HTMLVideoElement | null): void {
  if (!el) return;
  if (mintedBackgrounds.has(el)) {
    mintedBackgrounds.delete(el);
    // Read `src` before the teardown clears it.
    if (el.src.startsWith("blob:")) URL.revokeObjectURL(el.src);
  }
  if (typeof HTMLVideoElement === "undefined" || !(el instanceof HTMLVideoElement)) return;
  el.pause();
  el.removeAttribute("src");
  el.load();
  // Decoders are parked in the document (see `mountOffscreen`); take them out.
  el.remove();
}

/**
 * Plays the kept ranges once in real time, drawing every frame through
 * `drawFrame` into an offscreen canvas that a MediaRecorder encodes. The
 * recorder is paused between ranges, so cuts are gapless in the output.
 */
export async function renderToBlob(sources: RenderSources, edits: VideoEdits, opts: RenderOptions): Promise<RenderResult> {
  const fps = opts.fps ?? 30;
  const primaryBlob = sources.mode === "camera" ? sources.camera : sources.screen;
  if (!primaryBlob) throw new Error("Nothing to render.");
  const primary = await makeVideo(primaryBlob, false);

  let camera: HTMLVideoElement | null = null;
  let background: HTMLImageElement | HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let audioCtx: AudioContext | null = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    primary.pause(); camera?.pause();
    URL.revokeObjectURL(primary.src); if (camera) URL.revokeObjectURL(camera.src);
    primary.remove(); camera?.remove();
    // Revokes the object URL too, when the background came from a saved
    // wallpaper and `loadBackground` minted one.
    releaseBackground(background);
    stream?.getTracks().forEach((t) => t.stop());
    audioCtx?.close().catch(() => {});
  };

  try {
    if (primary.videoWidth <= 0 || primary.videoHeight <= 0) {
      throw new Error("The recording has no video track we can render.");
    }
    camera = sources.mode === "screen+camera" && sources.camera ? await makeVideo(sources.camera, true) : null;
    background = await loadBackground(edits);
    // Image overlays decode asynchronously; drawFrame is sync and skips images
    // that are not ready, so decode them all before the first frame.
    await preloadOverlayImages(edits);
    const duration = sources.durationMs / 1000;
    const offset = (edits.cameraOffsetMs ?? 0) / 1000;

    const { width, height } = outputSize(primary.videoWidth, primary.videoHeight, edits);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("No 2D context.");

    const inputs: RenderInputs = {
      screen: sources.mode === "camera" ? null : primary,
      camera: sources.mode === "camera" ? primary : camera,
      mode: sources.mode, edits, background,
      // Built once per render: O(n) over the track, then O(log n) a frame.
      cursorAt: opts.cursor?.length ? createCursorSampler(opts.cursor) : undefined,
      keysAt: opts.keys?.length ? createKeySampler(opts.keys) : undefined,
      // The drawn pointer keeps up with the hand; the follow zoom lags it.
      smoothCursorAt: opts.cursor?.length
        ? createCursorSampler(opts.cursor, { tau: CURSOR_TAU_S })
        : undefined,
    };

    stream = canvas.captureStream(fps);
    // Route the primary's audio into the recorded stream only — never to
    // `audioCtx.destination` — so the export is silent to the user.
    audioCtx = new AudioContext();
    await audioCtx.resume().catch(() => {});
    if (audioCtx.state !== "running") throw new Error("Audio could not start; click Upload again.");
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaElementSource(primary).connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream?.addTrack(t));

    const mimeType = CODECS.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 10_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const ranges = keptRanges(edits, duration);
    const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
    if (total <= 0) throw new Error("Everything is cut. Keep at least part of the take.");
    let done = 0;
    let thumbnail: Blob | null = null;
    let thumbRequested = false;
    const thumbSource = editedToSource(edits, duration, opts.thumbnailAt);

    let lastPct = -1;
    const report = (pct: number) => {
      if (pct === lastPct) return;
      lastPct = pct;
      opts.onProgress(pct);
    };

    // Wall-clock time the recorder actually ran, for the WebM duration fix.
    let recordedMs = 0;
    let segmentStart = 0;

    // The draw loop runs off a plain timer at the capture rate.
    //
    // It used to be driven by `requestVideoFrameCallback` on the primary, which
    // looks right — one draw per decoded frame — but is wrong here: these
    // decoders are detached elements, and Chromium only fires rVFC when a frame
    // is PRESENTED for composition. An uncomposited element falls back to
    // background rendering (~4 Hz), so the canvas was only redrawn ~4 times a
    // second and `captureStream(fps)`, which emits a frame only when the canvas
    // changes, wrote a ~4 fps file. `requestAnimationFrame` would fix the rate
    // but stops entirely in a hidden window; a timer keeps going (throttled to
    // 1 Hz at worst) and still produces a correct, if coarse, render.
    const intervalMs = frameIntervalMs(fps);

    recorder.start(250);
    recorder.pause();
    for (const r of ranges) {
      if (opts.signal.aborted) throw abortError();
      await seek(primary, r.start, opts.signal);
      if (camera) await seek(camera, Math.max(0, r.start + offset), opts.signal);
      await primary.play();
      if (camera) await camera.play().catch(() => {});
      // Paint this range's first frame before the recorder wakes up, so the
      // encoder never picks up the previous range's last frame.
      drawFrame(ctx, inputs, r.start, width, height);
      recorder.resume();
      segmentStart = performance.now();
      await new Promise<void>((resolve, reject) => {
        let timer = 0;
        // The watchdog trips on a frozen PLAYHEAD, not on missing callbacks:
        // the timer always fires, so callback delivery says nothing about
        // whether the video is actually making progress.
        let watch: StallWatch = { time: primary.currentTime, at: performance.now() };
        const off = () => {
          if (timer) { clearInterval(timer); timer = 0; }
          primary.removeEventListener("ended", onEnded);
          opts.signal.removeEventListener("abort", onAbort);
        };
        const onEnded = () => { off(); resolve(); };
        const onAbort = () => { off(); reject(abortError()); };
        const tick = () => {
          // A throw anywhere below would otherwise escape into the interval's
          // own task, leaving this promise pending forever with the recorder
          // still running and the UI stuck on "Rendering".
          try {
            if (opts.signal.aborted) return onAbort();
            const t = primary.currentTime;
            const now = performance.now();
            watch = tickStall(watch, t, now);
            if (isStalled(watch, now, STALL_MS)) { off(); return reject(stallError()); }
            // Checked BEFORE the draw: a frame past the range end belongs to
            // the material this cut removes, and the recorder is still live.
            if (rangeDone(t, r.end, primary.ended)) { off(); return resolve(); }
            if (camera && Math.abs(camera.currentTime - (t + offset)) > RESYNC_S) {
              camera.currentTime = Math.max(0, t + offset);
            }
            drawFrame(ctx, inputs, t, width, height);
            if (!thumbRequested && t >= thumbSource) {
              thumbRequested = true;
              canvas.toBlob((b) => { thumbnail = b; }, "image/jpeg", 0.8);
            }
            report(Math.min(99, Math.round(((done + (t - r.start)) / total) * 100)));
          } catch (err) {
            off();
            reject(err);
          }
        };
        primary.addEventListener("ended", onEnded, { once: true });
        opts.signal.addEventListener("abort", onAbort, { once: true });
        timer = window.setInterval(tick, intervalMs);
        tick();
      });
      recorder.pause();
      recordedMs += performance.now() - segmentStart;
      primary.pause(); camera?.pause();
      done += r.end - r.start;
    }
    const stopped = new Promise<void>((resolve) => recorder?.addEventListener("stop", () => resolve(), { once: true }));
    recorder.stop();
    await stopped;

    // Fall back to a still drawn at the thumbnail time if the in-loop capture missed.
    if (!thumbnail) {
      await seek(primary, thumbSource, opts.signal).catch(() => {});
      drawFrame(ctx, inputs, thumbSource, width, height);
      thumbnail = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.8));
    }
    cleanup();

    const type = recorder.mimeType?.split(";")[0] || "video/webm";
    let blob = new Blob(chunks, { type });
    const durationMs = Math.round(recordedMs > 0 ? recordedMs : total * 1000);
    try { blob = await fixWebmDuration(blob, durationMs, { logger: false }); } catch { /* keep raw */ }
    report(100);
    return { blob, thumbnail, width, height };
  } catch (err) {
    if (recorder && recorder.state !== "inactive") { recorder.ondataavailable = null; recorder.stop(); }
    cleanup();
    throw err;
  }
}
