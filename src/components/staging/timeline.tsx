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
  /** Track geometry, measured once per drag — a layout read per pointermove thrashes. */
  const rectRef = useRef<{ left: number; width: number } | null>(null);
  /** Where the zoom being dragged ended up, so its (re-sorted) index can be re-found. */
  const zoomStartRef = useRef(0);
  /** Likewise for a dragged camera keyframe, which is addressed by time. */
  const kfTimeRef = useRef(0);
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

  /** Measure the track and cache it for the drag that is about to start. */
  const measure = useCallback(() => {
    const el = trackRef.current;
    const r = el?.getBoundingClientRect();
    rectRef.current = r ? { left: r.left, width: r.width || 1 } : null;
    return rectRef.current;
  }, []);

  const timeAt = useCallback(
    (clientX: number) => {
      const r = rectRef.current ?? measure();
      if (!r) return 0;
      return duration * clamp((clientX - r.left) / r.width, 0, 1);
    },
    [duration, measure],
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
        // Keyframes are addressed by time: stash the new one so the release
        // can re-select it, or Delete would look for the pre-drag time.
        kfTimeRef.current = nt;
        ctx.applyLive(() =>
          ops.upsertCameraKeyframe(ops.removeCameraKeyframe(d.from, k.t), nt, { mode: k.mode, rect: k.rect, ...(k.shape ? { shape: k.shape } : {}) }),
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
      if (d.kind === "zoom") zoomStartRef.current = start;
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
      // `updateZoom` re-inserts and re-sorts, so the dragged clip's index can
      // have moved (or the clip can have been swallowed by a neighbour).
      if (drag.kind === "zoom") {
        const i = ctx.edits.zooms.findIndex((z) => z.start === zoomStartRef.current);
        ctx.setSelected(i >= 0 ? { kind: "zoom", index: i } : null);
      }
      // A moved keyframe is re-inserted at its new time and the list re-sorted,
      // so both the index and the selection's `t` (what Delete removes by) are
      // stale until they are re-found.
      if (drag.kind === "keyframe") {
        const t = kfTimeRef.current;
        const i = ctx.edits.camera?.keyframes.findIndex((k) => k.t === t) ?? -1;
        ctx.setSelected(i >= 0 ? { kind: "keyframe", index: i, t } : null);
      }
      rectRef.current = null;
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
    measure();
    if (d.kind === "zoom") zoomStartRef.current = d.start;
    if (d.kind === "keyframe") kfTimeRef.current = d.from.camera?.keyframes[d.index]?.t ?? 0;
    setDrag(d);
  };

  const isSel = (kind: "cut" | "zoom" | "overlay" | "keyframe", index: number) =>
    selected?.kind === kind && selected.index === index;

  const laneClip = "absolute inset-y-0 rounded-sm border";
  const handle = "absolute inset-y-0 w-1.5 cursor-ew-resize";
  /** One lane per item, kept short so a dozen of them still fit under the track. */
  const laneRow = "relative h-[18px] shrink-0 rounded-sm border bg-surface";
  const laneLabel =
    "pointer-events-none absolute left-0.5 top-1/2 z-20 -translate-y-1/2 rounded-sm bg-surface/85 px-1 text-[9px] leading-none text-muted-dim";

  /**
   * "Blur" when it is the only one of its type, "Ellipse 2" when it is not.
   * A step is always labelled by its own badge number ("Step 3"), which is
   * what is drawn on the frame — never by its position in the list.
   */
  const overlayLabel = (i: number) => {
    const { type, n } = edits.overlays[i];
    const name = type.charAt(0).toUpperCase() + type.slice(1);
    if (type === "step") return `Step ${n ?? 1}`;
    const total = edits.overlays.reduce((n, o) => n + (o.type === type ? 1 : 0), 0);
    if (total < 2) return name;
    const nth = edits.overlays.slice(0, i + 1).reduce((n, o) => n + (o.type === type ? 1 : 0), 0);
    return `${name} ${nth}`;
  };

  const camera = edits.camera;
  const laneCount = edits.zooms.length + edits.overlays.length + (camera ? 1 : 0);

  return (
    <div className="space-y-1">
      <div ref={trackRef} className="relative touch-none select-none">
        {/*
          Seeking lives on the main track alone: a pointer-down on a clip, a
          handle, a keyframe or a cut must edit that thing, never drag the
          playhead out from under it (`begin` and the cut button stop the event).
        */}
        <div
          className="relative h-12 overflow-hidden rounded-md border border-border bg-surface"
          onPointerDown={(e) => {
            measure();
            player.seek(timeAt(e.clientX));
            setDrag({ kind: "scrub" });
          }}
        >
          <div className="absolute inset-y-0 left-0 bg-black/50" style={{ width: pct(trim.start) }} />
          <div className="absolute inset-y-0 right-0 bg-black/50" style={{ left: pct(trim.end) }} />
          {edits.cuts.map((c, i) => (
            <button
              key={`cut-${i}`}
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
          {edits.markers.map((m, i) => (
            <div
              key={`marker-${i}`}
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

        {/*
          One lane per zoom and per overlay so each can be grabbed on its own,
          plus the single camera-keyframe lane. Past eight lanes the stack
          scrolls rather than pushing the rest of the screen down.

          The scrollbar is given no layout width (and no reserved gutter — that
          would narrow the rows permanently): every clip's percentage is
          resolved against the same width as `trackRef`, so a classic scrollbar
          eating ~15px would slide the whole stack out from under the playhead.
          The ninth lane deliberately peeks instead, as the scroll affordance.
        */}
        <div
          className={`mt-1 space-y-1 ${
            laneCount > 8 ? "max-h-[184px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : ""
          }`}
        >
          {edits.zooms.map((z, i) => (
            <div key={`zoom-lane-${i}`} className={`${laneRow} ${isSel("zoom", i) ? "border-accent" : "border-border"}`}>
              <span className={laneLabel}>Zoom {i + 1}</span>
              <div
                className={`${laneClip} z-30 cursor-grab ${
                  isSel("zoom", i) ? "border-sky-300 bg-sky-500/50" : "border-sky-500/50 bg-sky-500/25"
                }`}
                style={{ left: pct(z.start), width: pct(z.end - z.start) }}
                onPointerDown={(e) => {
                  ctx.setSelected({ kind: "zoom", index: i });
                  ctx.openSection?.("zoom");
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
            </div>
          ))}

          {camera && (
            <div className={`${laneRow} ${selected?.kind === "keyframe" ? "border-accent" : "border-border"}`}>
              <span className={laneLabel}>Camera</span>
              {camera.keyframes.map((k, i) => (
                <div
                  key={`kf-${i}`}
                  title={`Camera keyframe ${k.t.toFixed(2)}s`}
                  className={`absolute top-1/2 z-30 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${
                    i === 0 ? "cursor-default" : "cursor-ew-resize"
                  } ${isSel("keyframe", i) ? "border-violet-200 bg-violet-300" : "border-violet-400 bg-violet-500"}`}
                  style={{ left: pct(k.t) }}
                  onPointerDown={(e) => {
                    ctx.setSelected({ kind: "keyframe", index: i, t: k.t });
                    if (i === 0) {
                      // Anchored at 0: nothing to drag, but the event still
                      // must not reach anything that would move the playhead.
                      e.stopPropagation();
                      return;
                    }
                    begin(e, { kind: "keyframe", index: i, from: edits });
                  }}
                />
              ))}
            </div>
          )}

          {edits.overlays.map((o, i) => (
            <div key={`ov-lane-${i}`} className={`${laneRow} ${isSel("overlay", i) ? "border-accent" : "border-border"}`}>
              <span className={laneLabel}>{overlayLabel(i)}</span>
              <div
                title={o.type}
                className={`${laneClip} z-30 cursor-grab ${
                  isSel("overlay", i) ? "border-emerald-200 bg-emerald-500/50" : "border-emerald-500/50 bg-emerald-500/25"
                }`}
                style={{ left: pct(o.start), width: pct(o.end - o.start) }}
                onPointerDown={(e) => {
                  ctx.setSelected({ kind: "overlay", index: i });
                  ctx.openSection?.("overlays");
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
            </div>
          ))}
        </div>

        {/* Above the lane clips (z-30), which would otherwise paint over it. */}
        <div ref={headRef} className="pointer-events-none absolute inset-y-0 z-40 w-0.5 -translate-x-1/2 bg-red-500" />
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
