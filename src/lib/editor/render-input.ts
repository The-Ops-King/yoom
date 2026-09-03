/**
 * The input layer: everything the desktop shell's global hooks captured, drawn
 * on top of the frame — click ripples, key-cap badges, and the synthetic
 * cursor — plus the zoom's motion blur, which is not drawn here but is sized
 * here (`motionOffsets`) so the geometry can be tested without a canvas.
 *
 * Coordinates. Clicks and the cursor path live in normalised SOURCE space, the
 * same space as an overlay's `rect`, so they map through the active zoom
 * exactly like overlays do: `box.view` is the source rect on screen this frame
 * and `box.box` is where those pixels landed in output pixels. A key badge is
 * positioned by its overlay's `rect`, so it maps the same way.
 *
 * Everything except `drawInputLayer` is pure and unit-tested; the draw itself
 * is a thin translation of those helpers into canvas calls.
 */

import { DEFAULT_CURSOR, type ClickMark, type Overlay, type Point, type Rect } from "@/lib/edits";
import type { KeyMod, KeySample } from "@/lib/recording/types";
import type { RenderInputs } from "./render";

/** How long a click's ripple expands for, in seconds. Matches the `click` overlay. */
export const CLICK_RIPPLE_S = 0.5;

/** How long a key press stays on the badge before it is gone entirely. */
export const KEY_FADE_S = 1.2;
/** The tail of `KEY_FADE_S` spent fading out; before it the badge is fully opaque. */
const KEY_FADE_OUT_S = 0.4;
/** A bare modifier press combines with a key pressed within this many seconds. */
export const MOD_COMBINE_S = 0.3;
/** Most badges drawn at once; a fast typist would otherwise paint a paragraph. */
const MAX_BADGES = 6;

/** The synthetic cursor's height in output pixels at 1080p, before `cursor.size`. */
export const CURSOR_BASE_PX = 20;
/** The frame height `CURSOR_BASE_PX` is quoted at. */
const CURSOR_REF_H = 1080;

/** Below this centre speed (frame-widths per second) the zoom is not "moving". */
export const MOTION_MIN_SPEED = 0.5;
/** Longest a single smear tap may reach, in output pixels. */
export const MOTION_MAX_PX = 12;
/** The frame the previous view is sampled at — `zoomAt(t)` vs `zoomAt(t - MOTION_DT)`. */
export const MOTION_DT = 1 / 60;
/** Each of the three taps carries a third of the source. */
export const MOTION_ALPHA = 1 / 3;

// ---------- clicks ----------

/** The first index whose `t` is `>= at`, in an array sorted by `t`. */
function lowerBound(items: readonly { t: number }[], at: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].t < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The clicks whose ripple is on screen at `t`: switched on, and started within
 * the last `CLICK_RIPPLE_S`. `clicks` is sorted by `t` (`edit-ops.setClicks`
 * guarantees it), so this is a binary search plus a short walk.
 */
export function activeClicks(clicks: readonly ClickMark[] | undefined, t: number): ClickMark[] {
  if (!clicks || clicks.length === 0) return [];
  const out: ClickMark[] = [];
  for (let i = lowerBound(clicks, t - CLICK_RIPPLE_S); i < clicks.length; i++) {
    const c = clicks[i];
    if (c.t > t) break;
    if (c.on) out.push(c);
  }
  return out;
}

// ---------- key badges ----------

/** One keycap badge: the label to draw and how opaque it is at this instant. */
export interface KeyBadge {
  /** The rendered chord, e.g. `"⌘ ⇧ K"`. */
  label: string;
  /** 1 until the badge starts fading, then down to 0 at `KEY_FADE_S`. */
  alpha: number;
  /** The press's source time, so a caller can key on it. */
  t: number;
}

/** Modifier symbols, in the order macOS prints them after ⌘ leads. */
const MOD_SYMBOL: Record<KeyMod, string> = { meta: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };
const MOD_ORDER: KeyMod[] = ["meta", "ctrl", "alt", "shift"];

/** The modifier a bare press names, or null for an ordinary key. */
function modOf(key: string): KeyMod | null {
  switch (key) {
    case "Meta":
    case "Command":
    case "Cmd":
      return "meta";
    case "Control":
    case "Ctrl":
      return "ctrl";
    case "Alt":
    case "Option":
      return "alt";
    case "Shift":
      return "shift";
    default:
      return null;
  }
}

const NAMED_KEYS: Record<string, string> = {
  " ": "Space",
  Space: "Space",
  Enter: "⏎",
  Return: "⏎",
  Escape: "Esc",
  Esc: "Esc",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** How one key prints on a cap: a letter uppercased, a named key as its glyph. */
export function keyLabel(key: string): string {
  if (NAMED_KEYS[key]) return NAMED_KEYS[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function fadeAt(age: number): number {
  const a = (KEY_FADE_S - age) / KEY_FADE_OUT_S;
  return a > 1 ? 1 : a < 0 ? 0 : a;
}

/**
 * The badges to show at `t`, oldest first — the caller draws them left to
 * right so the newest sits at the right.
 *
 * A bare modifier press is NOT a badge of its own when a key follows it within
 * `MOD_COMBINE_S`: it folds into that key's chord instead, which is what turns
 * ⌘ then ⇧ then K into one "⌘ ⇧ K" rather than three flashes. A modifier that
 * is still alone at `t` does get its own badge — you are holding it, and seeing
 * that is the point.
 *
 * Pure and idempotent on the window: passing the whole take gives the same
 * answer as passing `keysAt(t)`'s slice, so the sampler is only an optimisation.
 */
export function keyBadgesAt(keys: readonly KeySample[], t: number): KeyBadge[] {
  const out: KeyBadge[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k.t > t) break;
    const age = t - k.t;
    if (age > KEY_FADE_S) continue;
    const self = modOf(k.key);
    const next = keys[i + 1];
    // Folded into the next press's chord — drawn there, not here.
    if (self && next && next.t <= t && next.t - k.t <= MOD_COMBINE_S) continue;
    const mods = new Set<KeyMod>(k.mods);
    if (self) mods.add(self);
    // Modifiers pressed just before this key belong to it, even when the hook
    // did not report them in `mods` (it reports the OS's view, which can lag).
    for (let j = i - 1; j >= 0; j--) {
      const prev = keys[j];
      if (k.t - prev.t > MOD_COMBINE_S) break;
      const m = modOf(prev.key);
      if (!m) break;
      mods.add(m);
    }
    const parts = MOD_ORDER.filter((m) => mods.has(m)).map((m) => MOD_SYMBOL[m]);
    if (!self) parts.push(keyLabel(k.key));
    out.push({ label: parts.join(" "), alpha: fadeAt(age), t: k.t });
  }
  return out.length > MAX_BADGES ? out.slice(-MAX_BADGES) : out;
}

/**
 * A sampler bound to one key track: the presses that can still be on screen at
 * `t`, in `O(log n)`. The window reaches `MOD_COMBINE_S` further back than the
 * fade so `keyBadgesAt` can still see the modifier in front of the oldest badge.
 */
export function createKeySampler(keys: readonly KeySample[]): (t: number) => KeySample[] {
  if (keys.length === 0) return () => [];
  const sorted = keys.every((k, i) => i === 0 || keys[i - 1].t <= k.t)
    ? keys
    : [...keys].sort((a, b) => a.t - b.t);
  return (t: number) => {
    const from = lowerBound(sorted, t - KEY_FADE_S - MOD_COMBINE_S);
    const to = lowerBound(sorted, t);
    // `lowerBound(t)` excludes a press exactly at `t`; include it.
    let end = to;
    while (end < sorted.length && sorted[end].t <= t) end++;
    return from >= end ? [] : sorted.slice(from, end);
  };
}

// ---------- synthetic cursor ----------

/**
 * The macOS arrow as a closed polygon, normalised so the tip is the origin and
 * the whole shape is one unit tall. Scaled by the caller; nothing here depends
 * on a canvas, so the geometry is testable.
 */
const CURSOR_POINTS: readonly Point[] = Object.freeze([
  { x: 0, y: 0 },
  { x: 0, y: 0.75 },
  { x: 0.185, y: 0.575 },
  { x: 0.3, y: 0.87 },
  { x: 0.44, y: 0.81 },
  { x: 0.325, y: 0.52 },
  { x: 0.56, y: 0.52 },
]);

export function cursorPath(): readonly Point[] {
  return CURSOR_POINTS;
}

/** The synthetic cursor's height in output pixels for a frame `h` px tall. */
export function cursorHeightPx(h: number, size: number): number {
  return CURSOR_BASE_PX * (h / CURSOR_REF_H) * size;
}

// ---------- motion blur ----------

export interface MotionOffset {
  dx: number;
  dy: number;
}

/**
 * The three source-draw offsets for the zoom's motion blur, or an empty array
 * when the view is not moving fast enough to be worth smearing.
 *
 * `view` is the source rect shown now and `prevView` the one shown `dt`
 * earlier (`zoomAt(t)` and `zoomAt(t - MOTION_DT)`). Speed is the CENTRE's, in
 * frame-widths per second — the same unit both axes are measured in, so a
 * vertical pan and a horizontal one of the same visual length blur alike.
 *
 * The smear length is how far the view actually moved in one frame, in output
 * pixels, capped at `MOTION_MAX_PX`; the taps are −1, 0, +1 along the motion
 * vector and the caller draws each at `MOTION_ALPHA`.
 */
export function motionOffsets(view: Rect, prevView: Rect, W: number, dt = MOTION_DT): MotionOffset[] {
  if (dt <= 0) return [];
  const dcx = view.x + view.w / 2 - (prevView.x + prevView.w / 2);
  const dcy = view.y + view.h / 2 - (prevView.y + prevView.h / 2);
  const dist = Math.hypot(dcx, dcy);
  if (!Number.isFinite(dist) || dist / dt <= MOTION_MIN_SPEED) return [];
  const px = Math.min(dist * W, MOTION_MAX_PX);
  if (px <= 0) return [];
  const ux = (dcx / dist) * px;
  const uy = (dcy / dist) * px;
  return [{ dx: -ux, dy: -uy }, { dx: 0, dy: 0 }, { dx: ux, dy: uy }];
}

// ---------- drawing ----------

/** Where the source pixels landed this frame, and what part of the source they are. */
export interface InputLayerBox {
  /** The fitted view box in output pixels — overlays use exactly this box. */
  box: Rect;
  /** The source rect on screen this frame (`zoomAt`), for mapping through the zoom. */
  view: Rect;
  /** The output canvas width, which effect sizes are quoted against. */
  W: number;
}

function measure(ctx: CanvasRenderingContext2D, text: string, fontPx: number): number {
  const m = ctx.measureText(text) as TextMetrics | undefined;
  return m && Number.isFinite(m.width) && m.width > 0 ? m.width : text.length * fontPx * 0.62;
}

function pillPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  // Safari < 16.4 (and the node test's stub context) has no `roundRect`.
  if (rr > 0 && typeof (ctx as Partial<CanvasRenderingContext2D>).roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
  } else {
    ctx.rect(x, y, w, h);
  }
}

/** The badges for one `keys` overlay, right-aligned inside its (already mapped) rect. */
function drawBadges(ctx: CanvasRenderingContext2D, badges: KeyBadge[], r: Rect): void {
  if (badges.length === 0 || r.h <= 0) return;
  const fontPx = Math.max(8, r.h * 0.55);
  const padX = fontPx * 0.5;
  const gap = fontPx * 0.35;
  ctx.font = `600 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const widths = badges.map((b) => measure(ctx, b.label, fontPx) + padX * 2);
  const total = widths.reduce((s, w) => s + w, 0) + gap * (badges.length - 1);
  // Newest at the right: lay the row out ending at the rect's right edge, and
  // never let it start before the left edge.
  let x = Math.max(r.x, r.x + r.w - total);
  const cy = r.y + r.h / 2;
  for (let i = 0; i < badges.length; i++) {
    const w = widths[i];
    ctx.save();
    ctx.globalAlpha = badges[i].alpha;
    ctx.fillStyle = "rgba(18,18,22,0.82)";
    pillPath(ctx, x, r.y, w, r.h, r.h * 0.28);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = Math.max(1, r.h * 0.04);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.fillText(badges[i].label, x + padX, cy);
    ctx.restore();
    x += w + gap;
  }
}

/** The synthetic arrow, black with a white outline, its tip at `p`. */
function drawCursor(ctx: CanvasRenderingContext2D, p: Point, h: number): void {
  if (h <= 0) return;
  const pts = cursorPath();
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = p.x + pts[i].x * h;
    const y = p.y + pts[i].y * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  // Stroke first, fill second: the white outline sits outside the black body.
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, h * 0.12);
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
}

/**
 * Draw the input layer for source time `t`. Called by `drawFrame` after the
 * overlays, inside the same clip, so a click at the edge of a zoom cannot bleed
 * onto the frame's padding.
 */
export function drawInputLayer(
  ctx: CanvasRenderingContext2D,
  inputs: RenderInputs,
  t: number,
  box: InputLayerBox,
): void {
  const { box: b, view, W } = box;
  if (view.w <= 0 || view.h <= 0 || b.w <= 0 || b.h <= 0) return;
  const zoom = 1 / view.w;
  /** A normalised SOURCE point in output pixels, through the active zoom. */
  const map = (p: Point): Point => ({
    x: b.x + ((p.x - view.x) / view.w) * b.w,
    y: b.y + ((p.y - view.y) / view.h) * b.h,
  });
  /** A normalised SOURCE rect in output pixels, likewise. */
  const mapRect = (r: Rect): Rect => ({
    x: b.x + ((r.x - view.x) / view.w) * b.w,
    y: b.y + ((r.y - view.y) / view.h) * b.h,
    w: (r.w / view.w) * b.w,
    h: (r.h / view.h) * b.h,
  });

  ctx.save();

  // Click ripples — the same expanding ring the `click` overlay draws.
  for (const c of activeClicks(inputs.edits.clicks, t)) {
    const p = Math.min(1, Math.max(0, (t - c.t) / CLICK_RIPPLE_S));
    const at = map(c);
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = "#f5c542";
    ctx.lineWidth = Math.max(2, W * 0.003);
    ctx.beginPath();
    ctx.arc(at.x, at.y, (W * 0.01 + p * W * 0.03) * zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Key badges, for every `keys` overlay whose span contains `t`.
  const keysAt = inputs.keysAt;
  if (keysAt) {
    let badges: KeyBadge[] | null = null;
    for (const o of inputs.edits.overlays as Overlay[]) {
      if (o.type !== "keys" || t < o.start || t > o.end) continue;
      // The track is the same for every span at this instant; sample once.
      badges ??= keyBadgesAt(keysAt(t), t);
      drawBadges(ctx, badges, mapRect(o.rect));
    }
  }

  // The synthetic cursor. `real` keeps whatever the capture recorded and
  // `none` draws nothing, so only `smooth` has anything to add here.
  const cursor = inputs.edits.cursor ?? DEFAULT_CURSOR;
  if (cursor.style === "smooth" && inputs.smoothCursorAt) {
    const p = inputs.smoothCursorAt(t);
    if (p) drawCursor(ctx, map(p), cursorHeightPx(b.h, cursor.size));
  }

  ctx.restore();
}
