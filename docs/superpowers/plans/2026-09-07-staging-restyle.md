# Staging Editor Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Yoom's staging editor along Recordly's lines — packed timeline rows, a top bar, a right-hand icon strip showing one panel at a time — without changing how recording, rendering or upload work.

**Architecture:** Pure logic goes into `src/lib/editor/lanes.ts` and `src/lib/recording/settings.ts` where it can be tested in the existing node-environment vitest setup. The UI changes are confined to `src/components/staging/`, reusing the section components unchanged wherever possible. One data-model change: `FrameConfig.shadow` becomes a number.

**Tech Stack:** Next.js 16 (App Router, RSC + `"use client"`), React 19, TypeScript, Tailwind v4 (`@theme inline` tokens in `globals.css`), Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-09-07-staging-restyle-design.md`

---

## Context an engineer needs before starting

**Read these first:**
- `src/lib/edits.ts` — `VideoEdits`, `Zoom`, `Overlay`, `CameraTrack`, `ClickMark`. This is the document model the editor edits.
- `src/components/staging/types.ts` — `StagingContext`, the object every section and the timeline receive.
- `src/components/staging/ui.ts` — the shared control-class vocabulary. New controls go here, not into individual sections.

**Testing reality:** `vitest.config.mts` sets `environment: "node"` and
`include: ["src/**/*.test.ts"]`. `.tsx` is **not** included — this repo has no
component tests and this plan does not add any. Logic worth testing gets
extracted into `.ts`. Run tests with `npm test`.

**What already exists** (do not rebuild it): the timeline's clip track with trim
handles and cut regions, the camera-keyframe lane, the clicks lane with
per-click `on` toggles, the `laneCount > 8` scroll behaviour, and
`ctx.openSection?.(...)` wiring so selecting a timeline object opens its section.

**Review policy.** Every task gets a spec-compliance review. Only two also get a
separate code-quality review: **Task 7** (the `shadow` model change — the one
change that can alter how already-saved recordings render) and **Task 12**
(sticky defaults — it writes persisted user state). Everything else is UI work
where a single review is enough; findings that are genuinely about quality can be
raised by the spec reviewer in the same pass.

**Commit style:** conventional commits, present tense, scoped — e.g.
`feat(staging): pack zoom and overlay lanes into rows`. Match the existing log.

---

## File Structure

**Create:**
- `src/lib/editor/lanes.ts` — `packRows()`. Pure interval packing, no React, no DOM.
- `src/lib/editor/lanes.test.ts` — its tests.
- `src/components/staging/top-bar.tsx` — the top bar (history, title, slug, discard, upload).
- `src/components/staging/icon-strip.tsx` — the vertical section selector.
- `src/components/staging/transport.tsx` — split/cut tools, time, transport, fit.
- `src/components/staging/slider.tsx` — the filled-bar `<Slider>` used by every panel. Markup, so it lives here rather than in `ui.ts`, which holds only class strings.

**Modify:**
- `src/components/staging/timeline.tsx` — consume `packRows()` for zoom and overlay lanes; fix `laneCount`.
- `src/components/staging/rail.tsx` — drop the accordion, render one panel.
- `src/components/staging/staging.tsx` — new grid, mount top bar and transport.
- `src/components/staging/ui.ts` — add `seg`/`segItem`/`segItemOn`, the `sliderFill` family, `swatchGrid`/`swatch`/`swatchOn`.
- `src/lib/recording/types.ts` — `FrameConfig.shadow: boolean → number`.
- `src/lib/recording/settings.ts` — shadow migration, sticky-default blocks.
- `src/lib/editor/render.ts` — scale the shadow by strength.
- `src/components/staging/sections/*.tsx` — adopt the new control classes.
- `src/components/staging/overlay-layer.tsx`, `camera-layer.tsx` — preview selection opens the matching panel.

**Delete:**
- `src/components/staging/sections/trim.tsx` — cuts live on the Clip lane; Split/Cut move to the transport.
- `src/components/staging/sections/upload.tsx` — becomes the top-bar button.

---

# Phase 1 — Row packing

Highest value, lowest risk, no layout change. Seven non-overlapping overlays
currently render seven lanes; after this they render one.

### Task 1: `packRows()`

**Files:**
- Create: `src/lib/editor/lanes.ts`
- Test: `src/lib/editor/lanes.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/editor/lanes.test.ts
import { describe, expect, it } from "vitest";
import { packRows } from "./lanes";

const span = (start: number, end: number) => ({ start, end });

describe("packRows", () => {
  it("puts everything in one row when nothing overlaps", () => {
    expect(packRows([span(0, 1), span(2, 3), span(4, 5)])).toEqual([0, 0, 0]);
  });

  it("opens a second row for an overlap", () => {
    expect(packRows([span(0, 5), span(2, 7)])).toEqual([0, 1]);
  });

  it("uses exactly as many rows as the deepest overlap", () => {
    // three live at t=3, so three rows and no more
    const rows = packRows([span(0, 5), span(2, 7), span(3, 4), span(9, 10)]);
    expect(Math.max(...rows) + 1).toBe(3);
  });

  it("reuses a row once it is free", () => {
    // the third starts after the first ends, so it goes back to row 0
    expect(packRows([span(0, 5), span(2, 7), span(6, 8)])).toEqual([0, 1, 0]);
  });

  it("treats touching spans as non-overlapping", () => {
    expect(packRows([span(0, 5), span(5, 9)])).toEqual([0, 0]);
  });

  it("returns rows in the caller's order, not sorted order", () => {
    // input is out of time order; result must line up index-for-index
    expect(packRows([span(6, 8), span(0, 5), span(2, 7)])).toEqual([0, 0, 1]);
  });

  it("handles zero-length spans", () => {
    expect(packRows([span(3, 3), span(3, 3)])).toEqual([0, 0]);
  });

  it("is empty for no input", () => {
    expect(packRows([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lanes`
Expected: FAIL — `Failed to resolve import "./lanes"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/editor/lanes.ts

/** Anything with a time span: a `Zoom`, an `Overlay`, a `Cut`. */
export type Span = { start: number; end: number };

/**
 * Assign each span the index of a row it can occupy without overlapping
 * anything already in that row.
 *
 * Greedy first-fit over spans sorted by start time uses exactly as many rows as
 * the deepest overlap — no more. (Time spans form an interval graph, where
 * greedy colouring by left endpoint is optimal: when a span is placed, every
 * row below the one it takes is busy, so those spans all overlap it and each
 * other, and no colouring could use fewer.)
 *
 * Touching spans share a row: an overlay ending exactly where the next begins
 * never draws over it.
 *
 * The result is indexed to match `spans`, NOT the sorted order, so callers can
 * do `rows[i]` against their own array.
 */
export function packRows(spans: readonly Span[]): { rows: number[]; count: number } {
  const order = spans
    .map((span, index) => ({ span, index }))
    .sort((a, b) => a.span.start - b.span.start || a.index - b.index);

  const rows = new Array<number>(spans.length);
  /** The end time of the last span placed in each row. */
  const rowEnds: number[] = [];

  for (const { span, index } of order) {
    let row = rowEnds.findIndex((end) => end <= span.start);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(span.end);
    } else {
      rowEnds[row] = span.end;
    }
    rows[index] = row;
  }

  return rows;
}

// NOTE: revised during Task 1 review — `packRows` returns `{rows, count}` in one
// pass rather than a separate `rowCount()` helper, and skips malformed spans
// (NaN or inverted) so they cannot widen the timeline. See lanes.ts for the
// authoritative signature.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lanes`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/lanes.ts src/lib/editor/lanes.test.ts
git commit -m "feat(editor): pack time spans into minimum rows"
```

---

### Task 2: Pack the zoom and overlay lanes

`timeline.tsx` currently renders `edits.zooms.map(...)` and
`edits.overlays.map(...)` as one lane each. Group them by packed row instead.

**Files:**
- Modify: `src/components/staging/timeline.tsx:196-202` (laneCount), `:284-300` (zoom lanes), `:410-425` (overlay lanes)

- [ ] **Step 1: Import the helper and compute rows**

At the top of `timeline.tsx`, alongside the existing imports:

```ts
import { packRows } from "@/lib/editor/lanes";
```

Replace the `laneCount` block at `:199-201`:

```ts
  const camera = edits.camera;
  // The clicks lane exists only for a take the desktop hook actually saw.
  const clicks = edits.clicks ?? [];

  // Zooms and overlays share rows when they do not overlap in time: seven
  // non-overlapping overlays are one row, not seven lanes. `rows[i]` is the row
  // for `edits.overlays[i]`, so selection and drag indices are unaffected.
  const zoomLanes = packRows(edits.zooms);
  const overlayLanes = packRows(edits.overlays);
  const laneCount =
    zoomLanes.count + overlayLanes.count + (camera ? 1 : 0) + (clicks.length > 0 ? 1 : 0);
```

- [ ] **Step 2: Render zoom rows instead of zoom lanes**

Replace `{edits.zooms.map((z, i) => (` … `))}` with a row-grouped render. Each
row is one lane `div` containing every zoom assigned to it; the inner clip
markup, handlers and class names are unchanged from the current code — only the
nesting and the label change.

```tsx
{Array.from({ length: zoomLanes.count }, (_, row) => (
  <div key={`zoom-row-${row}`} className={`${laneRow} border-border`}>
    <span className={laneLabel}>{row === 0 ? "Zoom" : ""}</span>
    {edits.zooms.map((z, i) =>
      zoomLanes.rows[i] !== row ? null : (
        <div
          key={`zoom-${i}`}
          className={`${laneClip} z-30 cursor-grab ${
            isSel("zoom", i) ? "border-sky-300 bg-sky-500/50" : "border-sky-500/50 bg-sky-500/25"
          }`}
          style={{ left: pct(z.start), width: pct(z.end - z.start) }}
          title={z.kind === "follow" ? `Follow ${i + 1}` : `Zoom ${i + 1}`}
          onPointerDown={(e) => {
            ctx.setSelected({ kind: "zoom", index: i });
            ctx.openSection?.("zoom");
            begin(e, { kind: "zoom", index: i });
          }}
        />
      ),
    )}
  </div>
))}
```

**Note:** the per-lane selection border moved onto the clip itself, because a row
can hold several zooms and the row cannot be "the selected one". The clip's own
`isSel` border already carries that.

- [ ] **Step 3: Render overlay rows the same way**

Replace `{edits.overlays.map((o, i) => (` … `))}`:

```tsx
{Array.from({ length: overlayLanes.count }, (_, row) => (
  <div key={`ov-row-${row}`} className={`${laneRow} border-border`}>
    <span className={laneLabel}>{row === 0 ? "Overlays" : ""}</span>
    {edits.overlays.map((o, i) =>
      overlayLanes.rows[i] !== row ? null : (
        <div
          key={`ov-${i}`}
          title={`${overlayLabel(i)} — ${o.type}`}
          className={`${laneClip} z-30 cursor-grab ${
            isSel("overlay", i) ? "border-emerald-200 bg-emerald-500/50" : "border-emerald-500/50 bg-emerald-500/25"
          }`}
          style={{ left: pct(o.start), width: pct(o.end - o.start) }}
          onPointerDown={(e) => {
            ctx.setSelected({ kind: "overlay", index: i });
            ctx.openSection?.("overlays");
            begin(e, { kind: "overlay", index: i });
          }}
        />
      ),
    )}
  </div>
))}
```

Keep whatever extra fields the existing `begin(e, {...})` calls pass — copy them
verbatim from the current code rather than retyping from this plan.

- [ ] **Step 4: Verify by running the app**

```bash
npm run dev
```

Open a staging session with several non-overlapping overlays. Expected: one
overlay row, not one per overlay. Drag one so it overlaps another: a second row
appears. Drag it clear again: back to one row. Selection borders and drag
behaviour unchanged.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. No existing test asserts lane counts, so nothing should break.

- [ ] **Step 6: Commit**

```bash
git add src/components/staging/timeline.tsx
git commit -m "feat(staging): pack zoom and overlay lanes into rows"
```

---

### Task 3: Report the packed row in the Overlays panel

**Files:**
- Modify: `src/components/staging/sections/overlays.tsx`

- [ ] **Step 1: Show the row for the selected overlay**

Import the helper:

```ts
import { packRows } from "@/lib/editor/lanes";
```

Inside `OverlaysSection`, after the existing `edits` is in scope:

```tsx
const { rows, count } = packRows(edits.overlays);
const sel = ctx.selected?.kind === "overlay" ? ctx.selected.index : null;
```

Render, beneath the selected overlay's controls:

```tsx
{sel !== null && (
  <div className={ui.check}>
    <span>Row</span>
    <span className="ml-auto font-mono tabular-nums text-foreground">
      {rows[sel] + 1} of {count}
    </span>
  </div>
)}
```

- [ ] **Step 2: Verify**

Select an overlay that shares a row with another. Expected: `Row 1 of 2` style
readout matching where it sits on the timeline.

- [ ] **Step 3: Commit**

```bash
git add src/components/staging/sections/overlays.tsx
git commit -m "feat(staging): show which packed row an overlay sits in"
```

---

# Phase 2 — Shell

Top bar, icon strip, one panel, transport row. Section components render
unchanged inside the new frame; only `rail.tsx` and `staging.tsx` restructure.

### Task 4: The top bar

**Files:**
- Create: `src/components/staging/top-bar.tsx`
- Modify: `src/components/staging/staging.tsx:443-449`

- [ ] **Step 1: Write the component**

```tsx
// src/components/staging/top-bar.tsx
"use client";

import type { StagingContext } from "./types";
import * as ui from "./ui";

/**
 * The editor's title row: history on the left, what this recording will be
 * called and where it will live in the middle, and the one action that ends
 * staging on the right.
 *
 * Title and slug are the same state the Details panel edits — this is a second
 * view of it, not a copy.
 */
export function TopBar({ ctx, shareBase }: { ctx: StagingContext; shareBase: string }) {
  return (
    <header className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <button type="button" disabled={!ctx.canUndo} onClick={ctx.undo} className={ui.btn}>
        Undo
      </button>
      <button type="button" disabled={!ctx.canRedo} onClick={ctx.redo} className={ui.btn}>
        Redo
      </button>

      <input
        value={ctx.details.title}
        onChange={(e) => ctx.setDetails({ ...ctx.details, title: e.target.value })}
        placeholder="Untitled recording"
        aria-label="Recording title"
        className="min-w-0 flex-1 select-text border-b border-dashed border-border bg-transparent pb-0.5 text-sm font-semibold text-foreground outline-none placeholder:text-muted-dim focus:border-accent/50"
      />

      <span className={`${ui.hint} shrink-0 truncate`}>
        {shareBase}/v/<span className="text-muted">{ctx.details.slug || "auto"}</span>
      </span>

      <button type="button" onClick={ctx.discard} className={ui.btnDanger}>
        Discard
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={reason ? "staging-upload-reason" : undefined}
        onClick={ctx.finish}
        className="shrink-0 rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
      >
        Upload
      </button>
    </header>
  );
}
```

The gating comes from `sections/upload.tsx:17-27` and moves here **verbatim** —
put this above the `return`:

```tsx
  const nothingKept = keptRanges(ctx.edits, ctx.duration).length === 0;
  // An empty slug means "auto" and never blocks; anything else has to have
  // come back available from the details form's check.
  const slugBlocked = ctx.details.slug !== "" && ctx.details.slugOk !== true;
  const disabled = nothingKept || slugBlocked;

  const reason = nothingKept
    ? "Every second is trimmed or cut away."
    : slugBlocked
      ? "Waiting on the share link — check it in Details."
      : null;
```

with `import { keptRanges } from "@/lib/editor/cuts";`.

The reason line and `ctx.error` alert (`upload.tsx:58-65`) move too — render them
in a `<p>` below the header, since a header row has no space for them:

```tsx
<p id="staging-upload-reason" aria-live="polite" className={`${ui.hint} empty:hidden`}>{reason}</p>
{ctx.error && <p role="alert" className="text-[11px] text-danger-text/90">{ctx.error}</p>}
```

The take summary (length, size, link) that `upload.tsx` also rendered moves into
the **Details** panel — it is metadata about the recording, which is what that
panel is for.

**Names to note:** the action is `ctx.finish()`, not `ctx.upload`; there is no
`ctx.uploading`. `ctx.details` is `{title, description, slug, thumbnailAt, slugOk}`
and `ctx.setDetails` accepts an updater function.

- [ ] **Step 2: Mount it and check it renders**

In `staging.tsx`, wrap the existing grid:

```tsx
<div className="w-full max-w-[1280px] select-none space-y-3">
  <TopBar ctx={ctx} shareBase={props.shareBase} />
  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
    <div className="min-w-0 space-y-3">
      <Preview ctx={ctx} />
      <Timeline ctx={ctx} />
    </div>
    <Rail ctx={ctx} section={section} onSection={setSection} />
  </div>
</div>
```

`shareBase` comes from `shareBaseUrl()` in `@/lib/env`, passed down as a prop
from the server component that renders staging — follow how `slug-editor.tsx`
already receives its prefix.

Run: `npm run dev`. Expected: title bar above the editor, title editable, slug
preview updating as Details changes it, Upload working as before.

- [ ] **Step 3: Delete the upload section**

```bash
git rm src/components/staging/sections/upload.tsx
```

Remove its import and its `SECTIONS` entry from `rail.tsx`, and the `"upload"`
member of `RailSection`.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run lint`
Expected: PASS, no unused-import errors.

```bash
git add -A src/components/staging
git commit -m "feat(staging): add the editor top bar and retire the upload section"
```

---

### Task 5: The transport row

**Corrected after reading the code.** The original draft of this task was wrong
in three ways and must not be followed:

- There is **no `splitAt` in `edit-ops.ts`** and no "split" concept anywhere in
  the editor. It was invented. Do not add one.
- `addCut` takes a `Cut` object: `ops.addCut(e, { start, end })`, not two
  positional times.
- `sections/trim.tsx` does more than trim. Besides In/Out and the cut list it
  carries **marker cuts** — the take's recorded `Marker[]` (`{t, label?}`), each
  with seek plus one-click "cut the 2s before" / "cut the 2s after"
  (`MARKER_CUT_S = 2`). Nothing on the timeline replaces that, so it must be
  rehomed, not deleted.

**Files:**
- Create: `src/components/staging/transport.tsx`
- Modify: `src/components/staging/staging.tsx`, `src/components/staging/rail.tsx`, `src/components/staging/sections/cursor.tsx`
- Delete: `src/components/staging/sections/trim.tsx`

**What goes where**

| From `trim.tsx` | Goes to | Why |
|---|---|---|
| Set In, Set Out, Cut range, Reset trim | the transport | They act on the playhead |
| Marker list (seek, cut-before, cut-after) | Cursor & clicks panel | Markers are captured time-point events, exactly like clicks |
| Cut list (`0:12 -> 0:18` rows) | dropped | Cuts are selectable on the Clip lane and Delete removes them (`staging.tsx:260`) |

- [ ] **Step 1: Build the transport**

`src/components/staging/transport.tsx`, a client component. It carries, copied
from the real `trim.tsx`: Set In / Set Out (writing `ctx.setInPoint` /
`ctx.setOutPoint` from `player.timeRef.current`), Cut range (disabled unless both
are set, using `ops.addCut(e, {start: Math.min(...), end: Math.max(...)})` exactly
as `trim.tsx:37` does), and Reset trim
(`ops.setTrim(e, duration, {start: 0, end: duration})`, disabled unless trimmed).

Plus playback: `player.editedTime`, a play/pause button calling `player.toggle()`,
and `player.editedDuration`. There is no `player.duration`.

- [ ] **Step 2: Mount it between the preview and the timeline** in `staging.tsx`.

- [ ] **Step 3: Move the markers block** into `sections/cursor.tsx`, preserving
      `MARKER_CUT_S` and all three actions verbatim.

- [ ] **Step 4: Delete `sections/trim.tsx`**, remove `"trim"` from `RailSection`
      and `SECTIONS` and its import/branch in `rail.tsx`. **`staging.tsx`'s
      `useState<RailSection>("trim")` must change** — `"trim"` no longer exists.
      Use `"camera"`.

- [ ] **Step 5: Verify** `npm test`, `npm run lint`, `npx tsc --noEmit` (exactly
      3 known pre-existing errors), `npm run build`.

- [ ] **Step 6: Commit** as `feat(staging): add the transport row and retire the trim section`.

### Task 6: The icon strip, and preview-side selection

**Verified against HEAD before dispatch — these are current, do not re-derive:**
- `RailSection` is now exactly `"camera" | "frame" | "zoom" | "overlays" | "cursor" | "details"` — six members. `"trim"` and `"upload"` are already gone.
- `staging.tsx` already initialises to `"camera"`.
- The rail's Undo/Redo/Discard row is already gone (it lives in `top-bar.tsx`).
- The cursor section's label is now `"Cursor, input & markers"` — carry that wording into the icon's `title`/`aria-label`.
- `Selection` is `{kind: "overlay" | "cut" | "keyframe" | "zoom"; index: number; t?: number} | null` at `types.ts:109` — it does NOT yet have `"camera"`.
- `overlay-layer.tsx:283` already calls `setSelected({kind: "overlay", index})` but does NOT call `openSection`.
- `camera-layer.tsx` has drag handling but no `setSelected` at all.

**Files:**
- Create: `src/components/staging/icon-strip.tsx`
- Modify: `src/components/staging/rail.tsx`

- [ ] **Step 1: Write the strip**

```tsx
// src/components/staging/icon-strip.tsx
"use client";

import type { RailSection } from "./rail";

/**
 * The rail's section selector. Six 34px buttons replace eight always-visible
 * header rows, so the open panel gets the height instead.
 *
 * Glyphs, not an icon library: the app has no icon dependency and these are
 * legible at 15px. `title` and `aria-label` carry the real name.
 */
const ICONS: { id: RailSection; glyph: string; label: string }[] = [
  { id: "camera", glyph: "◉", label: "Camera" },
  { id: "frame", glyph: "▣", label: "Frame" },
  { id: "zoom", glyph: "⌕", label: "Zoom" },
  { id: "overlays", glyph: "◈", label: "Overlays" },
  { id: "cursor", glyph: "➤", label: "Cursor & clicks" },
  { id: "details", glyph: "✎", label: "Details" },
];

export function IconStrip({
  section,
  onSection,
  showCamera,
}: {
  section: RailSection;
  onSection: (s: RailSection) => void;
  showCamera: boolean;
}) {
  const items = ICONS.filter((i) => i.id !== "camera" || showCamera);

  return (
    <nav aria-label="Editor panels" className="flex shrink-0 flex-col gap-1.5">
      {items.map((i) => {
        const on = section === i.id;
        return (
          <button
            key={i.id}
            type="button"
            title={i.label}
            aria-label={i.label}
            aria-current={on}
            onClick={() => onSection(i.id)}
            className={`flex h-[34px] w-[34px] items-center justify-center rounded-lg border text-[15px] transition-colors ${
              on
                ? "border-accent/50 bg-accent/15 text-accent-text"
                : "border-border bg-surface text-muted-dim hover:text-muted"
            }`}
          >
            <span aria-hidden>{i.glyph}</span>
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Rewrite the rail to render one panel**

Replace the whole `<aside>` body in `rail.tsx`. `RailSection` loses `"trim"` and
`"upload"`; `SECTIONS` and the accordion go.

```tsx
export type RailSection = "camera" | "frame" | "zoom" | "overlays" | "cursor" | "details";

const TITLES: Record<RailSection, string> = {
  camera: "Camera",
  frame: "Frame",
  zoom: "Zoom",
  overlays: "Overlays",
  cursor: "Cursor & clicks",
  details: "Details",
};

export function Rail({ ctx, section, onSection }: {
  ctx: StagingContext;
  section: RailSection;
  onSection: (s: RailSection) => void;
}) {
  const showCamera = ctx.mode === "screen+camera";
  // A camera-only take has no Camera panel; if it was open when the mode
  // changed, fall back rather than render an empty rail.
  const active = section === "camera" && !showCamera ? "frame" : section;

  return (
    <aside className="flex gap-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
      <IconStrip section={active} onSection={onSection} showCamera={showCamera} />
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface lg:min-h-0 lg:overflow-y-auto">
        <div className={`border-b border-border px-3 py-2 ${ui.label}`}>{TITLES[active]}</div>
        <div className="p-3">
          {active === "camera" && <CameraSection ctx={ctx} />}
          {active === "frame" && <FrameSection ctx={ctx} />}
          {active === "zoom" && <ZoomSection ctx={ctx} />}
          {active === "overlays" && <OverlaysSection ctx={ctx} />}
          {active === "cursor" && <CursorSection ctx={ctx} />}
          {active === "details" && <DetailsForm ctx={ctx} />}
        </div>
      </div>
    </aside>
  );
}
```

Update the initial state in `staging.tsx:118` — `useState<RailSection>("trim")`
is now an invalid member. Use `"camera"`.

- [ ] **Step 3: Widen the rail column**

In `staging.tsx`, the rail now holds a 34px strip plus the panel:

```tsx
<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_366px]">
```

- [ ] **Step 4: Verify**

Run: `npm run dev`. Expected: six icons, one panel, the active icon lit with an
accent border. Clicking a zoom or overlay on the timeline still opens its panel
(`ctx.openSection` is unchanged). A camera-only take shows five icons.

Run: `npm run lint` — expected PASS, no unused imports from the deleted sections.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/staging
git commit -m "feat(staging): replace the accordion rail with an icon strip"
```

---

#### Part 2 — preview-side selection (same task, same commit series)

The timeline already does this; the preview does not. `overlay-layer.tsx:283`
selects an overlay but never opens the section, and the camera bubble is not a
`Selection` kind at all.

**Files:**
- Modify: `src/components/staging/types.ts:102`, `src/components/staging/overlay-layer.tsx:283`, `src/components/staging/camera-layer.tsx:227-245`

- [ ] **Step 1: Open the panel when an overlay is grabbed in the preview**

`overlay-layer.tsx`, at the existing `setSelected` call:

```tsx
    ctx.setSelected({ kind: "overlay", index });
    ctx.openSection?.("overlays");
```

- [ ] **Step 2: Make the camera selectable**

`types.ts:102` — add the kind. `index` stays required and is `0` for the camera,
which has only one track:

```ts
-export type Selection = { kind: "overlay" | "cut" | "keyframe" | "zoom"; index: number; t?: number } | null;
+export type Selection = { kind: "overlay" | "cut" | "keyframe" | "zoom" | "camera"; index: number; t?: number } | null;
```

`camera-layer.tsx`, inside `begin` (`:227`), before the drag state is set:

```tsx
    ctx.setSelected({ kind: "camera", index: 0 });
    ctx.openSection?.("camera");
```

- [ ] **Step 3: Check nothing switched on the old exhaustive set**

Run: `npx tsc --noEmit`
Expected: PASS. If a `switch` on `selected.kind` now reports a missing case, add
`"camera"` to it — do not widen the type with a default branch.

- [ ] **Step 4: Verify**

Run: `npm run dev`. Expected: clicking the camera bubble in the preview opens the
Camera panel; clicking an overlay opens Overlays with it selected. Dragging still
moves and resizes as before.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/staging
git commit -m "feat(staging): open the matching panel from preview selection"
```

---

# Phase 3 — Control vocabulary and the shadow model

### Task 7: `shadow` becomes a number

**Files:**
- Modify: `src/lib/recording/types.ts:309`, `src/lib/recording/settings.ts:38,124`, `src/lib/editor/render.ts:595-596`
- Modify: `src/components/staging/frame-picker.tsx:292-293` — **the shadow control lives here, not in `sections/frame.tsx`**
- Fixtures to update: `src/lib/edits.test.ts:228,399`, `src/lib/recording/settings.test.ts:271`, `src/lib/recording/geometry.test.ts:372`, `src/lib/editor/render.test.ts:48,125,139`
- Test: `src/lib/recording/settings.test.ts`

**Full site inventory (verified by grep at `cefd487`).** An earlier draft of this
task named only 6 of the 12 places `shadow` is read or written. The one that
matters is `frame-picker.tsx:292-293`, where the control is a **checkbox**:

```tsx
checked={frame.shadow}
onChange={(e) => onChange({ shadow: e.target.checked })}
```

Changing the type without converting that control leaves the tree failing
typecheck, so it belongs in this task, not in Task 9. `npx tsc --noEmit` is what
proves the migration is complete — with no component tests in this repo it is the
only check that can, which is why the "exactly 3 pre-existing errors" baseline is
load-bearing rather than ceremony.

- [ ] **Step 1: Write the failing migration tests**

Append to `src/lib/recording/settings.test.ts`:

```ts
describe("sanitizeFrame shadow migration", () => {
  it("maps a legacy true to today's rendered weight", () => {
    expect(sanitizeFrame({ shadow: true }).shadow).toBe(0.5);
  });
  it("maps a legacy false to no shadow", () => {
    expect(sanitizeFrame({ shadow: false }).shadow).toBe(0);
  });
  it("keeps an in-range number", () => {
    expect(sanitizeFrame({ shadow: 0.15 }).shadow).toBe(0.15);
  });
  it("clamps out of range", () => {
    expect(sanitizeFrame({ shadow: 4 }).shadow).toBe(1);
    expect(sanitizeFrame({ shadow: -1 }).shadow).toBe(0);
  });
  it("falls back for garbage", () => {
    expect(sanitizeFrame({ shadow: "heavy" }).shadow).toBe(DEFAULT_FRAME.shadow);
  });
});
```

Add `sanitizeFrame` and `DEFAULT_FRAME` to the file's existing import from
`./settings` if they are not already there.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- settings`
Expected: FAIL — `expected true to be 0.5`.

- [ ] **Step 3: Change the type**

`src/lib/recording/types.ts`, in `FrameConfig`:

```ts
-  shadow: boolean;
+  /** Shadow strength, 0..1. 0 is none; 0.5 is what `shadow: true` used to draw. */
+  shadow: number;
```

- [ ] **Step 4: Migrate in `sanitizeFrame`**

`src/lib/recording/settings.ts`. Change the default:

```ts
-  shadow: true,
+  shadow: 0.5,
```

and the sanitize line at `:124`:

```ts
-    shadow: bool(frameRaw.shadow, fallback.shadow),
+    shadow: shadowStrength(frameRaw.shadow, fallback.shadow),
```

with, above `sanitizeFrame`:

```ts
/**
 * `shadow` was a boolean until the staging restyle. A stored `true` maps to 0.5,
 * which reproduces the old fixed shadow exactly (see `render.ts`), so existing
 * recordings render unchanged. The boolean form is read forever and never
 * written again — a settings-key bump would have thrown away every other
 * preference to fix one field.
 */
function shadowStrength(value: unknown, fallback: number): number {
  if (value === true) return 0.5;
  if (value === false) return 0;
  return num(value, fallback, 0, 1);
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -- settings`
Expected: PASS.

- [ ] **Step 6: Scale the render by strength**

`src/lib/editor/render.ts:595-596` currently reads:

```js
if (frame.shadow) {
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = W * 0.02; ctx.shadowOffsetY = W * 0.008;
```

Replace with:

```js
if (frame.shadow > 0) {
  // Strength scales alpha, blur and offset together so the shadow keeps its
  // shape and reads as one control. 0.5 reproduces the pre-restyle fixed values.
  const s = frame.shadow * 2;
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${0.45 * s})`;
  ctx.shadowBlur = W * 0.02 * s;
  ctx.shadowOffsetY = W * 0.008 * s;
```

- [ ] **Step 7: Fix the render tests**

`src/lib/editor/render.test.ts` uses `shadow: false` at `:48` and `:125`, and
`shadow: true` at `:139`. Change to `0` and `0.5`. Run:

Run: `npm test`
Expected: PASS across the whole suite. Any other `shadow:` boolean literal that
fails to typecheck is a site the migration must also cover — fix it to a number.

- [ ] **Step 8: Commit**

```bash
git add -A src/lib src/components
git commit -m "feat(editor): make frame shadow a 0..1 strength

A stored true maps to 0.5, which draws exactly the old fixed shadow, so
existing recordings render unchanged."
```

---

### Task 8: The control vocabulary, and every panel adopting it

Tasks 8-11 of an earlier draft are merged here: they were one job — give the rail
a single control vocabulary and apply it — split four ways for no benefit.

**Files:**
- Modify: `src/components/staging/ui.ts`
- Create: `src/components/staging/slider.tsx`
- Modify: `src/components/staging/frame-picker.tsx`, `sections/frame.tsx`,
  `sections/camera.tsx`, `sections/overlays.tsx`, `sections/zoom.tsx`,
  `sections/cursor.tsx`, `details-form.tsx`
- Modify: `src/components/staging/transport.tsx`, `top-bar.tsx` (shared bar shell only)

- [ ] **Step 1: Extend `ui.ts`** with the segmented control (`seg`, `segItem`,
      `segItemOn`), the filled-bar slider classes (`sliderFill`, `sliderFillBar`,
      `sliderFillName`, `sliderFillValue`, `sliderInput`), and the swatch grid
      (`swatchGrid`, `swatch`, `swatchOn`). Match the file's existing comment
      voice — each export says what it is for, not what it does.

      Also consolidate two things deferred from earlier tasks:
      - **`fmt`** — four byte-identical copies of `` `${t.toFixed(1)}s` `` now
        live in `transport.tsx`, `sections/cursor.tsx`, `sections/zoom.tsx` and
        `sections/camera.tsx`. Export one and delete the copies.
      - **`bar`** — the bar shell `rounded-lg border border-border bg-surface
        px-3 py-2` is hand-copied in `top-bar.tsx` and `transport.tsx`. Export it
        and use it in both.

- [ ] **Step 2: Create `src/components/staging/slider.tsx`** — the shared
      filled-bar `<Slider>`. A native `<input type="range">` sits transparent
      over the row so the control stays keyboard-operable and announced, while
      the accent fill shows the value. Markup, so it lives here rather than in
      `ui.ts`, which holds only class strings.

- [ ] **Step 3: Adopt it, one panel per commit.** Frame (via `frame-picker.tsx`,
      which holds the real controls), then Camera, Overlays, Zoom, Cursor,
      Details. Replace `sliderRow`/`sliderName`/`slider`/`sliderValue` triples
      with `<Slider>`, and mutually-exclusive button rows with the segmented
      control. **Behaviour must not change** — this is a restyle.

- [ ] **Step 4: Camera gains its two missing controls.** Not styling, so treat it
      as its own commit: the `pan` crop pad (a 2-axis value, so a draggable pad
      rather than two sliders) writing through
      `ops.upsertCameraKeyframe(e, t, { pan })`, and the `cameraOffsetMs` sync
      slider bounded by `MAX_CAMERA_OFFSET_MS` from `edits.ts`.

- [ ] **Step 5: Overlays gains the full tool grid** — all fifteen `OverlayType`
      values in a 5x3 grid, with the existing `MAX_OVERLAYS` cap guard and its
      "that is all 64 overlays" message preserved.

- [ ] **Step 6: Verify** `npm test`, `npm run lint`, `npx tsc --noEmit` (exactly
      3 known pre-existing errors), `npm run build`. Commit per panel so the
      review can read them separately.

# Phase 4 — Sticky defaults

### Task 9: Extend `RecorderSettings` with staging defaults

**Files:**
- Modify: `src/lib/recording/types.ts`, `src/lib/recording/settings.ts`
- Test: `src/lib/recording/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("staging defaults", () => {
  it("falls back to DEFAULT_STAGING when nothing is stored", () => {
    expect(loadSettings().staging).toEqual(DEFAULT_STAGING);
  });

  it("round-trips a changed overlay colour", () => {
    persistStaging({ ...DEFAULT_STAGING, overlayColor: "#b8543d" });
    expect(loadSettings().staging.overlayColor).toBe("#b8543d");
  });

  it("leaves other preferences alone", () => {
    saveSettings({ ...DEFAULT_SETTINGS, micOn: false });
    persistStaging({ ...DEFAULT_STAGING, clickColor: "#c9973f" });
    const after = loadSettings();
    expect(after.micOn).toBe(false);
    expect(after.staging.clickColor).toBe("#c9973f");
  });

  it("clamps a stored thickness out of range", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ staging: { overlayThickness: 99 } }));
    expect(loadSettings().staging.overlayThickness).toBe(MAX_OVERLAY_THICKNESS);
  });

  it("ignores a garbage staging block", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ staging: "nope" }));
    expect(loadSettings().staging).toEqual(DEFAULT_STAGING);
  });
});
```

The file already stubs `localStorage` at `:27` — reuse that stub.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- settings`
Expected: FAIL — `staging` is undefined.

- [ ] **Step 3: Add the type**

`src/lib/recording/types.ts`:

```ts
/**
 * Appearance the editor remembers between takes. Content never lives here —
 * cuts, placed zooms, placed overlays, click on/off toggles, camera keyframes
 * after t=0, title, description and slug are per-recording.
 */
export interface StagingDefaults {
  /** Bubble shape a new take's camera opens on. */
  cameraShape: BubbleShape;
  cameraMirror: boolean;
  /** Overlay styling a newly placed overlay inherits. */
  overlayColor: string;
  overlayThickness: number;
  arrowStyle: ArrowStyle;
  /** Click-highlight styling. */
  clickColor: string;
  clickRippleMs: number;
}
```

Add `staging: StagingDefaults;` to `RecorderSettings`.

`ArrowStyle` lives in `src/lib/edits.ts`; import the type.

- [ ] **Step 4: Add defaults, sanitizer and persist helper**

`src/lib/recording/settings.ts`:

```ts
export const DEFAULT_STAGING: StagingDefaults = {
  cameraShape: "circle",
  cameraMirror: true,
  overlayColor: "#c9973f",
  overlayThickness: 0.04,
  arrowStyle: "standard",
  clickColor: "#c9973f",
  clickRippleMs: 500,
};

const ARROW_STYLES: ArrowStyle[] = ["standard", "double", "curved", "fancy"];

function sanitizeStaging(raw: unknown, fallback: StagingDefaults = DEFAULT_STAGING): StagingDefaults {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    cameraShape: pick(r.cameraShape, SHAPES, fallback.cameraShape),
    cameraMirror: bool(r.cameraMirror, fallback.cameraMirror),
    overlayColor: str(r.overlayColor, fallback.overlayColor),
    overlayThickness: num(r.overlayThickness, fallback.overlayThickness, 0, MAX_OVERLAY_THICKNESS),
    arrowStyle: pick(r.arrowStyle, ARROW_STYLES, fallback.arrowStyle),
    clickColor: str(r.clickColor, fallback.clickColor),
    clickRippleMs: num(r.clickRippleMs, fallback.clickRippleMs, 0, 5000),
  };
}

/**
 * Merge staging appearance into stored settings, leaving every other preference
 * alone — the same contract as `persistFrame`.
 */
export function persistStaging(staging: StagingDefaults): void {
  if (typeof window === "undefined") return;
  const current = loadSettings();
  saveSettings({ ...current, staging: sanitizeStaging(staging, current.staging) });
}
```

Add `staging: DEFAULT_STAGING` to `DEFAULT_SETTINGS` and
`staging: sanitizeStaging(r.staging)` to `sanitize()`.

`MAX_OVERLAY_THICKNESS` is exported from `src/lib/edits.ts:256`.

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -- settings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/recording
git commit -m "feat(recording): persist staging appearance defaults"
```

---

### Task 10: Wire panels to read and write the defaults

**Files:**
- Modify: `sections/camera.tsx`, `sections/overlays.tsx`, `sections/cursor.tsx`, `staging.tsx`

- [ ] **Step 1: Seed new overlays from the stored defaults**

`staging.tsx:291` defines `addOverlayAt(type, rect, extra?)`. Read the stored
defaults once and fold them in under any explicit `extra`, so a caller that
passes its own colour still wins:

```tsx
const defaults = useMemo(() => loadSettings().staging, []);

const addOverlayAt = useCallback(
  (type: Overlay["type"], rect: Overlay["rect"], extra?: Partial<Overlay>) => {
    // Stored appearance is the floor, not the ceiling: an explicit `extra`
    // from the caller still wins.
    const styled: Partial<Overlay> = {
      color: defaults.overlayColor,
      thickness: defaults.overlayThickness,
      ...(type === "arrow" || type === "line" ? { arrowStyle: defaults.arrowStyle } : {}),
      ...extra,
    };
    ctxApply((e) => ops.addOverlay(e, type, rect, styled));
  },
  [defaults, ctxApply],
);
```

Match the real body of the existing `addOverlayAt` — this shows the seeding, not
a replacement for what it already does with `rect` clamping and the cap check.

- [ ] **Step 2: Persist on change, debounced**

A slider drag fires many changes; writing `localStorage` on each is wasteful.
Add to `staging.tsx`:

```tsx
// Appearance settles into the stored defaults, but not on every frame of a
// drag — one write once the value stops moving.
const stagingRef = useRef(defaults);
useEffect(() => {
  stagingRef.current = defaults;
  const id = setTimeout(() => persistStaging(stagingRef.current), 400);
  return () => clearTimeout(id);
}, [defaults]);
```

- [ ] **Step 3: Make Reset restore saved defaults**

Each panel's `Reset` link resets to `loadSettings().staging` (and
`loadSettings().frame` for Frame), **not** to `DEFAULT_STAGING`. Factory reset
is a separate control, next task.

- [ ] **Step 4: Verify**

Run: `npm run dev`. Set shadow to 15%, change the overlay colour, discard the
recording, start another. Expected: the new take opens at 15% shadow with the
same overlay colour. Hit Reset in Frame: returns to 15%, not to 2%.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/staging
git commit -m "feat(staging): remember appearance between takes"
```

---

### Task 11: Factory reset

**Files:**
- Modify: `src/components/settings/alert-toggles.tsx` or its parent settings page

- [ ] **Step 1: Add the control**

```tsx
<button
  type="button"
  onClick={() => {
    localStorage.removeItem(SETTINGS_KEY);
    location.reload();
  }}
  className={ui.btnDanger}
>
  Restore factory defaults
</button>
```

Put it below the alert toggles with a one-line explanation: *"Clears remembered
recorder and editor appearance. Recordings are not affected."*

- [ ] **Step 2: Verify**

Set a non-default shadow, click Restore, reload. Expected: shadow back to 50%,
recordings untouched.

- [ ] **Step 3: Commit**

```bash
git add -A src/components/settings
git commit -m "feat(settings): add factory reset for remembered appearance"
```

---

## Final verification

- [ ] `npm test` — full suite passes
- [ ] `npm run lint` — clean
- [ ] `npx tsc --noEmit` — **exactly 3 errors, the known pre-existing ones** in
      `src/lib/db.test.ts:349` and `src/lib/upload-client.test.ts:42` (x2). These
      predate this work (verified at `f50f4b0`). Any fourth error is yours —
      in particular a missed `shadow` boolean.
- [ ] Record a screen+camera take end to end: edit camera keyframes, place three
      overlapping overlays and confirm three packed rows, set a shadow, upload,
      and open the resulting `jtylerray.com/v/<slug>` to confirm the render
      matches the preview
- [ ] Open an **older** recording saved before this work and confirm its shadow
      renders identically to before

---

## Notes for the implementer

**The shadow migration is the only thing that can corrupt existing work.** If
`npx tsc --noEmit` reports a `shadow` used as a boolean anywhere this plan does
not name, that site needs the same treatment — do not cast it.

**Do not add component tests.** This repo tests logic in node. If a UI change
feels like it needs a test, that is a sign the logic should move into
`src/lib/` where it can be tested — which is what Task 1 does for packing.

**`packRows` serves cuts too.** Cuts are `{start, end}` and cannot overlap by
construction, so they do not need it today. Do not pre-emptively wire it.
