"use client";

import { clampRect, type Rect, type Zoom, type ZoomKind } from "@/lib/edits";
import * as ops from "@/lib/editor/edit-ops";
import { DEFAULT_RAMP_S } from "@/lib/editor/zoom";
import type { StagingContext } from "../types";
import * as ui from "../ui";

/** What "Focus whole take" zooms to when nothing is selected to copy. */
const CENTRE_HALF: Rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

/** Smallest side a zoom may be typed down to, as a percentage of the source. */
const MIN_PCT = 5;

// `select-text` because the staging root sets `select-none` and `user-select`
// inherits: without it the caret cannot select the value to retype it.

/** A half-typed or emptied number field must not push `NaN` into the edits. */
const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback);

export function ZoomSection({ ctx }: { ctx: StagingContext }) {
  const { edits, duration, player, selected, tool } = ctx;
  const index = selected?.kind === "zoom" ? selected.index : -1;
  const zoom = index >= 0 ? edits.zooms[index] : undefined;

  /**
   * `updateZoom` re-inserts through `insertZoom`, which re-sorts the list and
   * may trim or drop the neighbours the edit ran into — so the selected index
   * can point at a different zoom afterwards. Re-find the edited one by its
   * (disjoint, therefore unique) start.
   */
  const editZoom = (patch: Partial<Zoom>) => {
    if (!zoom) return;
    const start = patch.start ?? zoom.start;
    const next = ops.updateZoom(edits, index, patch);
    ctx.apply(() => next);
    const at = next.zooms.findIndex((z) => z.start === start);
    ctx.setSelected(at >= 0 ? { kind: "zoom", index: at } : null);
  };

  /** Whether this take has a mouse track to follow at all. */
  const hasCursor = ctx.cursor.length > 0;
  /** `kind` is the only spelling read here; `parseEdits` migrates the legacy flag. */
  const following = zoom?.kind === "follow";

  /** Static ⇄ Follow. `setZoomKind` re-inserts too, so re-find the zoom like `editZoom` does. */
  const setKind = (kind: ZoomKind) => {
    if (!zoom) return;
    const next = ops.setZoomKind(edits, index, kind);
    ctx.apply(() => next);
    const at = next.zooms.findIndex((z) => z.start === zoom.start);
    ctx.setSelected(at >= 0 ? { kind: "zoom", index: at } : null);
  };

  /**
   * Resize the selected zoom about its own origin. Free aspect: `drawFrame`
   * fits whatever aspect the rect ends up with inside the content box, so a
   * tall or wide zoom letterboxes rather than stretching the picture.
   */
  const editSize = (axis: "w" | "h", pct: number) => {
    if (!zoom) return;
    const side = Math.min(100, Math.max(MIN_PCT, pct)) / 100;
    editZoom({ rect: clampRect({ ...zoom.rect, [axis]: side }) });
  };

  const pct = (v: number) => Math.round(v * 100);

  return (
    <div className={ui.section}>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={tool === "zoom"}
          className={tool === "zoom" ? ui.btnActive : ui.btn}
          onClick={() => ctx.setTool(tool === "zoom" ? "select" : "zoom")}
        >
          Zoom
        </button>
        {/* The drag sets only the window SIZE, so it needs a track to follow. */}
        <button
          type="button"
          aria-pressed={tool === "followZoom"}
          disabled={!hasCursor}
          title={hasCursor ? undefined : "No mouse track for this take"}
          className={tool === "followZoom" ? ui.btnActive : ui.btn}
          onClick={() => ctx.setTool(tool === "followZoom" ? "select" : "followZoom")}
        >
          Follow zoom
        </button>
        <button
          type="button"
          className={ui.btn}
          disabled={duration <= 0}
          onClick={() =>
            // Deliberately not `addZoomAt`: this one spans the take rather
            // than the in/out range or three seconds from the playhead.
            ctx.apply((e) => ops.addZoom(e, { start: 0, end: duration, rect: zoom?.rect ?? CENTRE_HALF }))
          }
        >
          Focus whole take
        </button>
      </div>

      <p className={ui.hint}>
        {tool === "followZoom"
          ? "Drag the window SIZE; its centre rides the mouse. It holds for 3 s or the in/out range."
          : "Drag the region to zoom into; it holds for 3 s or the in/out range."}
      </p>

      {zoom && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-muted">
              Start
              <input
                type="number"
                step={0.1}
                min={0}
                value={zoom.start}
                className={ui.field}
                onChange={(e) => editZoom({ start: num(e.target.value, zoom.start) })}
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted">
              End
              <input
                type="number"
                step={0.1}
                min={0}
                value={zoom.end}
                className={ui.field}
                onChange={(e) => editZoom({ end: num(e.target.value, zoom.end) })}
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted">
              Ramp
              <input
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={zoom.ramp ?? DEFAULT_RAMP_S}
                className={ui.field}
                onChange={(e) =>
                  editZoom({ ramp: Math.min(2, Math.max(0, num(e.target.value, zoom.ramp ?? DEFAULT_RAMP_S))) })
                }
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-muted">
              Width %
              <input
                type="number"
                step={1}
                min={MIN_PCT}
                max={100}
                value={pct(zoom.rect.w)}
                className={ui.field}
                onChange={(e) => editSize("w", num(e.target.value, pct(zoom.rect.w)))}
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted">
              Height %
              <input
                type="number"
                step={1}
                min={MIN_PCT}
                max={100}
                value={pct(zoom.rect.h)}
                className={ui.field}
                onChange={(e) => editSize("h", num(e.target.value, pct(zoom.rect.h)))}
              />
            </label>
          </div>
          {/*
            Follow is offered whenever there is a track — and, even without
            one, whenever the zoom is ALREADY following: a take restored from a
            draft has the kind but not the track, and disabling both buttons
            would leave no way back to Static.
          */}
          <div className={ui.group}>
            <span className="text-[11px] text-muted">Kind</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className={ui.seg}>
                <button
                  type="button"
                  aria-pressed={!following}
                  className={following ? ui.segItem : ui.segItemOn}
                  onClick={() => setKind("static")}
                >
                  Static
                </button>
                <button
                  type="button"
                  aria-pressed={following}
                  disabled={!hasCursor && !following}
                  className={following ? ui.segItemOn : ui.segItem}
                  onClick={() => setKind("follow")}
                >
                  Follow mouse
                </button>
              </div>
              {!hasCursor && <span className={ui.hint}>· no mouse track for this take</span>}
            </div>
          </div>
          <p className={ui.hint}>
            {following
              ? "Width and height set the window size; its centre follows the mouse, smoothed and kept inside the frame."
              : "Any aspect: the region is fitted inside the frame, so a tall or wide zoom letterboxes rather than stretching. Drag the box on the preview to move or resize it."}
          </p>
          <button
            type="button"
            className="text-[11px] text-danger-text/80 hover:text-danger-hover"
            onClick={() => {
              ctx.apply((ed) => ops.removeZoom(ed, index));
              ctx.setSelected(null);
            }}
          >
            Delete zoom
          </button>
        </div>
      )}

      <div className={ui.group}>
        <span className={ui.label}>Zooms ({edits.zooms.length})</span>
        {edits.zooms.length === 0 ? (
          <p className={ui.hint}>No zooms yet.</p>
        ) : (
          <ul className={ui.group}>
            {edits.zooms.map((z, i) => (
              <li key={`${z.start}-${z.end}`} className="flex items-center justify-between gap-2">
                <span className={`flex-1 text-[11px] ${i === index ? "text-foreground" : "text-muted"}`}>
                  {ui.fmt(z.start)} → {ui.fmt(z.end)}
                  {z.kind === "follow" && <span className="text-muted-dim"> · follows</span>}
                </span>
                <button
                  type="button"
                  className={ui.btn}
                  onClick={() => {
                    ctx.setSelected({ kind: "zoom", index: i });
                    // Land past the ease-in so the held rect is what shows.
                    player.seek(Math.min(z.end, z.start + (z.ramp ?? DEFAULT_RAMP_S)));
                  }}
                >
                  Go
                </button>
                <button
                  type="button"
                  aria-label={`Remove zoom ${i + 1}`}
                  className="text-[11px] text-danger-text/80 hover:text-danger-hover"
                  onClick={() => {
                    ctx.apply((ed) => ops.removeZoom(ed, i));
                    ctx.setSelected(null);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
