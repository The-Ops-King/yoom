/**
 * Person segmentation for the camera-bubble virtual backgrounds.
 *
 * Runs its own `requestVideoFrameCallback` loop at 256 px wide and writes an
 * alpha mask into `mask`. The compositor samples that canvas whenever it
 * happens to be ready — segmentation never blocks the draw loop, and a
 * not-ready segmenter simply means "plain camera".
 */

type ImageSegmenterModule = typeof import("@mediapipe/tasks-vision");

const WASM_PATH = "/mediapipe/wasm";
const WASM_FALLBACK =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_PATH = "/models/selfie_segmenter.tflite";

export interface SegmenterOptions {
  /** Working width of the mask; height follows the camera aspect. */
  width?: number;
  fps?: number;
}

type Segmenter = Awaited<
  ReturnType<ImageSegmenterModule["ImageSegmenter"]["createFromOptions"]>
>;

export class PersonSegmenter {
  readonly mask: HTMLCanvasElement;
  ready = false;

  private segmenter: Segmenter | null = null;
  private maskCtx: CanvasRenderingContext2D;
  /** The segmenter's input frame. Never read back, only drawn from. */
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
  /** Where `putImageData` lands, kept separate from the segmenter's input. */
  private staging: HTMLCanvasElement;
  private stagingCtx: CanvasRenderingContext2D;
  private video: HTMLVideoElement | null = null;
  private frameCallbackId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Bumped by start()/stop() so a restarted loop cannot double up. */
  private generation = 0;
  private imageData: ImageData | null = null;
  private delegate: "GPU" | "CPU" = "GPU";

  private constructor(segmenter: Segmenter, delegate: "GPU" | "CPU") {
    this.segmenter = segmenter;
    this.delegate = delegate;
    this.mask = document.createElement("canvas");
    this.maskCtx = this.mask.getContext("2d")!;
    // Start opaque so the compositor's `destination-in` shows the full camera
    // until the first real mask lands, rather than erasing the person.
    this.mask.width = 2;
    this.mask.height = 2;
    this.maskCtx.fillStyle = "#fff";
    this.maskCtx.fillRect(0, 0, 2, 2);
    this.scratch = document.createElement("canvas");
    this.scratchCtx = this.scratch.getContext("2d")!;
    this.staging = document.createElement("canvas");
    this.stagingCtx = this.staging.getContext("2d")!;
    this.ready = true;
  }

  /** Resolves to null when the model or WASM is unavailable. */
  static async load(): Promise<PersonSegmenter | null> {
    try {
      const vision: ImageSegmenterModule = await import("@mediapipe/tasks-vision");
      let fileset;
      try {
        fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      } catch {
        fileset = await vision.FilesetResolver.forVisionTasks(WASM_FALLBACK);
      }

      const create = (delegate: "GPU" | "CPU") =>
        vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });

      try {
        return new PersonSegmenter(await create("GPU"), "GPU");
      } catch {
        return new PersonSegmenter(await create("CPU"), "CPU");
      }
    } catch (err) {
      console.warn("[Yoom] segmentation unavailable", err);
      return null;
    }
  }

  start(video: HTMLVideoElement, options: SegmenterOptions = {}): void {
    if (this.running) this.stop();
    this.video = video;
    this.running = true;
    const gen = ++this.generation;

    const targetWidth = options.width ?? 256;
    // The CPU delegate cannot keep up at 30fps at this size.
    const fps = options.fps ?? (this.delegate === "GPU" ? 30 : 15);
    const minIntervalMs = 1000 / fps;
    let lastRun = 0;

    const step = (nowMs: number) => {
      // A stop()+start() bumps the generation, so the old loop dies here
      // instead of running alongside the new one.
      if (!this.running || !this.video || this.generation !== gen) return;
      if (nowMs - lastRun >= minIntervalMs) {
        lastRun = nowMs;
        this.segmentOnce(this.video, targetWidth);
      }
      this.schedule(step);
    };

    this.schedule(step);
  }

  private schedule(step: (nowMs: number) => void): void {
    const video = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    };
    if (video?.requestVideoFrameCallback) {
      this.frameCallbackId = video.requestVideoFrameCallback((now) => step(now));
    } else {
      // Firefox has no rVFC; a plain interval is close enough at 15-30fps.
      if (this.timer) clearTimeout(this.timer as unknown as number);
      this.timer = setTimeout(
        () => step(performance.now()),
        1000 / 30,
      ) as unknown as ReturnType<typeof setInterval>;
    }
  }

  private segmentOnce(video: HTMLVideoElement, targetWidth: number): void {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!this.segmenter || vw === 0 || vh === 0) return;

    const w = targetWidth;
    const h = Math.max(1, Math.round((targetWidth * vh) / vw));

    if (this.scratch.width !== w || this.scratch.height !== h) {
      this.scratch.width = w;
      this.scratch.height = h;
      this.staging.width = w;
      this.staging.height = h;
      this.mask.width = w;
      this.mask.height = h;
      this.imageData = this.maskCtx.createImageData(w, h);
      // Start fully opaque (person everywhere) so the first frames after a
      // background is enabled show the plain camera, then the temporal blend
      // converges on the real mask. A transparent start would make the
      // person vanish for a few frames.
      this.maskCtx.globalCompositeOperation = "source-over";
      this.maskCtx.fillStyle = "#fff";
      this.maskCtx.fillRect(0, 0, w, h);
    }

    try {
      this.scratchCtx.drawImage(video, 0, 0, w, h);
      this.segmenter.segmentForVideo(this.scratch, performance.now(), (result) => {
        try {
          const confidence = result.confidenceMasks?.[0];
          if (!confidence || !this.imageData) return;
          const floats = confidence.getAsFloat32Array();
          const px = this.imageData.data;
          for (let i = 0, p = 0; i < floats.length; i += 1, p += 4) {
            const alpha = Math.round(floats[i] * 255);
            px[p] = 255;
            px[p + 1] = 255;
            px[p + 2] = 255;
            px[p + 3] = alpha;
          }
          // The mask lands on its own canvas: `scratch` still holds the
          // camera frame the segmenter is reading from.
          this.stagingCtx.putImageData(this.imageData, 0, 0);
          // Temporal smoothing: 70% new over the previous mask kills flicker.
          this.maskCtx.save();
          this.maskCtx.globalAlpha = 0.7;
          this.maskCtx.globalCompositeOperation = "source-over";
          // Feather the edge at low resolution — cheap because w is 256.
          this.maskCtx.filter = "blur(1px)";
          this.maskCtx.drawImage(this.staging, 0, 0);
          this.maskCtx.restore();
        } finally {
          result.close?.();
        }
      });
    } catch (err) {
      console.warn("[Yoom] segmentation frame failed", err);
    }
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    const video = this.video as
      | (HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void })
      | null;
    if (this.frameCallbackId && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(this.frameCallbackId);
    }
    this.frameCallbackId = 0;
    if (this.timer) clearTimeout(this.timer as unknown as number);
    this.timer = null;
    this.video = null;
  }

  dispose(): void {
    this.stop();
    try {
      this.segmenter?.close();
    } catch {
      // Already closed.
    }
    this.segmenter = null;
    this.ready = false;
  }
}
