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
 * `follow` (desktop takes with a cursor track only): `rect` gives the window
 * SIZE and its position is ignored — the centre rides the smoothed cursor path
 * instead, clamped inside the frame. See `lib/editor/cursor-path`.
 */
export type Zoom = { start: number; end: number; rect: Rect; ramp?: number; follow?: boolean };

export type OverlayType =
  | "blur"
  | "ellipse"
  | "step"
  | "underline"
  | "highlight"
  | "arrow"
  | "image"
  | "click";

/** A normalised point on the source frame (0..1 in each axis). */
export type Point = { x: number; y: number };

/**
 * ARROW REPRESENTATION (one representation, chosen once, relied on everywhere):
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
  /** Arrow tail; see the arrow note above. Arrows only. */
  from?: Point;
  /** Arrow head; see the arrow note above. Arrows only. */
  to?: Point;
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
  "ellipse",
  "step",
  "underline",
  "highlight",
  "arrow",
  "image",
  "click",
];
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
    // Only `true` is worth storing: a stored take without a cursor track falls
    // back to the rect anyway, so `follow: false` and absent mean the same.
    if (isRecord(raw) && raw.follow === true) zoom.follow = true;
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
    if (type === "arrow") {
      // The endpoints are the arrow; an old or hand-written entry with only a
      // rect becomes that rect's diagonal, and the rect is then re-derived so
      // the two can never disagree.
      const from = parsePoint(raw.from) ?? { x: overlay.rect.x, y: overlay.rect.y };
      const to = parsePoint(raw.to) ?? { x: overlay.rect.x + overlay.rect.w, y: overlay.rect.y + overlay.rect.h };
      overlay.from = from;
      overlay.to = to;
      overlay.rect = arrowRect(from, to);
    }
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

  const markers: Marker[] = [];
  for (const raw of asArray(input.markers)) {
    if (markers.length >= MAX_MARKERS) break;
    const marker = parseMarker(raw);
    if (marker) markers.push(marker);
  }
  markers.sort((a, b) => a.t - b.t);

  const out: VideoEdits = { version: 1, cuts, crop: parseRect(input.crop), zooms, overlays, markers };
  const trim = parseSpan(input.trim);
  if (trim) out.trim = trim;
  if (isRecord(input.frame)) out.frame = sanitizeFrame(input.frame);
  const camera = parseCamera(input.camera);
  if (camera !== undefined) out.camera = camera;
  const offset = num(input.cameraOffsetMs);
  if (offset !== null) out.cameraOffsetMs = clamp(offset, -MAX_CAMERA_OFFSET_MS, MAX_CAMERA_OFFSET_MS);
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
