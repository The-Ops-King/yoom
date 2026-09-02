/**
 * Non-destructive edit decision list stored in `videos.edits` (jsonb).
 *
 * Phase 3 only persists and plumbs this through; nothing renders it yet. The
 * proposed Phase 5 editor draws it on the canvas overlay in `edit-player.tsx`.
 *
 * All times are seconds from the start of the source video. All rects are
 * normalised to the video frame (0..1) so they survive any display size.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export type Cut = { start: number; end: number };

export type Zoom = { start: number; end: number; rect: Rect };

export type OverlayType = "blur" | "callout" | "underline" | "highlight";

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

export type VideoEdits = {
  version: 1;
  cuts: Cut[];
  crop: Rect | null;
  zooms: Zoom[];
  overlays: Overlay[];
  markers: Marker[];
};

export const EMPTY_EDITS: VideoEdits = {
  version: 1,
  cuts: [],
  crop: null,
  zooms: [],
  overlays: [],
  markers: [],
};

const OVERLAY_TYPES: OverlayType[] = ["blur", "callout", "underline", "highlight"];

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
  if (!isRecord(input)) return EMPTY_EDITS;
  if (input.version !== 1) return EMPTY_EDITS;

  const cuts: Cut[] = [];
  for (const raw of asArray(input.cuts)) {
    const span = parseSpan(raw);
    if (span) cuts.push(span);
  }

  const zooms: Zoom[] = [];
  for (const raw of asArray(input.zooms)) {
    const span = parseSpan(raw);
    const rect = isRecord(raw) ? parseRect(raw.rect) : null;
    if (span && rect) zooms.push({ ...span, rect });
  }

  const overlays: Overlay[] = [];
  for (const raw of asArray(input.overlays)) {
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
    const marker = parseMarker(raw);
    if (marker) markers.push(marker);
  }
  markers.sort((a, b) => a.t - b.t);

  return {
    version: 1,
    cuts,
    crop: parseRect(input.crop),
    zooms,
    overlays,
    markers,
  };
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
