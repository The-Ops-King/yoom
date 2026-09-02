"use client";

import { useEffect, useRef, useState } from "react";
import type { Rect, VideoEdits } from "@/lib/edits";
import { bubbleHeightFor, cameraAt } from "@/lib/editor/camera-track";
import * as ops from "@/lib/editor/edit-ops";
import { shapeRadius } from "@/lib/recording/geometry";
import type { BubbleShape } from "@/lib/recording/types";
import { contentRect, type Box } from "./content-rect";
import type { StagingContext } from "./types";

/** Smallest the bubble may be dragged to, as a fraction of the content width. */
const MIN_W = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Drag = {
  kind: "move" | "resize";
  /** Playhead when the gesture started; the keyframe the drag writes. */
  t: number;
  /** Pre-drag edits: every move re-derives from these, so a drag never accumulates. */
  from: VideoEdits;
  startX: number;
  startY: number;
  /** The displayed rect at `t`, normalized to the content box. */
  rect: Rect;
  /** The content box in client coordinates, so pointer math needs no re-measure. */
  content: Box;
  shape: BubbleShape;
};

/**
 * The camera bubble's direct-manipulation layer: a dashed box over the preview
 * canvas that writes a camera keyframe at the playhead when dragged or
 * resized. Transparent and `pointer-events: none` everywhere except the box
 * itself, so the overlay layer stacked above it still gets every other click.
 *
 * The box is positioned from a rAF loop reading `player.timeRef` rather than
 * from React state: playback must not re-render the whole staging tree at
 * 60 Hz (the timeline's playhead does the same).
 */
export function CameraLayer({ ctx }: { ctx: StagingContext }) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  /**
   * The rect being dragged right now. The rAF prefers it over `cameraAt`
   * because a keyframe's eased move starts AT its own `t`: sampling at the
   * drag's own time would report the *previous* rect and the box would not
   * follow the pointer.
   */
  const liveRectRef = useRef<Rect | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const track = ctx.mode === "screen+camera" ? ctx.edits.camera ?? null : null;
  const frame = ctx.edits.frame;
  const { timeRef } = ctx.player;

  useEffect(() => {
    const layer = layerRef.current;
    const box = boxRef.current;
    const badge = badgeRef.current;
    if (!layer || !box || !badge || !track) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = layer.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const c = contentRect(r.width, r.height, frame);
      const sample = cameraAt(track, timeRef.current);
      const live = liveRectRef.current;
      const full = sample.mode === "full" && !live;
      badge.style.display = full ? "block" : "none";
      box.style.display = full ? "none" : "block";
      if (full) {
        badge.style.left = `${c.x + 8}px`;
        badge.style.top = `${c.y + 8}px`;
        return;
      }
      const rect = live ?? sample.rect;
      const w = rect.w * c.w;
      const h = rect.h * c.h;
      box.style.left = `${c.x + rect.x * c.w}px`;
      box.style.top = `${c.y + rect.y * c.h}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      box.style.borderRadius = `${shapeRadius(track.shape, w, h)}px`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [track, frame, timeRef]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const c = drag.content;
      const base = drag.rect;
      let rect: Rect;
      if (drag.kind === "move") {
        rect = {
          ...base,
          x: clamp(base.x + (e.clientX - drag.startX) / c.w, 0, Math.max(0, 1 - base.w)),
          y: clamp(base.y + (e.clientY - drag.startY) / c.h, 0, Math.max(0, 1 - base.h)),
        };
      } else {
        const aspect = c.h > 0 ? c.w / c.h : 16 / 9;
        let w = clamp((e.clientX - c.x) / c.w - base.x, MIN_W, Math.max(MIN_W, 1 - base.x));
        let h = bubbleHeightFor(drag.shape, w, aspect);
        const hMax = Math.max(0, 1 - base.y);
        // `bubbleHeightFor` is linear in `w` for every bubble shape, so the
        // width that just fits `hMax` is this simple ratio.
        if (h > hMax && h > 0) {
          w = Math.max(MIN_W, (w * hMax) / h);
          h = bubbleHeightFor(drag.shape, w, aspect);
        }
        rect = { ...base, w, h: Math.min(h, hMax) };
      }
      liveRectRef.current = rect;
      ctx.applyLive(() => ops.upsertCameraKeyframe(drag.from, drag.t, { rect }));
    };
    const onUp = () => {
      liveRectRef.current = null;
      ctx.commit(drag.from);
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
  }, [drag, ctx]);

  if (!track) return null;

  const begin = (e: React.PointerEvent, kind: Drag["kind"]) => {
    const layer = layerRef.current;
    if (!layer) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.player.pause();
    const r = layer.getBoundingClientRect();
    const c = contentRect(r.width, r.height, frame);
    const t = timeRef.current;
    const rect = cameraAt(track, t).rect;
    liveRectRef.current = rect;
    setDrag({
      kind,
      t,
      from: ctx.edits,
      startX: e.clientX,
      startY: e.clientY,
      rect,
      content: { x: r.left + c.x, y: r.top + c.y, w: c.w, h: c.h },
      shape: track.shape,
    });
  };

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-20">
      <div
        ref={badgeRef}
        style={{ display: "none" }}
        className="absolute rounded bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur"
      >
        Full screen
      </div>
      <div
        ref={boxRef}
        role="presentation"
        style={{ display: "none" }}
        onPointerDown={(e) => begin(e, "move")}
        className="pointer-events-auto absolute cursor-move touch-none border-2 border-dashed border-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
      >
        <div
          role="presentation"
          aria-label="Resize the camera bubble"
          onPointerDown={(e) => begin(e, "resize")}
          className="pointer-events-auto absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-black/50 bg-white"
        />
      </div>
    </div>
  );
}
