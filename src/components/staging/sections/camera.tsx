"use client";

import { useEffect, useRef, useState } from "react";
import { formatElapsed } from "@/components/recorder/preview-stage";
import {
  MAX_CAMERA_OFFSET_MS,
  type CameraKeyframe,
  type CameraMode,
  type Point,
  type Rect,
  type VideoEdits,
} from "@/lib/edits";
import { bubbleHeightFor, cameraAt } from "@/lib/editor/camera-track";
import * as ops from "@/lib/editor/edit-ops";
import { loadSettings } from "@/lib/recording/settings";
import type { BubbleShape } from "@/lib/recording/types";
import { contentRect } from "../content-rect";
import { Slider } from "../slider";
import type { StagingContext } from "../types";
import * as ui from "../ui";

const SHAPE_LABEL: Record<BubbleShape, string> = {
  circle: "Circle",
  rounded: "Rounded",
  square: "Square",
  portrait: "Portrait",
  full: "Full",
};

/**
 * Shapes the Shape control offers. Deliberately excludes `"full"`, even
 * though it is a valid `BubbleShape` value (do not import the canonical
 * `SHAPES` list from `@/lib/recording/settings` here — that five-item list
 * is for storage/settings validation, not this control).
 *
 * `"full"` is not really a bubble shape — it is a request for full-frame
 * camera. `defaultCameraTrack` (`@/lib/editor/camera-track.ts`) treats
 * `shape: "full"` as shorthand for `mode: "full"` with a `{0,0,1,1}` rect,
 * and stores `shape: "circle"` underneath. Full-frame camera is already a
 * first-class choice in the Mode control below (Bubble / Full screen /
 * Hidden); offering "full" here too just reintroduces the bug where
 * `bubbleHeightFor` returns height `1` for a bubble-width rect, rendering as
 * a thin vertical sliver instead of an actual full-frame camera.
 */
const BUBBLE_SHAPES: BubbleShape[] = ["circle", "rounded", "square", "portrait"];

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
  const setPan = (pan: Point) => {
    const g = beginGesture(true);
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
    // Only the take's OPENING shape is appearance — a shape set later on the
    // timeline is a content decision for this take, not a sticky default.
    if (t === 0) ctx.setStagingDefaults({ cameraShape: shape });
  };

  const setMode = (mode: CameraMode) => atPlayhead({ mode });

  /**
   * Mirror is a track-wide property, not a per-keyframe one, so it is always
   * the sticky default — there is no "later in the timeline" case to exclude
   * the way there is for shape. Shared by the checkbox and its Reset so the
   * two can never drift apart.
   */
  const setMirror = (mirror: boolean) => {
    ctx.apply((ed) => (ed.camera ? ops.setCamera(ed, { ...ed.camera, mirror }) : ed));
    ctx.setStagingDefaults({ cameraMirror: mirror });
  };

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

  const mirrorControl = (
    <div className={ui.sectionHeader}>
      <label className={ui.check}>
        <input
          type="checkbox"
          checked={track.mirror}
          onChange={(e) => setMirror(e.target.checked)}
        />
        Mirror the camera
      </label>
      <button
        type="button"
        className={ui.sectionHeaderAction}
        onClick={() => setMirror(loadSettings().staging.cameraMirror)}
      >
        Reset
      </button>
    </div>
  );

  // Camera-only: the camera IS the picture, so there is no bubble to shape,
  // move, pan or hide. Mirror is the one thing that still applies — a
  // mirrored take reads text backwards — so the panel collapses to it.
  if (ctx.mode === "camera") {
    return (
      <div className={ui.section}>
        {mirrorControl}
        <p className={ui.hint}>
          Mirroring matches what you saw while recording. Turn it off to show the room the
          way others see it, with any text the right way round.
        </p>
      </div>
    );
  }

  return (
    <div className={ui.section}>
      <div className={ui.group}>
        <div className={ui.sectionHeader}>
          <span className={ui.sectionHeaderTitle}>Shape at the playhead</span>
          <button
            type="button"
            className={ui.sectionHeaderAction}
            disabled={sample.mode === "hidden"}
            onClick={() => setShape(loadSettings().staging.cameraShape)}
          >
            Reset
          </button>
        </div>
        <div className={ui.seg} role="group" aria-label="Bubble shape">
          {BUBBLE_SHAPES.map((shape) => (
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

      {mirrorControl}

      <div className={ui.group}>
        <div className={ui.sectionHeader}>
          <span className={ui.sectionHeaderTitle}>At the playhead</span>
        </div>
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
        <div className={ui.sectionHeader}>
          <span className={ui.sectionHeaderTitle}>Crop pan</span>
        </div>
        {/*
          The cover-crop only has slack on the axis the camera's aspect
          overshoots the bubble's. The bubble always fills the full height of
          its own box, so the common case is horizontal-only slack — hence a
          single horizontal slider for `pan.x`. But height isn't *always*
          full relative to the camera: e.g. a `rounded` bubble on a
          portrait-oriented recording (screenAspect < 1) comes out wider
          than the camera, which puts the slack on `pan.y` instead — see
          `bubbleHeightFor`. So the vertical slider stays, gated the same way
          the horizontal one is, rather than assuming it can never apply.
        */}
        <Slider
          name="Horizontal"
          value={sample.pan.x}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          disabled={!canPanX}
          onChange={(x) => setPan({ x, y: sample.pan.y })}
        />
        {canPanY && (
          <Slider
            name="Vertical"
            value={sample.pan.y}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(y) => setPan({ x: sample.pan.x, y })}
          />
        )}
        <p className={ui.hint}>
          {canPanX || canPanY
            ? "Choose what the crop shows."
            : "This bubble matches the camera's shape, so there is nothing to pan."}
        </p>
      </div>

      <div className={ui.group}>
        <div className={ui.sectionHeader}>
          <span className={ui.sectionHeaderTitle}>Keyframes ({track.keyframes.length})</span>
        </div>
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
        <Slider
          name="Sync"
          value={offset}
          min={-MAX_CAMERA_OFFSET_MS}
          max={MAX_CAMERA_OFFSET_MS}
          step={10}
          format={(v) => `${v > 0 ? "+" : ""}${v}ms`}
          onChange={(ms) => {
            beginGesture(false);
            ctx.applyLive((ed) => ops.setCameraOffset(ed, ms));
          }}
        />
        <p className={ui.hint}>Negative pulls the camera earlier than the screen.</p>
      </div>
    </div>
  );
}
