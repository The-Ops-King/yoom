/**
 * Container choice for everything MediaRecorder produces.
 *
 * MP4 leads both lists. A MediaRecorder WebM carries no duration in its
 * header and no seek index, so a take that is cut short — a crashed tab, a
 * killed process — lands on Drive as bytes the `<video>` element refuses to
 * decode, and the viewer gets a bare "error". MP4 from MediaRecorder is
 * fragmented, so a truncated one still plays up to the last complete
 * fragment, and it is the container Safari and iOS want anyway.
 *
 * The WebM entries stay as fallbacks: Firefox has no MP4 MediaRecorder, and
 * a WebM recording beats no recording.
 */

/** Live capture candidates, most preferred first. */
export const CAPTURE_CODECS = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

/**
 * Candidates for the legacy real-time exporter, which re-encodes a canvas and
 * a mixed audio track. This is the list that decides what actually reaches
 * Drive whenever the WebCodecs fast path bows out — `fast-export` already
 * writes fragmented MP4 on its own.
 */
export const EXPORT_CODECS = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

/**
 * First candidate this browser can actually encode, or `""` when none of them
 * work — callers pass that to MediaRecorder by omitting `mimeType` entirely
 * and letting the browser pick.
 */
export function pickMimeType(candidates: readonly string[]): string {
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
}
