import {
  computeBubbleRect,
  computeFrameLayout,
  coverCrop,
  easeInOutCubic,
  lerpRect,
  shapeRadius,
  type RectBox,
} from "./geometry";
import type {
  BackgroundConfig,
  BubbleConfig,
  FrameConfig,
  FrameInfo,
  OverlayLayer,
  Rect,
} from "./types";

export {
  bubblePath,
  computeBubbleRect,
  computeFrameLayout,
  coverCrop,
  SIZE_FRACTION,
} from "./geometry";
export type {
  BackgroundConfig,
  BackgroundKind,
  BubbleConfig,
  BubbleShape,
  BubbleSize,
  FrameConfig,
  FrameInfo,
  OverlayLayer,
  Rect,
} from "./types";

export type CompositorLayout = "camera" | "screen+camera";

/** How long a bubble shape/size/position/visibility change takes to settle. */
export const BUBBLE_ANIM_MS = 300;

/**
 * A rounded-rect path at an arbitrary radius. Unlike `bubblePath` this is
 * driven by a number rather than a shape name, which is what makes the
 * circle → rounded → square transition a single interpolated value.
 */
function roundedBubblePath(box: RectBox, radius: number): Path2D {
  const path = new Path2D();
  const r = Math.max(0, Math.min(radius, Math.min(box.w, box.h) / 2));
  const maybe = path as Path2D & {
    roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
  };
  if (r > 0 && typeof maybe.roundRect === "function") {
    maybe.roundRect(box.x, box.y, box.w, box.h, r);
  } else if (r > 0) {
    // Safari < 16.4: four arcs.
    path.moveTo(box.x + r, box.y);
    path.arcTo(box.x + box.w, box.y, box.x + box.w, box.y + box.h, r);
    path.arcTo(box.x + box.w, box.y + box.h, box.x, box.y + box.h, r);
    path.arcTo(box.x, box.y + box.h, box.x, box.y, r);
    path.arcTo(box.x, box.y, box.x + box.w, box.y, r);
    path.closePath();
  } else {
    path.rect(box.x, box.y, box.w, box.h);
  }
  return path;
}

export interface CompositorSources {
  screen?: MediaStream | null;
  camera?: MediaStream | null;
}

function makeVideo(stream: MediaStream): HTMLVideoElement {
  const el = document.createElement("video");
  el.srcObject = stream;
  el.muted = true;
  el.playsInline = true;
  el.autoplay = true;
  void el.play().catch(() => {});
  return el;
}

/** A hidden, looping, muted <video> for a video background. */
function makeMediaBackgroundVideo(src: string): HTMLVideoElement {
  const el = document.createElement("video");
  el.src = src;
  el.loop = true;
  el.muted = true;
  el.playsInline = true;
  el.autoplay = true;
  el.crossOrigin = "anonymous";
  void el.play().catch(() => {});
  return el;
}

function makeImage(src: string): HTMLImageElement {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  return img;
}

interface ResolvedBackground {
  cfg: BackgroundConfig;
  image: HTMLImageElement | null;
  video: HTMLVideoElement | null;
}

function resolveBackground(cfg: BackgroundConfig): ResolvedBackground {
  return {
    cfg,
    image: cfg.kind === "image" && cfg.src ? makeImage(cfg.src) : null,
    video: cfg.kind === "video" && cfg.src ? makeMediaBackgroundVideo(cfg.src) : null,
  };
}

/**
 * Detaches the media elements only. Object URLs are NOT revoked here: the hook
 * creates them (via the frame picker) and owns their lifetime.
 */
function releaseBackground(bg: ResolvedBackground | null): void {
  if (!bg) return;
  if (bg.video) {
    bg.video.pause();
    bg.video.removeAttribute("src");
    bg.video.load();
  }
  if (bg.image) bg.image.src = "";
}

function isDrawable(el: HTMLImageElement | HTMLVideoElement | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLVideoElement) return el.readyState >= 2 && el.videoWidth > 0;
  return el.complete && el.naturalWidth > 0;
}

/**
 * Owns the canvas and the rAF loop. Nothing here reads React state — the hook
 * pushes config in through the setters, which only flip dirty flags.
 */
export class Compositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layout: CompositorLayout;

  private screenVideo: HTMLVideoElement | null = null;
  private cameraVideo: HTMLVideoElement | null = null;

  private bubble: BubbleConfig | null = null;
  private frame: FrameConfig | null = null;
  private frameBackground: ResolvedBackground | null = null;

  private overlays: OverlayLayer[] = [];

  private rafId = 0;
  private running = false;
  private sizeLocked = false;
  private frameIndex = 0;
  private lastFrameMs = 0;

  private cachedRect: Rect | null = null;
  private cachedPath: Path2D | null = null;
  private cacheKey = "";

  // ---- bubble transition ----
  /** Where the bubble actually is on screen right now. */
  private drawnRect: RectBox | null = null;
  private drawnRadius = 0;
  private animFrom: RectBox | null = null;
  private animFromRadius = 0;
  private animTo: RectBox | null = null;
  private animToRadius = 0;
  private animStartMs = 0;
  /** Set by `setBubble(cfg, { immediate: true })` — drags must not lag. */
  private snapNext = false;

  private layerCanvas: HTMLCanvasElement;
  private layerCtx: CanvasRenderingContext2D;

  private stream: MediaStream | null = null;

  constructor(canvas: HTMLCanvasElement, layout: CompositorLayout) {
    this.canvas = canvas;
    this.layout = layout;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get a 2D context for the compositor.");
    this.ctx = ctx;

    this.layerCanvas = document.createElement("canvas");
    const layerCtx = this.layerCanvas.getContext("2d");
    if (!layerCtx) throw new Error("Could not get a 2D context for the camera layer.");
    this.layerCtx = layerCtx;
  }

  setSources(sources: CompositorSources): void {
    // A replaced <video> must let go of its MediaStream, or the old element
    // keeps a decoder (and the tracks) alive until GC gets around to it.
    if (sources.screen !== undefined) {
      this.screenVideo?.pause();
      if (this.screenVideo) this.screenVideo.srcObject = null;
      this.screenVideo = sources.screen ? makeVideo(sources.screen) : null;
    }
    if (sources.camera !== undefined) {
      this.cameraVideo?.pause();
      if (this.cameraVideo) this.cameraVideo.srcObject = null;
      this.cameraVideo = sources.camera ? makeVideo(sources.camera) : null;
    }
    this.cacheKey = "";
  }

  /**
   * `immediate` snaps to the new geometry instead of tweening to it. The drag
   * overlay passes it so the bubble tracks the pointer 1:1 rather than
   * restarting a 300 ms tween on every pointermove.
   */
  setBubble(cfg: BubbleConfig, opts?: { immediate?: boolean }): void {
    this.bubble = cfg;
    if (opts?.immediate) this.snapNext = true;
    this.cacheKey = "";
  }

  setFrame(cfg: FrameConfig): void {
    const bgChanged =
      !this.frameBackground ||
      this.frameBackground.cfg.kind !== cfg.background.kind ||
      this.frameBackground.cfg.src !== cfg.background.src ||
      this.frameBackground.cfg.color !== cfg.background.color;

    // Padding / enabled / radius change the canvas size or the inset, which
    // the encoder cannot follow once recording. After `lockSize()` only the
    // background and shadow may change; the geometry stays as it was locked.
    this.frame =
      this.sizeLocked && this.frame
        ? {
            ...cfg,
            enabled: this.frame.enabled,
            padding: this.frame.padding,
            radius: this.frame.radius,
          }
        : cfg;
    if (bgChanged) {
      releaseBackground(this.frameBackground);
      this.frameBackground = resolveBackground(cfg.background);
    }
    this.cacheKey = "";
  }

  /** The <video> the compositor decodes the camera stream into. */
  cameraElement(): HTMLVideoElement | null {
    return this.cameraVideo;
  }

  addOverlay(layer: OverlayLayer): () => void {
    this.overlays = [...this.overlays.filter((l) => l.id !== layer.id), layer];
    return () => this.removeOverlay(layer.id);
  }

  removeOverlay(id: string): void {
    this.overlays = this.overlays.filter((l) => l.id !== id);
  }

  bubbleRect(): Rect | null {
    return this.cachedRect;
  }

  /** Resolves once the first real frame has been painted. */
  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    this.running = true;
    this.frameIndex = 0;
    this.lastFrameMs = 0;

    return new Promise<void>((resolve) => {
      let resolved = false;
      const tick = () => {
        if (!this.running) return;
        const painted = this.drawFrame();
        if (painted && !resolved) {
          resolved = true;
          resolve();
        }
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    });
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Locks the canvas size; call once the first frame is up, before recording. */
  lockSize(): void {
    this.sizeLocked = true;
  }

  captureStream(fps: number): MediaStream {
    // A restart must not leave the previous capture track live on the canvas.
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = this.canvas.captureStream(fps);
    return this.stream;
  }

  snapshot(): Promise<Blob | null> {
    if (this.canvas.width === 0) return Promise.resolve(null);
    return new Promise((resolve) =>
      this.canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8),
    );
  }

  dispose(): void {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.screenVideo?.pause();
    this.cameraVideo?.pause();
    if (this.screenVideo) this.screenVideo.srcObject = null;
    if (this.cameraVideo) this.cameraVideo.srcObject = null;
    this.screenVideo = null;
    this.cameraVideo = null;
    this.drawnRect = null;
    this.animFrom = null;
    this.animTo = null;
    this.cachedPath = null;
    this.cacheKey = "";
    releaseBackground(this.frameBackground);
    this.frameBackground = null;
    this.overlays = [];
  }

  // ---------- drawing ----------

  private sourceSize(): { w: number; h: number } {
    if (this.layout === "screen+camera" && this.screenVideo) {
      return { w: this.screenVideo.videoWidth, h: this.screenVideo.videoHeight };
    }
    if (this.cameraVideo) {
      return { w: this.cameraVideo.videoWidth, h: this.cameraVideo.videoHeight };
    }
    return { w: 0, h: 0 };
  }

  /** Returns true when a real frame was painted. */
  private drawFrame(): boolean {
    const src = this.sourceSize();
    if (src.w <= 0 || src.h <= 0) return false;

    const frameCfg = this.frame;
    const layout =
      this.layout === "screen+camera" && frameCfg
        ? computeFrameLayout(src.w, src.h, frameCfg)
        : {
            canvasW: src.w,
            canvasH: src.h,
            dest: { x: 0, y: 0, w: src.w, h: src.h },
            radius: 0,
          };

    if (
      !this.sizeLocked &&
      (this.canvas.width !== layout.canvasW || this.canvas.height !== layout.canvasH)
    ) {
      this.canvas.width = layout.canvasW;
      this.canvas.height = layout.canvasH;
      this.cacheKey = "";
    }

    const W = this.canvas.width;
    const H = this.canvas.height;
    if (W === 0 || H === 0) return false;

    const nowMs = performance.now();
    const deltaMs = this.lastFrameMs === 0 ? 0 : nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;

    const ctx = this.ctx;
    ctx.save();
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // 1. background / frame
    let screenRect: { x: number; y: number; w: number; h: number } | null = null;
    if (this.layout === "screen+camera" && this.screenVideo) {
      const framed = frameCfg?.enabled === true;
      if (framed) {
        this.drawFrameBackground(ctx, W, H);
        // Letterbox the source into the padded area if the canvas was locked
        // before a surface switch changed the source dimensions.
        const dest = this.fitInto(src.w, src.h, layout.dest, W, H, framed);
        if (frameCfg?.shadow) {
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.45)";
          ctx.shadowBlur = Math.round(W * 0.02);
          ctx.shadowOffsetY = Math.round(W * 0.008);
          ctx.fillStyle = "#000";
          this.fillRounded(ctx, dest, layout.radius);
          ctx.restore();
        }
        ctx.save();
        this.clipRounded(ctx, dest, layout.radius);
        ctx.drawImage(this.screenVideo, dest.x, dest.y, dest.w, dest.h);
        ctx.restore();
        screenRect = dest;
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        const dest = this.fitInto(src.w, src.h, { x: 0, y: 0, w: W, h: H }, W, H, false);
        ctx.drawImage(this.screenVideo, dest.x, dest.y, dest.w, dest.h);
        screenRect = dest;
      }
    } else {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
    }

    // 2. camera bubble — tweened between shapes/sizes/positions
    let rect: Rect | null = null;
    const cam = this.cameraVideo;
    const bubble = this.bubble;
    const camW = cam?.videoWidth ?? 0;
    const camH = cam?.videoHeight ?? 0;

    if (cam && bubble && camW > 0 && camH > 0) {
      rect = this.resolveBubbleRect(W, H, camW, camH, bubble, nowMs);

      if (rect && rect.w >= 1 && rect.h >= 1) {
        this.drawCameraLayer(cam, rect, bubble);
        ctx.save();
        ctx.clip(this.cachedPath!);
        ctx.drawImage(this.layerCanvas, rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
        if (bubble.shape !== "full") {
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.2)";
          ctx.lineWidth = Math.max(2, Math.round(W * 0.0015));
          ctx.stroke(this.cachedPath!);
          ctx.restore();
        }
      } else {
        rect = null;
      }
      this.cachedRect = rect;
    } else {
      this.cachedRect = null;
      this.cacheKey = "";
      this.drawnRect = null;
      this.animTo = null;
    }

    ctx.restore();

    // 3. overlays — the seam. Each layer gets a clean context.
    if (this.overlays.length > 0) {
      const info: FrameInfo = {
        width: W,
        height: H,
        nowMs,
        deltaMs,
        frameIndex: this.frameIndex,
        screenRect,
        bubbleRect: rect,
      };
      for (const layer of this.overlays) {
        ctx.save();
        try {
          layer.draw(ctx, info);
        } catch {
          // A broken overlay must never kill the recording.
        }
        ctx.restore();
      }
    }

    this.frameIndex += 1;
    return true;
  }

  /** Letterbox srcW×srcH into `box`, preserving aspect. */
  private fitInto(
    srcW: number,
    srcH: number,
    box: { x: number; y: number; w: number; h: number },
    W: number,
    H: number,
    framed: boolean,
  ): { x: number; y: number; w: number; h: number } {
    const maxW = framed ? box.w : W;
    const maxH = framed ? box.h : H;
    const scale = Math.min(maxW / srcW, maxH / srcH);
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    return {
      x: Math.round(box.x + (maxW - w) / 2),
      y: Math.round(box.y + (maxH - h) / 2),
      w,
      h,
    };
  }

  private roundedKey = "";
  private roundedCached: Path2D | null = null;

  /**
   * The framed screen needs the same rounded path twice per frame (shadow fill
   * + clip) and it only changes when the destination rect or radius does, so
   * it is cached rather than reallocated 60 times a second.
   */
  private roundedPath(
    box: { x: number; y: number; w: number; h: number },
    radius: number,
  ): Path2D {
    const key = `${box.x}|${box.y}|${box.w}|${box.h}|${radius}`;
    if (this.roundedCached && key === this.roundedKey) return this.roundedCached;
    const p = new Path2D();
    const maybe = p as Path2D & {
      roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
    };
    if (radius > 0 && typeof maybe.roundRect === "function") {
      maybe.roundRect(box.x, box.y, box.w, box.h, radius);
    } else {
      p.rect(box.x, box.y, box.w, box.h);
    }
    this.roundedKey = key;
    this.roundedCached = p;
    return p;
  }

  private fillRounded(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; w: number; h: number },
    radius: number,
  ): void {
    ctx.fill(this.roundedPath(box, radius));
  }

  private clipRounded(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; w: number; h: number },
    radius: number,
  ): void {
    ctx.clip(this.roundedPath(box, radius));
  }

  private drawFrameBackground(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
  ): void {
    const bg = this.frameBackground;
    const cfg = bg?.cfg;

    if (!cfg || cfg.kind === "none") {
      ctx.fillStyle = "#1a1a1e";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    if (cfg.kind === "color") {
      ctx.fillStyle = cfg.color ?? "#1a1a1e";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const media = cfg.kind === "video" ? bg!.video : bg!.image;
    if (!isDrawable(media)) {
      ctx.fillStyle = cfg.color ?? "#1a1a1e";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const mw = media instanceof HTMLVideoElement ? media.videoWidth : media!.naturalWidth;
    const mh = media instanceof HTMLVideoElement ? media.videoHeight : media!.naturalHeight;
    const crop = coverCrop(mw, mh, W, H);
    ctx.drawImage(media!, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
  }

  /** Collapse a rect to zero size around its own centre (the hide/show tween). */
  private static collapse(box: RectBox): RectBox {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2, w: 0, h: 0 };
  }

  /**
   * The bubble's rect for this frame. A change in shape / size / position /
   * visibility starts a 300 ms ease-in-out from wherever the bubble currently
   * is; `w`, `h` and the corner radius all interpolate, so circle → square and
   * small → large are one continuous motion rather than a jump. Hiding
   * animates down to zero around the centre; showing scales back up.
   */
  private resolveBubbleRect(
    W: number,
    H: number,
    camW: number,
    camH: number,
    bubble: BubbleConfig,
    nowMs: number,
  ): Rect {
    const base = computeBubbleRect(W, H, camW, camH, bubble);
    const full: RectBox = { x: base.x, y: base.y, w: base.w, h: base.h };
    const target = bubble.visible ? full : Compositor.collapse(full);
    const targetRadius = bubble.visible ? shapeRadius(bubble.shape, full.w, full.h) : 0;

    const key = [
      W,
      H,
      camW,
      camH,
      bubble.shape,
      bubble.size,
      bubble.pos.x.toFixed(4),
      bubble.pos.y.toFixed(4),
      bubble.visible,
    ].join("|");

    if (key !== this.cacheKey) {
      this.cacheKey = key;
      // Nothing drawn yet (first frame, or the camera just arrived) and drags
      // both snap: there is no "from" worth animating out of.
      if (!this.drawnRect || this.snapNext) {
        this.drawnRect = target;
        this.drawnRadius = targetRadius;
        this.animTo = null;
      } else {
        this.animFrom = this.drawnRect;
        this.animFromRadius = this.drawnRadius;
        this.animTo = target;
        this.animToRadius = targetRadius;
        this.animStartMs = nowMs;
      }
      this.snapNext = false;
      this.cachedPath = null;
    }

    if (this.animTo && this.animFrom) {
      const t = (nowMs - this.animStartMs) / BUBBLE_ANIM_MS;
      const e = easeInOutCubic(t);
      this.drawnRect = lerpRect(this.animFrom, this.animTo, e);
      this.drawnRadius =
        this.animFromRadius + (this.animToRadius - this.animFromRadius) * e;
      if (t >= 1) {
        this.drawnRect = this.animTo;
        this.drawnRadius = this.animToRadius;
        this.animTo = null;
        this.animFrom = null;
      }
      // Mid-tween the path changes every frame, so it cannot be cached.
      this.cachedPath = null;
    }

    const cur = this.drawnRect ?? target;
    const x = Math.round(cur.x);
    const y = Math.round(cur.y);
    const w = Math.round(cur.w);
    const h = Math.round(cur.h);
    const out: Rect = { x, y, w, h, crop: coverCrop(camW, camH, w, h) };
    // The radius can never exceed half the short side, or roundRect throws.
    const radius = Math.min(this.drawnRadius, Math.min(w, h) / 2);
    if (!this.cachedPath) this.cachedPath = roundedBubblePath(out, radius);
    return out;
  }

  /**
   * Builds the bubble's pixels on an offscreen canvas: mirror, then the
   * cropped camera. Virtual backgrounds were removed in Phase 2.1.
   */
  private drawCameraLayer(
    cam: HTMLVideoElement,
    rect: Rect,
    bubble: BubbleConfig,
  ): void {
    const { w, h, crop } = rect;
    if (this.layerCanvas.width !== w || this.layerCanvas.height !== h) {
      this.layerCanvas.width = w;
      this.layerCanvas.height = h;
    }
    const lctx = this.layerCtx;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, w, h);
    lctx.filter = "none";
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = "source-over";

    if (bubble.mirror) {
      lctx.translate(w, 0);
      lctx.scale(-1, 1);
    }

    lctx.drawImage(cam, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
