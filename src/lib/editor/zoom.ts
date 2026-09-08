import { MAX_ZOOMS, type Rect, type Zoom } from "@/lib/edits";
import { easeInOutCubic, lerpRect } from "@/lib/recording/geometry";

export const FULL_RECT: Rect = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

/**
 * A smoothed cursor position at a source time, or `null` when the take has no
 * cursor sample at or before it. `lib/editor/cursor-path` builds these.
 */
export type CursorAt = (t: number) => { x: number; y: number } | null;

export const DEFAULT_RAMP_S = 0.4;
/** Zooms (or trimmed remnants) shorter than this are dropped as slivers. */
const MIN_ZOOM_S = 0.05;

/**
 * A zoom's effective ramp: its own `ramp` (or the default), never more than a
 * third of its span so the two ends cannot overlap.
 */
function rampOf(z: Zoom): number {
  return Math.max(0, Math.min(z.ramp ?? DEFAULT_RAMP_S, (z.end - z.start) / 3));
}

/** The zoom that ends nearest before `z` starts, if any. Zooms are disjoint. */
function prevOf(zooms: Zoom[], z: Zoom): Zoom | null {
  let best: Zoom | null = null;
  for (const o of zooms) if (o !== z && o.end <= z.start && (!best || o.end > best.end)) best = o;
  return best;
}

/** The zoom that starts nearest after `z` ends, if any. */
function nextOf(zooms: Zoom[], z: Zoom): Zoom | null {
  let best: Zoom | null = null;
  for (const o of zooms) if (o !== z && o.start >= z.end && (!best || o.start < best.start)) best = o;
  return best;
}

/**
 * Two zooms chain when the later one starts within a ramp of the earlier one
 * ending: close enough that easing out to the full frame and straight back in
 * would read as a flinch rather than a move.
 */
function chained(a: Zoom, b: Zoom): boolean {
  const gap = b.start - a.end;
  return gap >= 0 && gap <= Math.max(rampOf(a), rampOf(b));
}

/** A window centred on `p` (clamped so it stays inside the source). */
function centeredWindow(p: { x: number; y: number }, w: number, h: number): Rect {
  return {
    x: Math.min(Math.max(p.x - w / 2, 0), Math.max(0, 1 - w)),
    y: Math.min(Math.max(p.y - h / 2, 0), Math.max(0, 1 - h)),
    w,
    h,
  };
}

/**
 * A single crossing of the deadzone boundary: the window eases from `from` to
 * `to` (both windows of the same size) starting at `triggerT`, over
 * `FOLLOW_EASE_S`. A hold — the window not moving yet, or having settled — is
 * just a move with `from === to` (by reference; `moveRectAt` checks that).
 */
interface FollowMove {
  triggerT: number;
  from: Rect;
  to: Rect;
}

/** A follow zoom's precomputed window-position track; see `buildFollowTrack`. */
interface FollowTrack {
  moves: FollowMove[];
}

/**
 * The deadzone's size as a fraction of the follow window, applied on both
 * axes and centred on the window. 65%: the cursor can range fairly freely
 * near the middle of the shot without the window reacting — killing the
 * "circling" nausea the user described — while still leaving a 17.5%-of-window
 * margin on every side, which is what the eased move below has to close
 * before the cursor would otherwise reach the edge of frame. Bigger and the
 * cursor would reach the window's edge before the deadzone is even crossed;
 * smaller and this degenerates back into the old continuous tracking.
 */
const DEADZONE_FRACTION = 0.65;

/**
 * How long the window takes to ease to its new position once the cursor
 * crosses the deadzone. Long enough to read as a deliberate reframe rather
 * than a snap; short enough that the subject doesn't wander back out of frame
 * while the window catches up.
 */
const FOLLOW_EASE_S = 0.35;

/**
 * The resolution, in seconds, at which a deadzone crossing is detected while
 * building a follow zoom's track (see `buildFollowTrack`). Far finer than the
 * cursor's own 250 ms smoothing time constant, so it adds no visible
 * discretization of its own — sampling between the grid points below is done
 * with the exact eased formula, not a linear interpolation of the grid.
 */
const FOLLOW_STEP_S = 1 / 60;

/** The window rect a `FollowMove` shows at `t` (`t >= move.triggerT`). */
function moveRectAt(move: FollowMove, t: number): Rect {
  if (move.from === move.to) return move.to;
  const e = easeInOutCubic((t - move.triggerT) / FOLLOW_EASE_S);
  return lerpRect(move.from, move.to, e);
}

/**
 * Walk a follow zoom's cursor track once, forward, from `z.start` to `z.end`,
 * applying the deadzone rule: the window holds its position while the cursor
 * stays within the inner `DEADZONE_FRACTION` box, and eases to a new position
 * — offset by exactly enough to bring the cursor back to the deadzone's edge,
 * never further — the instant the cursor steps outside it. A move already in
 * progress when the cursor crosses again is interrupted from wherever it
 * currently sits, so the track never has a discontinuity.
 *
 * This mirrors `cursor-path.ts`'s own track: built once from a fixed starting
 * point regardless of which `t` a caller asks for or in what order, then
 * sampled by binary search in `evalFollow`. That determinism is what makes
 * scrubbing and export agree — see the note on `effectiveRect` below.
 *
 * Only ever called for `t` inside the zoom's own `[start, end)` — the
 * pre-roll/gap blending in `zoomAt`/`gapEase` uses the stateless
 * `centeredWindow` formula instead (see `effectiveRect`), so this never has
 * to answer for `t` outside that span.
 */
function buildFollowTrack(z: Zoom, cursorAt: CursorAt): FollowTrack {
  const { w, h } = z.rect;
  const maxX = Math.max(0, 1 - w);
  const maxY = Math.max(0, 1 - h);
  const dzHalfW = (DEADZONE_FRACTION * w) / 2;
  const dzHalfH = (DEADZONE_FRACTION * h) / 2;

  const moves: FollowMove[] = [];
  let active: FollowMove | null = null;

  const span = z.end - z.start;
  const steps = Math.max(1, Math.ceil(span / FOLLOW_STEP_S));

  for (let i = 0; i <= steps; i++) {
    const t = i < steps ? z.start + i * FOLLOW_STEP_S : z.end;
    const p = cursorAt(t);
    if (!p) continue; // No cursor data yet at this instant.

    if (!active) {
      // The cursor track begins mid-zoom (or exactly at its start): the
      // window snaps to it, exactly as the old stateless formula did — there
      // is nothing before this instant to ease from.
      const start = centeredWindow(p, w, h);
      active = { triggerT: t, from: start, to: start };
      moves.push(active);
      continue;
    }

    // The deadzone is checked against the window's committed REST position
    // (`active.to`), not wherever it happens to be mid-ease. Checking the
    // live, still-interpolating position instead would make the cursor chase
    // a moving target — each grid step's "exceed" would be computed against
    // a `cur` that had already closed part of the gap, so the target itself
    // would keep retreating and the window would creep toward the cursor far
    // more slowly than `FOLLOW_EASE_S` intends (and, near a clamped edge,
    // never actually settle). Checking against the rest position instead
    // means: once a move is triggered, nothing retriggers it — the ease just
    // runs to completion — unless the cursor genuinely moves again.
    const ref = active.to;
    const dx = p.x - (ref.x + w / 2);
    const dy = p.y - (ref.y + h / 2);
    const exceedX = Math.abs(dx) > dzHalfW ? dx - Math.sign(dx) * dzHalfW : 0;
    const exceedY = Math.abs(dy) > dzHalfH ? dy - Math.sign(dy) * dzHalfH : 0;
    if (exceedX === 0 && exceedY === 0) continue; // Inside the deadzone: hold.

    const target: Rect = {
      x: Math.min(Math.max(ref.x + exceedX, 0), maxX),
      y: Math.min(Math.max(ref.y + exceedY, 0), maxY),
      w,
      h,
    };
    if (target.x === active.to.x && target.y === active.to.y) continue; // Clamped to the same edge again: nothing new to do.

    // Ease from wherever the window visually is right now (which may itself
    // be mid-ease) so an interruption is seamless, never a pop.
    active = { triggerT: t, from: moveRectAt(active, t), to: target };
    moves.push(active);
  }

  return { moves };
}

/** Sample a built follow track at `t`, or `null` before it has any data. */
function evalFollow(track: FollowTrack, t: number): Rect | null {
  const { moves } = track;
  if (moves.length === 0 || t < moves[0].triggerT) return null;
  let lo = 0;
  let hi = moves.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (moves[mid].triggerT <= t) lo = mid;
    else hi = mid - 1;
  }
  return moveRectAt(moves[lo], t);
}

/**
 * One follow track per (cursor sampler, zoom) pair, content-keyed on the
 * zoom's timing and window size — the only fields `buildFollowTrack` reads —
 * so a zoom object recreated with the same content still hits the cache.
 * Keyed weakly on the sampler itself for the same reason `cursor-path.ts`
 * keys its track on the samples array: the caller holds the only reference,
 * and the tracks die with it.
 */
const followCache = new WeakMap<CursorAt, Map<string, FollowTrack>>();

function followKey(z: Zoom): string {
  const r = z.rect;
  return `${z.start}|${z.end}|${r.x}|${r.y}|${r.w}|${r.h}`;
}

function followTrackFor(z: Zoom, cursorAt: CursorAt): FollowTrack {
  let byKey = followCache.get(cursorAt);
  if (!byKey) {
    byKey = new Map();
    followCache.set(cursorAt, byKey);
  }
  const key = followKey(z);
  const hit = byKey.get(key);
  if (hit) return hit;
  const built = buildFollowTrack(z, cursorAt);
  byKey.set(key, built);
  return built;
}

/**
 * The rect a zoom actually shows at `t`.
 *
 * For an ordinary zoom that is its stored `rect` (by reference — callers must
 * not mutate it). A `kind: "follow"` zoom takes only the SIZE from its rect;
 * while `t` is inside the zoom's own `[start, end)` span the window HOLDS
 * that size centred wherever it last settled, moving only once the smoothed
 * cursor steps outside an inner deadzone (`buildFollowTrack`/`evalFollow`) —
 * for `t` outside that span (the pre-roll/gap blending `zoomAt` and
 * `gapEase` do towards a neighbouring zoom) there is no "the zoom" yet to
 * hold still, so it falls back to the plain formula: the window centred on
 * the cursor at that instant. Either way, with no sampler, or before the
 * cursor track starts, it falls back to the stored rect so a take whose
 * cursor track is missing still plays.
 */
export function effectiveRect(z: Zoom, t: number, cursorAt?: CursorAt): Rect {
  // `kind` is the only spelling read here; `parseEdits` migrates the legacy
  // `follow` flag before a stored zoom ever reaches this.
  if (z.kind !== "follow" || !cursorAt) return z.rect;

  if (t >= z.start && t < z.end) {
    const held = evalFollow(followTrackFor(z, cursorAt), t);
    return held ?? z.rect;
  }

  const p = cursorAt(t);
  if (!p) return z.rect;
  return centeredWindow(p, z.rect.w, z.rect.h);
}

/**
 * The rect-to-rect ease between two chained zooms, for a `t` in the gap
 * between them. Touching zooms (`gap === 0`) have no gap to ease across, so
 * their window straddles the shared frame instead — see `zoomAt`.
 */
function gapEase(a: Zoom, b: Zoom, t: number, cursorAt?: CursorAt): Rect {
  const e = easeInOutCubic((t - a.end) / (b.start - a.end));
  return lerpRect(effectiveRect(a, t, cursorAt), effectiveRect(b, t, cursorAt), e);
}

/**
 * The normalized source rect on screen at `t`: the whole frame, or an eased
 * zoom. The interval is half-open (`[start, end)`), so with two touching
 * zooms the later one wins at the shared frame. The returned rect is
 * read-only and may be the zoom's own `rect` by reference — callers must not
 * mutate it.
 *
 * Adjacent zooms chain: rather than ease out to the full frame and back in,
 * the pair eases straight from one rect to the other. Touching zooms ease
 * across `[A.end - r, A.end + r]` with `r = min(rampA, rampB)` (so the shared
 * frame is exactly the midpoint rect); zooms with a gap ease across the whole
 * gap, `[A.end, B.start]`. Either way no full-frame sample happens in between.
 *
 * `cursorAt` (optional) is the take's smoothed cursor sampler: every rect
 * below is a zoom's EFFECTIVE rect, so a follow zoom's window rides the
 * cursor and the ramps and chains ease between the windows as they stand at
 * `t`. Without it, follow zooms behave exactly like ordinary ones.
 */
export function zoomAt(zooms: Zoom[], t: number, cursorAt?: CursorAt): Rect {
  const z = zooms.find((zz) => t >= zz.start && t < zz.end);
  if (!z) {
    // Not inside a zoom: the only non-full-frame answer is a chained gap.
    let a: Zoom | null = null;
    let b: Zoom | null = null;
    for (const o of zooms) {
      if (o.end <= t && (!a || o.end > a.end)) a = o;
      if (o.start > t && (!b || o.start < b.start)) b = o;
    }
    return a && b && b.start > a.end && chained(a, b) ? gapEase(a, b, t, cursorAt) : FULL_RECT;
  }
  const rect = effectiveRect(z, t, cursorAt);
  const ramp = rampOf(z);
  if (ramp <= 0) return rect;
  const sinceStart = t - z.start;
  const untilEnd = z.end - t;

  if (sinceStart < ramp) {
    const prev = prevOf(zooms, z);
    if (prev && chained(prev, z)) {
      // A gap's transition already finished at `z.start`; a touching pair's
      // runs on for `r` past it, having started `r` before.
      const r = prev.end === z.start ? Math.min(rampOf(prev), ramp) : 0;
      if (sinceStart >= r) return rect;
      return lerpRect(effectiveRect(prev, t, cursorAt), rect, easeInOutCubic(0.5 + sinceStart / (2 * r)));
    }
    return lerpRect(FULL_RECT, rect, easeInOutCubic(sinceStart / ramp));
  }

  if (untilEnd < ramp) {
    const next = nextOf(zooms, z);
    if (next && chained(z, next)) {
      const r = next.start === z.end ? Math.min(ramp, rampOf(next)) : 0;
      if (untilEnd > r) return rect;
      return lerpRect(rect, effectiveRect(next, t, cursorAt), easeInOutCubic(0.5 - untilEnd / (2 * r)));
    }
    return lerpRect(rect, FULL_RECT, easeInOutCubic(1 - untilEnd / ramp));
  }
  return rect;
}

/**
 * Fit the visible source region `view` (of a `srcW`×`srcH` source) inside the
 * `content` box, preserving the view's pixel aspect — a zoom rect may have any
 * aspect, and squeezing it into the content box would stretch the picture. The
 * returned rect is centred in `content`; whatever is left over is letterbox
 * (frame background when framed, black otherwise).
 *
 * Only the *ratio* of `srcW` to `srcH` matters, so a caller working in element
 * pixels can pass the content box's own width and height.
 */
export function fitView(view: Rect, srcW: number, srcH: number, content: Rect): Rect {
  const vw = view.w * srcW;
  const vh = view.h * srcH;
  if (!(vw > 0) || !(vh > 0) || !(content.w > 0) || !(content.h > 0)) return content;
  const scale = Math.min(content.w / vw, content.h / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: content.x + (content.w - w) / 2, y: content.y + (content.h - h) / 2, w, h };
}

/**
 * Insert a zoom, trimming or dropping any it overlaps so the list stays
 * disjoint and sorted. If that would leave more than `MAX_ZOOMS` entries, the
 * newly inserted zoom always survives — the oldest *other* zoom(s) (lowest
 * `start`) are dropped instead, never the tail.
 */
export function insertZoom(zooms: Zoom[], zoom: Zoom): Zoom[] {
  if (!(zoom.end > zoom.start)) return zooms;
  const out: Zoom[] = [];
  for (const z of zooms) {
    if (z.end <= zoom.start || z.start >= zoom.end) { out.push(z); continue; }
    if (z.start < zoom.start) out.push({ ...z, end: zoom.start });
    if (z.end > zoom.end) out.push({ ...z, start: zoom.end });
  }
  out.push(zoom);

  const sorted = out.filter((z) => z.end - z.start > MIN_ZOOM_S).sort((a, b) => a.start - b.start);
  if (sorted.length <= MAX_ZOOMS) return sorted;

  let excess = sorted.length - MAX_ZOOMS;
  const kept: Zoom[] = [];
  for (const z of sorted) {
    if (excess > 0 && z !== zoom) {
      excess--;
      continue;
    }
    kept.push(z);
  }
  return kept;
}

/**
 * Map a source-normalized rect into view-normalized space for the current
 * zoom `view`. Requires `view.w > 0` and `view.h > 0`, which `parseEdits`
 * guarantees for every stored zoom/crop rect.
 */
export function toOutput(rect: Rect, view: Rect): Rect {
  return { x: (rect.x - view.x) / view.w, y: (rect.y - view.y) / view.h, w: rect.w / view.w, h: rect.h / view.h };
}
