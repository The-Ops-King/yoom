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

/** Gap between blocks inside a section, and between a label and its control. */
export const section = "space-y-3";
export const group = "space-y-1.5";
