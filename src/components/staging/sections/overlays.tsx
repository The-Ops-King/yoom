"use client";

import * as ops from "@/lib/editor/edit-ops";
import type { StagingContext, Tool } from "../types";

/** The four drawable overlay tools, in rail order. */
const TOOLS: { id: Tool; label: string }[] = [
  { id: "blur", label: "Blur" },
  { id: "callout", label: "Callout" },
  { id: "highlight", label: "Highlight" },
  { id: "underline", label: "Underline" },
];

/** `render.ts`'s fallback, so the picker opens on the colour actually drawn. */
const DEFAULT_COLOR = "#f5c542";

const btn =
  "rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground";
const active = "rounded-md border border-accent bg-accent/15 px-2 py-1 text-[11px] font-medium text-foreground";
const field =
  "w-20 rounded-md border border-border bg-surface-raised px-1.5 py-1 text-[11px] tabular-nums text-foreground";

/** A half-typed or emptied number field must not push `NaN` into the edits. */
const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback);

export function OverlaysSection({ ctx }: { ctx: StagingContext }) {
  const { edits, selected, tool } = ctx;
  const index = selected?.kind === "overlay" ? selected.index : -1;
  const overlay = index >= 0 ? edits.overlays[index] : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tool === t.id}
            className={tool === t.id ? active : btn}
            onClick={() => ctx.setTool(tool === t.id ? "select" : t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted-dim">
        {tool === "select"
          ? "Pick a tool, then drag on the video to draw."
          : "Drag on the video to draw. Esc cancels."}
      </p>

      {overlay ? (
        <div className="space-y-2 border-t border-border pt-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-dim">{overlay.type}</span>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-muted">
              Start
              <input
                type="number"
                step={0.1}
                min={0}
                value={overlay.start}
                className={field}
                onChange={(e) =>
                  ctx.apply((ed) => ops.updateOverlay(ed, index, { start: num(e.target.value, overlay.start) }))
                }
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted">
              End
              <input
                type="number"
                step={0.1}
                min={0}
                value={overlay.end}
                className={field}
                onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { end: num(e.target.value, overlay.end) }))}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Blur has no colour: it resamples the pixels underneath it. */}
            {overlay.type !== "blur" && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Colour
                <input
                  type="color"
                  value={overlay.color ?? DEFAULT_COLOR}
                  className="h-6 w-8 rounded border border-border bg-transparent"
                  onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { color: e.target.value }))}
                />
              </label>
            )}
            {overlay.type === "callout" && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Number
                <input
                  type="number"
                  step={1}
                  min={1}
                  value={overlay.n ?? 1}
                  className={field}
                  onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { n: num(e.target.value, overlay.n ?? 1) }))}
                />
              </label>
            )}
          </div>

          <button
            type="button"
            className="text-[11px] text-red-400/80 hover:text-red-300"
            onClick={() => {
              ctx.apply((ed) => ops.removeOverlay(ed, index));
              ctx.setSelected(null);
            }}
          >
            Delete overlay
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-dim">
          {edits.overlays.length === 0
            ? "No overlays yet."
            : `${edits.overlays.length} overlay${edits.overlays.length === 1 ? "" : "s"} · click one on the video or the timeline to edit it.`}
        </p>
      )}
    </div>
  );
}
