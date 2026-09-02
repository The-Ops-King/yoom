"use client";

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoEdits } from "@/lib/edits";
import type { RecordingMode } from "@/lib/recording/types";
import {
  editedDurationIn,
  editedToSourceIn,
  keptRanges,
  sourceToEditedIn,
  type Range,
} from "./cuts";
import { loadBackground, mountOffscreen } from "./export";
import { drawFrame, outputSize, type RenderInputs } from "./render";

/**
 * Should the draw loop repaint this animation frame?
 *
 * Note what is NOT an input: whether `requestVideoFrameCallback` is available.
 * The loop used to skip the draw while playing whenever rVFC existed, on the
 * theory that rVFC would set `dirty` once per decoded frame. It does not for
 * these decoders: they are detached `<video>` elements, and Chromium only fires
 * rVFC when a frame is presented for composition, so an uncomposited element
 * falls back to background rendering at ~4 Hz. The preview redrew four times a
 * second, and zoom ramps — a function of TIME, not of new video pixels, so they
 * need a repaint even on a frozen frame — did not animate.
 */
export function shouldDraw(playing: boolean, dirty: boolean): boolean {
  return dirty || playing;
}

/** One frame at the export frame rate — the unit `step()` moves by. */
const FRAME_S = 1 / 30;
/** How far the playhead must move before the `time` state is pushed — 10 Hz, not 60. */
const TIME_PUSH_S = 0.1;
/** Camera drift we tolerate before hard-seeking it back onto the primary. */
const CAMERA_DRIFT_S = 0.08;

export interface StagingPlayer {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /**
   * Source time in seconds, throttled to ~10 Hz (exact on seek and pause).
   * Use it for text labels; a scrubber should draw from `timeRef` instead.
   */
  time: number;
  /**
   * Live source time in seconds, updated every animation frame without a
   * re-render — read it from a scrubber's own rAF loop.
   */
  timeRef: RefObject<number>;
  editedTime: number;
  editedDuration: number;
  playing: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Seek to a SOURCE time. */
  seek(t: number): void;
  /** Seek to an EDITED time. */
  seekEdited(t: number): void;
  step(frames: number): void;
  /** The output size for the current edits (for the preview's aspect box). */
  size: { width: number; height: number };
}

export interface StagingPlayerOptions {
  /** Mute the primary element. The preview plays its audio by default. */
  muted?: boolean;
}

type Size = { width: number; height: number };

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height;
}

/**
 * Fully release a video decoder so the blob URL it holds can be revoked.
 * Images need nothing — dropping the reference leaves them to the GC.
 */
function release(el: HTMLImageElement | HTMLVideoElement | null): void {
  if (!el || typeof HTMLVideoElement === "undefined" || !(el instanceof HTMLVideoElement)) return;
  el.pause();
  el.removeAttribute("src");
  el.load();
  // Decoders are parked in the document (see `mountOffscreen`); take them out.
  el.remove();
}

/** Identity of the frame background, so it is only decoded when it actually changes. */
function backgroundKey(edits: VideoEdits): string | null {
  const bg = edits.frame?.enabled ? edits.frame.background : undefined;
  if (!bg?.src || (bg.kind !== "image" && bg.kind !== "video")) return null;
  return `${bg.kind}:${bg.src}`;
}

export function useStagingPlayer(
  screenUrl: string | null,
  cameraUrl: string | null,
  mode: RecordingMode,
  durationMs: number,
  edits: VideoEdits,
  options?: StagingPlayerOptions,
): StagingPlayer {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const primaryRef = useRef<HTMLVideoElement | null>(null);
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const bgRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const bgKeyRef = useRef<string | null>(null);
  /** Set whenever something the canvas shows has changed; cleared once drawn. */
  const dirtyRef = useRef(true);
  /** Canvas size at the last draw, so a resize forces a redraw while paused. */
  const drawnSizeRef = useRef({ w: 0, h: 0 });
  /** Live playhead, written every frame; `time` is its throttled mirror. */
  const timeRef = useRef(0);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [size, setSize] = useState<Size>({ width: 16, height: 9 });

  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;
  const ranges = useMemo(() => keptRanges(edits, duration), [edits, duration]);

  const editsRef = useRef(edits);
  const rangesRef = useRef<Range[]>(ranges);
  const muted = options?.muted ?? false;
  const mutedRef = useRef(muted);

  /** Push the exact playhead — for seek, pause, and end of playback. */
  const pushTime = useCallback((t: number) => {
    timeRef.current = t;
    setTime(t);
  }, []);

  // Hand the current edits to the animation loop, and make it redraw for them.
  useEffect(() => {
    editsRef.current = edits;
    rangesRef.current = ranges;
    dirtyRef.current = true;
  }, [edits, ranges]);

  // Hidden decoders. One primary (screen, or camera in camera-only mode) plus,
  // in screen+camera, a muted camera element kept in sync by the draw loop.
  useEffect(() => {
    const src = mode === "camera" ? cameraUrl : screenUrl;
    const primary = document.createElement("video");
    primary.playsInline = true;
    primary.preload = "auto";
    // Read from the ref so a rebuild (source or mode change) keeps the option.
    primary.muted = mutedRef.current;
    if (src) primary.src = src;
    mountOffscreen(primary);
    primaryRef.current = primary;

    let camera: HTMLVideoElement | null = null;
    if (mode === "screen+camera" && cameraUrl) {
      camera = document.createElement("video");
      camera.src = cameraUrl;
      camera.muted = true;
      camera.playsInline = true;
      camera.preload = "auto";
      mountOffscreen(camera);
    }
    cameraRef.current = camera;

    const onMeta = () => {
      const next = outputSize(primary.videoWidth, primary.videoHeight, editsRef.current);
      setSize((prev) => (sameSize(prev, next) ? prev : next));
      dirtyRef.current = true;
    };
    const onEnded = () => setPlaying(false);
    const onPause = () => {
      setPlaying(false);
      pushTime(primary.currentTime);
    };
    const onPlaying = () => setPlaying(true);
    // A completed seek is new pixels even where `requestVideoFrameCallback` is
    // missing, and a camera-only seek (offset nudged while paused) too.
    const onSeeked = () => {
      dirtyRef.current = true;
    };
    primary.addEventListener("loadedmetadata", onMeta);
    primary.addEventListener("ended", onEnded);
    primary.addEventListener("pause", onPause);
    primary.addEventListener("playing", onPlaying);
    primary.addEventListener("seeked", onSeeked);
    camera?.addEventListener("seeked", onSeeked);

    // An EXTRA dirty source, never the only one: rVFC fires when a frame is
    // presented for composition, which is a useful nudge while paused (a seek
    // landing, a decoder catching up) but is not a reliable clock — see
    // `shouldDraw`. The loop redraws every rAF while playing regardless.
    let vfc = 0;
    const supportsVfc = typeof primary.requestVideoFrameCallback === "function";
    if (supportsVfc) {
      const onFrame = () => {
        dirtyRef.current = true;
        vfc = primary.requestVideoFrameCallback(onFrame);
      };
      vfc = primary.requestVideoFrameCallback(onFrame);
    }

    return () => {
      primary.removeEventListener("loadedmetadata", onMeta);
      primary.removeEventListener("ended", onEnded);
      primary.removeEventListener("pause", onPause);
      primary.removeEventListener("playing", onPlaying);
      primary.removeEventListener("seeked", onSeeked);
      camera?.removeEventListener("seeked", onSeeked);
      if (vfc && supportsVfc) primary.cancelVideoFrameCallback(vfc);
      release(primary);
      release(camera);
      primaryRef.current = null;
      cameraRef.current = null;
      setPlaying(false);
    };
  }, [screenUrl, cameraUrl, mode, pushTime]);

  // Audio follows the option without rebuilding the decoders.
  useEffect(() => {
    mutedRef.current = muted;
    const p = primaryRef.current;
    if (p) p.muted = muted;
  }, [muted]);

  // Output size and frame background follow the edits. The background is only
  // re-decoded when its descriptor changes, not on every drag of a bubble.
  useEffect(() => {
    const p = primaryRef.current;
    if (p && p.videoWidth > 0) {
      const next = outputSize(p.videoWidth, p.videoHeight, edits);
      setSize((prev) => (sameSize(prev, next) ? prev : next));
    }
    const key = backgroundKey(edits);
    if (key === bgKeyRef.current) return;
    bgKeyRef.current = key;
    if (!key) {
      release(bgRef.current);
      bgRef.current = null;
      dirtyRef.current = true;
      return;
    }
    let alive = true;
    void loadBackground(edits).then((bg) => {
      if (!alive) {
        release(bg);
        return;
      }
      release(bgRef.current);
      bgRef.current = bg;
      dirtyRef.current = true;
    });
    return () => {
      alive = false;
    };
  }, [edits]);

  // Release the background on unmount (its own effect, so an edits change does
  // not tear down a background it is about to reuse).
  useEffect(() => {
    return () => {
      release(bgRef.current);
      bgRef.current = null;
      bgKeyRef.current = null;
    };
  }, []);

  // Draw loop. Always scheduled so paused frames re-render when edits change;
  // the actual `drawFrame` is skipped when nothing has changed.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = primaryRef.current;
      if (!p) return;
      const e = editsRef.current;
      const kept = rangesRef.current;
      let t = p.currentTime;

      // Skip removed ranges while playing.
      if (!p.paused) {
        const inside = kept.some((r) => t >= r.start && t < r.end);
        if (!inside) {
          const next = kept.find((r) => r.start > t);
          if (next) {
            p.currentTime = next.start;
            t = next.start;
            dirtyRef.current = true;
          } else {
            p.pause();
            setPlaying(false);
            pushTime(t);
          }
        }
      }

      const cam = cameraRef.current;
      if (cam) {
        // Clamp into the camera's own range: past its end the seek would never
        // land, and the loop would re-seek on every frame.
        const camEnd = Number.isFinite(cam.duration) ? cam.duration : Infinity;
        const target = Math.min(camEnd, Math.max(0, t + (e.cameraOffsetMs ?? 0) / 1000));
        if (Math.abs(cam.currentTime - target) > CAMERA_DRIFT_S) cam.currentTime = target;
        if (!p.paused && cam.paused) void cam.play().catch(() => {});
        else if (p.paused && !cam.paused) cam.pause();
      }

      const canvas = canvasRef.current;
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        const drawn = drawnSizeRef.current;
        if (canvas.width !== drawn.w || canvas.height !== drawn.h) {
          drawnSizeRef.current = { w: canvas.width, h: canvas.height };
          dirtyRef.current = true;
        }
        // While playing, every rAF is a draw: zoom ramps and the camera bubble
        // move with TIME, not with new decoded pixels.
        if (shouldDraw(!p.paused, dirtyRef.current)) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const inputs: RenderInputs = {
              screen: mode === "camera" ? null : p,
              camera: mode === "camera" ? p : cam,
              mode,
              edits: e,
              background: bgRef.current,
            };
            drawFrame(ctx, inputs, t, canvas.width, canvas.height);
            dirtyRef.current = false;
          }
        }
      }

      // The ref is the live playhead; the state is a 10 Hz mirror of it, so a
      // 60 Hz preview does not re-render the whole staging tree every frame.
      timeRef.current = t;
      setTime((prev) => (Math.abs(prev - t) >= TIME_PUSH_S ? t : prev));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, pushTime]);

  const seek = useCallback(
    (t: number) => {
      const p = primaryRef.current;
      if (!p) return;
      const max = duration > 0 ? duration : Number.isFinite(p.duration) ? p.duration : Infinity;
      const next = Math.max(0, Math.min(max, t));
      p.currentTime = next;
      dirtyRef.current = true;
      pushTime(next);
    },
    [duration, pushTime],
  );

  const seekEdited = useCallback(
    (t: number) => seek(editedToSourceIn(rangesRef.current, t)),
    [seek],
  );

  const play = useCallback(() => {
    const p = primaryRef.current;
    if (!p) return;
    const kept = rangesRef.current;
    if (kept.length > 0 && !kept.some((r) => p.currentTime >= r.start && p.currentTime < r.end)) {
      // Off a kept range (inside a cut, or past the end): jump to the next one,
      // wrapping to the start when there is none.
      const next = kept.find((r) => r.start > p.currentTime) ?? kept[0];
      p.currentTime = next.start;
      pushTime(next.start);
    }
    dirtyRef.current = true;
    // Autoplay policy can reject; stay paused rather than lying about it.
    void p
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, [pushTime]);

  const pause = useCallback(() => {
    const p = primaryRef.current;
    p?.pause();
    cameraRef.current?.pause();
    setPlaying(false);
    if (p) pushTime(p.currentTime);
  }, [pushTime]);

  const toggle = useCallback(() => {
    const p = primaryRef.current;
    if (!p || p.paused) play();
    else pause();
  }, [play, pause]);

  const step = useCallback(
    (frames: number) => {
      pause();
      seek((primaryRef.current?.currentTime ?? 0) + frames * FRAME_S);
    },
    [pause, seek],
  );

  return {
    canvasRef,
    time,
    timeRef,
    playing,
    play,
    pause,
    toggle,
    seek,
    seekEdited,
    step,
    size,
    editedTime: sourceToEditedIn(ranges, time),
    editedDuration: editedDurationIn(ranges),
  };
}
