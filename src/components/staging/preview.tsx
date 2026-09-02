"use client";

import type { StagingContext } from "./types";
import { CameraLayer } from "./camera-layer";
import { OverlayLayer } from "./overlay-layer";

export function Preview({ ctx }: { ctx: StagingContext }) {
  const { canvasRef, size, playing, toggle } = ctx.player;

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-border bg-black shadow-lg shadow-black/30"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      {/*
        `width`/`height` are the canvas backing store, kept at the render
        output size; the aspect box above lays the element out in CSS pixels.
      */}
      <canvas ref={canvasRef} width={size.width} height={size.height} className="h-full w-full" />
      <CameraLayer ctx={ctx} />
      <OverlayLayer ctx={ctx} />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur"
      >
        {playing ? "Pause" : "Play"} · space
      </button>
    </div>
  );
}
