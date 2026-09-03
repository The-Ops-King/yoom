/**
 * Non-destructive edit decision list stored in `videos.edits` (jsonb).
 *
 * Phase 3 only persists and plumbs this through; nothing renders it yet. The
 * proposed Phase 5 editor draws it on the canvas overlay in `edit-player.tsx`.
 *
 * All times are seconds from the start of the source video. All rects are
 * normalised to the video frame (0..1) so they survive any display size.
 */

import { pick, sanitizeFrame, SHAPES } from "@/lib/recording/settings";
import type { BubbleShape, FrameConfig } from "@/lib/recording/types";

export type Rect = { x: number; y: number; w: number; h: number };

export type Cut = { start: number; end: number };

/**
 * How a zoom picks the region it shows. `follow` (desktop takes with a cursor
 * track only): `rect` gives the window SIZE and its position is ignored — the
 * centre rides the smoothed cursor path instead, clamped inside the frame. See
 * `lib/editor/cursor-path`. Absent means `static`.
 */
export type ZoomKind = "static" | "follow";

export type Zoom = {
  start: number;
  end: number;
  rect: Rect;
  ramp?: number;
  kind?: ZoomKind;
  /**
   * @deprecated The pre-addendum spelling of `kind: "follow"`. `parseEdits`
   * migrates it and never emits it again; the field survives on the type for
   * one release so stored rows and older callers still type-check. Read
   * `kind === "follow"`, never this.
   */
  follow?: boolean;
};

export type OverlayType =
  | "blur"
  | "blackout"
  | "ellipse"
  | "rect"
  | "line"
  | "arrow"
  | "step"
  | "underline"
  | "highlight"
  | "text"
  | "emoji"
  | "draw"
  | "image"
  | "keys"
  | "click";

/** How an `arrow` is drawn. `curved` bends through the overlay's `ctrl` point. */
export type ArrowStyle = "standard" | "double" | "curved" | "fancy";

/** A normalised point on the source frame (0..1 in each axis). */
export type Point = { x: number; y: number };

/**
 * ARROW REPRESENTATION (one representation, chosen once, relied on everywhere;
 * `line` shares it):
 * `from` and `to` are the arrow's endpoints in normalised **source** coordinates
 * — the same space as `rect` — and they are the single source of truth. `rect`
 * is their axis-aligned BOUNDING BOX, derived and kept in step by `parseEdits`
 * and by `edit-ops.addOverlay` / `updateOverlay`, so every rect-shaped consumer
 * (the timeline, hit-testing, the zoom mapping in `render.ts`) keeps working
 * unchanged. Nothing else reads `from`/`to`; every other overlay type drops them.
 */
export type Overlay = {
  type: OverlayType;
  start: number;
  end: number;
  rect: Rect;
  /** Step badge number. */
  n?: number;
  /** CSS colour for everything but blur and image. */
  color?: string;
  /** Arrow tail; see the arrow note above. Arrows and lines only. */
  from?: Point;
  /** Arrow head; see the arrow note above. Arrows and lines only. */
  to?: Point;
  /**
   * The control point a `curved` arrow bends through, in the same normalised
   * source space as `from`/`to`. Arrows and lines only; absent means the
   * renderer's default (the midpoint pushed 15 % along the perpendicular).
   */
  ctrl?: Point;
  /** Draw the shape filled rather than stroked (`rect`, `ellipse`). */
  fill?: boolean;
  /** Arrow head/shaft style; absent means `standard`. Arrows only. */
  style?: ArrowStyle;
  /** The string a `text` overlay shows, or the emoji an `emoji` overlay is. Capped at `MAX_TEXT`. */
  text?: string;
  /** Text size, normalised to the frame HEIGHT (`MIN_TEXT_SIZE`..`MAX_TEXT_SIZE`). */
  size?: number;
  /** CSS colour painted behind a `text` overlay; absent means no plate. */
  bg?: string;
  /**
   * A freehand stroke's path in normalised source coordinates, capped at
   * `MAX_DRAW_POINTS`. `draw` only, and — exactly like an arrow's endpoints —
   * the truth: `rect` is their bounding box, re-derived by `parseEdits` and by
   * `edit-ops.addOverlay` / `updateOverlay`.
   */
  points?: Point[];
  /**
   * Image source: an object URL minted during staging, or a data URL. Kept
   * verbatim, `blob:` included — the client export needs it, and a `blob:`
   * that reaches the server is simply a dead string nothing dereferences.
   */
  src?: string;
  /** Stroke width, normalised to the frame HEIGHT (see `DEFAULT_OVERLAY_THICKNESS`). */
  thickness?: number;
  /** 0..1; the fill alpha for highlight and the draw alpha for image. */
  opacity?: number;
};

/** A recorder-placed timestamp marker (seconds from the start of the video). */
export type Marker = { t: number; label?: string };

/** `hidden` removes the camera from the frame entirely (it cross-fades out). */
export type CameraMode = "bubble" | "full" | "hidden";
export type CameraKeyframe = {
  t: number;
  mode: CameraMode;
  rect: Rect;
  /** Bubble shape from this keyframe on; falls back to the track's `shape`. */
  shape?: BubbleShape;
  /**
   * Which part of the camera feed the cover-crop shows, 0..1 per axis, in
   * SOURCE space (0 = the source's left/top edge, 1 = its right/bottom, 0.5 =
   * the centred crop everything did before this existed). Absent means 0.5/0.5;
   * `cameraAt` lerps it like `rect` and always reports a value.
   */
  pan?: Point;
};
export type CameraTrack = {
  /** The default shape, for keyframes that do not carry their own. */
  shape: BubbleShape;
  mirror: boolean;
  /** Sorted by t; the first is always t = 0. */
  keyframes: CameraKeyframe[];
};

/**
 * One captured mouse click on the "Clicks" lane. `t` is source seconds, `x`/`y`
 * are normalised to the source frame, and `on` is the user's own toggle — an
 * `on` click draws the ripple over `t..t + 0.5 s`, an off one draws nothing but
 * stays on the lane so it can be switched back.
 */
export type ClickMark = { t: number; x: number; y: number; on: boolean };

/**
 * How the cursor is drawn. `none` hides it, `real` keeps the captured one, and
 * `smooth` hides the capture and draws a synthetic arrow along the low-pass
 * cursor path. `size` scales that arrow (`MIN_CURSOR_SIZE`..`MAX_CURSOR_SIZE`,
 * 1 = life-size). Click ripples are expressed per-mark by `clicks[].on`, so
 * there is deliberately no ripple field here.
 */
export type CursorStyle = "none" | "real" | "smooth";
export type CursorConfig = { style: CursorStyle; size: number };

export type VideoEdits = {
  version: 1;
  cuts: Cut[];
  crop: Rect | null;
  zooms: Zoom[];
  overlays: Overlay[];
  markers: Marker[];
  trim?: { start: number; end: number };
  frame?: FrameConfig;
  camera?: CameraTrack | null;
  cameraOffsetMs?: number;
  /** The clicks lane; absent on a take with no click track. Sorted by `t`, capped at `MAX_CLICKS`. */
  clicks?: ClickMark[];
  /** Cursor rendering; absent means the renderer's default (`real` at size 1). */
  cursor?: CursorConfig;
  /** Directional blur while the zoom view is moving fast; absent means on. */
  motionBlur?: boolean;
};

function deepFreezeEmptyEdits(edits: VideoEdits): VideoEdits {
  Object.freeze(edits.cuts);
  Object.freeze(edits.zooms);
  Object.freeze(edits.overlays);
  Object.freeze(edits.markers);
  return Object.freeze(edits);
}

/** Frozen shared default — never mutate; use `emptyEdits()` for a fresh, mutable copy. */
export const EMPTY_EDITS: VideoEdits = deepFreezeEmptyEdits({
  version: 1,
  cuts: [],
  crop: null,
  zooms: [],
  overlays: [],
  markers: [],
});

/** A fresh, mutable "no edits" object — never share `EMPTY_EDITS` with a caller that may mutate it. */
function emptyEdits(): VideoEdits {
  return {
    version: 1,
    cuts: [],
    crop: null,
    zooms: [],
    overlays: [],
    markers: [],
  };
}

export const MAX_OVERLAYS = 64;
export const MAX_CUTS = 64;
export const MAX_KEYFRAMES = 64;
export const MAX_ZOOMS = 32;
export const MAX_MARKERS = 200;
/** Clicks kept on the lane; a long take generates far more than anyone edits. */
export const MAX_CLICKS = 500;
/** Points in one freehand stroke; enough for a long scribble, small enough to store. */
export const MAX_DRAW_POINTS = 2000;
/** Characters in a `text`/`emoji` overlay. */
export const MAX_TEXT = 500;
/** Text size bounds, normalised to the frame height. */
export const MIN_TEXT_SIZE = 0.01;
export const MAX_TEXT_SIZE = 0.3;
/** The text size a `text`/`emoji` overlay is drawn at when it carries none. */
export const DEFAULT_TEXT_SIZE = 0.05;
/** Synthetic-cursor scale bounds; 1 is life-size. */
export const MIN_CURSOR_SIZE = 0.5;
export const MAX_CURSOR_SIZE = 2;
/** The cursor config a take gets when it carries none. */
export const DEFAULT_CURSOR: CursorConfig = Object.freeze({ style: "real", size: 1 });
/** Seconds the zoom's ease-in/ease-out ramp may span. */
const MAX_RAMP_S = 2;
/** Milliseconds the camera track may be shifted from the screen track, either direction. */
export const MAX_CAMERA_OFFSET_MS = 5000;
/** Smallest a normalised rect's width/height may shrink to when clamped into the frame. */
const MIN_RECT_SIZE = 0.001;
/**
 * Longest a non-`data:` overlay image `src` may be (a `blob:` or an http URL);
 * anything longer is dropped rather than stored.
 */
export const MAX_OVERLAY_SRC = 2048;
/**
 * Longest a `data:` overlay image `src` may be. A data URL IS the picture, so
 * it cannot be held to a URL-length cap and still survive a round trip — this
 * is a size limit on the embedded image (~1.5 MB of bytes at base64's 4/3
 * expansion), not an address limit.
 */
export const MAX_OVERLAY_DATA_SRC = 2 * 1024 * 1024;
/** Stroke width as a fraction of the frame height — a fat but still sane ceiling. */
export const MAX_OVERLAY_THICKNESS = 0.1;
/** The stroke width an ellipse/arrow/underline is drawn with when it carries none. */
export const DEFAULT_OVERLAY_THICKNESS = 0.006;
const OVERLAY_TYPES: OverlayType[] = [
  "blur",
  "blackout",
  "ellipse",
  "rect",
  "line",
  "arrow",
  "step",
  "underline",
  "highlight",
  "text",
  "emoji",
  "draw",
  "image",
  "keys",
  "click",
];
const ARROW_STYLES: ArrowStyle[] = ["standard", "double", "curved", "fancy"];
const CURSOR_STYLES: CursorStyle[] = ["none", "real", "smooth"];
/** The overlay types whose geometry is `from`/`to` with `rect` as the derived bounding box. */
const POINT_PAIR_TYPES: OverlayType[] = ["arrow", "line"];
/** Pre-addendum names that still have to parse. `callout` is today's `step`. */
const LEGACY_OVERLAY_TYPES: Record<string, OverlayType> = { callout: "step" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) return null;
  const x = num(value.x);
  const y = num(value.y);
  const w = num(value.w);
  const h = num(value.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Clamp a normalised rect fully inside the 0..1 frame: origin first, then size against what's left. */
export function clampRect(r: Rect): Rect {
  const x = clamp(r.x, 0, 1 - MIN_RECT_SIZE);
  const y = clamp(r.y, 0, 1 - MIN_RECT_SIZE);
  return {
    x,
    y,
    w: clamp(r.w, MIN_RECT_SIZE, 1 - x),
    h: clamp(r.h, MIN_RECT_SIZE, 1 - y),
  };
}

/**
 * The bounding box of an arrow's two endpoints, clamped into the frame. Never
 * zero-area: `clampRect` floors both sides, so an axis-aligned arrow still has
 * a grabbable, drawable rect.
 */
export function arrowRect(from: Point, to: Point): Rect {
  return clampRect({
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  });
}

/**
 * The bounding box of a freehand stroke, clamped into the frame — the `draw`
 * counterpart to `arrowRect`, and never zero-area for the same reason. Null for
 * an empty path, which means "keep whatever rect you already had".
 */
export function pointsRect(points: readonly Point[]): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return clampRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
}

/** A normalised point, clamped into 0..1, or null when either axis is missing. */
function parsePoint(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  const x = num(value.x);
  const y = num(value.y);
  if (x === null || y === null) return null;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/**
 * A camera keyframe's `pan`, clamped into 0..1. Unlike `parsePoint` a
 * half-written pan survives: the axis the author did set is kept and the other
 * fills in at centred, which is what an absent pan means anyway. Only a value
 * with no usable axis at all is dropped (returns null → the field stays absent).
 */
function parsePan(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  const x = num(value.x);
  const y = num(value.y);
  if (x === null && y === null) return null;
  return { x: clamp(x ?? 0.5, 0, 1), y: clamp(y ?? 0.5, 0, 1) };
}

function parseCamera(value: unknown): CameraTrack | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const shape = pick(value.shape, SHAPES, "circle");
  const keyframes: CameraKeyframe[] = [];
  for (const raw of asArray(value.keyframes)) {
    if (keyframes.length >= MAX_KEYFRAMES) break;
    if (!isRecord(raw)) continue;
    const t = num(raw.t);
    const rect = parseRect(raw.rect);
    if (t === null || t < 0 || !rect) continue;
    const mode: CameraMode =
      raw.mode === "full" ? "full" : raw.mode === "hidden" ? "hidden" : "bubble";
    const kf: CameraKeyframe = { t, mode, rect: clampRect(rect) };
    // Only a shape the settings sanitizer recognises survives; an absent or
    // bogus one falls back to the track's `shape` at sample time.
    if (typeof raw.shape === "string" && (SHAPES as string[]).includes(raw.shape)) {
      kf.shape = pick(raw.shape, SHAPES, shape);
    }
    const pan = parsePan(raw.pan);
    if (pan) kf.pan = pan;
    keyframes.push(kf);
  }
  keyframes.sort((a, b) => a.t - b.t);
  if (keyframes.length === 0) return undefined;
  keyframes[0] = { ...keyframes[0], t: 0 };
  return { shape, mirror: value.mirror === true, keyframes };
}

function parseSpan(value: unknown): { start: number; end: number } | null {
  if (!isRecord(value)) return null;
  const start = num(value.start);
  const end = num(value.end);
  if (start === null || end === null) return null;
  if (start < 0 || end <= start) return null;
  return { start, end };
}

function parseClick(value: unknown): ClickMark | null {
  if (!isRecord(value)) return null;
  const t = num(value.t);
  const x = num(value.x);
  const y = num(value.y);
  if (t === null || t < 0 || x === null || y === null) return null;
  // An absent `on` reads as on: the lane is seeded from the click track with
  // every mark live, and only a deliberate toggle writes `false`.
  return { t, x: clamp(x, 0, 1), y: clamp(y, 0, 1), on: value.on !== false };
}

function parseCursor(value: unknown): CursorConfig | undefined {
  if (!isRecord(value)) return undefined;
  const size = num(value.size);
  return {
    style: pick(value.style, CURSOR_STYLES, DEFAULT_CURSOR.style),
    size: size === null ? DEFAULT_CURSOR.size : clamp(size, MIN_CURSOR_SIZE, MAX_CURSOR_SIZE),
  };
}

function parseMarker(value: unknown): Marker | null {
  if (!isRecord(value)) return null;
  const t = num(value.t);
  if (t === null || t < 0) return null;
  const marker: Marker = { t };
  if (typeof value.label === "string") marker.label = value.label;
  return marker;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Total validator: never throws, never returns a partially-valid shape.
 * Anything unrecognised is dropped, so a hand-edited or future-versioned
 * jsonb blob degrades to "no edits" rather than breaking playback.
 */
export function parseEdits(input: unknown): VideoEdits {
  if (!isRecord(input)) return emptyEdits();
  if (input.version !== 1) return emptyEdits();

  const cuts: Cut[] = [];
  for (const raw of asArray(input.cuts)) {
    if (cuts.length >= MAX_CUTS) break;
    const span = parseSpan(raw);
    if (span) cuts.push(span);
  }

  const zooms: Zoom[] = [];
  for (const raw of asArray(input.zooms)) {
    if (zooms.length >= MAX_ZOOMS) break;
    const span = parseSpan(raw);
    const rect = isRecord(raw) ? parseRect(raw.rect) : null;
    if (!span || !rect) continue;
    const zoom: Zoom = { ...span, rect: clampRect(rect) };
    const ramp = isRecord(raw) ? num(raw.ramp) : null;
    if (ramp !== null) zoom.ramp = clamp(ramp, 0, MAX_RAMP_S);
    // `follow: true` is the pre-addendum spelling; it migrates to `kind` here
    // and is never written back out. `follow: false` and an absent flag both
    // mean static, which is also what an absent `kind` means.
    if (isRecord(raw)) {
      if (raw.kind === "follow" || raw.follow === true) zoom.kind = "follow";
      else if (raw.kind === "static") zoom.kind = "static";
    }
    zooms.push(zoom);
  }

  const overlays: Overlay[] = [];
  for (const raw of asArray(input.overlays)) {
    if (overlays.length >= MAX_OVERLAYS) break;
    if (!isRecord(raw)) continue;
    const rawType = raw.type;
    if (typeof rawType !== "string") continue;
    const type = LEGACY_OVERLAY_TYPES[rawType] ?? (rawType as OverlayType);
    if (!OVERLAY_TYPES.includes(type)) continue;
    const span = parseSpan(raw);
    const rect = parseRect(raw.rect);
    if (!span || !rect) continue;
    const overlay: Overlay = { type, ...span, rect: clampRect(rect) };
    const n = num(raw.n);
    // A step badge is a counting number: it is drawn as text, so a 0, a -2 or
    // a 3.7 would all render as themselves.
    if (n !== null) overlay.n = Math.max(1, Math.round(n));
    if (typeof raw.color === "string") overlay.color = raw.color;
    if (POINT_PAIR_TYPES.includes(type)) {
      // The endpoints are the arrow (or line); an old or hand-written entry
      // with only a rect becomes that rect's diagonal, and the rect is then
      // re-derived so the two can never disagree.
      const from = parsePoint(raw.from) ?? { x: overlay.rect.x, y: overlay.rect.y };
      const to = parsePoint(raw.to) ?? { x: overlay.rect.x + overlay.rect.w, y: overlay.rect.y + overlay.rect.h };
      overlay.from = from;
      overlay.to = to;
      overlay.rect = arrowRect(from, to);
      const ctrl = parsePoint(raw.ctrl);
      if (ctrl) overlay.ctrl = ctrl;
    }
    if (type === "draw") {
      const points: Point[] = [];
      for (const rawPoint of asArray(raw.points)) {
        if (points.length >= MAX_DRAW_POINTS) break;
        const point = parsePoint(rawPoint);
        if (point) points.push(point);
      }
      // Same invariant as an arrow's endpoints: the path is the truth and the
      // rect is its bounding box. A stroke with no usable points keeps the
      // stored rect rather than collapsing to a dot.
      const bounds = pointsRect(points);
      if (bounds) {
        overlay.points = points;
        overlay.rect = bounds;
      }
    }
    if (typeof raw.fill === "boolean") overlay.fill = raw.fill;
    if (typeof raw.style === "string" && (ARROW_STYLES as string[]).includes(raw.style)) {
      overlay.style = raw.style as ArrowStyle;
    }
    // Truncated, not dropped: a caption that ran long is still worth keeping.
    if (typeof raw.text === "string") overlay.text = raw.text.slice(0, MAX_TEXT);
    if (typeof raw.bg === "string") overlay.bg = raw.bg;
    const size = num(raw.size);
    if (size !== null) overlay.size = clamp(size, MIN_TEXT_SIZE, MAX_TEXT_SIZE);
    if (typeof raw.src === "string") {
      const cap = raw.src.startsWith("data:") ? MAX_OVERLAY_DATA_SRC : MAX_OVERLAY_SRC;
      if (raw.src.length <= cap) overlay.src = raw.src;
    }
    const thickness = num(raw.thickness);
    if (thickness !== null) overlay.thickness = clamp(thickness, 0, MAX_OVERLAY_THICKNESS);
    const opacity = num(raw.opacity);
    if (opacity !== null) overlay.opacity = clamp(opacity, 0, 1);
    overlays.push(overlay);
  }

  // Sorted BEFORE the cap, not after: capping first keeps whichever marks
  // happened to come first in the blob and silently drops everything past
  // them, so an unsorted (or reversed) list would lose the end of the take
  // rather than thinning it. Sorting first makes the cap "the first N by time".
  const markers: Marker[] = [];
  for (const raw of asArray(input.markers)) {
    const marker = parseMarker(raw);
    if (marker) markers.push(marker);
  }
  markers.sort((a, b) => a.t - b.t);
  markers.length = Math.min(markers.length, MAX_MARKERS);

  const out: VideoEdits = { version: 1, cuts, crop: parseRect(input.crop), zooms, overlays, markers };
  const trim = parseSpan(input.trim);
  if (trim) out.trim = trim;
  if (isRecord(input.frame)) out.frame = sanitizeFrame(input.frame);
  const camera = parseCamera(input.camera);
  if (camera !== undefined) out.camera = camera;
  const offset = num(input.cameraOffsetMs);
  if (offset !== null) out.cameraOffsetMs = clamp(offset, -MAX_CAMERA_OFFSET_MS, MAX_CAMERA_OFFSET_MS);

  if (Array.isArray(input.clicks)) {
    const clicks: ClickMark[] = [];
    for (const raw of input.clicks) {
      const click = parseClick(raw);
      if (click) clicks.push(click);
    }
    // Same rule as `markers` above: sort, then cap.
    clicks.sort((a, b) => a.t - b.t);
    clicks.length = Math.min(clicks.length, MAX_CLICKS);
    if (clicks.length > 0) out.clicks = clicks;
  }
  const cursor = parseCursor(input.cursor);
  if (cursor) out.cursor = cursor;
  if (typeof input.motionBlur === "boolean") out.motionBlur = input.motionBlur;
  return out;
}

export function isEmptyEdits(edits: VideoEdits): boolean {
  return (
    edits.cuts.length === 0 &&
    edits.crop === null &&
    edits.zooms.length === 0 &&
    edits.overlays.length === 0 &&
    edits.markers.length === 0
  );
}

/**
 * True when `edits` has anything that actually needs to be drawn on the
 * canvas overlay. Markers render as a separate tick bar, not on the canvas,
 * so a markers-only list is excluded — `edit-player.tsx` uses this (rather
 * than `isEmptyEdits`) to decide whether to run its rAF draw loop.
 *
 * Deliberately ignores `trim`/`frame`/`camera`: those are burned into the
 * pixels by the staging export, so the *uploaded* file already reflects
 * them — `edit-player.tsx` must not re-apply them on top of an already
 * rendered video.
 */
export function hasDrawableEdits(edits: VideoEdits): boolean {
  return (
    edits.cuts.length > 0 ||
    edits.crop !== null ||
    edits.zooms.length > 0 ||
    edits.overlays.length > 0
  );
}
