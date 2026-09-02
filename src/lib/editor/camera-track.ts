import type { CameraKeyframe, CameraMode, CameraTrack, Rect } from "@/lib/edits";
import { easeInOutCubic, SIZE_FRACTION } from "@/lib/recording/geometry";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";

/** Seconds a move/resize/mode change takes to settle. Mirrors BUBBLE_ANIM_MS. */
export const CAMERA_ANIM_S = 0.3;
const TOLERANCE_S = 1 / 30;

export type CameraSample = {
  mode: CameraMode;
  /** Set while a mode change is still fading; `fade` is 0..1 towards `mode`. */
  fromMode?: CameraMode;
  fade: number;
  rect: Rect;
};

/** Height (normalized to the screen) for a bubble of normalized width `w`. */
export function bubbleHeightFor(shape: BubbleShape, w: number, screenAspect: number, cameraAspect = 16 / 9): number {
  switch (shape) {
    case "portrait": return (w * screenAspect * 16) / 9;
    case "rounded": return (w * screenAspect) / cameraAspect;
    case "full": return 1;
    default: return w * screenAspect; // circle / square: square in pixels
  }
}

export function defaultCameraTrack(shape: BubbleShape, size: BubbleSize, screenAspect: number, cameraAspect = 16 / 9): CameraTrack {
  const w = SIZE_FRACTION[size];
  const h = Math.min(1, bubbleHeightFor(shape, w, screenAspect, cameraAspect));
  const margin = 0.03;
  const rect: Rect = { x: 1 - w - margin, y: 1 - h - margin * screenAspect, w, h };
  return { shape: shape === "full" ? "circle" : shape, mirror: true, keyframes: [{ t: 0, mode: "bubble", rect }] };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
});

export function cameraAt(track: CameraTrack, t: number): CameraSample {
  const ks = track.keyframes;
  let i = 0;
  while (i + 1 < ks.length && ks[i + 1].t <= t) i += 1;
  const cur = ks[i];
  if (i === 0) return { mode: cur.mode, fade: 0, rect: cur.rect };
  const prev = ks[i - 1];
  const p = Math.min(1, Math.max(0, (t - cur.t) / CAMERA_ANIM_S));
  const e = easeInOutCubic(p);
  const rect = p >= 1 ? cur.rect : lerpRect(prev.rect, cur.rect, e);
  if (prev.mode !== cur.mode && p < 1) return { mode: cur.mode, fromMode: prev.mode, fade: e, rect };
  return { mode: cur.mode, fade: 1, rect };
}

export function upsertKeyframe(track: CameraTrack, t: number, patch: Partial<Omit<CameraKeyframe, "t">>): CameraTrack {
  const time = Math.max(0, t);
  const ks = [...track.keyframes];
  const idx = ks.findIndex((k) => Math.abs(k.t - time) <= TOLERANCE_S);
  if (idx >= 0) {
    ks[idx] = { ...ks[idx], ...patch };
  } else {
    let prev = ks[0];
    for (const k of ks) if (k.t <= time) prev = k;
    ks.push({ t: time, mode: prev.mode, rect: prev.rect, ...patch });
    ks.sort((a, b) => a.t - b.t);
  }
  ks[0] = { ...ks[0], t: 0 };
  return { ...track, keyframes: ks.slice(0, 64) };
}

export function removeKeyframe(track: CameraTrack, t: number): CameraTrack {
  const ks = track.keyframes.filter((k, i) => i === 0 || Math.abs(k.t - t) > TOLERANCE_S);
  return { ...track, keyframes: ks };
}
