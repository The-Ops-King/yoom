import type { BubbleShape, BubbleSize } from "../shared/ipc";

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
 * circle and square are 1:1, portrait is 9:16, rounded follows the camera
 * (16:9 for every webcam Yoom supports). `full` never gets a floating window —
 * it is camera-only mode, which has no desktop overlay — but it needs an entry
 * so the table is total.
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
 */
export function bubbleWindowSize(
  shape: BubbleShape,
  size: BubbleSize,
  displayWidthDip: number,
): { width: number; height: number } {
  // Defensive fallbacks: an unknown size or shape would otherwise multiply by
  // `undefined` and yield NaN bounds. `bubble.ts` validates IPC payloads too;
  // this is the second line of defence.
  const fraction = SIZE_FRACTION[size] ?? SIZE_FRACTION.medium;
  const aspect = BUBBLE_ASPECT[shape] ?? BUBBLE_ASPECT.circle;
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
