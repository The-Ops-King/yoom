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
