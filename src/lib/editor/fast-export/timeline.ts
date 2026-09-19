import { editedDurationIn, editedToSourceIn, type Range } from "../cuts";

/**
 * Output frames needed to cover the kept ranges at `fps`. Floored at 1: an
 * all-cut (empty) timeline still yields a single frame, decoded at source
 * time 0, instead of an empty export.
 */
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

/**
 * Camera-file seconds for the given screen seconds (`cameraTime = screenTime + offset`),
 * clamped at zero. Only non-decreasing, NOT strictly increasing like
 * `sourceTimes` above: when `offsetS` pushes early screen times below zero,
 * they all clamp to 0, producing a flat run of equal timestamps (the
 * decoder holds a frozen first camera frame for that span). Callers must
 * tolerate that plateau.
 */
export function* cameraTimes(screenTimes: Iterable<number>, offsetS: number): Generator<number> {
  for (const t of screenTimes) yield Math.max(0, t + offsetS);
}

/**
 * Output frame index for a thumbnail given in edited seconds. Returns 0
 * when `frames <= 0` — there's no valid index, but this keeps the result a
 * safe, indexable fallback instead of -1. In practice `frames` comes from
 * `frameCount`, which never returns less than 1.
 */
export function thumbnailFrame(thumbnailAt: number, frames: number, fps: number): number {
  if (frames <= 0) return 0;
  return Math.min(frames - 1, Math.max(0, Math.round(thumbnailAt * fps)));
}
