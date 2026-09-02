"use client";

import type { RefObject } from "react";
import { BubbleDragOverlay } from "./bubble-drag-overlay";
import type { BubbleConfig, RecordingMode } from "@/lib/recording/types";

interface PreviewStageProps {
  mode: RecordingMode;
  status: string;
  elapsedMs: number;
  /** Flashes the REC chip for ~300 ms when a marker is dropped. */
  markFlash?: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  screenVideoRef: RefObject<HTMLVideoElement | null>;
  bubble: BubbleConfig;
  canvasWidth: number;
  canvasHeight: number;
  cameraWidth: number;
  cameraHeight: number;
  onBubbleMove: (pos: { x: number; y: number }, opts?: { immediate?: boolean }) => void;
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function PreviewStage({
  mode,
  status,
  elapsedMs,
  markFlash = false,
  canvasRef,
  screenVideoRef,
  bubble,
  canvasWidth,
  canvasHeight,
  cameraWidth,
  cameraHeight,
  onBubbleMove,
}: PreviewStageProps) {
  const live = status === "recording" || status === "paused";
  const showStage = status !== "idle" && status !== "acquiring" && status !== "review";

  return (
    <div
      // Native HTML5 drag-and-drop must never engage here: dragging the canvas
      // or the bubble handle otherwise paints Chrome's ghost image.
      onDragStart={(e) => e.preventDefault()}
      className={`relative w-full max-w-3xl aspect-video select-none touch-none overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/30 ${
        showStage ? "" : "hidden"
      }`}
    >
      {/*
        The canvas is always mounted for camera modes so the compositor has a
        target before acquisition finishes; it is simply empty until then.
      */}
      <canvas
        ref={canvasRef}
        draggable={false}
        className={`h-full w-full object-contain ${mode === "screen" ? "hidden" : ""}`}
      />
      <video
        ref={screenVideoRef}
        muted
        playsInline
        autoPlay
        draggable={false}
        className={`h-full w-full object-contain ${mode === "screen" ? "" : "hidden"}`}
      />

      {mode !== "screen" && (
        <BubbleDragOverlay
          bubble={bubble}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          cameraWidth={cameraWidth}
          cameraHeight={cameraHeight}
          onMove={onBubbleMove}
        />
      )}

      {/*
        The REC chip lives in the DOM on purpose — it is never burned into the
        recorded frames. The overlay seam exists for cursor/annotation layers.
      */}
      {live && (
        <div
          className={`pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 backdrop-blur transition-all duration-150 ${
            markFlash
              ? "scale-105 border-accent bg-accent/20 shadow-lg shadow-accent/30"
              : "border-border"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              status === "paused" ? "bg-muted" : "bg-accent recording-dot"
            }`}
          />
          <span className="font-mono text-xs tabular-nums text-foreground">
            {status === "paused" ? "Paused" : "REC"} {formatElapsed(elapsedMs)}
          </span>
        </div>
      )}
    </div>
  );
}
