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

/** `object-fit: cover` source rect for drawing srcW×srcH into dstW×dstH. */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): CropRect {
  if (srcW <= 0 || srcH <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  if (dstW <= 0 || dstH <= 0) return { sx: 0, sy: 0, sw: srcW, sh: srcH };

  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;

  if (srcAspect > dstAspect) {
    const sw = srcH * dstAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / dstAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
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

/**
 * Framed capture (for-later #1): enlarge the canvas and inset the screen.
 * Canvas dimensions are forced even because some encoders reject odd sizes.
 */
export function computeFrameLayout(
  srcW: number,
  srcH: number,
  frame: FrameConfig,
): FrameLayout {
  const passthrough: FrameLayout = {
    canvasW: srcW,
    canvasH: srcH,
    dest: { x: 0, y: 0, w: srcW, h: srcH },
    radius: 0,
  };
  if (!frame.enabled || srcW <= 0 || srcH <= 0) return passthrough;

  const pad = Math.round(srcW * clampRange(frame.padding, 0, 0.2));
  const even = (n: number) => (n % 2 === 0 ? n : n + 1);
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
