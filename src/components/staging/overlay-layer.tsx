"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { arrowRect, clampRect, type Overlay, type Point, type Rect, type VideoEdits } from "@/lib/edits";
import * as ops from "@/lib/editor/edit-ops";
import { toOutput, zoomAt } from "@/lib/editor/zoom";
import type { StagingContext } from "./types";
import { fractionOf, toSource, viewBox } from "./view-map";

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

/**
 * Moving or resizing an existing overlay in select mode. `from`/`to` drag one
 * end of an arrow: arrows have no box handles, because their endpoints — not
 * their bounding rect — are what is stored (see the note in `edits.ts`).
 */
type Grab = {
  index: number;
  mode: "move" | "resize" | "from" | "to";
  /** Pointer position at grab, content-normalised view space. */
  ox: number;
  oy: number;
  /** The overlay's source rect at grab — every move re-derives from it. */
  rect: Rect;
  view: Rect;
  from: VideoEdits;
};

/**
 * View-space rect from a band. Free aspect for every tool, zoom included: a
 * zoom rect no longer has to keep the source aspect, because `drawFrame` fits
 * the view inside the content box (letterboxing) rather than stretching it.
 */
/** A point the user drew on the zoomed frame, in source space (the point form of `toSource`). */
function toSourcePoint(p: Point, view: Rect): Point {
  return { x: clamp01(view.x + p.x * view.w), y: clamp01(view.y + p.y * view.h) };
}

/** A stored source point in view space, for positioning a handle (the point form of `toOutput`). */
function toViewPoint(p: Point, view: Rect): Point {
  return { x: (p.x - view.x) / view.w, y: (p.y - view.y) / view.h };
}

/** An arrow's two endpoints, falling back to its rect's diagonal. */
function endpoints(o: Overlay): { from: Point; to: Point } {
  return {
    from: o.from ?? { x: o.rect.x, y: o.rect.y },
    to: o.to ?? { x: o.rect.x + o.rect.w, y: o.rect.y + o.rect.h },
  };
}

function bandRect(b: Band): Rect {
  return {
    x: Math.min(b.ax, b.bx),
    y: Math.min(b.ay, b.by),
    w: Math.abs(b.bx - b.ax),
    h: Math.abs(b.by - b.ay),
  };
}

export function OverlayLayer({ ctx }: { ctx: StagingContext }) {
  const { edits, player, tool, selected } = ctx;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<Measured | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [grab, setGrab] = useState<Grab | null>(null);

  const drawing = tool !== "select";
  const frame = edits.frame;

  /**
   * Cache the geometry for the drag about to start; a layout read per move
   * thrashes. Points are normalised to the *fitted view* box — where the
   * zoomed picture landed — so `toSource` maps them back onto source pixels.
   */
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

  // Rubber band: drag on the layer with a tool armed.
  useEffect(() => {
    if (!band) return;
    const onMove = (e: PointerEvent) => {
      const p = pointAt(e.clientX, e.clientY);
      if (p) setBand((b) => (b ? { ...b, bx: clamp01(p.x), by: clamp01(p.y) } : b));
    };
    const onUp = () => {
      setBand(null);
      // An arrow is a drag from → to, not a band: it is measured by LENGTH, so
      // a perfectly horizontal one is not rejected as a zero-height rect.
      if (tool === "arrow") {
        if (Math.hypot(band.bx - band.ax, band.by - band.ay) < MIN_DRAW) return;
        const from = toSourcePoint({ x: band.ax, y: band.ay }, band.view);
        const to = toSourcePoint({ x: band.bx, y: band.by }, band.view);
        ctx.addOverlayAt("arrow", arrowRect(from, to), { from, to });
        return;
      }
      const r = bandRect(band);
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
      if (grab.mode === "from" || grab.mode === "to") {
        // An endpoint follows the pointer outright; `updateOverlay` re-derives
        // the arrow's bounding rect from the pair.
        const point = toSourcePoint({ x: clamp01(p.x), y: clamp01(p.y) }, grab.view);
        const patch = grab.mode === "from" ? { from: point } : { to: point };
        ctx.applyLive(() => ops.updateOverlay(grab.from, grab.index, patch));
        return;
      }
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
    // Read the live playhead, not the 10 Hz mirror: the zoom on screen is the
    // one the band has to be measured and mapped through.
    const view = zoomAt(edits.zooms, player.timeRef.current);
    if (!drawing || !measure(view)) return;
    const p = pointAt(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    player.pause();
    const x = clamp01(p.x);
    const y = clamp01(p.y);
    setBand({ ax: x, ay: y, bx: x, by: y, view });
  };

  const startGrab = (e: ReactPointerEvent, index: number, mode: Grab["mode"]) => {
    const view = zoomAt(edits.zooms, player.timeRef.current);
    if (!measure(view)) return;
    const p = pointAt(e.clientX, e.clientY);
    const o = edits.overlays[index];
    if (!p || !o) return;
    e.preventDefault();
    e.stopPropagation();
    player.pause();
    ctx.setSelected({ kind: "overlay", index });
    setGrab({ index, mode, ox: p.x, oy: p.y, rect: o.rect, view, from: edits });
  };

  /** A rect normalised to its containing box, as CSS percentages. */
  const pctBox = (r: Rect): CSSProperties => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  });

  const t = player.time;
  const view = zoomAt(edits.zooms, t);

  // The layer element covers the canvas, so the fitted view box as a fraction
  // of the output size is also its fraction of the element.
  const { width: ow, height: oh } = player.size;
  const cf = fractionOf(viewBox(ow, oh, frame, view, ctx.mode === "camera"), ow, oh);

  return (
    <div
      ref={rootRef}
      onPointerDown={startBand}
      className={`absolute inset-0 z-10 touch-none ${drawing ? "cursor-crosshair" : "pointer-events-none"}`}
    >
      {/*
        Everything is positioned inside the fitted view box and clipped to it:
        a zoom can push an overlay's mapped rect off the frame, and it must not
        appear over the frame padding or the letterbox — the same reason
        `render.ts` clips its own overlay pass.
      */}
      <div className="absolute overflow-hidden" style={pctBox(cf)}>
        {band && (
          <div
            className={`absolute border-2 border-dashed ${
              tool === "zoom" ? "border-sky-300 bg-sky-400/15" : "border-emerald-300 bg-emerald-400/15"
            }`}
            style={pctBox(bandRect(band))}
          />
        )}

        {/* An arrow in flight draws as the line it will become, not as a band. */}
        {band && tool === "arrow" && (
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line
              x1={band.ax * 100}
              y1={band.ay * 100}
              x2={band.bx * 100}
              y2={band.by * 100}
              stroke="rgb(110 231 183)"
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}

        {!drawing &&
          edits.overlays.map((o, i) => {
            if (t < o.start || t > o.end) return null;
            const sel = selected?.kind === "overlay" && selected.index === i;
            if (o.type === "arrow") {
              const ends = endpoints(o);
              return (["from", "to"] as const).map((end) => {
                const p = toViewPoint(ends[end], view);
                return (
                  <div
                    key={`ov-${i}-${o.start}-${end}`}
                    role="button"
                    tabIndex={-1}
                    aria-label={`Drag the arrow's ${end === "from" ? "tail" : "head"}`}
                    title={`arrow ${o.start.toFixed(1)}–${o.end.toFixed(1)}s`}
                    onPointerDown={(ev) => startGrab(ev, i, end)}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    className={`pointer-events-auto absolute -ml-1.5 -mt-1.5 h-3 w-3 cursor-move rounded-full border ${
                      sel ? "border-emerald-200 bg-emerald-300" : "border-emerald-200/70 bg-emerald-400/70"
                    }`}
                  />
                );
              });
            }
            return (
              <div
                key={`ov-${i}-${o.start}`}
                title={`${o.type} ${o.start.toFixed(1)}–${o.end.toFixed(1)}s`}
                onPointerDown={(e) => startGrab(e, i, "move")}
                style={pctBox(toOutput(o.rect, view))}
                className={`pointer-events-auto absolute cursor-move border ${
                  sel ? "border-emerald-200 bg-emerald-300/10" : "border-emerald-400/70 border-dashed"
                }`}
              >
                <div
                  role="button"
                  tabIndex={-1}
                  aria-label={`Resize the ${o.type} overlay`}
                  onPointerDown={(e) => startGrab(e, i, "resize")}
                  className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-emerald-200 bg-emerald-400"
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}
