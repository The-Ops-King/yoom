import { MAX_KEYFRAMES } from "@/lib/edits";
import type { CameraKeyframe, CameraMode, CameraTrack, Point, Rect } from "@/lib/edits";
import { easeInOutCubic, lerpRect, SIZE_FRACTION } from "@/lib/recording/geometry";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";

/**
 * Seconds a move/resize/shape/mode change takes to settle. Mirrors
 * BUBBLE_ANIM_MS.
 *
 * **Settle-by-`t`:** a keyframe means "be in this state *at* `t`", so its eased
 * transition occupies `[t - CAMERA_ANIM_S, t]` and is finished the instant the
 * playhead reaches `t`. The keyframe at `t = 0` has no transition — there is
 * nothing before it to come from.
 *
 * This is what makes the editor WYSIWYG: the user changes the size/shape/
 * position/mode at the playhead, and the preview *at that same playhead*
 * immediately shows the change. (An earlier version started the transition at
 * the keyframe's own `t`, so every edit looked like it had done nothing until
 * you scrubbed forward past the animation window.)
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
  /** The bubble shape in force: the keyframe's own, else the track's. */
  shape: BubbleShape;
  /** Set while a shape change is still morphing; the renderer lerps the radius. */
  fromShape?: BubbleShape;
  /**
   * 0..1 eased progress from `fromShape` to `shape`. Always 1 on a settled
   * sample, so a renderer can use it unconditionally.
   */
  shapeFade: number;
  /**
   * The cover-crop pan in force, in the camera's own source space. Always
   * present — a keyframe with no `pan` reads as the centred `CENTRED_PAN` —
   * so `render.ts` can hand it straight to `coverCrop` unconditionally.
   */
  pan: Point;
};

/** What an absent keyframe `pan` means: the historical centred cover-crop. */
export const CENTRED_PAN: Point = { x: 0.5, y: 0.5 };

const panOf = (k: CameraKeyframe): Point => k.pan ?? CENTRED_PAN;

function lerpPan(a: Point, b: Point, e: number): Point {
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

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
 * The moment `k`'s eased transition begins. The first keyframe has none.
 *
 * Clamped at 0: a keyframe closer to the start than `CAMERA_ANIM_S` gets a
 * *compressed* window rather than a clipped one. Clipping would mean the
 * transition was already partway through at `t = 0` — with keyframes at 0 and
 * 0.1 s the take would open two-thirds of the way into the move and the
 * `t = 0` state would never be shown at all.
 */
const startOf = (k: CameraKeyframe): number => Math.max(0, k.t - CAMERA_ANIM_S);

/** A keyframe as a fully settled sample. */
function settled(k: CameraKeyframe, fallbackShape: BubbleShape): CameraSample {
  return { mode: k.mode, fade: 1, rect: { ...k.rect }, shape: k.shape ?? fallbackShape, shapeFade: 1, pan: { ...panOf(k) } };
}

/**
 * Carry an in-flight cross-fade's own progress forward instead of resetting
 * it to 0, so a re-target that lands before the previous fade settled does
 * not pop. `from.fade` is progress *toward* `from` value; a carried fade is
 * always a reversal back to the target value, so the target's carried weight
 * is `1 - from.fade`.
 */
function carry(reversing: boolean, fade: number, e: number): number {
  const carried = reversing ? 1 - fade : 0;
  return carried + (1 - carried) * e;
}

/**
 * Advance `from` — the sample actually displayed at `startOf(target)` (or the
 * settled first keyframe, for the very first segment) — towards `target`,
 * evaluated at `t`.
 *
 * Folding forward one keyframe at a time like this, rather than always
 * lerping from `target`'s raw predecessor rect, is what keeps a re-target
 * that lands before the prior animation has settled from popping to the
 * predecessor's fully-settled position (or restarting its cross-fades from
 * scratch).
 */
function advanceTo(from: CameraSample, target: CameraKeyframe, t: number, fallbackShape: BubbleShape): CameraSample {
  // The window is `[startOf(target), target.t]`, which is shorter than
  // CAMERA_ANIM_S only for a keyframe within CAMERA_ANIM_S of the start; a
  // zero-length one (two keyframes at t = 0) is instant.
  const span = target.t - startOf(target);
  // `1 + (t - target.t)/span` rather than `(t - startOf(target))/span`: it is
  // exactly 1 at `t === target.t` and exactly 0 at the window's start, where
  // the algebraically identical form loses a bit and leaves p at 0.9999999993
  // — which would make a keyframe never quite settle at its own `t`.
  const p = span > 0 ? Math.min(1, Math.max(0, 1 + (t - target.t) / span)) : 1;
  const e = easeInOutCubic(p);
  const shape = target.shape ?? fallbackShape;
  if (p >= 1) return { mode: target.mode, fade: 1, rect: { ...target.rect }, shape, shapeFade: 1, pan: { ...panOf(target) } };

  const rect: Rect = lerpRect(from.rect, target.rect, e);
  // Pan rides the same eased `e` as the rect, so a keyframe that both moves
  // the bubble and re-frames the face does the two as one motion.
  const pan = lerpPan(from.pan, panOf(target), e);
  const out: CameraSample = { mode: target.mode, fade: 1, rect, shape, shapeFade: 1, pan };
  if (from.mode !== target.mode) {
    out.fromMode = from.mode;
    out.fade = carry(from.fromMode === target.mode, from.fade, e);
  }
  if (from.shape !== shape) {
    out.fromShape = from.shape;
    out.shapeFade = carry(from.fromShape === shape, from.shapeFade, e);
  }
  return out;
}

export function cameraAt(track: CameraTrack, t: number): CameraSample {
  const ks = track.keyframes;
  const fallback = track.shape;
  // The keyframe currently being animated *into* is the last one whose
  // transition has already begun — not the last one the playhead has passed.
  let i = 0;
  while (i + 1 < ks.length && startOf(ks[i + 1]) <= t) i += 1;
  if (i === 0) return settled(ks[0], fallback);

  // Fold forward to the sample actually shown when ks[i]'s transition starts,
  // then animate that into ks[i] for the query time. Still O(n) total: this
  // loop plus the scan above never touch more than `ks.length` keyframes.
  let sample = settled(ks[0], fallback);
  for (let j = 1; j < i; j++) sample = advanceTo(sample, ks[j], startOf(ks[j + 1]), fallback);
  return advanceTo(sample, ks[i], t, fallback);
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
    // Inherit the whole previous keyframe (`shape` included): a new keyframe
    // is "carry on as before, except for `patch`". Falling back to the
    // track's default shape instead would silently morph the bubble.
    ks.push({ ...prev, t: time, ...patch });
    ks.sort((a, b) => a.t - b.t);
  }
  ks[0] = { ...ks[0], t: 0 };
  return { ...track, keyframes: ks };
}

export function removeKeyframe(track: CameraTrack, t: number): CameraTrack {
  const ks = track.keyframes.filter((k, i) => i === 0 || Math.abs(k.t - t) > TOLERANCE_S);
  return { ...track, keyframes: ks };
}
