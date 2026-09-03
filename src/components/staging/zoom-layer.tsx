"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Rect, VideoEdits } from "@/lib/edits";
import * as ops from "@/lib/editor/edit-ops";
import { effectiveRect, toOutput, zoomAt } from "@/lib/editor/zoom";
import type { StagingContext } from "./types";
import { fractionOf, viewBox } from "./view-map";

/** Smallest side a zoom may be dragged down to, as a fraction of the source. */
const MIN_SIDE = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The fitted view box in client coordinates, measured once per drag. */
type Measured = { left: number; top: number; x: number; y: number; w: number; h: number };

type Drag = {
  mode: "move" | "resize";
  /** Index into `from.zooms`; every move re-derives from the pre-drag edits. */
  index: number;
  /** The zoom's `start`, which a drag never changes — used to re-find it after the commit. */
  start: number;
  /** Pointer position at grab, normalised to the fitted view box. */
  ox: number;
  oy: number;
  /** The zoom's source rect at grab. */
  rect: Rect;
  /** The zoom on screen when the drag began, so view-space deltas scale right. */
  view: Rect;
  from: VideoEdits;
};

/**
 * Direct manipulation of the selected zoom's rect on the preview: drag the box
 * to move it, the corner handle to resize it (free aspect — `drawFrame`
 * letterboxes whatever aspect it ends up with).
 *
 * The box is drawn *whenever a zoom is selected*, not only while the playhead
 * is inside its span, so a zoom stays editable when paused outside it; it is
 * dashed in that case to say "this is not what you are looking at right now".
 *
 * The layer is inert (`pointer-events: none`) unless a zoom is selected and
 * the select tool is armed, so it never steals a drawing gesture from the
 * overlay layer beneath it or a bubble drag from the camera layer above it.
 */
export function ZoomLayer({ ctx }: { ctx: StagingContext }) {
  const { edits, player, tool, selected, cursorAt } = ctx;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<Measured | null>(null);
  /** The edits the last live apply produced, so the commit can re-find the zoom. */
  const liveRef = useRef<VideoEdits | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const frame = edits.frame;
  const index = selected?.kind === "zoom" ? selected.index : -1;
  const zoom = index >= 0 ? edits.zooms[index] : undefined;
  const active = tool === "select" && zoom !== undefined;

  const measure = useCallback(
    (view: Rect) => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r || r.width <= 0 || r.height <= 0) return (boxRef.current = null);
      const c = viewBox(r.width, r.height, frame, view, ctx.mode === "camera");
      boxRef.current = c.w > 0 && c.h > 0 ? { left: r.left, top: r.top, ...c } : null;
      return boxRef.current;
    },
    [ctx.mode, frame],
  );

  const pointAt = useCallback((clientX: number, clientY: number) => {
    const b = boxRef.current;
    if (!b) return null;
    return { x: (clientX - b.left - b.x) / b.w, y: (clientY - b.top - b.y) / b.h };
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const p = pointAt(e.clientX, e.clientY);
      if (!p) return;
      // View-space movement is source-space movement scaled by the zoom.
      const dx = (p.x - drag.ox) * drag.view.w;
      const dy = (p.y - drag.oy) * drag.view.h;
      const r = drag.rect;
      const rect: Rect =
        drag.mode === "move"
          ? { x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h), w: r.w, h: r.h }
          : {
              x: r.x,
              y: r.y,
              w: clamp(r.w + dx, MIN_SIDE, 1 - r.x),
              h: clamp(r.h + dy, MIN_SIDE, 1 - r.y),
            };
      const next = ops.updateZoom(drag.from, drag.index, { rect });
      liveRef.current = next;
      ctx.applyLive(() => next);
    };
    const onUp = () => {
      ctx.commit(drag.from);
      // `updateZoom` re-inserts through `insertZoom`, which re-sorts and may
      // trim neighbours, so the selected index can move. Re-find the dragged
      // zoom by its (unchanged, and unique across a disjoint list) `start`.
      const at = liveRef.current?.zooms.findIndex((z) => z.start === drag.start) ?? -1;
      if (liveRef.current) ctx.setSelected(at >= 0 ? { kind: "zoom", index: at } : null);
      liveRef.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [ctx, drag, pointAt]);

  const startDrag = (e: ReactPointerEvent, mode: "move" | "resize") => {
    if (!zoom) return;
    // The live playhead, not the 10 Hz mirror: the zoom on screen is the one
    // the gesture is measured through.
    const view = zoomAt(edits.zooms, player.timeRef.current, cursorAt);
    if (!measure(view)) return;
    const p = pointAt(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    player.pause();
    liveRef.current = null;
    // The rect the gesture starts from is the one on screen: for a follow
    // zoom that is the cursor-centred window, not its (ignored) stored origin.
    // A RESIZE is the exception — it writes the rect back, and a follow zoom's
    // stored origin is what it falls back to the moment "Follow mouse" is
    // unticked, so sizing off the cursor-centred box would teleport it to
    // wherever the pointer happened to be.
    const follows = zoom.follow === true && cursorAt !== undefined;
    const rect =
      mode === "resize" && follows ? zoom.rect : effectiveRect(zoom, player.timeRef.current, cursorAt);
    setDrag({ mode, index, start: zoom.start, ox: p.x, oy: p.y, rect, view, from: edits });
  };

  const t = player.time;
  const view = zoomAt(edits.zooms, t, cursorAt);
  const { width: ow, height: oh } = player.size;
  const cf = fractionOf(viewBox(ow, oh, frame, view, ctx.mode === "camera"), ow, oh);

  const pctBox = (r: Rect): CSSProperties => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  });

  if (!active || !zoom) return null;

  // Solid while the playhead is inside the zoom's span (what you see is what
  // you are editing), dashed outside it.
  const inSpan = t >= zoom.start && t < zoom.end;
  // A follow zoom has no position of its own to drag — only a size. The box
  // still shows where the window actually is this frame.
  const following = zoom.follow === true && cursorAt !== undefined;
  const box = effectiveRect(zoom, t, cursorAt);

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-[15] touch-none">
      <div className="absolute overflow-hidden" style={pctBox(cf)}>
        <div
          role="button"
          tabIndex={-1}
          aria-label={following ? "The selected zoom follows the mouse" : "Move the selected zoom"}
          title={
            following
              ? `Zoom ${zoom.start.toFixed(1)}–${zoom.end.toFixed(1)}s — follows the mouse; drag the corner to resize`
              : `Zoom ${zoom.start.toFixed(1)}–${zoom.end.toFixed(1)}s — drag to move, corner to resize`
          }
          onPointerDown={(e) => {
            if (!following) startDrag(e, "move");
          }}
          style={pctBox(toOutput(box, view))}
          className={`pointer-events-auto absolute border-2 bg-sky-400/10 ${following ? "cursor-default" : "cursor-move"} ${
            inSpan ? "border-sky-300" : "border-dashed border-sky-300/70"
          }`}
        >
          <div
            role="button"
            tabIndex={-1}
            aria-label="Resize the selected zoom"
            onPointerDown={(e) => startDrag(e, "resize")}
            // Inside the box rather than straddling its corner: a zoom held at
            // full view maps to the whole box, and an outset handle would be
            // clipped away by the wrapper exactly when it is needed.
            className="pointer-events-auto absolute bottom-0 right-0 h-3.5 w-3.5 cursor-se-resize rounded-sm border border-sky-200 bg-sky-400"
          />
        </div>
      </div>
    </div>
  );
}
