"use client";

import type { RefObject } from "react";
import type { RecordingMode } from "@/lib/recording/types";

interface PreviewStageProps {
  mode: RecordingMode;
  status: string;
  elapsedMs: number;
  /** Flashes the REC chip for ~300 ms when a marker is dropped. */
  markFlash?: boolean;
  screenVideoRef: RefObject<HTMLVideoElement | null>;
  cameraVideoRef: RefObject<HTMLVideoElement | null>;
  /** Mirror the camera preview, matching the bubble default the user picked. */
  mirror: boolean;
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
  screenVideoRef,
  cameraVideoRef,
  mirror,
}: PreviewStageProps) {
  const live = status === "recording" || status === "paused";
  // Hidden — not unmounted — during staging: the two <video> elements are the
  // raw preview sinks, and the hook's refs must survive the transition.
  const showStage =
    status !== "idle" && status !== "acquiring" && status !== "staging";
  const cameraIsStage = mode === "camera";

  return (
    <div
      // Native HTML5 drag-and-drop must never engage here: dragging a preview
      // otherwise paints Chrome's ghost image.
      onDragStart={(e) => e.preventDefault()}
      className={`relative w-full max-w-3xl aspect-video select-none touch-none overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/30 ${
        showStage ? "" : "hidden"
      }`}
    >
      {/*
        Capture is raw now: this is the untouched screen track. The bubble and
        the frame are placed in staging, so nothing is composited here.
      */}
      <video
        ref={screenVideoRef}
        muted
        playsInline
        autoPlay
        draggable={false}
        aria-label="Screen preview"
        className={`h-full w-full object-contain ${cameraIsStage ? "hidden" : ""}`}
      />

      {cameraIsStage ? (
        <video
          ref={cameraVideoRef}
          muted
          playsInline
          autoPlay
          draggable={false}
          aria-label="Camera preview"
          style={{ transform: mirror ? "scaleX(-1)" : undefined }}
          className="h-full w-full object-contain"
        />
      ) : (
        <div
          className={`absolute bottom-3 right-3 w-32 ${
            mode === "screen+camera" ? "" : "hidden"
          }`}
        >
          <video
            ref={cameraVideoRef}
            muted
            playsInline
            autoPlay
            draggable={false}
            aria-label="Camera preview"
            style={{ transform: mirror ? "scaleX(-1)" : undefined }}
            className="aspect-video w-full rounded-lg border border-border object-cover"
          />
          <p className="mt-1 text-center text-[10px] leading-tight text-muted-dim">
            camera · placed after recording
          </p>
        </div>
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
