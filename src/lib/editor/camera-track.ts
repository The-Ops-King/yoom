import { MAX_KEYFRAMES } from "@/lib/edits";
import type { CameraKeyframe, CameraMode, CameraTrack, Rect } from "@/lib/edits";
import { easeInOutCubic, lerpRect, SIZE_FRACTION } from "@/lib/recording/geometry";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";

/**
 * Seconds a move/resize/mode change takes to settle. Mirrors BUBBLE_ANIM_MS.
 * The animation window starts AT the keyframe's own `t` (matching the live
 * recorder's tween), not before it: a keyframe records the moment the
 * change was made, and the eased move plays out over the following
 * `CAMERA_ANIM_S` seconds.
 */
export const CAMERA_ANIM_S = 0.3;
const TOLERANCE_S = 1 / 30;

export type CameraSample = {
  mode: CameraMode;
  /** Set while a mode change is still cross-fading in. */
  fromMode?: CameraMode;
  /**
   * 0..1 progress from `fromMode` to `mode`. Only meaningful when `fromMode`
   * is set — a settled sample (including the very first keyframe, before any
   * change has happened) always reports `fade: 1` with no `fromMode`.
   */
  fade: number;
  rect: Rect;
};

function normalizedAspect(screenAspect: number): number {
  return Number.isFinite(screenAspect) && screenAspect > 0 ? screenAspect : 16 / 9;
}

/** Height (normalized to the screen) for a bubble of normalized width `w`. */
export function bubbleHeightFor(shape: BubbleShape, w: number, screenAspect: number, cameraAspect = 16 / 9): number {
  const a = normalizedAspect(screenAspect);
  switch (shape) {
    case "portrait": return (w * a * 16) / 9;
    case "rounded": return (w * a) / cameraAspect;
    case "full": return 1;
    default: return w * a; // circle / square: square in pixels
  }
}

export function defaultCameraTrack(shape: BubbleShape, size: BubbleSize, screenAspect: number, cameraAspect = 16 / 9): CameraTrack {
  if (shape === "full") {
    return { shape: "circle", mirror: true, keyframes: [{ t: 0, mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } }] };
  }
  const a = normalizedAspect(screenAspect);
  const w = SIZE_FRACTION[size];
  const h = Math.min(1, bubbleHeightFor(shape, w, a, cameraAspect));
  const margin = 0.03;
  const rect: Rect = { x: 1 - w - margin, y: 1 - h - margin * a, w, h };
  return { shape, mirror: true, keyframes: [{ t: 0, mode: "bubble", rect }] };
}

/**
 * Advance `from` — the sample actually displayed at `target`'s own `t` (or
 * the settled first keyframe, for the very first segment) — towards
 * `target`, evaluated at `t`.
 *
 * Folding forward one keyframe at a time like this, rather than always
 * lerping from `target`'s raw predecessor rect, is what keeps a re-target
 * that lands before the prior animation has settled from popping to the
 * predecessor's fully-settled position (or restarting its mode cross-fade
 * from scratch).
 */
function advanceTo(from: CameraSample, target: CameraKeyframe, t: number): CameraSample {
  const p = Math.min(1, Math.max(0, (t - target.t) / CAMERA_ANIM_S));
  const e = easeInOutCubic(p);
  const rect: Rect = p >= 1 ? { ...target.rect } : lerpRect(from.rect, target.rect, e);
  if (from.mode === target.mode || p >= 1) {
    return { mode: target.mode, fade: 1, rect };
  }
  // Carry the incoming fade's own progress instead of resetting to 0, so a
  // re-target before the previous cross-fade settled doesn't pop either.
  // `from.fade` is progress *toward* `from.mode`; with only two modes, a
  // carried cross-fade is always a reversal back to `target.mode`, so the
  // carried weight of `target.mode` is `1 - from.fade`, not `from.fade`
  // (stays correct if a third mode is ever added).
  const carried = from.fromMode === target.mode ? 1 - from.fade : 0;
  const fade = carried + (1 - carried) * e;
  return { mode: target.mode, fromMode: from.mode, fade, rect };
}

export function cameraAt(track: CameraTrack, t: number): CameraSample {
  const ks = track.keyframes;
  let i = 0;
  while (i + 1 < ks.length && ks[i + 1].t <= t) i += 1;
  if (i === 0) return { mode: ks[0].mode, fade: 1, rect: { ...ks[0].rect } };

  // Fold forward to the sample actually shown at ks[i].t, then animate that
  // into ks[i] for the query time. Still O(n) total: this loop plus the scan
  // above never touch more than `ks.length` keyframes between them.
  let sample: CameraSample = { mode: ks[0].mode, fade: 1, rect: ks[0].rect };
  for (let j = 1; j < i; j++) sample = advanceTo(sample, ks[j], ks[j + 1].t);
  return advanceTo(sample, ks[i], t);
}

export function upsertKeyframe(track: CameraTrack, t: number, patch: Partial<Omit<CameraKeyframe, "t">>): CameraTrack {
  const time = Math.max(0, t);
  const ks = [...track.keyframes];
  const idx = ks.findIndex((k) => Math.abs(k.t - time) <= TOLERANCE_S);
  if (idx >= 0) {
    ks[idx] = { ...ks[idx], ...patch };
  } else {
    if (ks.length >= MAX_KEYFRAMES) return track;
    let prev = ks[0];
    for (const k of ks) if (k.t <= time) prev = k;
    ks.push({ t: time, mode: prev.mode, rect: prev.rect, ...patch });
    ks.sort((a, b) => a.t - b.t);
  }
  ks[0] = { ...ks[0], t: 0 };
  return { ...track, keyframes: ks };
}

export function removeKeyframe(track: CameraTrack, t: number): CameraTrack {
  const ks = track.keyframes.filter((k, i) => i === 0 || Math.abs(k.t - t) > TOLERANCE_S);
  return { ...track, keyframes: ks };
}
