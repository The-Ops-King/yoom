"use client";

import { useEffect, useRef, useState } from "react";
import type { Rect, VideoEdits } from "@/lib/edits";
import { bubbleHeightFor, cameraAt, type CameraSample } from "@/lib/editor/camera-track";
import * as ops from "@/lib/editor/edit-ops";
import { shapeRadius } from "@/lib/recording/geometry";
import type { BubbleShape } from "@/lib/recording/types";
import { contentRect, type Box } from "./content-rect";
import type { StagingContext } from "./types";

/** Smallest the bubble may be dragged to, as a fraction of the content width. */
const MIN_W = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The eased corner radius of a sample's bubble, matching `render.ts`. */
function sampleRadius(s: CameraSample, w: number, h: number): number {
  const to = shapeRadius(s.shape, w, h);
  if (!s.fromShape || s.shapeFade >= 1) return to;
  const from = shapeRadius(s.fromShape, w, h);
  return from + (to - from) * s.shapeFade;
}

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
 * itself, so the overlay layer beneath it (this layer sits on top, at `z-20`)
 * still gets every other click — and the box goes through too while a drawing
 * tool is armed, so an overlay can be drawn over the bubble.
 *
 * The box is positioned from a rAF loop reading `player.timeRef` rather than
 * from React state: playback must not re-render the whole staging tree at
 * 60 Hz (the timeline's playhead does the same).
 *
 * Nothing is rendered until the real output size is known. `player.size`
 * starts at the 16×9 placeholder, the default track is built against that
 * guess, and `staging.tsx` rebuilds it once the metadata lands — so drawing a
 * box before then would put it in the wrong place and move it out from under
 * the pointer the moment the video loads.
 */
export function CameraLayer({ ctx }: { ctx: StagingContext }) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  /**
   * `ctx` is a fresh object on every `applyLive`, so the drag effect reads it
   * through a ref instead of depending on it — otherwise the window listeners
   * would be torn down and re-added on every single pointermove.
   */
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  /** False until the video's metadata has replaced the 16×9 placeholder size. */
  const sized = ctx.player.size.width > 16;
  const track = ctx.mode === "screen+camera" && sized ? ctx.edits.camera ?? null : null;
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
      // Settle-by-`t` means `cameraAt` at the drag's own time already reports
      // the dragged rect, so the box needs no live override: what the dashed
      // box shows and what `drawFrame` paints are the same sample.
      if (sample.mode !== "bubble") {
        badge.textContent = sample.mode === "hidden" ? "Camera hidden" : "Full screen";
        badge.style.display = "block";
        box.style.display = "none";
        badge.style.left = `${c.x + 8}px`;
        badge.style.top = `${c.y + 8}px`;
        return;
      }
      badge.style.display = "none";
      box.style.display = "block";
      const rect = sample.rect;
      const w = rect.w * c.w;
      const h = rect.h * c.h;
      box.style.left = `${c.x + rect.x * c.w}px`;
      box.style.top = `${c.y + rect.y * c.h}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      box.style.borderRadius = `${sampleRadius(sample, w, h)}px`;
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
        // Delta from where the corner was grabbed, so the edge does not jump
        // to the pointer on the first move.
        let w = clamp(base.w + (e.clientX - drag.startX) / c.w, MIN_W, Math.max(MIN_W, 1 - base.x));
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
      ctxRef.current.applyLive(() => ops.upsertCameraKeyframe(drag.from, drag.t, { rect }));
    };
    const onUp = () => {
      ctxRef.current.commit(drag.from);
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
  }, [drag]);

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
    const sample = cameraAt(track, t);
    setDrag({
      kind,
      t,
      from: ctx.edits,
      startX: e.clientX,
      startY: e.clientY,
      rect: sample.rect,
      content: { x: r.left + c.x, y: r.top + c.y, w: c.w, h: c.h },
      // The shape in force at `t`, which is what a resize must keep square /
      // 16:9 / whatever — not the track-wide default.
      shape: sample.shape,
    });
  };

  // A drawing tool owns the whole preview: let its pointer events fall
  // straight through the bubble to the overlay layer underneath.
  const grabbable = ctx.tool === "select" ? "pointer-events-auto" : "pointer-events-none";

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
        className={`${grabbable} absolute cursor-move touch-none border-2 border-dashed border-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]`}
      >
        <div
          aria-label="Resize the camera bubble"
          onPointerDown={(e) => begin(e, "resize")}
          className={`${grabbable} absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-black/50 bg-white`}
        />
      </div>
    </div>
  );
}
