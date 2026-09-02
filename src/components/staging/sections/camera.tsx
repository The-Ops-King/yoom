"use client";

import { useEffect, useState } from "react";
import { formatElapsed } from "@/components/recorder/preview-stage";
import { MAX_CAMERA_OFFSET_MS, type CameraTrack, type Rect, type VideoEdits } from "@/lib/edits";
import { bubbleHeightFor, cameraAt } from "@/lib/editor/camera-track";
import * as ops from "@/lib/editor/edit-ops";
import { SIZE_FRACTION } from "@/lib/recording/geometry";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";
import { contentRect } from "../content-rect";
import type { StagingContext } from "../types";

/** The sync slider's range; narrower than `MAX_CAMERA_OFFSET_MS`, which is the hard clamp. */
const SYNC_RANGE_MS = Math.min(500, MAX_CAMERA_OFFSET_MS);

const btn =
  "rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-muted";
const btnOn = "rounded-md border border-accent bg-accent/15 px-2 py-1 text-[11px] font-medium text-foreground";

const SHAPES: { id: BubbleShape; label: string }[] = [
  { id: "circle", label: "Circle" },
  { id: "rounded", label: "Rounded" },
  { id: "square", label: "Square" },
  { id: "portrait", label: "Portrait" },
];

const SIZES: { id: BubbleSize; label: string }[] = [
  { id: "small", label: "S" },
  { id: "medium", label: "M" },
  { id: "large", label: "L" },
];

const fmt = (t: number) => `${t.toFixed(1)}s`;

/** Fit `rect` back inside 0..1 after its size changed. */
function refit(rect: Rect, w: number, h: number): Rect {
  return {
    x: Math.max(0, Math.min(rect.x, 1 - w)),
    y: Math.max(0, Math.min(rect.y, 1 - h)),
    w,
    h,
  };
}

export function CameraSection({ ctx }: { ctx: StagingContext }) {
  const { edits, player } = ctx;
  const track = edits.camera ?? null;

  /** Set for the length of one slider gesture, so it lands as a single undo step. */
  const [syncFrom, setSyncFrom] = useState<VideoEdits | null>(null);
  useEffect(() => {
    if (!syncFrom) return;
    const end = () => {
      ctx.commit(syncFrom);
      setSyncFrom(null);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("keyup", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("keyup", end);
    };
  }, [syncFrom, ctx]);

  if (!track) return <p className="text-[11px] text-muted-dim">This take has no camera.</p>;

  // The content box's aspect is the source aspect — what `bubbleHeightFor`
  // means by `screenAspect`. Measured off the output size the preview is laid
  // out at, so it matches the drag layer exactly.
  const box = contentRect(player.size.width, player.size.height, edits.frame);
  const aspect = box.h > 0 ? box.w / box.h : 16 / 9;
  const sample = cameraAt(track, player.time);

  /** Re-derive every keyframe's `h` so the pixel box keeps the new shape. */
  const setShape = (shape: BubbleShape) => {
    ctx.apply((e) => {
      const cur = e.camera;
      if (!cur) return e;
      const next: CameraTrack = {
        ...cur,
        shape,
        keyframes: cur.keyframes.map((k) => {
          const h = Math.min(1, bubbleHeightFor(shape, k.rect.w, aspect));
          return { ...k, rect: refit(k.rect, k.rect.w, h) };
        }),
      };
      return ops.setCamera(e, next);
    });
  };

  const setSize = (size: BubbleSize) => {
    const t = player.timeRef.current;
    const base = cameraAt(track, t).rect;
    const w = SIZE_FRACTION[size];
    const h = Math.min(1, bubbleHeightFor(track.shape, w, aspect));
    ctx.apply((e) => ops.upsertCameraKeyframe(e, t, { mode: "bubble", rect: refit(base, w, h) }));
  };

  const setMode = (mode: "bubble" | "full") => {
    ctx.apply((e) => ops.upsertCameraKeyframe(e, player.timeRef.current, { mode }));
  };

  const offset = edits.cameraOffsetMs ?? 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-muted-dim">Shape</span>
        <div className="flex flex-wrap gap-1.5">
          {SHAPES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={track.shape === s.id}
              className={track.shape === s.id ? btnOn : btn}
              onClick={() => setShape(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-muted">
        <input
          type="checkbox"
          checked={track.mirror}
          onChange={(e) => {
            const mirror = e.target.checked;
            ctx.apply((ed) => (ed.camera ? ops.setCamera(ed, { ...ed.camera, mirror }) : ed));
          }}
        />
        Mirror the camera
      </label>

      <div className="space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-muted-dim">At the playhead</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={sample.mode === "bubble"}
            className={sample.mode === "bubble" ? btnOn : btn}
            onClick={() => setMode("bubble")}
          >
            Bubble
          </button>
          <button
            type="button"
            aria-pressed={sample.mode === "full"}
            className={sample.mode === "full" ? btnOn : btn}
            onClick={() => setMode("full")}
          >
            Full screen
          </button>
          {SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={btn}
              aria-label={`${s.label} bubble at the playhead`}
              onClick={() => setSize(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-dim">Drag the dashed box on the preview to move or resize it.</p>
      </div>

      <div className="space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-muted-dim">
          Keyframes ({track.keyframes.length})
        </span>
        <ul className="space-y-1">
          {track.keyframes.map((k, i) => (
            <li key={k.t} className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  ctx.setSelected({ kind: "keyframe", index: i, t: k.t });
                  player.seek(k.t);
                }}
                className={`flex-1 text-left text-[11px] ${
                  ctx.selected?.kind === "keyframe" && ctx.selected.index === i ? "text-foreground" : "text-muted"
                }`}
              >
                {fmt(k.t)} · {k.mode === "full" ? "full screen" : "bubble"}
              </button>
              <button
                type="button"
                className={btn}
                aria-label={`Go to ${formatElapsed(k.t * 1000)}`}
                onClick={() => player.seek(k.t)}
              >
                Go
              </button>
              <button
                type="button"
                disabled={i === 0}
                aria-label={`Remove the keyframe at ${formatElapsed(k.t * 1000)}`}
                onClick={() => {
                  ctx.apply((e) => ops.removeCameraKeyframe(e, k.t));
                  ctx.setSelected(null);
                }}
                className="text-[11px] text-red-400/80 hover:text-red-300 disabled:opacity-30 disabled:hover:text-red-400/80"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1">
        <label htmlFor="camera-sync" className="block text-[11px] uppercase tracking-wider text-muted-dim">
          Sync {offset > 0 ? `+${offset}` : offset} ms
        </label>
        <input
          id="camera-sync"
          type="range"
          min={-SYNC_RANGE_MS}
          max={SYNC_RANGE_MS}
          step={10}
          value={offset}
          className="w-full"
          onPointerDown={() => setSyncFrom((f) => f ?? edits)}
          onKeyDown={() => setSyncFrom((f) => f ?? edits)}
          onChange={(e) => {
            const ms = Number(e.target.value);
            setSyncFrom((f) => f ?? edits);
            ctx.applyLive((ed) => ops.setCameraOffset(ed, ms));
          }}
        />
        <p className="text-[11px] text-muted-dim">Negative pulls the camera earlier than the screen.</p>
      </div>
    </div>
  );
}
