"use client";

import type { ChangeEvent } from "react";
import { DEFAULT_OVERLAY_THICKNESS, MAX_OVERLAY_THICKNESS, type OverlayType } from "@/lib/edits";
import * as ops from "@/lib/editor/edit-ops";
import { contentRect } from "../content-rect";
import type { StagingContext, Tool } from "../types";

/** The drawable overlay tools, in rail order. `image` is not one: it is placed from the file picker. */
const TOOLS: { id: Tool; label: string }[] = [
  { id: "blur", label: "Blur" },
  { id: "ellipse", label: "Ellipse" },
  { id: "step", label: "Step" },
  { id: "arrow", label: "Arrow" },
  { id: "highlight", label: "Highlight" },
  { id: "underline", label: "Underline" },
];

/** `render.ts`'s fallback, so the picker opens on the colour actually drawn. */
const DEFAULT_COLOR = "#f5c542";
/** Types whose colour is drawn: blur resamples the pixels, an image brings its own. */
const COLOURED: OverlayType[] = ["ellipse", "step", "arrow", "highlight", "underline", "click"];
/** Types drawn as a stroke, so a thickness means something. */
const STROKED: OverlayType[] = ["ellipse", "arrow", "underline"];
/** Types drawn with an alpha the user can set. */
const FADED: OverlayType[] = ["image", "highlight"];
/** How wide a placed image is, as a fraction of the frame. */
const IMAGE_WIDTH = 0.4;

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

  /**
   * Place an uploaded image centred at `IMAGE_WIDTH` of the frame, keeping its
   * aspect. The decode is what tells us that aspect, so nothing is added until
   * it lands (and nothing at all if the file will not decode). The object URL
   * is registered with the screen, which revokes it on unmount — the export
   * still needs it until then.
   */
  const pickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset first: picking the same file twice must fire `change` again.
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    ctx.registerBlobUrl(url);
    const img = new Image();
    img.onload = () => {
      if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) return;
      // Overlay rects are normalised to the CONTENT box, whose aspect is the
      // source aspect — not the padded output canvas's — so the placed rect
      // has to be squared against that to keep the picture undistorted.
      const box = contentRect(ctx.player.size.width || 1920, ctx.player.size.height || 1080, edits.frame);
      const frameAspect = box.w > 0 && box.h > 0 ? box.w / box.h : 16 / 9;
      const h = Math.min(0.9, (IMAGE_WIDTH * frameAspect * img.naturalHeight) / img.naturalWidth);
      ctx.addOverlayAt(
        "image",
        { x: (1 - IMAGE_WIDTH) / 2, y: (1 - h) / 2, w: IMAGE_WIDTH, h },
        { src: url },
      );
    };
    img.src = url;
  };

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
        <label className={`${btn} cursor-pointer`}>
          Add image
          <input type="file" accept="image/*" className="sr-only" onChange={pickImage} />
        </label>
      </div>

      <p className="text-[11px] text-muted-dim">
        {tool === "select"
          ? "Pick a tool, then drag on the video to draw."
          : tool === "arrow"
            ? "Drag from the tail to the head. Esc cancels."
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
            {/* Blur has no colour (it resamples the pixels underneath it) and an image brings its own. */}
            {COLOURED.includes(overlay.type) && (
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
            {STROKED.includes(overlay.type) && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Thickness
                <input
                  type="range"
                  min={0.002}
                  max={MAX_OVERLAY_THICKNESS / 2}
                  step={0.002}
                  value={overlay.thickness ?? DEFAULT_OVERLAY_THICKNESS}
                  className="w-24"
                  onChange={(e) =>
                    ctx.apply((ed) =>
                      ops.updateOverlay(ed, index, {
                        thickness: num(e.target.value, overlay.thickness ?? DEFAULT_OVERLAY_THICKNESS),
                      }),
                    )
                  }
                />
              </label>
            )}
            {overlay.type === "step" && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Number
                <input
                  type="number"
                  step={1}
                  min={1}
                  value={overlay.n ?? 1}
                  className={field}
                  onChange={(e) =>
                    ctx.apply((ed) =>
                      // A badge is drawn as text, so it has to stay a counting
                      // number even while the field is being typed into.
                      ops.updateOverlay(ed, index, {
                        n: Math.max(1, Math.round(num(e.target.value, overlay.n ?? 1))),
                      }),
                    )
                  }
                />
              </label>
            )}
            {FADED.includes(overlay.type) && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Opacity
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={overlay.opacity ?? (overlay.type === "highlight" ? 0.35 : 1)}
                  className="w-24"
                  onChange={(e) =>
                    ctx.apply((ed) =>
                      ops.updateOverlay(ed, index, { opacity: num(e.target.value, overlay.opacity ?? 1) }),
                    )
                  }
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
