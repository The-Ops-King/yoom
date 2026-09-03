import { DEFAULT_OVERLAY_THICKNESS, type CameraMode, type Overlay, type Point, type Rect, type VideoEdits } from "@/lib/edits";
import { computeFrameLayout, coverCrop, shapeRadius } from "@/lib/recording/geometry";
import type { BackgroundConfig, RecordingMode } from "@/lib/recording/types";
import { cameraAt } from "./camera-track";
import { type CursorAt, FULL_RECT, fitView, toOutput, zoomAt } from "./zoom";

export interface RenderInputs {
  screen: HTMLVideoElement | null;
  camera: HTMLVideoElement | null;
  mode: RecordingMode;
  edits: VideoEdits;
  /** Decoded frame background media (image or looping video), or null for none/colour. */
  background: HTMLImageElement | HTMLVideoElement | null;
  /**
   * The take's smoothed cursor sampler, for `follow` zooms. Omitted (or
   * returning null) leaves every zoom on its stored rect.
   */
  cursorAt?: CursorAt;
}

/** The output canvas size for a source of `w`×`h`. */
export function outputSize(w: number, h: number, edits: VideoEdits): { width: number; height: number } {
  if (!edits.frame?.enabled) return { width: w + (w % 2), height: h + (h % 2) };
  const l = computeFrameLayout(w, h, edits.frame);
  return { width: l.canvasW, height: l.canvasH };
}

function primary(inputs: RenderInputs): HTMLVideoElement | null {
  return inputs.mode === "camera" ? inputs.camera : inputs.screen;
}

type RoundRectPath = Path2D & {
  roundRect: (x: number, y: number, w: number, h: number, r: number) => void;
};

function buildPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  // Safari < 16.4 has Path2D but not roundRect.
  if (r > 0 && "roundRect" in p) (p as RoundRectPath).roundRect(x, y, w, h, r);
  else p.rect(x, y, w, h);
  return p;
}

function clampRadius(w: number, h: number, r: number): number {
  return Math.max(0, Math.min(r, Math.min(w, h) / 2));
}

/** Uncached — for the camera bubble, whose box moves every frame. */
function roundedPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  return buildPath(x, y, w, h, clampRadius(w, h, r));
}

let frameKey = "";
let frameCached: Path2D | null = null;

/**
 * The content box needs the same rounded path up to three times per frame
 * (shadow fill, screen clip, overlay clip) and it only changes when the
 * destination rect or radius does, so it is cached rather than reallocated 60
 * times a second. Single-entry, exactly like the live compositor's cache —
 * the bubble deliberately uses `roundedPath` so it cannot thrash this one.
 */
function framePath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const rr = clampRadius(w, h, r);
  const key = `${x}|${y}|${w}|${h}|${rr}`;
  if (frameCached && key === frameKey) return frameCached;
  const p = buildPath(x, y, w, h, rr);
  frameKey = key;
  frameCached = p;
  return p;
}

/** A normalised source point through the active zoom, the `toOutput` of a point. */
function toPoint(p: Point, view: Rect): Point {
  return { x: (p.x - view.x) / view.w, y: (p.y - view.y) / view.h };
}

/** Duck-typed so the node tests can pass plain objects for media elements. */
function isVideo(media: HTMLImageElement | HTMLVideoElement): media is HTMLVideoElement {
  return "videoWidth" in media;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  cfg: BackgroundConfig | undefined,
  media: RenderInputs["background"],
) {
  // `none` always paints the neutral base: `color` can linger from an earlier
  // pick, and honouring it would make "no background" show the old colour.
  ctx.fillStyle = !cfg || cfg.kind === "none" ? "#1a1a1e" : cfg.color ?? "#1a1a1e";
  ctx.fillRect(0, 0, W, H);
  if (!media || !cfg || (cfg.kind !== "image" && cfg.kind !== "video")) return;
  const mw = isVideo(media) ? media.videoWidth : media.naturalWidth;
  const mh = isVideo(media) ? media.videoHeight : media.naturalHeight;
  if (mw <= 0 || mh <= 0) return;
  const c = coverCrop(mw, mh, W, H);
  ctx.drawImage(media, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
}

let scratch: HTMLCanvasElement | null = null;
function scratchCanvas(): HTMLCanvasElement {
  if (!scratch) scratch = document.createElement("canvas");
  return scratch;
}

/**
 * Decoded overlay images, keyed by `src`. `drawFrame` is synchronous, so a
 * miss can only kick the decode off and skip this frame — the preview picks
 * the image up on the next one. The export must not do that (it renders each
 * frame once), so it awaits `preloadOverlayImages` first.
 *
 * Module-level and never evicted: an overlay `src` is an object URL that lives
 * as long as the staging screen, and there are at most `MAX_OVERLAYS` of them.
 */
const imageCache = new Map<string, HTMLImageElement>();

/** The cached element for `src`, starting its decode on the first miss. Null outside a browser. */
function overlayImage(src: string): HTMLImageElement | null {
  const hit = imageCache.get(src);
  if (hit) return hit;
  if (typeof Image === "undefined") return null;
  const img = new Image();
  imageCache.set(src, img);
  img.src = src;
  return img;
}

/**
 * Decode every image overlay in `edits` up front. The export awaits this
 * before its first frame; nothing else has to. Never rejects — an image that
 * fails to load is simply skipped by `drawOverlay`, so a dead `blob:` cannot
 * take the whole render down with it.
 */
export function preloadOverlayImages(edits: VideoEdits): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const o of edits.overlays) {
    if (o.type !== "image" || !o.src) continue;
    const img = overlayImage(o.src);
    if (!img || (img.complete && img.naturalWidth > 0)) continue;
    pending.push(
      new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      }),
    );
  }
  return Promise.all(pending).then(() => undefined);
}

/**
 * `zoom` is the current magnification (1 / view.w), so effects sized in output
 * pixels rather than source fractions still grow with the zoom.
 */
function drawOverlay(ctx: CanvasRenderingContext2D, o: Overlay, t: number, content: Rect, W: number, zoom: number) {
  const x = content.x + o.rect.x * content.w;
  const y = content.y + o.rect.y * content.h;
  const w = o.rect.w * content.w;
  const h = o.rect.h * content.h;
  const color = o.color ?? "#f5c542";
  // Thickness is normalised to the frame HEIGHT and stays constant in output
  // pixels under a zoom — a 4× zoom must not give you a 4× fatter stroke.
  const stroke = Math.max(1, (o.thickness ?? DEFAULT_OVERLAY_THICKNESS) * content.h);
  /** A normalised point (already mapped through the zoom) in output pixels. */
  const at = (p: Point) => ({ x: content.x + p.x * content.w, y: content.y + p.y * content.h });
  ctx.save();
  switch (o.type) {
    case "blur": {
      // Downscale the region 8× into a scratch canvas and draw it back up: cheap
      // and works without ctx.filter. Fail closed: if anything is missing, fill.
      const s = typeof document !== "undefined" ? scratchCanvas() : null;
      const sctx = s?.getContext("2d");
      const source = (ctx as { canvas?: HTMLCanvasElement }).canvas;
      if (s && sctx && source && w >= 8 && h >= 8) {
        s.width = Math.max(1, Math.round(w / 8)); s.height = Math.max(1, Math.round(h / 8));
        sctx.drawImage(source, x, y, w, h, 0, 0, s.width, s.height);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(s, 0, 0, s.width, s.height, x, y, w, h);
      } else {
        ctx.fillStyle = "#3a3a40"; ctx.fillRect(x, y, w, h);
      }
      break;
    }
    case "highlight":
      ctx.globalAlpha = o.opacity ?? 0.35; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); break;
    case "underline":
      ctx.strokeStyle = color; ctx.lineWidth = stroke; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke(); break;
    case "ellipse":
      ctx.strokeStyle = color; ctx.lineWidth = stroke;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "step": {
      // A badge sized by the rect, so the same drag gesture that draws every
      // other overlay sets how big the number is.
      const d = Math.min(w, h);
      const cx = x + w / 2, cy = y + h / 2;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = `bold ${d * 0.58}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(o.n ?? 1), cx, cy);
      break;
    }
    case "arrow": {
      // `from`/`to` are the arrow (see the note in `edits.ts`); the rect is
      // only their bounding box, so fall back to its diagonal if they are gone.
      const a = at(o.from ?? { x: o.rect.x, y: o.rect.y });
      const b = at(o.to ?? { x: o.rect.x + o.rect.w, y: o.rect.y + o.rect.h });
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = stroke * 3.5;
      ctx.strokeStyle = color; ctx.lineWidth = stroke; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      // Stop the shaft just short of the tip so the head is a clean triangle.
      ctx.lineTo(b.x - Math.cos(angle) * head * 0.8, b.y - Math.sin(angle) * head * 0.8);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - Math.cos(angle - 0.4) * head, b.y - Math.sin(angle - 0.4) * head);
      ctx.lineTo(b.x - Math.cos(angle + 0.4) * head, b.y - Math.sin(angle + 0.4) * head);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "image": {
      const img = o.src ? overlayImage(o.src) : null;
      // Sync draw: an image still decoding is skipped and picked up next frame.
      if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) break;
      const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.globalAlpha = o.opacity ?? 1;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      break;
    }
    case "click": {
      const p = Math.min(1, (t - o.start) / Math.max(0.05, o.end - o.start));
      const cx = x + w / 2, cy = y + h / 2;
      ctx.globalAlpha = 1 - p; ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, W * 0.003);
      ctx.beginPath(); ctx.arc(cx, cy, (W * 0.01 + p * W * 0.03) * zoom, 0, Math.PI * 2); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * Draw one frame at source time `t` into a `W`×`H` context. Pure with respect
 * to the inputs: the preview and the export both call exactly this.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, inputs: RenderInputs, t: number, W: number, H: number): void {
  const src = primary(inputs);
  const sw = src?.videoWidth ?? 0, sh = src?.videoHeight ?? 0;
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
  if (!src || sw <= 0 || sh <= 0) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.restore(); return; }

  const frame = inputs.edits.frame;
  const framed = frame?.enabled === true;
  // Zoom: the part of the source that fills the content box this frame.
  const view = zoomAt(inputs.edits.zooms, t, inputs.cursorAt);
  const sx = view.x * sw, sy = view.y * sh, svw = view.w * sw, svh = view.h * sh;

  // Camera-only draws the camera as the primary source: cover the box (a
  // letterboxed selfie looks broken) and mirror it, matching the live preview.
  const camOnly = inputs.mode === "camera";
  const camOnlyMirror = camOnly && (inputs.edits.camera?.mirror ?? true);
  // The keyframed framing applies to the camera whichever way it is drawn, so
  // camera-only reads the same track the bubble would. Pan is in source space,
  // ahead of the mirror below: `pan.x = 0` is the source's left edge, which a
  // mirrored draw then shows on the viewer's right.
  const camOnlyPan = camOnly && inputs.edits.camera ? cameraAt(inputs.edits.camera, t).pan : undefined;
  const drawPrimary = (box: Rect) => {
    if (!camOnly) { ctx.drawImage(src, sx, sy, svw, svh, box.x, box.y, box.w, box.h); return; }
    const crop = coverCrop(svw, svh, box.w, box.h, camOnlyPan);
    const csx = sx + crop.sx, csy = sy + crop.sy;
    if (camOnlyMirror) {
      ctx.save(); ctx.translate(box.x + box.w, box.y); ctx.scale(-1, 1);
      ctx.drawImage(src, csx, csy, crop.sw, crop.sh, 0, 0, box.w, box.h); ctx.restore();
    } else {
      ctx.drawImage(src, csx, csy, crop.sw, crop.sh, box.x, box.y, box.w, box.h);
    }
  };

  let content: Rect;
  let radius = 0;
  if (framed && frame) {
    const layout = computeFrameLayout(sw, sh, frame);
    const scale = Math.min(W / layout.canvasW, H / layout.canvasH);
    // Letterbox when the context isn't exactly `outputSize` — the staging
    // preview canvas is sized to the viewport, not to the export dimensions.
    const offX = (W - layout.canvasW * scale) / 2;
    const offY = (H - layout.canvasH * scale) / 2;
    content = { x: offX + layout.dest.x * scale, y: offY + layout.dest.y * scale, w: layout.dest.w * scale, h: layout.dest.h * scale };
    radius = layout.radius * scale;
  } else {
    const scale = Math.min(W / sw, H / sh);
    content = { x: (W - sw * scale) / 2, y: (H - sh * scale) / 2, w: sw * scale, h: sh * scale };
  }

  // A zoom rect may have any aspect, so the view is *fitted* inside the
  // content box rather than stretched across it; what is left over is
  // letterbox. Camera-only is the exception: it cover-crops the box, because
  // a letterboxed selfie looks broken (see `drawPrimary`).
  const dest = camOnly ? content : fitView(view, sw, sh, content);
  const letterboxed = dest.w < content.w - 0.5 || dest.h < content.h - 0.5;

  if (framed && frame) {
    drawBackground(ctx, W, H, frame.background, inputs.background);
    if (frame.shadow) {
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = W * 0.02; ctx.shadowOffsetY = W * 0.008;
      ctx.fillStyle = "#000"; ctx.fill(framePath(content.x, content.y, content.w, content.h, radius)); ctx.restore();
    }
    ctx.save(); ctx.clip(framePath(content.x, content.y, content.w, content.h, radius));
    // The shadow pass fills the whole content box black; repaint the frame
    // background over it so the letterbox reads as the frame's padding
    // growing, not as black bars inside the screen.
    if (letterboxed) drawBackground(ctx, W, H, frame.background, inputs.background);
    drawPrimary(dest); ctx.restore();
  } else {
    // Unframed, the letterbox is simply the black the canvas is cleared to.
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    drawPrimary(dest);
  }

  // Camera (screen+camera only; camera-only mode already drew the camera as `src`).
  const cam = inputs.camera;
  const track = inputs.edits.camera;
  if (inputs.mode === "screen+camera" && cam && track && cam.videoWidth > 0) {
    const s = cameraAt(track, t);
    // A shape change morphs the corner radius: every shape is just a radius,
    // so circle → square is one eased number (same trick as the compositor).
    const bubbleRadius = (w: number, h: number) => {
      const to = shapeRadius(s.shape, w, h);
      if (!s.fromShape || s.shapeFade >= 1) return to;
      const from = shapeRadius(s.fromShape, w, h);
      return from + (to - from) * s.shapeFade;
    };
    const drawCam = (mode: CameraMode, rect: Rect, alpha: number) => {
      // `hidden` draws nothing at all; the cross-fade alpha on the *other*
      // mode is what makes hiding and un-hiding a fade rather than a pop.
      if (mode === "hidden" || alpha <= 0) return;
      const box = mode === "full"
        ? content
        : { x: content.x + rect.x * content.w, y: content.y + rect.y * content.h, w: rect.w * content.w, h: rect.h * content.h };
      if (box.w < 1 || box.h < 1) return;
      const crop = coverCrop(cam.videoWidth, cam.videoHeight, box.w, box.h, s.pan);
      const r = mode === "full" ? 0 : bubbleRadius(box.w, box.h);
      ctx.save(); ctx.globalAlpha = alpha; ctx.clip(roundedPath(box.x, box.y, box.w, box.h, r));
      if (track.mirror) { ctx.translate(box.x + box.w, box.y); ctx.scale(-1, 1); ctx.drawImage(cam, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, box.w, box.h); }
      else ctx.drawImage(cam, crop.sx, crop.sy, crop.sw, crop.sh, box.x, box.y, box.w, box.h);
      ctx.restore();
      if (mode === "bubble") { ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = Math.max(2, W * 0.0015); ctx.stroke(roundedPath(box.x, box.y, box.w, box.h, r)); ctx.restore(); }
    };
    if (s.fromMode && s.fade < 1) { drawCam(s.fromMode, s.rect, 1 - s.fade); drawCam(s.mode, s.rect, s.fade); }
    else drawCam(s.mode, s.rect, 1);
  }

  // Overlays live on source pixels, so they move with the zoom; the bubble did
  // not. Their coordinate box is the *fitted* view box, not the whole content
  // box — that is where those source pixels actually landed. Clipped to it as
  // well: a zoom can push an overlay's mapped rect outside the view, and it
  // must not bleed onto the frame padding or the letterbox.
  ctx.save();
  ctx.clip(framePath(content.x, content.y, content.w, content.h, radius));
  if (letterboxed) ctx.clip(buildPath(dest.x, dest.y, dest.w, dest.h, 0));
  const zoom = view.w > 0 ? 1 / view.w : 1;
  for (const o of inputs.edits.overlays) {
    if (t < o.start || t > o.end) continue;
    // An arrow's endpoints live in the same source space as the rect, so they
    // map through the zoom the same way (`toOutput` on a zero-size rect).
    const mapped =
      view === FULL_RECT
        ? o
        : {
            ...o,
            rect: toOutput(o.rect, view),
            from: o.from && toPoint(o.from, view),
            to: o.to && toPoint(o.to, view),
          };
    drawOverlay(ctx, mapped, t, dest, W, zoom);
  }
  ctx.restore();
  ctx.restore();
}
