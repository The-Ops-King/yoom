"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoEdits } from "@/lib/edits";
import * as ops from "@/lib/editor/edit-ops";
import { formatElapsed } from "@/components/recorder/preview-stage";
import type { StagingContext } from "./types";

/** Shortest a dragged span may collapse to, matching `edit-ops`. */
const MIN_SPAN = 0.1;

type Drag =
  | { kind: "scrub" }
  | { kind: "trim"; edge: "start" | "end"; from: VideoEdits }
  | {
      kind: "zoom" | "overlay";
      index: number;
      edge: "start" | "end" | "body";
      grabT: number;
      start: number;
      end: number;
      from: VideoEdits;
    }
  | { kind: "keyframe"; index: number; from: VideoEdits };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function Timeline({ ctx }: { ctx: StagingContext }) {
  const { edits, duration, player, selected } = ctx;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const trim = edits.trim ?? { start: 0, end: duration };
  const pct = useCallback((t: number) => `${duration > 0 ? clamp(t / duration, 0, 1) * 100 : 0}%`, [duration]);

  // The playhead animates from the live ref, not the 10 Hz `time` state, so
  // playback never re-renders the whole staging tree at 60 Hz.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = headRef.current;
      if (el && duration > 0) el.style.left = `${clamp(player.timeRef.current / duration, 0, 1) * 100}%`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player.timeRef, duration]);

  const timeAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return duration * clamp((clientX - r.left) / (r.width || 1), 0, 1);
    },
    [duration],
  );

  /** Every move re-derives from the pre-drag edits, so a drag never accumulates. */
  const move = useCallback(
    (d: Drag, t: number) => {
      if (d.kind === "scrub") {
        player.seek(t);
        return;
      }
      if (d.kind === "trim") {
        const base = d.from.trim ?? { start: 0, end: duration };
        const next = d.edge === "start" ? { start: t, end: base.end } : { start: base.start, end: t };
        ctx.applyLive(() => ops.setTrim(d.from, duration, next));
        return;
      }
      if (d.kind === "keyframe") {
        const track = d.from.camera;
        const k = track?.keyframes[d.index];
        if (!k || d.index === 0) return;
        const nt = clamp(t, MIN_SPAN, duration);
        ctx.applyLive(() =>
          ops.upsertCameraKeyframe(ops.removeCameraKeyframe(d.from, k.t), nt, { mode: k.mode, rect: k.rect }),
        );
        return;
      }
      let start = d.start;
      let end = d.end;
      if (d.edge === "body") {
        const len = d.end - d.start;
        start = clamp(d.start + (t - d.grabT), 0, Math.max(0, duration - len));
        end = start + len;
      } else if (d.edge === "start") {
        start = clamp(t, 0, d.end - MIN_SPAN);
      } else {
        end = clamp(t, d.start + MIN_SPAN, duration);
      }
      ctx.applyLive(() =>
        d.kind === "zoom"
          ? ops.updateZoom(d.from, d.index, { start, end })
          : ops.updateOverlay(d.from, d.index, { start, end }),
      );
    },
    [ctx, duration, player],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => move(drag, timeAt(e.clientX));
    const onUp = () => {
      if ("from" in drag) ctx.commit(drag.from);
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, move, timeAt, ctx]);

  const begin = (e: React.PointerEvent, d: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag(d);
  };

  const isSel = (kind: "cut" | "zoom" | "overlay" | "keyframe", index: number) =>
    selected?.kind === kind && selected.index === index;

  const laneClip = "absolute inset-y-0 rounded-sm border";
  const handle = "absolute inset-y-0 w-1.5 cursor-ew-resize";

  return (
    <div className="space-y-1">
      <div
        ref={trackRef}
        className="relative touch-none select-none"
        onPointerDown={(e) => {
          player.seek(timeAt(e.clientX));
          setDrag({ kind: "scrub" });
        }}
      >
        {/* Source-time track: trim shading, cuts, markers. */}
        <div className="relative h-12 overflow-hidden rounded-md border border-border bg-surface">
          <div className="absolute inset-y-0 left-0 bg-black/50" style={{ width: pct(trim.start) }} />
          <div className="absolute inset-y-0 right-0 bg-black/50" style={{ left: pct(trim.end) }} />
          {edits.cuts.map((c, i) => (
            <button
              key={`cut-${c.start}-${c.end}`}
              type="button"
              aria-label={`Cut ${i + 1}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                ctx.setSelected({ kind: "cut", index: i });
              }}
              className={`absolute inset-y-0 border-x ${
                isSel("cut", i) ? "border-red-400 bg-red-500/40" : "border-red-500/40 bg-red-500/20"
              }`}
              style={{ left: pct(c.start), width: pct(c.end - c.start) }}
            />
          ))}
          {edits.markers.map((m) => (
            <div
              key={`marker-${m.t}`}
              className="pointer-events-none absolute top-0 h-2 w-px bg-amber-300"
              style={{ left: pct(m.t) }}
            />
          ))}
          {ctx.inPoint !== null && (
            <div className="pointer-events-none absolute inset-y-0 w-px bg-emerald-400" style={{ left: pct(ctx.inPoint) }} />
          )}
          {ctx.outPoint !== null && (
            <div className="pointer-events-none absolute inset-y-0 w-px bg-orange-400" style={{ left: pct(ctx.outPoint) }} />
          )}
          <div
            role="slider"
            tabIndex={-1}
            aria-label="Trim start"
            aria-valuenow={trim.start}
            className={`${handle} bg-foreground/70`}
            style={{ left: pct(trim.start) }}
            onPointerDown={(e) => begin(e, { kind: "trim", edge: "start", from: edits })}
          />
          <div
            role="slider"
            tabIndex={-1}
            aria-label="Trim end"
            aria-valuenow={trim.end}
            className={`${handle} -ml-1.5 bg-foreground/70`}
            style={{ left: pct(trim.end) }}
            onPointerDown={(e) => begin(e, { kind: "trim", edge: "end", from: edits })}
          />
        </div>

        {/* Zoom clips. */}
        <div className="relative mt-1 h-4 rounded-sm border border-border bg-surface">
          {edits.zooms.map((z, i) => (
            <div
              key={`zoom-${z.start}-${z.end}`}
              className={`${laneClip} cursor-grab ${
                isSel("zoom", i) ? "border-sky-300 bg-sky-500/50" : "border-sky-500/50 bg-sky-500/25"
              }`}
              style={{ left: pct(z.start), width: pct(z.end - z.start) }}
              onPointerDown={(e) => {
                ctx.setSelected({ kind: "zoom", index: i });
                begin(e, {
                  kind: "zoom",
                  index: i,
                  edge: "body",
                  grabT: timeAt(e.clientX),
                  start: z.start,
                  end: z.end,
                  from: edits,
                });
              }}
            >
              <div
                className={`${handle} left-0`}
                onPointerDown={(e) =>
                  begin(e, { kind: "zoom", index: i, edge: "start", grabT: 0, start: z.start, end: z.end, from: edits })
                }
              />
              <div
                className={`${handle} right-0`}
                onPointerDown={(e) =>
                  begin(e, { kind: "zoom", index: i, edge: "end", grabT: 0, start: z.start, end: z.end, from: edits })
                }
              />
            </div>
          ))}
        </div>

        {/* Camera keyframes. */}
        <div className="relative mt-1 h-4 rounded-sm border border-border bg-surface">
          {(edits.camera?.keyframes ?? []).map((k, i) => (
            <div
              key={`kf-${k.t}`}
              title={`Camera keyframe ${k.t.toFixed(2)}s`}
              className={`absolute top-1 h-2 w-2 -translate-x-1/2 rotate-45 border ${
                i === 0 ? "cursor-default" : "cursor-ew-resize"
              } ${isSel("keyframe", i) ? "border-violet-200 bg-violet-300" : "border-violet-400 bg-violet-500"}`}
              style={{ left: pct(k.t) }}
              onPointerDown={(e) => {
                ctx.setSelected({ kind: "keyframe", index: i, t: k.t });
                if (i === 0) {
                  e.stopPropagation();
                  return;
                }
                begin(e, { kind: "keyframe", index: i, from: edits });
              }}
            />
          ))}
        </div>

        {/* Overlay clips. */}
        <div className="relative mt-1 h-4 rounded-sm border border-border bg-surface">
          {edits.overlays.map((o, i) => (
            <div
              key={`ov-${i}-${o.start}`}
              title={o.type}
              className={`${laneClip} cursor-grab ${
                isSel("overlay", i) ? "border-emerald-200 bg-emerald-500/50" : "border-emerald-500/50 bg-emerald-500/25"
              }`}
              style={{ left: pct(o.start), width: pct(o.end - o.start) }}
              onPointerDown={(e) => {
                ctx.setSelected({ kind: "overlay", index: i });
                begin(e, {
                  kind: "overlay",
                  index: i,
                  edge: "body",
                  grabT: timeAt(e.clientX),
                  start: o.start,
                  end: o.end,
                  from: edits,
                });
              }}
            >
              <div
                className={`${handle} left-0`}
                onPointerDown={(e) =>
                  begin(e, { kind: "overlay", index: i, edge: "start", grabT: 0, start: o.start, end: o.end, from: edits })
                }
              />
              <div
                className={`${handle} right-0`}
                onPointerDown={(e) =>
                  begin(e, { kind: "overlay", index: i, edge: "end", grabT: 0, start: o.start, end: o.end, from: edits })
                }
              />
            </div>
          ))}
        </div>

        <div ref={headRef} className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-500" />
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-dim">
        <span>space play · , . frame · I/O in-out · C cut · ⌘Z undo</span>
        <span className="tabular-nums text-muted">
          {formatElapsed(player.editedTime * 1000)} / {formatElapsed(player.editedDuration * 1000)}
        </span>
      </div>
    </div>
  );
}
