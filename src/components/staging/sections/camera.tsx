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
import { SHAPES } from "@/lib/recording/settings";
import type { BubbleShape } from "@/lib/recording/types";
import { contentRect } from "../content-rect";
import { Slider } from "../slider";
import type { StagingContext } from "../types";
import * as ui from "../ui";

/** The sync slider's range; narrower than `MAX_CAMERA_OFFSET_MS`, which is the hard clamp. */
const SYNC_RANGE_MS = Math.min(500, MAX_CAMERA_OFFSET_MS);

const SHAPE_LABEL: Record<BubbleShape, string> = {
  circle: "Circle",
  rounded: "Rounded",
  square: "Square",
  portrait: "Portrait",
  full: "Full",
};

const MODES: { id: CameraMode; label: string }[] = [
  { id: "bubble", label: "Bubble" },
  { id: "full", label: "Full screen" },
  { id: "hidden", label: "Hidden" },
];

const MODE_LABEL: Record<CameraMode, string> = {
  bubble: "bubble",
  full: "full screen",
  hidden: "hidden",
};

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

  if (!track) return <p className={ui.hint}>This take has no camera.</p>;

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
    <div className={ui.section}>
      <div className={ui.group}>
        <span className={ui.label}>Shape at the playhead</span>
        <div className={ui.seg} role="group" aria-label="Bubble shape">
          {SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              aria-pressed={sample.shape === shape}
              // A hidden camera has no bubble to reshape; `setShape` refuses
              // anyway, so say so rather than looking broken.
              disabled={sample.mode === "hidden"}
              className={`${sample.shape === shape ? ui.segItemOn : ui.segItem} disabled:opacity-30`}
              onClick={() => setShape(shape)}
            >
              {SHAPE_LABEL[shape]}
            </button>
          ))}
        </div>
      </div>

      <label className={ui.check}>
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

      <div className={ui.group}>
        <span className={ui.label}>At the playhead</span>
        <div className={ui.seg} role="group" aria-label="Camera mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={sample.mode === m.id}
              className={sample.mode === m.id ? ui.segItemOn : ui.segItem}
              onClick={() => (m.id === "hidden" ? toggleHidden() : setMode(m.id))}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className={ui.hint}>Drag the dashed box on the preview to move or resize it.</p>
      </div>

      <div className={ui.group}>
        <span className={ui.label}>Framing</span>
        {/*
          One axis at a time has slack: the cover-crop only trims the axis the
          camera has too much of. The dead axis stays visible but disabled, so
          the control does not appear and disappear as the bubble is reshaped.
        */}
        <Slider
          name="Pan ↔"
          value={sample.pan.x}
          min={0}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          disabled={!canPanX}
          onChange={(v) => setPan("x", v)}
        />
        <Slider
          name="Pan ↕"
          value={sample.pan.y}
          min={0}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          disabled={!canPanY}
          onChange={(v) => setPan("y", v)}
        />
        <p className={ui.hint}>
          {canPanX || canPanY
            ? "Shift-drag the bubble to pan."
            : "This bubble matches the camera's shape, so there is nothing to pan."}
        </p>
      </div>

      <div className={ui.group}>
        <span className={ui.label}>
          Keyframes ({track.keyframes.length})
        </span>
        <ul className={ui.group}>
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
                {ui.fmt(k.t)} · {MODE_LABEL[k.mode]}
                {k.mode === "bubble" && k.shape ? ` · ${k.shape}` : ""}
              </button>
              <button
                type="button"
                className={ui.btn}
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
                className="text-[11px] text-danger-text/80 hover:text-danger-hover disabled:opacity-30 disabled:hover:text-danger-text/80"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={ui.group}>
        <label htmlFor="camera-sync" className={ui.label}>
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
        <p className={ui.hint}>Negative pulls the camera earlier than the screen.</p>
      </div>
    </div>
  );
}
