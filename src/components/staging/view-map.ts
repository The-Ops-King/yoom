import type { Rect } from "@/lib/edits";
import { fitView } from "@/lib/editor/zoom";
import type { FrameConfig } from "@/lib/recording/types";
import { contentRect, type Box } from "./content-rect";

/**
 * Inverse of `toOutput`: a rect the user drew on the zoomed frame, in source
 * space. Shared by every preview layer that turns a gesture into stored edits.
 */
export function toSource(r: Rect, view: Rect): Rect {
  return { x: view.x + r.x * view.w, y: view.y + r.y * view.h, w: r.w * view.w, h: r.h * view.h };
}

/**
 * Where the zoomed picture actually lands inside a layer element that covers
 * the preview canvas: `contentRect`'s box with `view` fitted inside it, exactly
 * as `drawFrame` fits it — a zoom rect may have any aspect, so the picture is
 * letterboxed inside the content box rather than stretched across it.
 *
 * `fitView` only uses the *ratio* of the source dimensions, and the content
 * box's own aspect in element pixels is the source aspect (see
 * `content-rect.ts`), so the box stands in for the source size the renderer
 * passes. Pass `cover` in camera-only mode, where `drawFrame` cover-crops the
 * content box instead of fitting into it.
 */
export function viewBox(
  elW: number,
  elH: number,
  frame: FrameConfig | null | undefined,
  view: Rect,
  cover = false,
): Box {
  const c = contentRect(elW, elH, frame);
  return cover ? c : fitView(view, c.w, c.h, c);
}

/** `box` as a fraction of an `elW`×`elH` element, for CSS percentage positioning. */
export function fractionOf(box: Box, elW: number, elH: number): Rect {
  if (!(elW > 0) || !(elH > 0) || !(box.w > 0) || !(box.h > 0)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: box.x / elW, y: box.y / elH, w: box.w / elW, h: box.h / elH };
}
