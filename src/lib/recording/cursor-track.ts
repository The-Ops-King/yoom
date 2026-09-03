/**
 * The in-memory cursor track (mouse-follow zoom).
 *
 * The desktop shell samples `screen.getCursorScreenPoint()` at 30 Hz while a
 * take is live and forwards the samples in batches. The recorder keeps them in
 * a ref — never in `videos.edits`, never in sessionStorage — and hands them to
 * staging when the take ends. Everything here is pure so the hook stays a thin
 * caller.
 */

import type { CursorSample } from "./types";

/**
 * Hard ceiling on how many samples one take may hold: ~33 minutes at 30 Hz,
 * comfortably past `MAX_DURATION_MS`. Beyond it further samples are IGNORED
 * rather than shifting the window — a track that starts at t=0 and stops early
 * degrades gracefully (a following zoom holds its last position), whereas a
 * sliding window would silently renumber the start of the timeline.
 */
export const CURSOR_CAP = 60_000;

/**
 * Append a forwarded batch, never growing past `cap`. Returns a NEW array when
 * anything was added and the same reference when nothing was (already full, or
 * an empty batch), so callers can cheaply skip work.
 */
export function appendSamples(
  track: CursorSample[],
  batch: readonly CursorSample[],
  cap: number = CURSOR_CAP,
): CursorSample[] {
  if (batch.length === 0) return track;
  const room = cap - track.length;
  if (room <= 0) return track;
  return track.concat(batch.length <= room ? batch : batch.slice(0, room));
}

/**
 * Convert `t` from milliseconds (the bridge's unit, matching
 * `HudState.elapsedMs`) to seconds (staging's unit). `x`/`y` pass through
 * untouched — they are already normalized, and they may overshoot ±0.1 on
 * purpose.
 */
export function toSeconds(samples: readonly CursorSample[]): CursorSample[] {
  return samples.map((s) => ({ t: s.t / 1000, x: s.x, y: s.y }));
}
