import type { CursorSample } from "@/lib/recording/types";

/** A smoothed cursor position, normalized to the captured display and clamped to the frame. */
export interface CursorPoint {
  x: number;
  y: number;
}

/**
 * Time constant of the low-pass filter, in seconds. The raw 30 Hz track is far
 * too jittery to point a camera at: at ~250 ms the window follows a deliberate
 * move within a beat and ignores a twitch.
 */
export const DEFAULT_TAU_S = 0.25;

/**
 * The time constant the SYNTHETIC CURSOR is drawn with. Much shorter than the
 * follow zoom's: a zoom window wants a lazy centre that ignores twitches, but a
 * drawn pointer that lags the user's hand by a quarter second reads as broken.
 * 0.12 s still sands off the 30 Hz sampling's stair-stepping.
 */
export const CURSOR_TAU_S = 0.12;

/** How a sampler is filtered: bare seconds, or `{ tau }`. */
export type SamplerOptions = number | { tau?: number };

function tauOf(opts: SamplerOptions | undefined): number {
  if (typeof opts === "number") return opts;
  return opts?.tau ?? DEFAULT_TAU_S;
}

/** Samples arrive clamped to [-0.1, 1.1]; the window centre must stay in frame. */
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The smoothed track: one filtered position per sample, so any `t` is one
 * binary search plus one exponential away.
 *
 * The filter is a first-order low-pass over a zero-order hold of the samples —
 * between `samples[i]` and `samples[i+1]` the input IS `samples[i]`, so
 *
 *     s(t) = x_i + (s_i - x_i) · e^(-(t - t_i)/tau)
 *
 * which is the exact continuous solution rather than a fixed-step
 * approximation. That matters because the shell's 30 Hz sampling arrives in
 * batches and drops frames under load: uneven `dt` must not change the shape
 * of the response.
 */
interface Track {
  tau: number;
  t: Float64Array;
  /** Raw sample positions (the held input over each interval). */
  x: Float64Array;
  y: Float64Array;
  /** Filtered positions AT each sample time. */
  sx: Float64Array;
  sy: Float64Array;
}

/**
 * One track per samples array PER TAU, so a component that re-renders 60 times
 * a second does not refilter the take on every frame — and so the follow
 * zoom's lazy filter and the synthetic cursor's quick one, which read the same
 * array with different constants, do not evict each other. Keyed weakly:
 * staging holds the only reference to the array, and the tracks die with it.
 */
const cache = new WeakMap<CursorSample[], Map<number, Track>>();

function build(samples: CursorSample[], tau: number): Track {
  const n = samples.length;
  const track: Track = {
    tau,
    t: new Float64Array(n),
    x: new Float64Array(n),
    y: new Float64Array(n),
    sx: new Float64Array(n),
    sy: new Float64Array(n),
  };
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    track.t[i] = s.t;
    track.x[i] = s.x;
    track.y[i] = s.y;
    if (i === 0) {
      // The filter starts settled on the first sample: a take that opens with
      // the cursor mid-screen must not swing in from the origin.
      track.sx[i] = s.x;
      track.sy[i] = s.y;
      px = s.x;
      py = s.y;
      continue;
    }
    const dt = Math.max(0, s.t - samples[i - 1].t);
    const k = tau > 0 ? Math.exp(-dt / tau) : 0;
    // The input held across this interval is the PREVIOUS sample's position.
    track.sx[i] = px + (track.sx[i - 1] - px) * k;
    track.sy[i] = py + (track.sy[i - 1] - py) * k;
    px = s.x;
    py = s.y;
  }
  return track;
}

function trackFor(samples: CursorSample[], tau: number): Track {
  let byTau = cache.get(samples);
  if (!byTau) {
    byTau = new Map<number, Track>();
    cache.set(samples, byTau);
  }
  const hit = byTau.get(tau);
  if (hit) return hit;
  const built = build(samples, tau);
  byTau.set(tau, built);
  return built;
}

/** The last index whose sample time is `<= t`, or -1 when `t` precedes the track. */
function indexAt(t: Float64Array, at: number): number {
  if (t.length === 0 || at < t[0]) return -1;
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function evaluate(track: Track, at: number): CursorPoint | null {
  const i = indexAt(track.t, at);
  if (i < 0) return null;
  const dt = Math.max(0, at - track.t[i]);
  const k = track.tau > 0 ? Math.exp(-dt / track.tau) : 0;
  return {
    x: clamp01(track.x[i] + (track.sx[i] - track.x[i]) * k),
    y: clamp01(track.y[i] + (track.sy[i] - track.y[i]) * k),
  };
}

/**
 * The low-pass-filtered cursor position at `t` (seconds, on the source
 * timeline), or `null` when the track has no sample at or before `t` — before
 * the first sample there is nothing to follow and the zoom keeps its own rect.
 *
 * O(log n) after the first call for a given samples array (the filtered track
 * is memoized on the array itself); O(n) on that first call.
 */
export function smoothCursor(samples: CursorSample[], t: number, tau = DEFAULT_TAU_S): CursorPoint | null {
  if (samples.length === 0) return null;
  return evaluate(trackFor(samples, tau), t);
}

/**
 * A sampler bound to one cursor track: `O(n)` to build, `O(log n)` per call.
 * Prefer this on any hot path (the draw loop calls it once per frame per
 * follow zoom) — it is exactly `smoothCursor` with the track resolved up front.
 */
export function createCursorSampler(
  samples: CursorSample[],
  opts?: SamplerOptions,
): (t: number) => CursorPoint | null {
  if (samples.length === 0) return () => null;
  const track = trackFor(samples, tauOf(opts));
  return (t: number) => evaluate(track, t);
}
