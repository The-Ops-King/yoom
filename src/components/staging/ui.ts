/**
 * One control vocabulary for the whole rail.
 *
 * Every section used to spell out its own label, button and slider classes,
 * so the eight panels drifted apart: three label sizes, two button heights and
 * a different spacing scale in each. Sections import from here instead, which
 * keeps a change in one place and the rail reading as one panel.
 */

/** Section-internal heading. The rail's own headers are set in `rail.tsx`. */
export const label =
  "block text-[11px] font-mono uppercase tracking-[0.14em] text-muted-dim";

/** Body copy under a control — hints, empty states, explanations. */
export const hint = "text-[11px] leading-relaxed text-muted-dim";

/** Default control. `active` is the same box, lit. */
export const btn =
  "rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-muted";

export const btnActive =
  "rounded-md border border-accent bg-accent/15 px-2 py-1 text-[11px] font-medium text-foreground";

/** Destructive inline action (remove, discard). */
export const btnDanger =
  "rounded-md px-2 py-1 text-[11px] font-medium text-danger-text/80 transition-colors hover:text-danger-hover disabled:opacity-30 disabled:hover:text-danger-text/80";

/**
 * Small numeric input sitting inline with a label — zoom and overlay
 * coordinates. `select-text` because the staging root sets `select-none` and
 * `user-select` inherits: without it the caret cannot select a value to retype.
 */
export const field =
  "w-20 select-text rounded-md border border-border bg-surface-raised px-1.5 py-1 text-[11px] tabular-nums text-foreground";

/** Full-width text input or textarea — the Details form. */
export const input =
  "w-full select-text rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-dim focus:border-accent/50 focus:ring-1 focus:ring-accent/20";

/** Row of controls that may wrap on a 320px rail. */
export const btnRow = "flex flex-wrap items-center gap-1.5";

/** Checkbox line. */
export const check = "flex items-center gap-2 text-[11px] text-muted";

/** Slider row: fixed-width name, slider takes the rest, value pinned right. */
export const sliderRow = "flex items-center gap-2 text-[11px] text-muted";
export const sliderName = "w-14 shrink-0";
export const slider = "min-w-0 flex-1 disabled:opacity-30";
export const sliderValue =
  "w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-dim";

/**
 * Segmented control: mutually exclusive choices in a shared trough. Use for
 * 2-5 options that would otherwise be a row of `btn`s (camera mode and shape,
 * background kind, arrow style).
 */
export const seg = "flex gap-0.5 rounded-lg bg-surface-raised p-0.5";
export const segItem =
  "flex-1 rounded-md px-2 py-1 text-center text-[11px] text-muted transition-colors hover:text-foreground";
/**
 * Selected segment. `text-white`, not `text-foreground`: `#f5f3ee` on
 * `--color-accent` `#3f7d5c` measures ~4.39:1, under WCAG AA's 4.5:1 for
 * normal text. White is ~4.87:1. This exact regression already shipped once
 * in this project — do not reintroduce it.
 */
export const segItemOn =
  "flex-1 rounded-md bg-accent px-2 py-1 text-center text-[11px] font-semibold text-white";

/**
 * Filled-bar slider: the row IS the track, accent fill shows the value, name
 * left, value right. Replaces the `sliderRow`/`sliderName`/`slider`/
 * `sliderValue` quartet, which wastes a third of a 320px rail on a thin line.
 * See `slider.tsx` for the `<Slider>` component built from these.
 */
export const sliderFill =
  "relative flex h-7 items-center overflow-hidden rounded-lg border border-border-subtle bg-surface-raised px-2.5";
export const sliderFillBar = "absolute inset-y-0 left-0 bg-accent/20 border-r border-accent/50";
export const sliderFillName = "relative text-[11px] text-muted";
export const sliderFillValue = "relative ml-auto font-mono text-[11px] tabular-nums text-foreground";
export const sliderInput = "absolute inset-0 h-full w-full cursor-ew-resize opacity-0";

/** Swatch grid for backgrounds and colours. Caller sets the column count. */
export const swatchGrid = "grid gap-1";
export const swatch = "aspect-square rounded-md border border-border-subtle";
export const swatchOn =
  "aspect-square rounded-md outline outline-2 outline-accent-text outline-offset-1";

/**
 * Horizontal bar chrome shared by the top bar and the transport bar. Owned
 * here so both can read the same look; `top-bar.tsx` and `transport.tsx`
 * still carry their own copies pending a follow-up cleanup.
 */
export const bar = "rounded-lg border border-border bg-surface px-3 py-2";

/**
 * Seconds formatter. Lives here (a class-string file) rather than a
 * component/hook file because it's a plain, dependency-free helper reused by
 * both markup (`slider.tsx`) and non-markup panel code — no `.tsx` needed to
 * own it, and it belongs next to the other rail-wide conventions. Four
 * byte-identical copies still live in `transport.tsx`, `sections/cursor.tsx`,
 * `sections/zoom.tsx` and `sections/camera.tsx` pending a follow-up cleanup.
 */
export const fmt = (t: number) => `${t.toFixed(1)}s`;

/** Gap between blocks inside a section, and between a label and its control. */
export const section = "space-y-3";
export const group = "space-y-1.5";
