import fixWebmDuration from "fix-webm-duration";
import type { VideoEdits } from "@/lib/edits";
import type { RecordingMode } from "@/lib/recording/types";
import { editedToSource, keptRanges } from "./cuts";
import { drawFrame, outputSize, type RenderInputs } from "./render";

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
  fps?: number;
}

export interface RenderResult { blob: Blob; thumbnail: Blob | null; width: number; height: number }

const CODECS = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

/** Camera drift past this many seconds is corrected with a hard seek. */
const RESYNC_S = 0.08;

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/** `requestVideoFrameCallback` aligns draws to decoded frames; not everywhere yet. */
type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (cb: () => void) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};

function hasRvfc(el: HTMLVideoElement): el is RvfcVideo {
  return "requestVideoFrameCallback" in el;
}

function makeVideo(blob: Blob, muted: boolean): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    const url = URL.createObjectURL(blob);
    el.src = url;
    el.muted = muted; el.playsInline = true; el.preload = "auto";
    el.onloadedmetadata = () => resolve(el);
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not decode the recording.")); };
  });
}

function seek(el: HTMLVideoElement, t: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    if (Math.abs(el.currentTime - t) < 0.02) return resolve();
    const off = () => {
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

export async function loadBackground(edits: VideoEdits): Promise<HTMLImageElement | HTMLVideoElement | null> {
  const bg = edits.frame?.enabled ? edits.frame.background : undefined;
  if (!bg?.src || (bg.kind !== "image" && bg.kind !== "video")) return null;
  if (bg.kind === "video") {
    const v = document.createElement("video");
    v.src = bg.src; v.loop = true; v.muted = true; v.playsInline = true; v.crossOrigin = "anonymous";
    await v.play().catch(() => {});
    return v;
  }
  const img = new Image(); img.crossOrigin = "anonymous"; img.src = bg.src;
  await img.decode().catch(() => {});
  return img;
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
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    primary.pause(); camera?.pause();
    URL.revokeObjectURL(primary.src); if (camera) URL.revokeObjectURL(camera.src);
    stream?.getTracks().forEach((t) => t.stop());
  };

  try {
    camera = sources.mode === "screen+camera" && sources.camera ? await makeVideo(sources.camera, true) : null;
    const background = await loadBackground(edits);
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
    };

    stream = canvas.captureStream(fps);
    const audioStream = (primary as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    audioStream?.getAudioTracks().forEach((t) => stream?.addTrack(t));
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

    // rVFC fires once per decoded frame; rAF is the fallback.
    const rvfc = hasRvfc(primary) ? primary : null;
    let handle = 0;
    const schedule = (fn: () => void) => {
      handle = rvfc ? rvfc.requestVideoFrameCallback(fn) : requestAnimationFrame(() => fn());
    };
    const unschedule = () => {
      if (!handle) return;
      if (rvfc) rvfc.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      handle = 0;
    };

    recorder.start(250);
    recorder.pause();
    for (const r of ranges) {
      if (opts.signal.aborted) throw abortError();
      await seek(primary, r.start, opts.signal);
      if (camera) await seek(camera, Math.max(0, r.start + offset), opts.signal);
      recorder.resume();
      await primary.play();
      if (camera) await camera.play().catch(() => {});
      await new Promise<void>((resolve, reject) => {
        const off = () => {
          unschedule();
          primary.removeEventListener("ended", onEnded);
          opts.signal.removeEventListener("abort", onAbort);
        };
        const onEnded = () => { off(); resolve(); };
        const onAbort = () => { off(); reject(abortError()); };
        const tick = () => {
          if (opts.signal.aborted) return onAbort();
          const t = primary.currentTime;
          if (camera && Math.abs(camera.currentTime - (t + offset)) > RESYNC_S) {
            camera.currentTime = Math.max(0, t + offset);
          }
          drawFrame(ctx, inputs, t, width, height);
          if (!thumbRequested && t >= thumbSource) {
            thumbRequested = true;
            canvas.toBlob((b) => { thumbnail = b; }, "image/jpeg", 0.8);
          }
          opts.onProgress(Math.min(99, Math.round(((done + (t - r.start)) / total) * 100)));
          if (t >= r.end || primary.ended) { off(); return resolve(); }
          schedule(tick);
        };
        primary.addEventListener("ended", onEnded, { once: true });
        opts.signal.addEventListener("abort", onAbort, { once: true });
        schedule(tick);
      });
      primary.pause(); camera?.pause();
      recorder.pause();
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
    try { blob = await fixWebmDuration(blob, Math.round(total * 1000), { logger: false }); } catch { /* keep raw */ }
    opts.onProgress(100);
    return { blob, thumbnail, width, height };
  } catch (err) {
    if (recorder && recorder.state !== "inactive") { recorder.ondataavailable = null; recorder.stop(); }
    cleanup();
    throw err;
  }
}
