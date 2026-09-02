import type { Rect, Zoom } from "@/lib/edits";
import { easeInOutCubic } from "@/lib/recording/geometry";

export const FULL_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 };
export const DEFAULT_RAMP_S = 0.4;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
});

/** The normalized source rect on screen at `t`: the whole frame, or an eased zoom. */
export function zoomAt(zooms: Zoom[], t: number): Rect {
  const z = zooms.find((zz) => t >= zz.start && t <= zz.end);
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

/** Insert a zoom, trimming or dropping any it overlaps so the list stays disjoint and sorted. */
export function insertZoom(zooms: Zoom[], zoom: Zoom): Zoom[] {
  if (!(zoom.end > zoom.start)) return zooms;
  const out: Zoom[] = [];
  for (const z of zooms) {
    if (z.end <= zoom.start || z.start >= zoom.end) { out.push(z); continue; }
    if (z.start < zoom.start) out.push({ ...z, end: zoom.start });
    if (z.end > zoom.end) out.push({ ...z, start: zoom.end });
  }
  out.push(zoom);
  return out.filter((z) => z.end - z.start > 0.05).sort((a, b) => a.start - b.start).slice(0, 32);
}

/** Map a source-normalized rect into view-normalized space for the current zoom `view`. */
export function toOutput(rect: Rect, view: Rect): Rect {
  return { x: (rect.x - view.x) / view.w, y: (rect.y - view.y) / view.h, w: rect.w / view.w, h: rect.h / view.h };
}
