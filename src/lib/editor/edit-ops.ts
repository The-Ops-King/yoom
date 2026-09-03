import {
  DEFAULT_CURSOR,
  MAX_CAMERA_OFFSET_MS,
  MAX_CLICKS,
  MAX_CURSOR_SIZE,
  MAX_CUTS,
  MAX_DRAW_POINTS,
  MAX_OVERLAYS,
  MIN_CURSOR_SIZE,
  arrowRect,
  clampRect,
  pointsRect,
  type CameraKeyframe,
  type CameraTrack,
  type ClickMark,
  type CursorConfig,
  type CursorStyle,
  type Cut,
  type Overlay,
  type Point,
  type VideoEdits,
  type Zoom,
  type ZoomKind,
} from "@/lib/edits";
import { insertZoom } from "./zoom";
import type { FrameConfig } from "@/lib/recording/types";
import { addCut as mergeCut } from "./cuts";
import { removeKeyframe, upsertKeyframe } from "./camera-track";

/**
 * Smallest a trim/overlay/zoom span may shrink to when an edit would
 * otherwise collapse `end` onto or past `start`.
 */
const MIN_SPAN = 0.1;

/**
 * Set the trim in/out points, clamped into `[0, duration]` and ordered so
 * `end >= start + MIN_SPAN`. A non-positive or non-finite `duration` leaves
 * `e` untouched (same reference) — there is no valid range to clamp into.
 * (Deliberately does not re-clamp `end` against `duration` afterwards: doing
 * so would void the `MIN_SPAN` floor when `start` sits within `MIN_SPAN` of
 * `duration`.)
 */
export function setTrim(e: VideoEdits, duration: number, trim: { start: number; end: number }): VideoEdits {
  if (!(duration > 0)) return e;
  const start = Math.max(0, Math.min(duration, Math.min(trim.start, trim.end)));
  const end = Math.max(start + MIN_SPAN, Math.min(duration, Math.max(trim.start, trim.end)));
  return { ...e, trim: { start, end } };
}

/**
 * Merge `cut` into the cut list via `cuts.ts`'s sorted/disjoint merge,
 * capped at `MAX_CUTS`. A rejected (zero/negative-width) span returns `e`
 * unchanged (same reference). Over the cap, the newly merged cut always
 * survives — the oldest *other* cut(s) are dropped instead, mirroring how
 * `insertZoom` handles its own cap.
 */
export function addCut(e: VideoEdits, cut: Cut): VideoEdits {
  const merged = mergeCut(e.cuts, cut);
  if (merged === e.cuts) return e;
  if (merged.length <= MAX_CUTS) return { ...e, cuts: merged };
  const newCut = merged.find((c) => c.start <= cut.start && c.end >= cut.end) ?? merged[merged.length - 1];
  let excess = merged.length - MAX_CUTS;
  const kept: Cut[] = [];
  for (const c of merged) {
    if (excess > 0 && c !== newCut) {
      excess--;
      continue;
    }
    kept.push(c);
  }
  return { ...e, cuts: kept };
}

/** Remove the cut at `index`. An out-of-range index returns `e` unchanged (same reference). */
export function removeCut(e: VideoEdits, index: number): VideoEdits {
  if (index < 0 || index >= e.cuts.length) return e;
  return { ...e, cuts: e.cuts.filter((_, i) => i !== index) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clampPoint = (p: Point): Point => ({ x: clamp01(p.x), y: clamp01(p.y) });

/**
 * The next free step number: `max(existing step n) + 1`, never a plain count
 * of existing steps — so removing a middle step can never leave two overlays
 * sharing a number.
 */
function nextStepNumber(overlays: readonly Overlay[]): number {
  return overlays.reduce((m, o) => (o.type === "step" && typeof o.n === "number" ? Math.max(m, o.n) : m), 0) + 1;
}

/**
 * Restore the derived-`rect` invariants from `edits.ts`.
 *
 * An arrow or line: `from`/`to` are the truth and `rect` is their bounding box
 * (one arriving with no endpoints takes the rect's diagonal), and a curved
 * arrow's `ctrl` is clamped into the frame alongside them. A `draw`: `points`
 * are the truth and `rect` is *their* bounding box — an empty path keeps the
 * rect it came with rather than collapsing to a dot. Everything else passes
 * through untouched, by reference.
 */
function withDerivedRect(o: Overlay): Overlay {
  if (o.type === "draw") {
    if (!o.points || o.points.length === 0) return o;
    const points = o.points.slice(0, MAX_DRAW_POINTS).map(clampPoint);
    return { ...o, points, rect: pointsRect(points) ?? o.rect };
  }
  if (o.type !== "arrow" && o.type !== "line") return o;
  const from = clampPoint(o.from ?? { x: o.rect.x, y: o.rect.y });
  const to = clampPoint(o.to ?? { x: o.rect.x + o.rect.w, y: o.rect.y + o.rect.h });
  const next: Overlay = { ...o, from, to, rect: arrowRect(from, to) };
  if (next.ctrl) next.ctrl = clampPoint(next.ctrl);
  return next;
}

/**
 * Append an overlay, clamped into range (`start >= 0`, `end > start` by
 * `MIN_SPAN`, `rect` clamped into the 0..1 frame via `clampRect`). A step with
 * no explicit `n` is numbered by `nextStepNumber`; an arrow's or line's `rect`
 * is re-derived from its endpoints and a draw's from its `points`. Returns `e`
 * unchanged once `MAX_OVERLAYS` is reached.
 */
export function addOverlay(e: VideoEdits, overlay: Overlay): VideoEdits {
  if (e.overlays.length >= MAX_OVERLAYS) return e;
  const next = { ...overlay };
  next.start = Math.max(0, next.start);
  if (next.end <= next.start) next.end = next.start + MIN_SPAN;
  next.rect = clampRect(next.rect);
  if (next.type === "step" && next.n === undefined) next.n = nextStepNumber(e.overlays);
  return { ...e, overlays: [...e.overlays, withDerivedRect(next)] };
}

/**
 * Patch the overlay at `index`, re-clamping the same way `addOverlay` does
 * (`start >= 0`, `end > start` by `MIN_SPAN`, `rect` clamped into range). An
 * out-of-range index returns `e` unchanged (same reference).
 *
 * Arrows and lines keep the `edits.ts` invariant: patching `from`/`to`
 * re-derives the bounding box, and patching only `rect` (the box drag the
 * preview does for every other type) TRANSLATES both endpoints by the origin
 * delta rather than letting the two representations drift apart. A `draw`
 * overlay's `rect` is re-derived from its `points` the same way.
 */
export function updateOverlay(e: VideoEdits, index: number, patch: Partial<Overlay>): VideoEdits {
  if (index < 0 || index >= e.overlays.length) return e;
  return {
    ...e,
    overlays: e.overlays.map((o, i) => {
      if (i !== index) return o;
      const merged = { ...o, ...patch };
      merged.start = Math.max(0, merged.start);
      if (merged.end <= merged.start) merged.end = merged.start + MIN_SPAN;
      merged.rect = clampRect(merged.rect);
      if ((merged.type === "arrow" || merged.type === "line") && patch.rect && !patch.from && !patch.to) {
        const a = o.from ?? { x: o.rect.x, y: o.rect.y };
        const b = o.to ?? { x: o.rect.x + o.rect.w, y: o.rect.y + o.rect.h };
        // Clamp the TRANSLATION against both endpoints at once, not each
        // endpoint on its own: clamping them separately would shorten the
        // arrow (or swing it) as it is dragged into a wall instead of just
        // stopping it there.
        const span = (lo: number, hi: number, d: number) => Math.min(1 - hi, Math.max(-lo, d));
        const dx = span(Math.min(a.x, b.x), Math.max(a.x, b.x), merged.rect.x - o.rect.x);
        const dy = span(Math.min(a.y, b.y), Math.max(a.y, b.y), merged.rect.y - o.rect.y);
        merged.from = { x: a.x + dx, y: a.y + dy };
        merged.to = { x: b.x + dx, y: b.y + dy };
      }
      return withDerivedRect(merged);
    }),
  };
}

/** Remove the overlay at `index`. An out-of-range index returns `e` unchanged (same reference). */
export function removeOverlay(e: VideoEdits, index: number): VideoEdits {
  if (index < 0 || index >= e.overlays.length) return e;
  return { ...e, overlays: e.overlays.filter((_, i) => i !== index) };
}

/** Replace the burned-in frame config. */
export const setFrame = (e: VideoEdits, frame: FrameConfig): VideoEdits => ({ ...e, frame });

/** Replace the camera track wholesale, or clear it with `null`. */
export const setCamera = (e: VideoEdits, camera: CameraTrack | null): VideoEdits => ({ ...e, camera });

/** Upsert a camera keyframe at `t` via `camera-track.ts`. A no-op (returns `e`) when there is no camera track. */
export function upsertCameraKeyframe(e: VideoEdits, t: number, patch: Partial<Omit<CameraKeyframe, "t">>): VideoEdits {
  return e.camera ? { ...e, camera: upsertKeyframe(e.camera, t, patch) } : e;
}

/** Remove the camera keyframe nearest `t` via `camera-track.ts`. A no-op (returns `e`) when there is no camera track. */
export function removeCameraKeyframe(e: VideoEdits, t: number): VideoEdits {
  return e.camera ? { ...e, camera: removeKeyframe(e.camera, t) } : e;
}

/**
 * Set the camera/screen sync offset, clamped to
 * `[-MAX_CAMERA_OFFSET_MS, MAX_CAMERA_OFFSET_MS]` and rounded. Returns `e`
 * unchanged (same reference) when the clamped value equals the current one.
 */
export function setCameraOffset(e: VideoEdits, ms: number): VideoEdits {
  const clamped = Math.max(-MAX_CAMERA_OFFSET_MS, Math.min(MAX_CAMERA_OFFSET_MS, Math.round(ms)));
  if (clamped === (e.cameraOffsetMs ?? 0)) return e;
  return { ...e, cameraOffsetMs: clamped };
}

/**
 * Insert a zoom via `insertZoom`'s disjoint-list logic (which itself keeps
 * the newly inserted zoom over `MAX_ZOOMS`, dropping the oldest others). A
 * rejected (zero/negative-width) span returns `e` unchanged (same
 * reference), detected by comparing `insertZoom`'s result to the input
 * array by reference.
 */
export function addZoom(e: VideoEdits, zoom: Zoom): VideoEdits {
  const zooms = insertZoom(e.zooms, zoom);
  return zooms === e.zooms ? e : { ...e, zooms };
}

/** Remove the zoom at `index`. An out-of-range index returns `e` unchanged (same reference). */
export function removeZoom(e: VideoEdits, index: number): VideoEdits {
  if (index < 0 || index >= e.zooms.length) return e;
  return { ...e, zooms: e.zooms.filter((_, i) => i !== index) };
}

/**
 * Patch the zoom at `index` and re-insert it so it stays disjoint from the
 * rest of the list (any field not in `patch`, including `ramp`, carries
 * over from the current zoom). An out-of-range index returns `e` unchanged
 * (same reference).
 */
export function updateZoom(e: VideoEdits, index: number, patch: Partial<Zoom>): VideoEdits {
  const cur = e.zooms[index];
  if (!cur) return e;
  const next = { ...cur, ...patch };
  if (next.end <= next.start) next.end = next.start + MIN_SPAN;
  return { ...e, zooms: insertZoom(e.zooms.filter((_, i) => i !== index), next) };
}

/**
 * Set the zoom's kind, re-inserting it so it stays disjoint from the rest of
 * the list and preserving every other field. Also drops the legacy `follow`
 * flag, so a migrated zoom can never carry two spellings at once. An
 * out-of-range index, or a kind the zoom already has, returns `e` unchanged
 * (same reference).
 */
export function setZoomKind(e: VideoEdits, index: number, kind: ZoomKind): VideoEdits {
  const cur = e.zooms[index];
  if (!cur) return e;
  if ((cur.kind ?? "static") === kind && cur.follow === undefined) return e;
  const next: Zoom = { ...cur, kind };
  delete next.follow;
  return { ...e, zooms: insertZoom(e.zooms.filter((_, i) => i !== index), next) };
}

/** One click mark, clamped into the frame. `t` is left alone — it indexes the source. */
const normalizeClick = (c: ClickMark): ClickMark => ({ t: c.t, x: clamp01(c.x), y: clamp01(c.y), on: c.on === true });

function sameClicks(a: readonly ClickMark[] | undefined, b: readonly ClickMark[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((c, i) => c.t === b[i].t && c.x === b[i].x && c.y === b[i].y && c.on === b[i].on);
}

/**
 * Replace the clicks lane: sorted by `t`, `x`/`y` clamped into the frame and
 * capped at `MAX_CLICKS`. Returns `e` unchanged (same reference) when the
 * normalised list matches the one already stored.
 */
export function setClicks(e: VideoEdits, clicks: readonly ClickMark[]): VideoEdits {
  const next = clicks.map(normalizeClick).sort((a, b) => a.t - b.t).slice(0, MAX_CLICKS);
  return sameClicks(e.clicks, next) ? e : { ...e, clicks: next };
}

/** Flip one click's `on`. An out-of-range index (or no lane) returns `e` unchanged (same reference). */
export function toggleClick(e: VideoEdits, index: number): VideoEdits {
  const cur = e.clicks?.[index];
  if (!cur) return e;
  return { ...e, clicks: e.clicks!.map((c, i) => (i === index ? { ...c, on: !c.on } : c)) };
}

/**
 * Turn every click on the lane on or off ("All on" / "All off"). Returns `e`
 * unchanged (same reference) when the lane is empty or already all that way.
 */
export function setAllClicks(e: VideoEdits, on: boolean): VideoEdits {
  const clicks = e.clicks;
  if (!clicks || clicks.length === 0) return e;
  if (clicks.every((c) => c.on === on)) return e;
  return { ...e, clicks: clicks.map((c) => (c.on === on ? c : { ...c, on })) };
}

/**
 * Set how the cursor is drawn: an unrecognised `style` falls back to the
 * default and `size` is clamped into `MIN_CURSOR_SIZE..MAX_CURSOR_SIZE`.
 * Returns `e` unchanged (same reference) when nothing moves.
 */
export function setCursor(e: VideoEdits, cursor: CursorConfig): VideoEdits {
  const styles: CursorStyle[] = ["none", "real", "smooth"];
  const next: CursorConfig = {
    style: styles.includes(cursor.style) ? cursor.style : DEFAULT_CURSOR.style,
    size: Math.min(MAX_CURSOR_SIZE, Math.max(MIN_CURSOR_SIZE, cursor.size)),
  };
  if (e.cursor && e.cursor.style === next.style && e.cursor.size === next.size) return e;
  return { ...e, cursor: next };
}

/**
 * Toggle the zoom-motion blur. Returns `e` unchanged (same reference) only
 * when the flag is already stored at that value — an absent flag means "the
 * default", so setting it writes the value out explicitly.
 */
export function setMotionBlur(e: VideoEdits, on: boolean): VideoEdits {
  return e.motionBlur === on ? e : { ...e, motionBlur: on };
}
