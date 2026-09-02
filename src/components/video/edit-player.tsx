"use client";

import { useEffect, useRef, useState } from "react";
import { hasDrawableEdits, type Marker, type VideoEdits } from "@/lib/edits";
import { fmtDuration } from "@/lib/format";

export type EditPlayerProps = {
  src: string;
  poster?: string;
  edits: VideoEdits;
  /**
   * Supplied by the watch page so `useViewTracker` keeps owning the element.
   * When omitted the component uses its own internal ref.
   */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /**
   * Recorder-placed timestamps. When present a thin tick bar renders under the
   * video; clicking a tick seeks. Omit (or pass `[]`) to hide the bar.
   */
  markers?: Marker[];
  className?: string;
  autoPlay?: boolean;
};

/**
 * A `<video>` with a pixel-accurate `<canvas>` layered over its rendered box.
 *
 * Phase 3 draws nothing — `edits` is always the empty list — but the sizing,
 * the ref plumbing and the per-frame draw loop are in place so the proposed
 * Phase 5 editor only has to fill in `drawEdits`.
 */
export function EditPlayer({
  src,
  poster,
  edits,
  videoRef,
  markers,
  className,
  autoPlay,
}: EditPlayerProps) {
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? internalRef;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [duration, setDuration] = useState(0);

  // Keep the canvas backing store matched to the element's rendered box and
  // the device pixel ratio, so future overlays land on the right pixels.
  useEffect(() => {
    const video = ref.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const resize = () => {
      const rect = video.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(video);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [ref]);

  // Draw loop. It only runs while there is something to actually draw on the
  // canvas — markers render as a separate tick bar below, not here — so a
  // marker-only or unedited video costs nothing.
  useEffect(() => {
    const video = ref.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    if (!hasDrawableEdits(edits)) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let frame = 0;
    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      // Phase 5: render edits at video.currentTime here.
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [ref, edits]);

  const ticks = markers ?? [];
  const showTicks = ticks.length > 0 && duration > 0;

  function seekTo(seconds: number) {
    const video = ref.current;
    if (!video) return;
    video.currentTime = seconds;
  }

  function onDuration(value: number) {
    setDuration(Number.isFinite(value) ? value : 0);
  }

  return (
    <div className={className}>
      <div className="relative">
        <video
          ref={ref}
          src={src}
          poster={poster}
          controls
          preload="metadata"
          playsInline
          autoPlay={autoPlay}
          onLoadedMetadata={(event) => onDuration(event.currentTarget.duration)}
          onDurationChange={(event) => onDuration(event.currentTarget.duration)}
          className="w-full rounded-xl border border-border bg-black shadow-lg shadow-black/30"
        />
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 rounded-xl"
        />
      </div>

      {showTicks && (
        <div
          className="relative mt-1.5 h-4 rounded bg-border-subtle"
          role="group"
          aria-label="Markers"
        >
          {ticks.map((marker, index) => (
            <button
              key={`${marker.t}-${index}`}
              type="button"
              onClick={() => seekTo(marker.t)}
              title={marker.label ?? fmtDuration(marker.t * 1000)}
              aria-label={`Jump to ${fmtDuration(marker.t * 1000)}`}
              style={{
                left: `${Math.min(100, Math.max(0, (marker.t / duration) * 100))}%`,
              }}
              className="absolute top-0 h-4 min-w-[10px] -translate-x-1/2 rounded-sm bg-accent transition-transform hover:scale-x-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          ))}
        </div>
      )}
    </div>
  );
}
