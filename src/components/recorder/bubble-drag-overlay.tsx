"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeBubbleRect,
  contentBox,
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
  const hostElRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });

  // A callback ref, not an effect: this component returns `null` until the
  // canvas reports a size, so a `[]`-dep effect would run once with a null
  // host and never observe anything. The callback fires on every real
  // mount/unmount of the host, and seeds `hostSize` immediately so the very
  // first render with a sized canvas already positions the handle correctly.
  const hostRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    hostElRef.current = el;
    if (!el) return;

    const bounds = el.getBoundingClientRect();
    setHostSize({ width: bounds.width, height: bounds.height });

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = el.getBoundingClientRect();
      setHostSize((prev) =>
        prev.width === next.width && prev.height === next.height
          ? prev
          : { width: next.width, height: next.height },
      );
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const rect = useMemo(
    () =>
      canvasWidth > 0 && canvasHeight > 0
        ? computeBubbleRect(canvasWidth, canvasHeight, cameraWidth, cameraHeight, bubble)
        : null,
    [canvasWidth, canvasHeight, cameraWidth, cameraHeight, bubble],
  );

  // The canvas renders with `object-contain` inside the stage, so it may be
  // letterboxed on the sides or top/bottom. The handle must be positioned —
  // and drags interpreted — relative to that rendered content box, not the
  // full (possibly letterboxed) host box. Recomputed whenever the host is
  // measured or the canvas dimensions arrive/change.
  const box = useMemo(
    () => contentBox({ left: 0, top: 0, ...hostSize }, canvasWidth, canvasHeight),
    [hostSize, canvasWidth, canvasHeight],
  );

  const handlePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const host = hostElRef.current;
      if (!host) return;
      const bounds = host.getBoundingClientRect();
      const content = contentBox(bounds, canvasWidth, canvasHeight);
      onMove(pointerToNormalized(e.clientX, e.clientY, content));
    },
    [onMove, canvasWidth, canvasHeight],
  );

  if (!bubble.visible || !rect || bubble.shape === "full") return null;

  const pctX = (n: number) => `${box.left + (n / canvasWidth) * box.width}px`;
  const pctY = (n: number) => `${box.top + (n / canvasHeight) * box.height}px`;
  const pctW = (n: number) => `${(n / canvasWidth) * box.width}px`;
  const pctH = (n: number) => `${(n / canvasHeight) * box.height}px`;

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
          left: pctX(rect.x),
          top: pctY(rect.y),
          width: pctW(rect.w),
          height: pctH(rect.h),
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
