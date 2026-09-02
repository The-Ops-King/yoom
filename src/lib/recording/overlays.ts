import type { FrameInfo, OverlayLayer } from "./types";

/**
 * The seam Phase 5 plugs into: `compositor.addOverlay(layer)` calls
 * `layer.draw(ctx, frame)` once per composited frame, after the screen and the
 * camera bubble, in registration order. Layers must not mutate the context
 * state without save/restore.
 */
export type { OverlayLayer, FrameInfo };

/** The trivial built-in: proves the seam is wired without changing pixels. */
export function createNoopOverlay(id = "noop"): OverlayLayer {
  return {
    id,
    draw() {
      // Intentionally empty.
    },
  };
}

/**
 * Debug-only FPS readout, drawn top-left. Gated by
 * `NEXT_PUBLIC_YOOM_DEBUG_FPS=1` so it never burns into a real recording.
 */
export function createFpsOverlay(id = "debug-fps"): OverlayLayer {
  let smoothed = 0;

  return {
    id,
    draw(ctx: CanvasRenderingContext2D, frame: FrameInfo) {
      if (frame.deltaMs > 0) {
        const instant = 1000 / frame.deltaMs;
        smoothed = smoothed === 0 ? instant : smoothed * 0.9 + instant * 0.1;
      }
      const fps = Math.round(smoothed);
      const text = `${fps} fps · ${frame.width}×${frame.height}`;

      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(16, 16, 220, 34);
      ctx.fillStyle = "#f0f0f2";
      ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 28, 33);
      ctx.restore();
    },
  };
}

export function debugOverlaysEnabled(
  flag: string | undefined = process.env.NEXT_PUBLIC_YOOM_DEBUG_FPS,
): boolean {
  return flag === "1";
}
