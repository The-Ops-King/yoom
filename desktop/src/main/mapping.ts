import type { BubbleShape, BubbleSize, HudStatus } from "../shared/ipc";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bubble width as a fraction of the display width.
 *
 * DUPLICATED from `SIZE_FRACTION` in the web app's
 * `src/lib/recording/geometry.ts`. The two MUST agree: the floating window and
 * the composited bubble have to occupy the same rectangle, otherwise the
 * composited bubble stops occluding the captured pixels of the live window.
 * `mapping.test.ts` asserts the literal values so a drift in either package
 * shows up as a failing test rather than a visual artefact.
 */
export const SIZE_FRACTION: Record<BubbleSize, number> = {
  small: 0.15,
  medium: 0.22,
  large: 0.3,
};

/**
 * width / height for each shape, matching `computeBubbleRect`:
 * circle and square are 1:1, portrait is 9:16, rounded follows the live
 * camera's aspect ratio (this 16:9 entry is only the fallback used when the
 * camera aspect is not yet known — see `bubbleWindowSize`'s `cameraAspect`
 * param). `full` never gets a floating window — it is camera-only mode, which
 * has no desktop overlay — but it needs an entry so the table is total.
 */
export const BUBBLE_ASPECT: Record<BubbleShape, number> = {
  circle: 1,
  square: 1,
  rounded: 16 / 9,
  portrait: 9 / 16,
  full: 16 / 9,
};

/** Corner radius of a rounded/portrait bubble, as a fraction of its short side. */
export const BUBBLE_RADIUS_FRACTION = 0.14;

/** Smallest window we will ever create, so the bubble stays draggable. */
export const MIN_BUBBLE_PX = 120;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/**
 * The bubble window's centre, normalized to the display it sits on.
 *
 * Both `bubble` (from `BrowserWindow.getBounds()`) and `display`
 * (`Display.bounds`) are in **device-independent pixels**, so the display's
 * `scaleFactor` cancels out and must NOT be applied here. The captured frame is
 * a uniformly scaled copy of the same rectangle, which makes a normalized
 * coordinate DPR-invariant — that is exactly why the wire format is normalized.
 */
export function bubbleCentreToNormalized(
  bubble: Bounds,
  display: Bounds,
): { x: number; y: number } {
  if (display.width <= 0 || display.height <= 0) return { x: 0.5, y: 0.5 };
  const cx = bubble.x + bubble.width / 2;
  const cy = bubble.y + bubble.height / 2;
  return {
    x: clamp01((cx - display.x) / display.width),
    y: clamp01((cy - display.y) / display.height),
  };
}

/**
 * The window size that makes the live bubble line up with the composited one.
 * `displayWidthDip` is `Display.bounds.width` for the display the bubble is on.
 * `cameraAspect` (width/height) overrides the `rounded` shape's aspect ratio —
 * the web compositor uses the live camera's real aspect there instead of
 * assuming 16:9, so the floating window has to match it or self-occlusion
 * breaks for non-16:9 webcams.
 */
export function bubbleWindowSize(
  shape: BubbleShape,
  size: BubbleSize,
  displayWidthDip: number,
  cameraAspect?: number,
): { width: number; height: number } {
  // Defensive fallbacks: an unknown size or shape would otherwise multiply by
  // `undefined` and yield NaN bounds. `bubble.ts` validates IPC payloads too;
  // this is the second line of defence.
  const fraction = SIZE_FRACTION[size] ?? SIZE_FRACTION.medium;
  const aspect =
    shape === "rounded"
      ? (cameraAspect ?? BUBBLE_ASPECT.rounded)
      : (BUBBLE_ASPECT[shape] ?? BUBBLE_ASPECT.circle);
  // A non-finite display width (a display that has gone away mid-drag) is
  // treated as 0 so the minimum takes over, instead of producing NaN bounds.
  const dip = Number.isFinite(displayWidthDip) ? displayWidthDip : 0;
  // The minimum is applied to the WIDTH ONLY, then the height is derived from
  // it. Clamping both independently would silently break the aspect ratio at
  // small sizes, and the live window would stop matching the composited bubble.
  const width = Math.max(MIN_BUBBLE_PX, Math.round(dip * fraction));
  const height = Math.max(1, Math.round(width / aspect));
  return { width, height };
}

/** CSS the bubble renderer applies to its shaped container. */
export function shapeToCss(
  shape: BubbleShape,
  mirror: boolean,
): { borderRadius: string; transform: string } {
  const borderRadius =
    shape === "circle"
      ? "50%"
      // `square` and `full` are both hard-edged: `full` is camera-only mode,
      // which fills its container and never gets a rounded corner.
      : shape === "square" || shape === "full"
        ? "0px"
        : `${Math.round(BUBBLE_RADIUS_FRACTION * 100)}%`;
  return { borderRadius, transform: mirror ? "scaleX(-1)" : "none" };
}

/** The order the bubble's own shape button walks through. */
export function cycleShape(shape: BubbleShape): BubbleShape {
  switch (shape) {
    case "circle":
      return "rounded";
    case "rounded":
      return "square";
    case "square":
      return "portrait";
    default:
      // `portrait` and the unreachable `full` both wrap to the start.
      return "circle";
  }
}

/**
 * The HUD window's size in device-independent pixels. The pill itself is
 * 284×48; the window is larger so the drop shadow and the transparent rounded
 * corners have room, since a transparent window cannot paint outside itself.
 */
export const HUD_SIZE = { width: 300, height: 64 } as const;

/** Gap between the top of the work area and the top of the HUD window. */
export const HUD_TOP_INSET = 12;

/**
 * Default HUD placement: horizontally centred at the top of the WORK AREA.
 *
 * `workArea`, not `bounds` — `bounds` starts behind the menu bar, and a pill
 * tucked under the menu bar cannot be dragged. Top-centre is deliberate: it is
 * the least destructive place for a bar that macOS ≥ 14 will capture anyway
 * (see `hud.ts`), and it is where Loom parks its control bar's neighbours.
 */
export function hudDefaultBounds(workArea: Bounds): Bounds {
  const width = HUD_SIZE.width;
  const height = HUD_SIZE.height;
  // A display that has gone away mid-session reports non-finite bounds; treat
  // it as a zero-sized area at the origin rather than producing NaN bounds.
  const areaX = Number.isFinite(workArea.x) ? workArea.x : 0;
  const areaY = Number.isFinite(workArea.y) ? workArea.y : 0;
  const areaW = Number.isFinite(workArea.width) ? workArea.width : 0;
  return {
    x: Math.round(areaX + Math.max(0, (areaW - width) / 2)),
    y: Math.round(areaY + HUD_TOP_INSET),
    width,
    height,
  };
}

/**
 * Keep a window's top-left inside `workArea`, so a manual drag (see
 * `hud.ts#installHudIpc`) cannot fling the pill behind the menu bar or off the
 * bottom of the screen where it can never be grabbed back.
 *
 * The result is always integral: `BrowserWindow#setPosition` takes device-
 * independent pixels and a fractional position makes macOS blur the window.
 *
 * A window larger than the work area (or a work area reporting garbage, which
 * a display unplugged mid-drag does) clamps to the area's origin rather than
 * producing a negative range or NaN.
 */
export function clampToWorkArea(bounds: Bounds, workArea: Bounds): Bounds {
  const fin = (v: number): number => (Number.isFinite(v) ? v : 0);
  const areaX = fin(workArea.x);
  const areaY = fin(workArea.y);
  const areaW = Math.max(0, fin(workArea.width));
  const areaH = Math.max(0, fin(workArea.height));
  const width = Math.max(0, fin(bounds.width));
  const height = Math.max(0, fin(bounds.height));

  const maxX = areaX + Math.max(0, areaW - width);
  const maxY = areaY + Math.max(0, areaH - height);
  return {
    x: Math.round(Math.min(Math.max(fin(bounds.x), areaX), maxX)),
    y: Math.round(Math.min(Math.max(fin(bounds.y), areaY), maxY)),
    width: bounds.width,
    height: bounds.height,
  };
}

/** Statuses during which the recorder window is deliberately off screen. */
const HIDDEN_DURING: ReadonlySet<HudStatus> = new Set([
  "countdown",
  "recording",
  "paused",
  "stopping",
]);

/**
 * Statuses that end a take and must bring the recorder window back.
 * `rendering` is treated exactly like `staging` — both show the recorder
 * window.
 */
const RESTORES: ReadonlySet<HudStatus> = new Set([
  "staging",
  "rendering",
  "error",
  "idle",
]);

export type RecorderVisibility = "hide" | "show" | "none";

/**
 * What to do with the recorder window on a status transition.
 *
 * Loom-style "the app disappears": entering `countdown` hides it, and only a
 * transition OUT of a hidden status INTO a resolving one brings it back. The
 * `prev` guard is what stops an `idle → staging` transition (which never hid
 * anything) from yanking a window the user had deliberately hidden themselves.
 */
export function recorderWindowVisibility(
  prev: HudStatus,
  next: HudStatus,
): RecorderVisibility {
  if (prev === next) return "none";
  if (next === "countdown") return "hide";
  if (HIDDEN_DURING.has(prev) && RESTORES.has(next)) return "show";
  // A discard (⌘⇧X, or the pill's bin) goes straight back to `setup`, which
  // collapses to `other` on this channel and is in neither set above. Leaving
  // it at "none" strands the recorder window hidden with no way back. Any exit
  // from a hidden-during status is an end of take, so restore.
  if (HIDDEN_DURING.has(prev) && !HIDDEN_DURING.has(next)) return "show";
  return "none";
}
