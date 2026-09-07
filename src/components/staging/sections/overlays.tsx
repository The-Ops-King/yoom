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
import { packRows } from "@/lib/editor/lanes";
import { contentRect } from "../content-rect";
import { Slider } from "../slider";
import type { StagingContext, Tool } from "../types";
import * as ui from "../ui";

/**
 * The tool grid, in the 5-column layout order the panel renders (related
 * tools grouped together: mark-up, shapes, drawing, redaction). `image` is
 * NOT a `Tool` — see the `<label>` below the grid, which places it straight
 * off the file picker the same way `pickImage` always has.
 *
 * `keys` and `click` are the other two `OverlayType`s and deliberately have
 * no button here: per `Tool` in `../types`, both come from the take's
 * recorded input tracks, not a drag on the canvas, so there is no tool to
 * arm for them without inventing a placement gesture the rest of the
 * machinery (`ctx.addOverlayAt`, `ctx.setTool`) does not support.
 */
const TOOL_GRID: { id: Tool; label: string; glyph: string }[] = [
  { id: "text", label: "Text", glyph: "T" },
  { id: "arrow", label: "Arrow", glyph: "→" },
  { id: "line", label: "Line", glyph: "╱" },
  { id: "rect", label: "Rectangle", glyph: "▭" },
  { id: "ellipse", label: "Ellipse", glyph: "◯" },
  { id: "highlight", label: "Highlight", glyph: "▤" },
  { id: "underline", label: "Underline", glyph: "▁" },
  { id: "step", label: "Step", glyph: "①" },
  { id: "emoji", label: "Emoji", glyph: "🙂" },
  { id: "draw", label: "Draw", glyph: "✎" },
  { id: "blur", label: "Blur", glyph: "▒" },
  { id: "blackout", label: "Blackout", glyph: "■" },
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
/** Preset swatches offered before the free-pick cell; the first matches `DEFAULT_COLOR`. */
const SWATCH_PALETTE = ["#f5c542", "#ef4444", "#f97316", "#22c55e", "#3b82f6", "#a855f7", "#111827"];
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

/** `thickness` is normalised to the frame height; shown as a share of it. */
const thicknessFmt = (v: number) => `${(v * 100).toFixed(1)}%`;

// `select-text` because the staging root sets `select-none` and `user-select`
// inherits: without it the caret cannot select the value to retype it.

/** A half-typed or emptied number field must not push `NaN` into the edits. */
const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback);

export function OverlaysSection({ ctx }: { ctx: StagingContext }) {
  const { edits, selected, tool } = ctx;
  const index = selected?.kind === "overlay" ? selected.index : -1;
  const overlay = index >= 0 ? edits.overlays[index] : undefined;
  // Same call the timeline makes, over the same array — so the row this panel
  // reports always matches the row the overlay actually packs into there.
  const overlayLanes = packRows(edits.overlays);
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
    <div className={ui.section}>
      <div className={ui.group}>
        <div className="flex items-center justify-between">
          <span className={ui.label}>Overlays</span>
          <span className="text-[11px] font-mono tabular-nums text-muted-dim">
            {edits.overlays.length} / {MAX_OVERLAYS}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {TOOL_GRID.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              disabled={full && tool !== t.id}
              className={`${tool === t.id ? ui.btnActive : ui.btn} aspect-square flex items-center justify-center text-sm`}
              onClick={() => ctx.setTool(tool === t.id ? "select" : t.id)}
            >
              {t.glyph}
            </button>
          ))}
          <label
            title="Image"
            aria-label="Image"
            aria-disabled={full}
            className={`${ui.btn} aspect-square flex items-center justify-center text-sm ${full ? "cursor-not-allowed opacity-30" : "cursor-pointer"}`}
          >
            🖼
            <input type="file" accept="image/*" className="sr-only" disabled={full} onChange={pickImage} />
          </label>
        </div>
      </div>

      <p className={ui.hint}>
        {full
          ? `That is all ${MAX_OVERLAYS} overlays — delete one to add another.`
          : (HINTS[tool] ?? "Drag on the video to draw. Esc cancels.")}
      </p>

      {overlay ? (
        <div className="space-y-2 border-t border-border pt-2">
          <span className={ui.label}>{overlay.type}</span>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-muted">
              Start
              <input
                type="number"
                step={0.1}
                min={0}
                value={overlay.start}
                className={ui.field}
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
                className={ui.field}
                onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { end: num(e.target.value, overlay.end) }))}
              />
            </label>
          </div>

          {/* `overlay` is only set once `index` is in range, so `overlayLanes.rows[index]` is always defined. */}
          <dl className="space-y-1 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-dim">Row</dt>
              <dd className="text-muted">
                {overlayLanes.rows[index] + 1} of {overlayLanes.count}
              </dd>
            </div>
          </dl>

          {/* Blur has no colour (it resamples the pixels underneath it) and an image brings its own. */}
          {COLOURED.includes(overlay.type) && (
            <div className={ui.group}>
              <span className="text-[11px] text-muted">Colour</span>
              <div className={`${ui.swatchGrid} grid-cols-8`}>
                {SWATCH_PALETTE.map((hex) => {
                  const on = (overlay.color ?? DEFAULT_COLOR) === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      title={hex}
                      aria-label={`Colour ${hex}`}
                      aria-pressed={on}
                      className={on ? ui.swatchOn : ui.swatch}
                      style={{ background: hex }}
                      onClick={() => ctx.apply((ed) => ops.updateOverlay(ed, index, { color: hex }))}
                    />
                  );
                })}
                <input
                  type="color"
                  title="Custom colour"
                  aria-label="Custom colour"
                  value={overlay.color ?? DEFAULT_COLOR}
                  className={`${ui.swatch} cursor-pointer border-0 p-0`}
                  onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { color: e.target.value }))}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
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
              <div className="w-36">
                <Slider
                  name="Thickness"
                  value={overlay.thickness ?? DEFAULT_OVERLAY_THICKNESS}
                  min={0.002}
                  max={MAX_OVERLAY_THICKNESS}
                  step={0.002}
                  format={thicknessFmt}
                  onChange={(v) => ctx.apply((ed) => ops.updateOverlay(ed, index, { thickness: v }))}
                />
              </div>
            )}
            {overlay.type === "step" && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Number
                <input
                  type="number"
                  step={1}
                  min={1}
                  value={overlay.n ?? 1}
                  className={ui.field}
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

          {/*
            Arrows only. A line shares the arrow's from/to representation, but
            `render.ts`'s "line" case draws a plain moveTo/lineTo and never reads
            `o.style` — offering the picker there would be a control that
            visibly does nothing. Widen this when the renderer honours it.
          */}
          {overlay.type === "arrow" && (
            <div className={ui.group}>
              <span className="text-[11px] text-muted">Style</span>
              <div className={ui.seg}>
                {ARROW_STYLES.map((s) => {
                  const on = (overlay.style ?? "standard") === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      className={on ? ui.segItemOn : ui.segItem}
                      onClick={() => ctx.apply((ed) => ops.updateOverlay(ed, index, { style: s.id }))}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
              {overlay.style === "curved" && (
                <p className={ui.hint}>
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
                  className={overlay.bg === undefined ? ui.btnActive : ui.btn}
                  onClick={() => ctx.apply((ed) => ops.updateOverlay(ed, index, { bg: undefined }))}
                >
                  None
                </button>
              </div>
              <p className={ui.hint}>Wraps inside the box you drew; drag its corner to rewrap.</p>
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
                    className={`${overlay.text === emoji ? ui.btnActive : ui.btn} text-sm leading-none`}
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
                  className={ui.field}
                  onChange={(e) => ctx.apply((ed) => ops.updateOverlay(ed, index, { text: e.target.value }))}
                />
              </label>
            </div>
          )}

          <button
            type="button"
            className="text-[11px] text-danger-text/80 hover:text-danger-hover"
            onClick={() => {
              ctx.apply((ed) => ops.removeOverlay(ed, index));
              ctx.setSelected(null);
            }}
          >
            Delete overlay
          </button>
        </div>
      ) : (
        <p className={ui.hint}>
          {edits.overlays.length === 0
            ? "No overlays yet."
            : `${edits.overlays.length} overlay${edits.overlays.length === 1 ? "" : "s"} · click one on the video or the timeline to edit it.`}
        </p>
      )}
    </div>
  );
}
