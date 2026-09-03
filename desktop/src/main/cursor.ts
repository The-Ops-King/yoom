import { screen } from "electron";
import { IPC, type HudStatus } from "../shared/ipc";
import { captureDisplayId } from "./capture";
import { Clock, normalize, type CursorSample } from "./cursor-track";
import { sendToRecorder } from "./windows";

/**
 * Mouse-follow zoom, desktop half (spec addendum 2026-09-02, "Mouse-follow zoom
 * (desktop only)").
 *
 * While a take is live the shell samples `screen.getCursorScreenPoint()` at
 * 30 Hz, normalizes it against the captured display, and ships batches to the
 * recorder renderer on `IPC.cursor`. The recorder keeps the track in memory and
 * hands it to staging, where a zoom with `follow: true` low-passes it into a
 * moving window centre. Nothing is persisted: the track never lands in
 * `videos.edits`.
 *
 * Only display captures produce a track. A window capture has no fixed
 * rectangle on screen — the window moves, and the captured frame is not a
 * uniformly scaled copy of any display's bounds — so there is nothing sane to
 * normalize against and we sample nothing at all.
 *
 * The pure parts (normalization, the paused-time clock) live in
 * `cursor-track.ts` and are unit-tested; this module is the Electron seam.
 */

/** 30 Hz. Cheap — `getCursorScreenPoint` is a synchronous window-server read. */
const SAMPLE_MS = 33;
/** One IPC hop per ~7-8 samples instead of one per sample. */
const FLUSH_MS = 250;
/**
 * Hard cap on the pending batch. The flush timer keeps it near 8 entries; this
 * only matters if the renderer is gone or the event loop stalls, and it bounds
 * the memory a wedged take can hold.
 */
const MAX_PENDING = 200;

let sampleTimer: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let pending: CursorSample[] = [];
let lastStatus: HudStatus = "idle";
const clock = new Clock();

/** The captured display's bounds, or null if the capture is not a display. */
function capturedBounds(): { x: number; y: number; width: number; height: number } | null {
  const id = captureDisplayId();
  if (id === null) return null;
  // Re-read every sample tick rather than caching: a display can be moved,
  // resized or resolution-switched mid-take, and a stale rectangle would skew
  // every remaining sample.
  const display = screen.getAllDisplays().find((d) => d.id === id);
  return display ? display.bounds : null;
}

function sample(): void {
  const bounds = capturedBounds();
  if (!bounds) return;
  if (clock.isPaused) return;
  const now = Date.now();
  const { x, y } = normalize(screen.getCursorScreenPoint(), bounds);
  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push({ t: Math.round(clock.elapsed(now)), x, y });
}

function flush(): void {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  sendToRecorder(IPC.cursor, batch);
}

function startTimers(): void {
  if (!sampleTimer) sampleTimer = setInterval(sample, SAMPLE_MS);
  if (!flushTimer) flushTimer = setInterval(flush, FLUSH_MS);
}

function stopTimers(): void {
  if (sampleTimer) clearInterval(sampleTimer);
  if (flushTimer) clearInterval(flushTimer);
  sampleTimer = null;
  flushTimer = null;
}

/**
 * Driven by `hud.ts#setHudState`, which is the shell's only view of the
 * recorder's state machine. Called on every 4 Hz push; only transitions do
 * anything.
 *
 * - `countdown` → `recording`: a NEW take. `t` restarts at 0.
 * - `recording` → `paused`: the clock freezes, sampling stops. `t` picks up
 *   exactly where it left off on resume, so the track stays aligned with the
 *   recorded media rather than with wall time.
 * - anything else: the take is over (or was never live). Flush what we have
 *   and reset — the recorder keeps the samples it already received.
 */
export function onRecorderStatus(status: HudStatus): void {
  if (status === lastStatus) return;
  const prev = lastStatus;
  lastStatus = status;

  if (status === "recording") {
    // `countdown → recording` is the only start; `paused → recording` resumes.
    // Any other route into `recording` that finds no running clock (a reload
    // mid-take, say) also starts one, so a take is never silently untracked.
    if (prev === "paused" && clock.isRunning) clock.resume(Date.now());
    else if (!clock.isRunning || prev === "countdown") {
      clock.start(Date.now());
      pending = [];
    }
    // No display capture: no timers, nothing sent, and the page sees no track.
    if (captureDisplayId() !== null) startTimers();
    return;
  }

  if (status === "paused") {
    clock.pause(Date.now());
    flush();
    return;
  }

  stopTimers();
  flush();
  clock.stop();
  pending = [];
}

/** Quit / teardown. Drops the pending batch: there is no renderer to take it. */
export function stopCursorTracking(): void {
  stopTimers();
  clock.stop();
  pending = [];
  lastStatus = "idle";
}
