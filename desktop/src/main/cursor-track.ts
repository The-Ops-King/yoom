/**
 * The pure half of the mouse-follow cursor track (spec addendum 2026-09-02,
 * "Mouse-follow zoom (desktop only)"). Everything here is testable without an
 * Electron runtime; `cursor.ts` owns the timers, the `screen` module and the
 * IPC send.
 */

import type { Bounds } from "./mapping";

/**
 * One sampled cursor position on the wire.
 *
 * MUST stay identical to `CursorSample` in `../shared/ipc.ts` and in the web
 * app's `src/lib/recording/types.ts`.
 */
export interface CursorSample {
  /** Milliseconds of RECORDED material since the take started, paused time excluded. */
  t: number;
  /** 0..1 across the captured display, clamped to [-0.1, 1.1]. */
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * How far outside the captured display a sample is allowed to travel before it
 * is pinned. The cursor legitimately leaves the captured display (a second
 * monitor, the menu bar on a display whose bounds start above 0), and a zoom
 * that follows it should keep drifting slightly in that direction rather than
 * sticking hard at the edge — so the wire format keeps a little overshoot and
 * the staging page clamps the rest of the way.
 */
export const CURSOR_OVERSHOOT = 0.1;

function clampNormalized(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1 + CURSOR_OVERSHOOT, Math.max(-CURSOR_OVERSHOOT, value));
}

/**
 * Normalize a cursor point against the captured display's bounds.
 *
 * `screen.getCursorScreenPoint()` returns a **DIP** point ("The return value is
 * a DIP point, not a screen physical point" — electron.d.ts @ 44.1.1) and
 * `Display.bounds` is "the bounds of the display in DIP points", so the
 * display's `scaleFactor` cancels out and must NOT be applied. Same reasoning
 * as `bubbleCentreToNormalized` in `mapping.ts`.
 */
export function normalize(point: Point, bounds: Bounds): { x: number; y: number } {
  const w = bounds.width;
  const h = bounds.height;
  return {
    x: w > 0 ? clampNormalized((point.x - bounds.x) / w) : 0.5,
    y: h > 0 ? clampNormalized((point.y - bounds.y) / h) : 0.5,
  };
}

/**
 * The display id embedded in a `desktopCapturer` screen source id.
 *
 * Screen sources are `screen:<displayId>:0`; window sources are
 * `window:<handle>:<n>` and produce no cursor track at all (a window capture
 * has no fixed rectangle on screen to normalize against). Returns null for
 * anything that is not a screen source or whose id is not a finite number.
 */
export function displayIdFromSourceId(sourceId: string): number | null {
  const match = /^screen:(\d+)/.exec(sourceId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Recorded-media time: wall clock minus every paused interval.
 *
 * The samples have to line up with the recorder's own `elapsedMs`, and
 * `MediaRecorder.pause()` stops the media timeline dead — so `t` freezes while
 * the take is paused. Mirrors `pausedAtRef` / `pausedTotalRef` in the web
 * app's `use-recorder.ts` so the two clocks agree to the millisecond.
 *
 * Every method takes `now` rather than reading a clock, which is what makes it
 * testable.
 */
export class Clock {
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private running = false;

  /** Begin (or restart) the take: `t` goes back to 0. */
  start(now: number): void {
    this.startedAt = now;
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.running = true;
  }

  pause(now: number): void {
    if (!this.running || this.pausedAt) return;
    this.pausedAt = now;
  }

  resume(now: number): void {
    if (!this.running || !this.pausedAt) return;
    this.pausedTotal += now - this.pausedAt;
    this.pausedAt = 0;
  }

  stop(): void {
    this.running = false;
    this.startedAt = 0;
    this.pausedAt = 0;
    this.pausedTotal = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.running && this.pausedAt !== 0;
  }

  /** Milliseconds of recorded material at `now`, never negative. */
  elapsed(now: number): number {
    if (!this.running) return 0;
    const frozen = this.pausedAt ? now - this.pausedAt : 0;
    return Math.max(0, now - this.startedAt - this.pausedTotal - frozen);
  }
}
