"use client";

import type { Rect, Zoom } from "@/lib/edits";
import * as ops from "@/lib/editor/edit-ops";
import { DEFAULT_RAMP_S } from "@/lib/editor/zoom";
import type { StagingContext } from "../types";

/** What "Focus whole take" zooms to when nothing is selected to copy. */
const CENTRE_HALF: Rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

const btn =
  "rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-muted";
const active = "rounded-md border border-accent bg-accent/15 px-2 py-1 text-[11px] font-medium text-foreground";
const field =
  "w-20 rounded-md border border-border bg-surface-raised px-1.5 py-1 text-[11px] tabular-nums text-foreground";

const fmt = (t: number) => `${t.toFixed(1)}s`;

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={tool === "zoom"}
          className={tool === "zoom" ? active : btn}
          onClick={() => ctx.setTool(tool === "zoom" ? "select" : "zoom")}
        >
          Zoom
        </button>
        <button
          type="button"
          className={btn}
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

      <p className="text-[11px] text-muted-dim">
        Drag the region to zoom into; it holds for 3 s or the in/out range.
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
                className={field}
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
                className={field}
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
                className={field}
                onChange={(e) =>
                  editZoom({ ramp: Math.min(2, Math.max(0, num(e.target.value, zoom.ramp ?? DEFAULT_RAMP_S))) })
                }
              />
            </label>
          </div>
          <button
            type="button"
            className="text-[11px] text-red-400/80 hover:text-red-300"
            onClick={() => {
              ctx.apply((ed) => ops.removeZoom(ed, index));
              ctx.setSelected(null);
            }}
          >
            Delete zoom
          </button>
        </div>
      )}

      <div className="space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-muted-dim">Zooms ({edits.zooms.length})</span>
        {edits.zooms.length === 0 ? (
          <p className="text-[11px] text-muted-dim">No zooms yet.</p>
        ) : (
          <ul className="space-y-1">
            {edits.zooms.map((z, i) => (
              <li key={`${z.start}-${z.end}`} className="flex items-center justify-between gap-2">
                <span className={`flex-1 text-[11px] ${i === index ? "text-foreground" : "text-muted"}`}>
                  {fmt(z.start)} → {fmt(z.end)}
                </span>
                <button
                  type="button"
                  className={btn}
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
                  className="text-[11px] text-red-400/80 hover:text-red-300"
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
