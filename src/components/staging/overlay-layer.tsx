"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { clampRect, type Rect, type VideoEdits } from "@/lib/edits";
import * as ops from "@/lib/editor/edit-ops";
import { toOutput, zoomAt } from "@/lib/editor/zoom";
import { contentRect } from "./content-rect";
import type { StagingContext } from "./types";

/** A band smaller than this in either axis is a click, not a draw. */
const MIN_DRAW = 0.005;
/** Smallest normalised side a resize may collapse an overlay to. */
const MIN_SIDE = 0.01;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The content box in client coordinates, measured once per drag. */
type Measured = { left: number; top: number; x: number; y: number; w: number; h: number };

/**
 * A rubber band with a tool armed. Its points are normalised to the content
 * box in **view** space — what the user is looking at — and `view` is the
 * zoom that was on screen when the drag began, so the release can map back
 * into source space even if playback moved on.
 */
type Band = { ax: number; ay: number; bx: number; by: number; view: Rect };

/** Moving or resizing an existing overlay in select mode. */
type Grab = {
  index: number;
  mode: "move" | "resize";
  /** Pointer position at grab, content-normalised view space. */
  ox: number;
  oy: number;
  /** The overlay's source rect at grab — every move re-derives from it. */
  rect: Rect;
  view: Rect;
  from: VideoEdits;
};

/**
 * View-space rect from a band. A zoom's rect must keep the source aspect or
 * the zoomed frame is stretched, and in frame-normalised units that means
 * equal width and height — so `h` is derived from `w` rather than tracked.
 */
function bandRect(b: Band, square: boolean): Rect {
  const x = Math.min(b.ax, b.bx);
  if (!square) {
    return { x, y: Math.min(b.ay, b.by), w: Math.abs(b.bx - b.ax), h: Math.abs(b.by - b.ay) };
  }
  // Both points are already inside the frame, so the width is safe — but the
  // derived height can run off the edge the drag is heading for. Shrink the
  // square rather than let `clampRect` squash one axis and stretch the zoom.
  const down = b.by >= b.ay;
  const w = Math.min(Math.abs(b.bx - b.ax), down ? 1 - b.ay : b.ay);
  return { x, y: down ? b.ay : b.ay - w, w, h: w };
}

/** Inverse of `toOutput`: a rect the user drew on the zoomed frame, in source space. */
function toSource(r: Rect, view: Rect): Rect {
  return { x: view.x + r.x * view.w, y: view.y + r.y * view.h, w: r.w * view.w, h: r.h * view.h };
}

export function OverlayLayer({ ctx }: { ctx: StagingContext }) {
  const { edits, player, tool, selected } = ctx;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<Measured | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [grab, setGrab] = useState<Grab | null>(null);

  const drawing = tool !== "select";
  const frame = edits.frame;

  /** Cache the geometry for the drag about to start; a layout read per move thrashes. */
  const measure = useCallback(() => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return (boxRef.current = null);
    const c = contentRect(r.width, r.height, frame);
    boxRef.current = c.w > 0 && c.h > 0 ? { left: r.left, top: r.top, ...c } : null;
    return boxRef.current;
  }, [frame]);

  const pointAt = useCallback((clientX: number, clientY: number) => {
    const b = boxRef.current;
    if (!b) return null;
    return { x: (clientX - b.left - b.x) / b.w, y: (clientY - b.top - b.y) / b.h };
  }, []);

  // Rubber band: drag on the layer with a tool armed.
  useEffect(() => {
    if (!band) return;
    const onMove = (e: PointerEvent) => {
      const p = pointAt(e.clientX, e.clientY);
      if (p) setBand((b) => (b ? { ...b, bx: clamp01(p.x), by: clamp01(p.y) } : b));
    };
    const onUp = () => {
      setBand(null);
      const r = bandRect(band, tool === "zoom");
      if (r.w < MIN_DRAW || r.h < MIN_DRAW) return;
      // Drawn on the zoomed frame, stored against source pixels, so it stays
      // on what the user pointed at once the zoom ramps out.
      const rect = clampRect(toSource(r, band.view));
      if (tool === "zoom") ctx.addZoomAt(rect);
      else if (tool !== "select") ctx.addOverlayAt(tool, rect);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [band, ctx, pointAt, tool]);

  // Move / resize an existing overlay in select mode.
  useEffect(() => {
    if (!grab) return;
    const onMove = (e: PointerEvent) => {
      const p = pointAt(e.clientX, e.clientY);
      if (!p) return;
      // View-space movement is source-space movement scaled by the zoom.
      const dx = (p.x - grab.ox) * grab.view.w;
      const dy = (p.y - grab.oy) * grab.view.h;
      const r = grab.rect;
      const rect: Rect =
        grab.mode === "move"
          ? { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }
          : { x: r.x, y: r.y, w: Math.max(MIN_SIDE, r.w + dx), h: Math.max(MIN_SIDE, r.h + dy) };
      ctx.applyLive(() => ops.updateOverlay(grab.from, grab.index, { rect }));
    };
    const onUp = () => {
      ctx.commit(grab.from);
      setGrab(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [ctx, grab, pointAt]);

  const startBand = (e: ReactPointerEvent) => {
    if (!drawing || !measure()) return;
    const p = pointAt(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    player.pause();
    const x = clamp01(p.x);
    const y = clamp01(p.y);
    // Read the live playhead, not the 10 Hz mirror: the zoom on screen is the
    // one the band has to be mapped through.
    setBand({ ax: x, ay: y, bx: x, by: y, view: zoomAt(edits.zooms, player.timeRef.current) });
  };

  const startGrab = (e: ReactPointerEvent, index: number, mode: "move" | "resize") => {
    if (!measure()) return;
    const p = pointAt(e.clientX, e.clientY);
    const o = edits.overlays[index];
    if (!p || !o) return;
    e.preventDefault();
    e.stopPropagation();
    player.pause();
    ctx.setSelected({ kind: "overlay", index });
    setGrab({
      index,
      mode,
      ox: p.x,
      oy: p.y,
      rect: o.rect,
      view: zoomAt(edits.zooms, player.timeRef.current),
      from: edits,
    });
  };

  // The layer element covers the canvas, so the content box as a fraction of
  // the output size is also its fraction of the element.
  const { width: ow, height: oh } = player.size;
  const c = contentRect(ow, oh, frame);
  const cf =
    ow > 0 && oh > 0 && c.w > 0 && c.h > 0
      ? { x: c.x / ow, y: c.y / oh, w: c.w / ow, h: c.h / oh }
      : { x: 0, y: 0, w: 1, h: 1 };

  /** `r` is normalised to the content box in view space. */
  const styleFor = (r: Rect): CSSProperties => ({
    left: `${(cf.x + r.x * cf.w) * 100}%`,
    top: `${(cf.y + r.y * cf.h) * 100}%`,
    width: `${r.w * cf.w * 100}%`,
    height: `${r.h * cf.h * 100}%`,
  });

  const t = player.time;
  const view = zoomAt(edits.zooms, t);

  return (
    <div
      ref={rootRef}
      onPointerDown={startBand}
      className={`absolute inset-0 z-10 touch-none ${drawing ? "cursor-crosshair" : "pointer-events-none"}`}
    >
      {band && (
        <div
          className={`absolute border-2 border-dashed ${
            tool === "zoom" ? "border-sky-300 bg-sky-400/15" : "border-emerald-300 bg-emerald-400/15"
          }`}
          style={styleFor(bandRect(band, tool === "zoom"))}
        />
      )}

      {!drawing &&
        edits.overlays.map((o, i) => {
          if (t < o.start || t > o.end) return null;
          const sel = selected?.kind === "overlay" && selected.index === i;
          return (
            <div
              key={`ov-${i}-${o.start}`}
              title={`${o.type} ${o.start.toFixed(1)}–${o.end.toFixed(1)}s`}
              onPointerDown={(e) => startGrab(e, i, "move")}
              style={styleFor(toOutput(o.rect, view))}
              className={`pointer-events-auto absolute cursor-move border ${
                sel ? "border-emerald-200 bg-emerald-300/10" : "border-emerald-400/70 border-dashed"
              }`}
            >
              <div
                aria-hidden
                onPointerDown={(e) => startGrab(e, i, "resize")}
                className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-emerald-200 bg-emerald-400"
              />
            </div>
          );
        })}
    </div>
  );
}
