import type {
  BubbleConfig,
  BubbleShape,
  BubbleSize,
  CropRect,
  FrameConfig,
  FrameLayout,
  Rect,
} from "./types";

/** Bubble width as a fraction of the canvas width. */
export const SIZE_FRACTION: Record<BubbleSize, number> = {
  small: 0.15,
  medium: 0.22,
  large: 0.3,
};

/** Corner radius of a `rounded`/`portrait` bubble, as a fraction of its short side. */
export const BUBBLE_RADIUS_FRACTION = 0.14;

export function clampNormalized(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/**
 * `object-fit: cover` source rect for drawing srcW×srcH into dstW×dstH.
 *
 * `pan` (0..1 per axis, default 0.5 = the historical centred crop) slides the
 * window along whichever axis has excess: 0 pins it to the source's start edge
 * (left / top), 1 to the far edge. The axis without excess has no slack, so its
 * pan component is inert — a 4:3 source in a 16:9 box ignores `pan.x` entirely.
 *
 * Pan is in SOURCE space and is applied before any mirror transform: with the
 * camera mirrored, `pan.x = 0` shows the source's left edge, which the viewer
 * sees on the right. Callers that map a gesture to a pan therefore have to
 * flip the sign when mirroring (see `camera-layer.tsx`).
 */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  pan?: { x: number; y: number },
): CropRect {
  if (srcW <= 0 || srcH <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  if (dstW <= 0 || dstH <= 0) return { sx: 0, sy: 0, sw: srcW, sh: srcH };

  // `clampNormalized` also turns a NaN pan back into a centred crop.
  const px = pan ? clampNormalized(pan.x) : 0.5;
  const py = pan ? clampNormalized(pan.y) : 0.5;
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;

  if (srcAspect > dstAspect) {
    const sw = srcH * dstAspect;
    return { sx: (srcW - sw) * px, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / dstAspect;
  return { sx: 0, sy: (srcH - sh) * py, sw: srcW, sh };
}

/**
 * Where the camera bubble lands on a W×H canvas. Pure — the whole layout can be
 * asserted in a node test without a canvas.
 */
export function computeBubbleRect(
  W: number,
  H: number,
  camW: number,
  camH: number,
  cfg: BubbleConfig,
): Rect {
  if (W <= 0 || H <= 0) {
    return { x: 0, y: 0, w: 0, h: 0, crop: { sx: 0, sy: 0, sw: 0, sh: 0 } };
  }

  if (cfg.shape === "full") {
    return { x: 0, y: 0, w: W, h: H, crop: coverCrop(camW, camH, W, H) };
  }

  const w = Math.round(W * SIZE_FRACTION[cfg.size]);
  let h: number;
  switch (cfg.shape) {
    case "circle":
    case "square":
      h = w;
      break;
    case "portrait":
      h = Math.round((w * 16) / 9);
      break;
    case "rounded":
    default:
      h = Math.round(w * (camH > 0 && camW > 0 ? camH / camW : 9 / 16));
      break;
  }

  const cx = clampRange(clampNormalized(cfg.pos.x) * W, w / 2, W - w / 2);
  const cy = clampRange(clampNormalized(cfg.pos.y) * H, h / 2, H - h / 2);

  return {
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    w,
    h,
    crop: coverCrop(camW, camH, w, h),
  };
}

/** The clip/stroke path for a bubble. Uses the global `Path2D`. */
export function bubblePath(rect: Rect, shape: BubbleShape): Path2D {
  const path = new Path2D();
  const { x, y, w, h } = rect;

  if (shape === "circle") {
    path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    path.closePath();
    return path;
  }

  if (shape === "square" || shape === "full") {
    path.rect(x, y, w, h);
    return path;
  }

  const radius = Math.round(Math.min(w, h) * BUBBLE_RADIUS_FRACTION);
  const maybeRound = path as Path2D & {
    roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
  };
  if (typeof maybeRound.roundRect === "function") {
    maybeRound.roundRect(x, y, w, h, radius);
  } else {
    // Safari < 16.4 and the node test stub.
    path.rect(x, y, w, h);
  }
  return path;
}

// ---------- bubble transition animation ----------

/** A bubble rect without its media crop — what the tween interpolates. */
export interface RectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Standard ease-in-out cubic over 0..1. Out-of-range input is clamped. */
export function easeInOutCubic(t: number): number {
  if (!Number.isFinite(t)) return 1;
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** Component-wise linear interpolation between two rects. */
export function lerpRect(a: RectBox, b: RectBox, t: number): RectBox {
  const c = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 1;
  return {
    x: a.x + (b.x - a.x) * c,
    y: a.y + (b.y - a.y) * c,
    w: a.w + (b.w - a.w) * c,
    h: a.h + (b.h - a.h) * c,
  };
}

/**
 * The corner radius that renders `shape` at this size. Expressing every shape
 * as a radius is what lets the compositor tween between them: a circle is just
 * a very round rectangle, so circle → square is one animated number.
 */
export function shapeRadius(shape: BubbleShape, w: number, h: number): number {
  const short = Math.max(0, Math.min(w, h));
  switch (shape) {
    case "circle":
      return short / 2;
    case "rounded":
    case "portrait":
      return short * 0.08;
    case "square":
      return short * 0.04;
    case "full":
    default:
      return 0;
  }
}

/**
 * Framed capture (for-later #1): enlarge the canvas and inset the screen.
 * Canvas dimensions are forced even because some encoders reject odd sizes.
 */
export function computeFrameLayout(
  srcW: number,
  srcH: number,
  frame: FrameConfig,
): FrameLayout {
  const even = (n: number) => (n % 2 === 0 ? n : n + 1);

  if (!frame.enabled || srcW <= 0 || srcH <= 0) {
    const canvasW = even(srcW);
    const canvasH = even(srcH);
    return {
      canvasW,
      canvasH,
      dest: {
        x: Math.round((canvasW - srcW) / 2),
        y: Math.round((canvasH - srcH) / 2),
        w: srcW,
        h: srcH,
      },
      radius: 0,
    };
  }

  const pad = Math.round(srcW * clampRange(frame.padding, 0, 0.2));
  const canvasW = even(srcW + pad * 2);
  const canvasH = even(srcH + pad * 2);

  return {
    canvasW,
    canvasH,
    dest: {
      x: Math.round((canvasW - srcW) / 2),
      y: Math.round((canvasH - srcH) / 2),
      w: srcW,
      h: srcH,
    },
    radius: Math.round(srcW * clampRange(frame.radius, 0, 0.1)),
  };
}

/**
 * Phase 4: the floating desktop bubble reports a centre normalized to the
 * *captured display*, but `computeBubbleRect` works in *canvas* space. With
 * framed capture on, the canvas is larger than the screen and the screen sits
 * inset at `layout.dest`, so the two spaces differ. Pure so the mapping can be
 * asserted without a canvas or an Electron runtime.
 */
export function displayPosToCanvasPos(
  pos: { x: number; y: number },
  layout: FrameLayout,
): { x: number; y: number } {
  if (layout.canvasW <= 0 || layout.canvasH <= 0) return { x: 0.5, y: 0.5 };
  if (layout.dest.w <= 0 || layout.dest.h <= 0) return { x: 0.5, y: 0.5 };
  const x = clampNormalized(pos.x);
  const y = clampNormalized(pos.y);
  return {
    x: clampNormalized((layout.dest.x + x * layout.dest.w) / layout.canvasW),
    y: clampNormalized((layout.dest.y + y * layout.dest.h) / layout.canvasH),
  };
}

/**
 * The rendered content box of a canvas shown with `object-contain` inside a
 * DOM element. Letterbox bars appear on the sides or top/bottom when the
 * canvas aspect ratio doesn't match the element's aspect ratio; this returns
 * the sub-rect the canvas actually occupies (in the same coordinate space as
 * `bounds`), so pointer math and handle placement never land in a bar.
 */
export function contentBox(
  bounds: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): { left: number; top: number; width: number; height: number } {
  if (canvasWidth <= 0 || canvasHeight <= 0) return bounds;

  const scale = Math.min(bounds.width / canvasWidth, bounds.height / canvasHeight);
  const contentW = canvasWidth * scale;
  const contentH = canvasHeight * scale;

  return {
    left: bounds.left + (bounds.width - contentW) / 2,
    top: bounds.top + (bounds.height - contentH) / 2,
    width: contentW,
    height: contentH,
  };
}

/** Drag helper: a client point inside a DOM rect → a normalized bubble centre. */
export function pointerToNormalized(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 };
  return {
    x: clampNormalized((clientX - rect.left) / rect.width),
    y: clampNormalized((clientY - rect.top) / rect.height),
  };
}
