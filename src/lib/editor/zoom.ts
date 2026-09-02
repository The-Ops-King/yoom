import { MAX_ZOOMS, type Rect, type Zoom } from "@/lib/edits";
import { easeInOutCubic, lerpRect } from "@/lib/recording/geometry";

export const FULL_RECT: Rect = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
export const DEFAULT_RAMP_S = 0.4;
/** Zooms (or trimmed remnants) shorter than this are dropped as slivers. */
const MIN_ZOOM_S = 0.05;

/**
 * The normalized source rect on screen at `t`: the whole frame, or an eased
 * zoom. The interval is half-open (`[start, end)`), so with two touching
 * zooms the later one wins at the shared frame. The returned rect is
 * read-only and may be the zoom's own `rect` by reference — callers must not
 * mutate it.
 */
export function zoomAt(zooms: Zoom[], t: number): Rect {
  const z = zooms.find((zz) => t >= zz.start && t < zz.end);
  if (!z) return FULL_RECT;
  const span = z.end - z.start;
  const ramp = Math.min(z.ramp ?? DEFAULT_RAMP_S, span / 3);
  if (ramp <= 0) return z.rect;
  const sinceStart = t - z.start;
  const untilEnd = z.end - t;
  if (sinceStart < ramp) return lerpRect(FULL_RECT, z.rect, easeInOutCubic(sinceStart / ramp));
  if (untilEnd < ramp) return lerpRect(z.rect, FULL_RECT, easeInOutCubic(1 - untilEnd / ramp));
  return z.rect;
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
