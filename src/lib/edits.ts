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

export type Zoom = { start: number; end: number; rect: Rect; ramp?: number };

export type OverlayType = "blur" | "callout" | "underline" | "highlight" | "click";

export type Overlay = {
  type: OverlayType;
  start: number;
  end: number;
  rect: Rect;
  /** Callout number badge. */
  n?: number;
  /** CSS colour for underline/highlight. */
  color?: string;
};

/** A recorder-placed timestamp marker (seconds from the start of the video). */
export type Marker = { t: number; label?: string };

export type CameraMode = "bubble" | "full";
export type CameraKeyframe = { t: number; mode: CameraMode; rect: Rect };
export type CameraTrack = {
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
const OVERLAY_TYPES: OverlayType[] = ["blur", "callout", "underline", "highlight", "click"];

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
function clampRect(r: Rect): Rect {
  const x = clamp(r.x, 0, 1 - MIN_RECT_SIZE);
  const y = clamp(r.y, 0, 1 - MIN_RECT_SIZE);
  return {
    x,
    y,
    w: clamp(r.w, MIN_RECT_SIZE, 1 - x),
    h: clamp(r.h, MIN_RECT_SIZE, 1 - y),
  };
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
    const mode: CameraMode = raw.mode === "full" ? "full" : "bubble";
    keyframes.push({ t, mode, rect: clampRect(rect) });
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
    zooms.push(zoom);
  }

  const overlays: Overlay[] = [];
  for (const raw of asArray(input.overlays)) {
    if (overlays.length >= MAX_OVERLAYS) break;
    if (!isRecord(raw)) continue;
    const type = raw.type;
    if (typeof type !== "string") continue;
    if (!OVERLAY_TYPES.includes(type as OverlayType)) continue;
    const span = parseSpan(raw);
    const rect = parseRect(raw.rect);
    if (!span || !rect) continue;
    const overlay: Overlay = { type: type as OverlayType, ...span, rect };
    const n = num(raw.n);
    if (n !== null) overlay.n = n;
    if (typeof raw.color === "string") overlay.color = raw.color;
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
