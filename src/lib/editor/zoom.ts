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

/**
 * The rect a zoom actually shows at `t`.
 *
 * For an ordinary zoom that is its stored `rect` (by reference — callers must
 * not mutate it). A `kind: "follow"` zoom takes only the SIZE from its rect and
 * centres that window on the smoothed cursor, clamped so it stays inside the
 * source; with no sampler, or before the cursor track starts, it falls back to
 * the stored rect so a take whose cursor track is missing still plays.
 */
export function effectiveRect(z: Zoom, t: number, cursorAt?: CursorAt): Rect {
  // `kind` is the only spelling read here; `parseEdits` migrates the legacy
  // `follow` flag before a stored zoom ever reaches this.
  if (z.kind !== "follow" || !cursorAt) return z.rect;
  const p = cursorAt(t);
  if (!p) return z.rect;
  const { w, h } = z.rect;
  return {
    x: Math.min(Math.max(p.x - w / 2, 0), Math.max(0, 1 - w)),
    y: Math.min(Math.max(p.y - h / 2, 0), Math.max(0, 1 - h)),
    w,
    h,
  };
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
