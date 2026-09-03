"use client";

import { useEffect, useRef, useState } from "react";
import { formatElapsed } from "@/components/recorder/preview-stage";
import {
  MAX_CAMERA_OFFSET_MS,
  type CameraKeyframe,
  type CameraMode,
  type Rect,
  type VideoEdits,
} from "@/lib/edits";
import { bubbleHeightFor, cameraAt } from "@/lib/editor/camera-track";
import * as ops from "@/lib/editor/edit-ops";
import type { BubbleShape } from "@/lib/recording/types";
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

const MODE_LABEL: Record<CameraMode, string> = {
  bubble: "bubble",
  full: "full screen",
  hidden: "hidden",
};

const fmt = (t: number) => `${t.toFixed(1)}s`;

/**
 * How far the bubble's aspect must differ from the camera's before that axis
 * counts as having crop slack. Below it the slider could not move anything.
 */
const SLACK_EPSILON = 0.001;

/** One slider gesture: the edits it started from, and the keyframe time it writes. */
type Gesture = { from: VideoEdits; t: number };

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

  /**
   * Set for the length of one slider gesture (sync or pan), so the whole drag
   * lands as a single undo step. Mirrored into a ref because `onChange` needs
   * the gesture's own `from`/`t` in the same tick it starts them.
   */
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  useEffect(() => {
    if (!gesture) return;
    const end = () => {
      ctx.commit(gesture.from);
      gestureRef.current = null;
      setGesture(null);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("keyup", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("keyup", end);
    };
  }, [gesture, ctx]);

  if (!track) return <p className="text-[11px] text-muted-dim">This take has no camera.</p>;

  // The content box's aspect is the source aspect — what `bubbleHeightFor`
  // means by `screenAspect`. Measured off the output size the preview is laid
  // out at, so it matches the drag layer exactly.
  const box = contentRect(player.size.width, player.size.height, edits.frame);
  const aspect = box.h > 0 ? box.w / box.h : 16 / 9;
  // The live playhead, not the 10 Hz `player.time` mirror: every control below
  // *writes* at `timeRef.current`, so the pressed state has to be read from
  // the same clock or a button can look off while it is on. (`player.time`
  // still drives the re-render that gets us here.)
  const sample = cameraAt(track, player.timeRef.current);

  /**
   * Start (or continue) a slider gesture. The pan sliders write a keyframe at
   * a fixed `t`, so the playhead is stopped first: a moving one would spray a
   * keyframe per input event instead of re-patching the one being dragged.
   */
  const beginGesture = (pauseFirst: boolean): Gesture => {
    if (gestureRef.current) return gestureRef.current;
    if (pauseFirst) player.pause();
    const g: Gesture = { from: edits, t: player.timeRef.current };
    gestureRef.current = g;
    setGesture(g);
    return g;
  };

  // Which axes the cover-crop actually has slack on. The bubble's pixel aspect
  // is what `coverCrop` fits the camera into: a camera wider than the box is
  // cropped at the sides (so pan.x bites), a taller one at top and bottom.
  const cam = player.cameraSize;
  const camAspect = cam && cam.height > 0 ? cam.width / cam.height : null;
  const bubbleAspect =
    sample.mode === "full" ? aspect : (sample.rect.w * box.w) / (sample.rect.h * box.h);
  const pannable = camAspect !== null && sample.mode !== "hidden" && Number.isFinite(bubbleAspect);
  const canPanX = pannable && camAspect > bubbleAspect + SLACK_EPSILON;
  const canPanY = pannable && camAspect < bubbleAspect - SLACK_EPSILON;

  /** Write the pan at the gesture's keyframe, rebuilding from its pre-gesture edits. */
  const setPan = (axis: "x" | "y", value: number) => {
    const g = beginGesture(true);
    const pan = { ...sample.pan, [axis]: value };
    ctx.applyLive(() => ops.upsertCameraKeyframe(g.from, g.t, { pan }));
  };

  /**
   * Every "at the playhead" control writes one keyframe at `t` so the change
   * animates in and is visible immediately (`cameraAt` settles *at* `t`).
   */
  const atPlayhead = (patch: Partial<Omit<CameraKeyframe, "t">>) => {
    const t = player.timeRef.current;
    ctx.apply((e) => ops.upsertCameraKeyframe(e, t, patch));
  };

  /** Shape is per-keyframe: the bubble morphs into it at the playhead. */
  const setShape = (shape: BubbleShape) => {
    const t = player.timeRef.current;
    const cur = cameraAt(track, t);
    // There is no bubble to reshape while the camera is hidden, and writing a
    // keyframe here would silently pin "hidden" at the playhead forever.
    if (cur.mode === "hidden") return;
    // Re-derive `h` for the new shape so the pixel box stays right (a circle
    // is square in pixels, `rounded` follows the camera aspect, and so on).
    const h = Math.min(1, bubbleHeightFor(shape, cur.rect.w, aspect));
    ctx.apply((e) => ops.upsertCameraKeyframe(e, t, { shape, rect: refit(cur.rect, cur.rect.w, h) }));
  };

  const setMode = (mode: CameraMode) => atPlayhead({ mode });

  /**
   * Un-hiding restores whatever the camera was doing before it was hidden —
   * the last non-hidden keyframe at or before the playhead, else a bubble.
   */
  const toggleHidden = () => {
    if (sample.mode !== "hidden") {
      setMode("hidden");
      return;
    }
    const t = player.timeRef.current;
    let restored: CameraMode = "bubble";
    for (const k of track.keyframes) {
      if (k.t > t) break;
      if (k.mode !== "hidden") restored = k.mode;
    }
    setMode(restored);
  };

  const offset = edits.cameraOffsetMs ?? 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-muted-dim">Shape at the playhead</span>
        <div className="flex flex-wrap gap-1.5">
          {SHAPES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={sample.shape === s.id}
              // A hidden camera has no bubble to reshape; `setShape` refuses
              // anyway, so say so rather than looking broken.
              disabled={sample.mode === "hidden"}
              className={sample.shape === s.id ? btnOn : btn}
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
          <button
            type="button"
            aria-pressed={sample.mode === "hidden"}
            className={sample.mode === "hidden" ? btnOn : btn}
            onClick={toggleHidden}
          >
            {sample.mode === "hidden" ? "Show camera" : "Hide camera"}
          </button>
        </div>
        <p className="text-[11px] text-muted-dim">Drag the dashed box on the preview to move or resize it.</p>
      </div>

      <div className="space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-muted-dim">Framing</span>
        {/*
          One axis at a time has slack: the cover-crop only trims the axis the
          camera has too much of. The dead axis stays visible but disabled, so
          the control does not appear and disappear as the bubble is reshaped.
        */}
        <label htmlFor="camera-pan-x" className="flex items-center gap-2 text-[11px] text-muted">
          <span className="w-10 shrink-0">Pan ↔</span>
          <input
            id="camera-pan-x"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sample.pan.x}
            disabled={!canPanX}
            className="w-full disabled:opacity-30"
            onPointerDown={() => beginGesture(true)}
            onKeyDown={() => beginGesture(true)}
            onChange={(e) => setPan("x", Number(e.target.value))}
          />
        </label>
        <label htmlFor="camera-pan-y" className="flex items-center gap-2 text-[11px] text-muted">
          <span className="w-10 shrink-0">Pan ↕</span>
          <input
            id="camera-pan-y"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sample.pan.y}
            disabled={!canPanY}
            className="w-full disabled:opacity-30"
            onPointerDown={() => beginGesture(true)}
            onKeyDown={() => beginGesture(true)}
            onChange={(e) => setPan("y", Number(e.target.value))}
          />
        </label>
        <p className="text-[11px] text-muted-dim">
          {canPanX || canPanY
            ? "Shift-drag the bubble to pan."
            : "This bubble matches the camera's shape, so there is nothing to pan."}
        </p>
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
                {fmt(k.t)} · {MODE_LABEL[k.mode]}
                {k.mode === "bubble" && k.shape ? ` · ${k.shape}` : ""}
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
          onPointerDown={() => beginGesture(false)}
          onKeyDown={() => beginGesture(false)}
          onChange={(e) => {
            const ms = Number(e.target.value);
            beginGesture(false);
            ctx.applyLive((ed) => ops.setCameraOffset(ed, ms));
          }}
        />
        <p className="text-[11px] text-muted-dim">Negative pulls the camera earlier than the screen.</p>
      </div>
    </div>
  );
}
