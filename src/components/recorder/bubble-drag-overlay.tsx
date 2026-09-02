"use client";

import { useCallback, useRef, useState } from "react";
import {
  computeBubbleRect,
  pointerToNormalized,
} from "@/lib/recording/geometry";
import type { BubbleConfig } from "@/lib/recording/types";

interface BubbleDragOverlayProps {
  bubble: BubbleConfig;
  /** Canvas dimensions, so the handle can be positioned in canvas space. */
  canvasWidth: number;
  canvasHeight: number;
  cameraWidth: number;
  cameraHeight: number;
  onMove: (pos: { x: number; y: number }) => void;
}

/**
 * Transparent layer over the preview. Drag writes a normalized centre straight
 * into the bubble config; the compositor picks it up on the next frame.
 */
export function BubbleDragOverlay({
  bubble,
  canvasWidth,
  canvasHeight,
  cameraWidth,
  cameraHeight,
  onMove,
}: BubbleDragOverlayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const rect =
    canvasWidth > 0 && canvasHeight > 0
      ? computeBubbleRect(canvasWidth, canvasHeight, cameraWidth, cameraHeight, bubble)
      : null;

  const handlePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const host = hostRef.current;
      if (!host) return;
      const bounds = host.getBoundingClientRect();
      onMove(pointerToNormalized(e.clientX, e.clientY, bounds));
    },
    [onMove],
  );

  if (!bubble.visible || !rect || bubble.shape === "full") return null;

  const pct = (n: number, total: number) => `${(n / total) * 100}%`;

  return (
    <div ref={hostRef} className="absolute inset-0">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Camera bubble position"
        aria-valuetext={`x ${Math.round(bubble.pos.x * 100)}%, y ${Math.round(
          bubble.pos.y * 100,
        )}%`}
        aria-valuenow={Math.round(bubble.pos.x * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          handlePointer(e);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          handlePointer(e);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          const { x, y } = bubble.pos;
          if (e.key === "ArrowLeft") onMove({ x: x - step, y });
          else if (e.key === "ArrowRight") onMove({ x: x + step, y });
          else if (e.key === "ArrowUp") onMove({ x, y: y - step });
          else if (e.key === "ArrowDown") onMove({ x, y: y + step });
          else return;
          e.preventDefault();
        }}
        style={{
          position: "absolute",
          left: pct(rect.x, canvasWidth),
          top: pct(rect.y, canvasHeight),
          width: pct(rect.w, canvasWidth),
          height: pct(rect.h, canvasHeight),
          borderRadius: bubble.shape === "circle" ? "50%" : "12px",
        }}
        className={`cursor-grab touch-none outline-none transition-shadow ${
          dragging
            ? "cursor-grabbing ring-2 ring-accent"
            : "ring-1 ring-white/20 hover:ring-accent/60 focus-visible:ring-2 focus-visible:ring-accent"
        }`}
      />
    </div>
  );
}
