import {
  MAX_CAMERA_OFFSET_MS,
  MAX_CUTS,
  MAX_OVERLAYS,
  clampRect,
  type CameraKeyframe,
  type CameraTrack,
  type Cut,
  type Overlay,
  type VideoEdits,
  type Zoom,
} from "@/lib/edits";
import { insertZoom } from "./zoom";
import type { FrameConfig } from "@/lib/recording/types";
import { addCut as mergeCut } from "./cuts";
import { removeKeyframe, upsertKeyframe } from "./camera-track";

/**
 * Smallest a trim/overlay/zoom span may shrink to when an edit would
 * otherwise collapse `end` onto or past `start`.
 */
const MIN_SPAN = 0.1;

/**
 * Set the trim in/out points, clamped into `[0, duration]` and ordered so
 * `end >= start + MIN_SPAN`. A non-positive or non-finite `duration` leaves
 * `e` untouched (same reference) — there is no valid range to clamp into.
 * (Deliberately does not re-clamp `end` against `duration` afterwards: doing
 * so would void the `MIN_SPAN` floor when `start` sits within `MIN_SPAN` of
 * `duration`.)
 */
export function setTrim(e: VideoEdits, duration: number, trim: { start: number; end: number }): VideoEdits {
  if (!(duration > 0)) return e;
  const start = Math.max(0, Math.min(duration, Math.min(trim.start, trim.end)));
  const end = Math.max(start + MIN_SPAN, Math.min(duration, Math.max(trim.start, trim.end)));
  return { ...e, trim: { start, end } };
}

/**
 * Merge `cut` into the cut list via `cuts.ts`'s sorted/disjoint merge,
 * capped at `MAX_CUTS`. A rejected (zero/negative-width) span returns `e`
 * unchanged (same reference). Over the cap, the newly merged cut always
 * survives — the oldest *other* cut(s) are dropped instead, mirroring how
 * `insertZoom` handles its own cap.
 */
export function addCut(e: VideoEdits, cut: Cut): VideoEdits {
  const merged = mergeCut(e.cuts, cut);
  if (merged === e.cuts) return e;
  if (merged.length <= MAX_CUTS) return { ...e, cuts: merged };
  const newCut = merged.find((c) => c.start <= cut.start && c.end >= cut.end) ?? merged[merged.length - 1];
  let excess = merged.length - MAX_CUTS;
  const kept: Cut[] = [];
  for (const c of merged) {
    if (excess > 0 && c !== newCut) {
      excess--;
      continue;
    }
    kept.push(c);
  }
  return { ...e, cuts: kept };
}

/** Remove the cut at `index`. An out-of-range index returns `e` unchanged (same reference). */
export function removeCut(e: VideoEdits, index: number): VideoEdits {
  if (index < 0 || index >= e.cuts.length) return e;
  return { ...e, cuts: e.cuts.filter((_, i) => i !== index) };
}

/**
 * Append an overlay, clamped into range (`start >= 0`, `end > start` by
 * `MIN_SPAN`, `rect` clamped into the 0..1 frame via `clampRect`). A callout
 * with no explicit `n` is numbered `max(existing callout n) + 1` — never a
 * plain count of existing callouts — so removing a middle callout can never
 * leave two overlays sharing a number. Returns `e` unchanged once
 * `MAX_OVERLAYS` is reached.
 */
export function addOverlay(e: VideoEdits, overlay: Overlay): VideoEdits {
  if (e.overlays.length >= MAX_OVERLAYS) return e;
  const next = { ...overlay };
  next.start = Math.max(0, next.start);
  if (next.end <= next.start) next.end = next.start + MIN_SPAN;
  next.rect = clampRect(next.rect);
  if (next.type === "callout" && next.n === undefined) {
    const maxN = e.overlays.reduce((m, o) => (o.type === "callout" && typeof o.n === "number" ? Math.max(m, o.n) : m), 0);
    next.n = maxN + 1;
  }
  return { ...e, overlays: [...e.overlays, next] };
}

/**
 * Patch the overlay at `index`, re-clamping the same way `addOverlay` does
 * (`start >= 0`, `end > start` by `MIN_SPAN`, `rect` clamped into range). An
 * out-of-range index returns `e` unchanged (same reference).
 */
export function updateOverlay(e: VideoEdits, index: number, patch: Partial<Overlay>): VideoEdits {
  if (index < 0 || index >= e.overlays.length) return e;
  return {
    ...e,
    overlays: e.overlays.map((o, i) => {
      if (i !== index) return o;
      const merged = { ...o, ...patch };
      merged.start = Math.max(0, merged.start);
      if (merged.end <= merged.start) merged.end = merged.start + MIN_SPAN;
      merged.rect = clampRect(merged.rect);
      return merged;
    }),
  };
}

/** Remove the overlay at `index`. An out-of-range index returns `e` unchanged (same reference). */
export function removeOverlay(e: VideoEdits, index: number): VideoEdits {
  if (index < 0 || index >= e.overlays.length) return e;
  return { ...e, overlays: e.overlays.filter((_, i) => i !== index) };
}

/** Replace the burned-in frame config. */
export const setFrame = (e: VideoEdits, frame: FrameConfig): VideoEdits => ({ ...e, frame });

/** Replace the camera track wholesale, or clear it with `null`. */
export const setCamera = (e: VideoEdits, camera: CameraTrack | null): VideoEdits => ({ ...e, camera });

/** Upsert a camera keyframe at `t` via `camera-track.ts`. A no-op (returns `e`) when there is no camera track. */
export function upsertCameraKeyframe(e: VideoEdits, t: number, patch: Partial<Omit<CameraKeyframe, "t">>): VideoEdits {
  return e.camera ? { ...e, camera: upsertKeyframe(e.camera, t, patch) } : e;
}

/** Remove the camera keyframe nearest `t` via `camera-track.ts`. A no-op (returns `e`) when there is no camera track. */
export function removeCameraKeyframe(e: VideoEdits, t: number): VideoEdits {
  return e.camera ? { ...e, camera: removeKeyframe(e.camera, t) } : e;
}

/**
 * Set the camera/screen sync offset, clamped to
 * `[-MAX_CAMERA_OFFSET_MS, MAX_CAMERA_OFFSET_MS]` and rounded. Returns `e`
 * unchanged (same reference) when the clamped value equals the current one.
 */
export function setCameraOffset(e: VideoEdits, ms: number): VideoEdits {
  const clamped = Math.max(-MAX_CAMERA_OFFSET_MS, Math.min(MAX_CAMERA_OFFSET_MS, Math.round(ms)));
  if (clamped === (e.cameraOffsetMs ?? 0)) return e;
  return { ...e, cameraOffsetMs: clamped };
}

/**
 * Insert a zoom via `insertZoom`'s disjoint-list logic (which itself keeps
 * the newly inserted zoom over `MAX_ZOOMS`, dropping the oldest others). A
 * rejected (zero/negative-width) span returns `e` unchanged (same
 * reference), detected by comparing `insertZoom`'s result to the input
 * array by reference.
 */
export function addZoom(e: VideoEdits, zoom: Zoom): VideoEdits {
  const zooms = insertZoom(e.zooms, zoom);
  return zooms === e.zooms ? e : { ...e, zooms };
}

/** Remove the zoom at `index`. An out-of-range index returns `e` unchanged (same reference). */
export function removeZoom(e: VideoEdits, index: number): VideoEdits {
  if (index < 0 || index >= e.zooms.length) return e;
  return { ...e, zooms: e.zooms.filter((_, i) => i !== index) };
}

/**
 * Patch the zoom at `index` and re-insert it so it stays disjoint from the
 * rest of the list (any field not in `patch`, including `ramp`, carries
 * over from the current zoom). An out-of-range index returns `e` unchanged
 * (same reference).
 */
export function updateZoom(e: VideoEdits, index: number, patch: Partial<Zoom>): VideoEdits {
  const cur = e.zooms[index];
  if (!cur) return e;
  const next = { ...cur, ...patch };
  if (next.end <= next.start) next.end = next.start + MIN_SPAN;
  return { ...e, zooms: insertZoom(e.zooms.filter((_, i) => i !== index), next) };
}
