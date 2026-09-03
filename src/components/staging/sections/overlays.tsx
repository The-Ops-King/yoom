"use client";

import type { ChangeEvent } from "react";
import {
  DEFAULT_OVERLAY_THICKNESS,
  DEFAULT_TEXT_SIZE,
  MAX_OVERLAYS,
  MAX_OVERLAY_THICKNESS,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  type ArrowStyle,
  type OverlayType,
} from "@/lib/edits";
import * as ops from "@/lib/editor/edit-ops";
import { contentRect } from "../content-rect";
import type { StagingContext, Tool } from "../types";

/** The drawable overlay tools, in rail order. `image` is not one: it is placed from the file picker. */
const TOOLS: { id: Tool; label: string }[] = [
  { id: "blur", label: "Blur" },
  { id: "blackout", label: "Blackout" },
  { id: "ellipse", label: "Ellipse" },
  { id: "rect", label: "Rectangle" },
  { id: "step", label: "Step" },
  { id: "arrow", label: "Arrow" },
  { id: "line", label: "Line" },
  { id: "highlight", label: "Highlight" },
  { id: "underline", label: "Underline" },
  { id: "text", label: "Text" },
  { id: "emoji", label: "Emoji" },
  { id: "draw", label: "Draw" },
];

/** The four arrow shapes, in picker order. */
const ARROW_STYLES: { id: ArrowStyle; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "double", label: "Double" },
  { id: "curved", label: "Curved" },
  { id: "fancy", label: "Fancy" },
];

/** A starter set of emoji; anything else goes in the free field beside it. */
const EMOJI_PALETTE = ["👉", "👆", "👇", "👈", "✅", "❌", "⭐", "🔥", "💡", "⚠️", "🎯", "🙌"];

/** `render.ts`'s fallback, so the picker opens on the colour actually drawn. */
const DEFAULT_COLOR = "#f5c542";
/** The plate colour the bg picker opens on once it is switched on. */
const DEFAULT_BG = "#000000";
/** Types whose colour is drawn: blur resamples the pixels, an image and an emoji bring their own. */
const COLOURED: OverlayType[] = [
  "blackout", "ellipse", "rect", "step", "arrow", "line", "highlight", "underline", "text", "draw", "click",
];
/** Types drawn as a stroke, so a thickness means something. */
const STROKED: OverlayType[] = ["ellipse", "rect", "arrow", "line", "underline", "draw"];
/** Types drawn with an alpha the user can set. */
const FADED: OverlayType[] = ["image", "highlight", "rect", "blackout"];
/** How wide a placed image is, as a fraction of the frame. */
const IMAGE_WIDTH = 0.4;
/** The hint under the tool row, per armed tool. */
const HINTS: Partial<Record<Tool, string>> = {
  select: "Pick a tool, then drag on the video to draw.",
  arrow: "Drag from the tail to the head. Esc cancels.",
  line: "Drag from one end to the other. Esc cancels.",
  draw: "Drag to scribble freehand; it commits when you let go. Esc cancels.",
  text: "Click to drop a caption, or drag the box it wraps inside. Esc cancels.",
  emoji: "Click to place it, or drag to size it. Esc cancels.",
};

const btn =
  "rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground";
const active = "rounded-md border border-accent bg-accent/15 px-2 py-1 text-[11px] font-medium text-foreground";
// `select-text` because the staging root sets `select-none` and `user-select`
// inherits: without it the caret cannot select the value to retype it.
const field =
  "w-20 select-text rounded-md border border-border bg-surface-raised px-1.5 py-1 text-[11px] tabular-nums text-foreground";

/** A half-typed or emptied number field must not push `NaN` into the edits. */
const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback);

export function OverlaysSection({ ctx }: { ctx: StagingContext }) {
  const { edits, selected, tool } = ctx;
  const index = selected?.kind === "overlay" ? selected.index : -1;
  const overlay = index >= 0 ? edits.overlays[index] : undefined;
  /**
   * `addOverlay` silently refuses past the cap, so arming a tool that cannot
   * place anything would look like the preview had stopped responding. Say it
   * on the buttons instead.
   */
  const full = edits.overlays.length >= MAX_OVERLAYS;

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
    if (full) return;
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
            disabled={full && tool !== t.id}
            className={tool === t.id ? active : btn}
            onClick={() => ctx.setTool(tool === t.id ? "select" : t.id)}
          >
            {t.label}
          </button>
        ))}
        <label
          aria-disabled={full}
          className={`${btn} ${full ? "cursor-not-allowed opacity-30" : "cursor-pointer"}`}
        >
          Add image
          <input type="file" accept="image/*" className="sr-only" disabled={full} onChange={pickImage} />
        </label>
      </div>

      <p className="text-[11px] text-muted-dim">
        {full
          ? `That is all ${MAX_OVERLAYS} overlays — delete one to add another.`
          : (HINTS[tool] ?? "Drag on the video to draw. Esc cancels.")}
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
            {overlay.type === "rect" && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={overlay.fill === true}
                  onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { fill: e.target.checked }))}
                />
                Fill
              </label>
            )}
            {/* A filled rect has no stroke to size, and an outlined one no fill to fade. */}
            {STROKED.includes(overlay.type) && !(overlay.type === "rect" && overlay.fill) && (
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
            {FADED.includes(overlay.type) && !(overlay.type === "rect" && !overlay.fill) && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Opacity
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={overlay.opacity ?? (overlay.type === "highlight" || overlay.type === "rect" ? 0.35 : 1)}
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

          {overlay.type === "arrow" && (
            <div className="space-y-1">
              <span className="text-[11px] text-muted">Style</span>
              <div className="flex flex-wrap gap-1.5">
                {ARROW_STYLES.map((s) => {
                  const on = (overlay.style ?? "standard") === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      className={on ? active : btn}
                      onClick={() => ctx.apply((ed) => ops.updateOverlay(ed, index, { style: s.id }))}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
              {overlay.style === "curved" && (
                <p className="text-[11px] text-muted-dim">
                  Bows through the midpoint by default; drag either end to re-aim it.
                </p>
              )}
            </div>
          )}

          {overlay.type === "text" && (
            <div className="space-y-2">
              <textarea
                rows={2}
                value={overlay.text ?? ""}
                aria-label="Overlay text"
                placeholder="Type the caption"
                className="w-full select-text rounded-md border border-border bg-surface-raised px-1.5 py-1 text-[11px] text-foreground"
                onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { text: e.target.value }))}
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] text-muted">
                  Size
                  <input
                    type="range"
                    min={MIN_TEXT_SIZE}
                    max={MAX_TEXT_SIZE}
                    step={0.005}
                    value={overlay.size ?? DEFAULT_TEXT_SIZE}
                    className="w-24"
                    onChange={(e) =>
                      ctx.apply((ed) =>
                        ops.updateOverlay(ed, index, { size: num(e.target.value, overlay.size ?? DEFAULT_TEXT_SIZE) }),
                      )
                    }
                  />
                </label>
                {/*
                  The plate is optional, so the swatch alone cannot express it:
                  "None" clears `bg` outright, which is what the renderer reads
                  as "no plate at all".
                */}
                <label className="flex items-center gap-1.5 text-[11px] text-muted">
                  Plate
                  <input
                    type="color"
                    value={overlay.bg ?? DEFAULT_BG}
                    className="h-6 w-8 rounded border border-border bg-transparent"
                    onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { bg: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  aria-pressed={overlay.bg === undefined}
                  className={overlay.bg === undefined ? active : btn}
                  onClick={() => ctx.apply((ed) => ops.updateOverlay(ed, index, { bg: undefined }))}
                >
                  None
                </button>
              </div>
              <p className="text-[11px] text-muted-dim">Wraps inside the box you drew; drag its corner to rewrap.</p>
            </div>
          )}

          {overlay.type === "emoji" && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {EMOJI_PALETTE.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Use ${emoji}`}
                    aria-pressed={overlay.text === emoji}
                    className={`${overlay.text === emoji ? active : btn} text-sm leading-none`}
                    onClick={() => ctx.apply((ed) => ops.updateOverlay(ed, index, { text: emoji }))}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Or paste one
                <input
                  type="text"
                  value={overlay.text ?? ""}
                  className={field}
                  onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { text: e.target.value }))}
                />
              </label>
            </div>
          )}

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
