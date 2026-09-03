"use client";

import { useEffect, useRef, useState } from "react";
import type { Point, Rect, VideoEdits } from "@/lib/edits";
import { bubbleHeightFor, cameraAt, type CameraSample } from "@/lib/editor/camera-track";
import * as ops from "@/lib/editor/edit-ops";
import { coverCrop, shapeRadius } from "@/lib/recording/geometry";
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
  kind: "move" | "resize" | "pan";
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
  /** The displayed pan at `t`; a pan drag offsets this. Pan drags only. */
  pan?: Point;
  /**
   * How many client pixels of drag equal a full 0→1 sweep of the pan, per axis
   * — the on-screen size of the cropped-away slack. 0 on an axis with no slack,
   * which then simply does not move. Pan drags only.
   */
  slack?: { x: number; y: number };
  /** Mirrored draw, which flips what a rightward drag has to do to `pan.x`. */
  mirror?: boolean;
};

/**
 * Client pixels of slack on each axis for a `camW`×`camH` camera cover-cropped
 * into a `w`×`h` box: the source pixels the crop throws away, scaled up by how
 * far the crop is magnified to fill the box. Dragging the picture by that many
 * pixels sweeps the whole pan range.
 */
function panSlack(camW: number, camH: number, w: number, h: number): { x: number; y: number } {
  const crop = coverCrop(camW, camH, w, h);
  if (crop.sw <= 0 || crop.sh <= 0) return { x: 0, y: 0 };
  return { x: ((camW - crop.sw) * w) / crop.sw, y: ((camH - crop.sh) * h) / crop.sh };
}

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

  /**
   * Whether Shift is down, which swaps the box's cursor from "move" to "grab".
   * A ref written by window listeners rather than state: the rAF loop below
   * already touches the box's style every frame, and tapping Shift must not
   * re-render the staging tree.
   */
  const shiftRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey;
    };
    // Blur too: a Shift-tabbed-away window never delivers the keyup.
    const onBlur = () => {
      shiftRef.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

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
      box.style.cursor = shiftRef.current ? "grab" : "move";
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [track, frame, timeRef]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const c = drag.content;
      const base = drag.rect;
      if (drag.kind === "pan") {
        const p = drag.pan ?? { x: 0.5, y: 0.5 };
        const slack = drag.slack ?? { x: 0, y: 0 };
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        // Drag the PICTURE, not the window: pushing right must move what you
        // see right. Raising `pan.x` slides the crop window right in source
        // space, which moves the picture LEFT — unless the draw is mirrored,
        // which flips it back. Y is never mirrored, so it always inverts.
        const pan = {
          x: slack.x > 0 ? clamp(p.x + (drag.mirror ? dx : -dx) / slack.x, 0, 1) : p.x,
          y: slack.y > 0 ? clamp(p.y - dy / slack.y, 0, 1) : p.y,
        };
        ctxRef.current.applyLive(() => ops.upsertCameraKeyframe(drag.from, drag.t, { pan }));
        return;
      }
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
    const cam = ctx.player.cameraSize;
    const slack = cam ? panSlack(cam.width, cam.height, sample.rect.w * c.w, sample.rect.h * c.h) : null;
    // Shift turns a body drag into a pan — but only once the camera's own size
    // is known and the cover-crop actually has slack to slide through. Without
    // slack the gesture would write a keyframe (and an undo entry) for a pan
    // that cannot move; it stays a plain move instead.
    const panning = kind === "move" && e.shiftKey && !!slack && (slack.x > 0 || slack.y > 0);
    setDrag({
      kind: panning ? "pan" : kind,
      t,
      from: ctx.edits,
      startX: e.clientX,
      startY: e.clientY,
      rect: sample.rect,
      content: { x: r.left + c.x, y: r.top + c.y, w: c.w, h: c.h },
      // The shape in force at `t`, which is what a resize must keep square /
      // 16:9 / whatever — not the track-wide default.
      shape: sample.shape,
      ...(panning && slack ? { pan: sample.pan, slack, mirror: track.mirror } : null),
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
        // The cursor is set from the rAF loop (move, or grab while Shift is held).
        className={`${grabbable} absolute touch-none border-2 border-dashed border-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]`}
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
