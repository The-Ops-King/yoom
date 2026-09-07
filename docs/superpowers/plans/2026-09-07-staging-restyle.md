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

**Files:**
- Create: `src/components/staging/transport.tsx`
- Modify: `src/components/staging/staging.tsx`, `src/components/staging/sections/trim.tsx` (deleted)

- [ ] **Step 1: Write the component**

```tsx
// src/components/staging/transport.tsx
"use client";

import * as ops from "@/lib/editor/edit-ops";
import type { StagingContext } from "./types";
import * as ui from "./ui";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Sits between the preview and the timeline. Carries the two edits that used to
 * be the Trim section's buttons — split at the playhead, cut the in/out range —
 * plus playback.
 */
export function Transport({ ctx }: { ctx: StagingContext }) {
  const { player } = ctx;
  const hasRange = ctx.inPoint !== null && ctx.outPoint !== null && ctx.outPoint > ctx.inPoint;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-1.5">
      <button
        type="button"
        onClick={() => ctx.apply((e) => ops.splitAt(e, player.time))}
        className={ui.btn}
      >
        Split
      </button>
      <button
        type="button"
        disabled={!hasRange}
        onClick={() => ctx.apply((e) => ops.addCut(e, ctx.inPoint!, ctx.outPoint!))}
        className={ui.btn}
      >
        Cut range
      </button>

      <div className="ml-auto flex items-center gap-3">
        {/*
          `editedTime` and `editedDuration`, not `time`/`duration`: the transport
          reports the timeline the viewer will see, with cuts already removed.
        */}
        <span className={`${ui.sliderValue} w-auto`}>{fmt(player.editedTime)}</span>
        <button
          type="button"
          onClick={player.toggle}
          aria-label={player.playing ? "Pause" : "Play"}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs text-foreground"
        >
          {player.playing ? "❚❚" : "▶"}
        </button>
        <span className={`${ui.sliderValue} w-auto`}>{fmt(player.editedDuration)}</span>
      </div>
    </div>
  );
}
```

**Names to note:** `StagingPlayer` has `time`, `timeRef`, `editedTime`,
`editedDuration`, `playing`, `play()`, `pause()`, `toggle()`, `seek()`,
`seekEdited()`, `step()`, `size` and `cameraSize`. There is **no** `duration` on
the player — source duration is `ctx.duration`.

Copy the split and cut handlers out of `sections/trim.tsx` before deleting it —
that file holds the working versions, including the `MARKER_CUT_SPAN` behaviour
noted at its line 7. Use whatever `edit-ops` functions it actually calls rather
than the `ops.splitAt` / `ops.addCut` names guessed above.

- [ ] **Step 2: Mount it between preview and timeline**

```tsx
<Preview ctx={ctx} />
<Transport ctx={ctx} />
<Timeline ctx={ctx} />
```

- [ ] **Step 3: Move the cut list, then delete the trim section**

The Trim section also lists existing cuts (`sections/trim.tsx:66-90`). Those are
now visible as regions on the Clip lane, so the list is redundant — but confirm
each cut is selectable and removable from the timeline before deleting. If
removal is missing there, add a delete affordance on the selected cut region
first.

```bash
git rm src/components/staging/sections/trim.tsx
```

Remove its import, its `SECTIONS` entry, and the `"trim"` member of `RailSection`.

- [ ] **Step 4: Verify**

Run: `npm run dev`. Expected: split and cut work from the transport; cuts appear
on the Clip lane and can be selected and removed there; play/pause works.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/staging
git commit -m "feat(staging): add the transport row and retire the trim section"
```

---

### Task 6: The icon strip

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

### Task 6b: Preview-side selection opens the panel

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
- Test: `src/lib/recording/settings.test.ts`

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

### Task 8: Add the shared control classes

**Files:**
- Modify: `src/components/staging/ui.ts`

- [ ] **Step 1: Add the new vocabulary**

Append to `ui.ts`, matching the file's existing comment style:

```ts
/**
 * Segmented control — mutually exclusive choices in a shared trough. Use for
 * anything with 2–5 options that would otherwise be a row of `btn`s: camera
 * mode and shape, background kind, arrow style.
 */
export const seg = "flex gap-0.5 rounded-lg bg-surface-raised p-0.5";
export const segItem =
  "flex-1 rounded-md px-2 py-1 text-center text-[11px] text-muted transition-colors hover:text-foreground";
export const segItemOn =
  "flex-1 rounded-md bg-accent px-2 py-1 text-center text-[11px] font-semibold text-foreground";

/**
 * Filled-bar slider. The row IS the track: the accent fill shows the value, the
 * name sits left and the value right. Replaces `sliderRow`'s separate
 * name/track/value columns, which wasted a third of a 320px rail on a thin line.
 *
 * Render an `<input type="range">` with `sliderInput` absolutely positioned over
 * `sliderFill` so the control stays keyboard-accessible and native.
 */
export const sliderFill =
  "relative flex h-7 items-center overflow-hidden rounded-lg border border-border-subtle bg-surface-raised px-2.5";
export const sliderFillBar = "absolute inset-y-0 left-0 bg-accent/20 border-r border-accent/50";
export const sliderFillName = "relative text-[11px] text-muted";
export const sliderFillValue =
  "relative ml-auto font-mono text-[11px] tabular-nums text-foreground";
export const sliderInput =
  "absolute inset-0 h-full w-full cursor-ew-resize opacity-0";

/** Swatch grid — backgrounds and colours. `cols` is set by the caller. */
export const swatchGrid = "grid gap-1";
export const swatch = "aspect-square rounded-md border border-border-subtle";
export const swatchOn = "aspect-square rounded-md outline outline-2 outline-accent-text outline-offset-1";
```

- [ ] **Step 2: Verify nothing broke**

Run: `npm run lint && npm test`
Expected: PASS. This step only adds exports.

- [ ] **Step 3: Commit**

```bash
git add src/components/staging/ui.ts
git commit -m "feat(staging): add segmented, filled-slider and swatch classes"
```

---

### Task 9: Adopt the vocabulary in the Frame panel

Do the panels one at a time so each is reviewable. Frame first — it has one of
each control.

**Files:**
- Modify: `src/components/staging/sections/frame.tsx`, `src/components/staging/frame-picker.tsx`

- [ ] **Step 1: Create the shared `Slider`**

Create `src/components/staging/slider.tsx`. Every panel from here on uses it.

```tsx
function Slider({ name, value, min, max, step, format, onChange }: {
  name: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <label className={ui.sliderFill}>
      <span aria-hidden className={ui.sliderFillBar} style={{ width: `${pct}%` }} />
      <span className={ui.sliderFillName}>{name}</span>
      <span className={ui.sliderFillValue}>{format(value)}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        aria-label={name}
        onChange={(e) => onChange(Number(e.target.value))}
        className={ui.sliderInput}
      />
    </label>
  );
}
```

The native `<input type="range">` sits transparent over the whole row, so the
control stays keyboard-operable and screen-reader-announced while looking like a
filled bar. Prefix the file with `"use client";` and
`import * as ui from "./ui";`.

- [ ] **Step 2: Use it for padding, radius and the new shadow**

```tsx
<Slider name="Padding" value={frame.padding} min={0} max={0.2} step={0.005}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => setFrame({ ...frame, padding: v })} />
<Slider name="Radius" value={frame.radius} min={0} max={0.1} step={0.002}
        format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={(v) => setFrame({ ...frame, radius: v })} />
<Slider name="Shadow" value={frame.shadow} min={0} max={1} step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => setFrame({ ...frame, shadow: v })} />
```

Use the existing setter in `frame.tsx` rather than a new `setFrame` — read
`:20-26` for how it applies and calls `persistFrame`.

- [ ] **Step 3: Convert the background-kind buttons to a segmented control**

```tsx
<div className={ui.seg} role="group" aria-label="Background kind">
  {(["none", "color", "image", "video"] as const).map((k) => (
    <button key={k} type="button" aria-pressed={frame.background.kind === k}
            onClick={() => setKind(k)}
            className={frame.background.kind === k ? ui.segItemOn : ui.segItem}>
      {k === "none" ? "None" : k[0].toUpperCase() + k.slice(1)}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Convert the preset grid to swatches**

`frame-picker.tsx:153` already maps `FRAME_PRESETS` to buttons. Change the
container to `${ui.swatchGrid} grid-cols-8` and each button to `ui.swatch` /
`ui.swatchOn`, keeping the existing `title`, `aria-label` and click handler.

- [ ] **Step 5: Verify**

Run: `npm run dev`. Expected: shadow slides from none to heavy with the preview
updating live; all 16 presets fit 8-wide without scrolling; padding and radius
show real percentages. Keyboard: tab to a slider, arrow keys change it.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/staging
git commit -m "feat(staging): restyle the frame panel with the new controls"
```

---

### Task 10: Camera panel — `pan` and `cameraOffsetMs`

**Files:**
- Modify: `src/components/staging/sections/camera.tsx`

- [ ] **Step 1: Convert mode and shape to segmented controls**

Five shapes come from `SHAPES` in `@/lib/recording/settings`: `circle`,
`rounded`, `square`, `portrait`, `full`. Mode is `bubble | full | hidden` from
`CameraMode`. Use `ui.seg` for both, replacing the current button rows at
`:181`.

- [ ] **Step 2: Add the crop-pan pad**

`CameraKeyframe.pan` is a `Point` (0..1 per axis), absent meaning `{x: .5, y: .5}`.
Two sliders would misrepresent a 2-axis value, so use a pad:

```tsx
function PanPad({ pan, onChange }: { pan: { x: number; y: number }; onChange: (p: { x: number; y: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    onChange({
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    });
  };
  return (
    <div
      ref={ref}
      role="application"
      aria-label="Camera crop pan"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
      onPointerMove={(e) => { if (e.buttons) set(e); }}
      className="relative aspect-[1.6] w-full cursor-crosshair rounded-md border border-border-subtle bg-surface-raised"
    >
      <span
        aria-hidden
        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-text"
        style={{ left: `${pan.x * 100}%`, top: `${pan.y * 100}%` }}
      />
    </div>
  );
}
```

Write through `ops.upsertCameraKeyframe(e, t, { pan })`, the same call
`setShape` already uses at `camera.tsx:147`.

- [ ] **Step 3: Add the sync-offset slider**

`cameraOffsetMs` lives on `VideoEdits`, clamped to `±MAX_CAMERA_OFFSET_MS` in
`edits.ts:562`. Import that constant rather than hardcoding a range.

```tsx
<Slider name="Camera sync" value={edits.cameraOffsetMs ?? 0}
        min={-MAX_CAMERA_OFFSET_MS} max={MAX_CAMERA_OFFSET_MS} step={10}
        format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}ms`}
        onChange={(v) => ctx.apply((e) => ({ ...e, cameraOffsetMs: v }))} />
```

- [ ] **Step 4: Verify**

Run: `npm run dev` with a screen+camera take. Expected: five shapes selectable;
dragging the pan pad moves which part of the camera feed shows; the sync slider
shifts the camera track against the screen track.

- [ ] **Step 5: Commit**

```bash
git add src/components/staging/sections/camera.tsx src/components/staging/slider.tsx
git commit -m "feat(staging): expose camera crop pan and sync offset"
```

---

### Task 11: Overlays, Zoom, Cursor and Details panels

**Files:**
- Modify: `sections/overlays.tsx`, `sections/zoom.tsx`, `sections/cursor.tsx`, `details-form.tsx`

- [ ] **Step 1: Overlays — tool grid**

Replace the current type buttons with a 5-column grid over all fifteen
`OverlayType` values, in this order so related tools sit together:

```ts
const TOOLS: { type: OverlayType; glyph: string; label: string }[] = [
  { type: "text", glyph: "T", label: "Text" },
  { type: "arrow", glyph: "➤", label: "Arrow" },
  { type: "line", glyph: "╱", label: "Line" },
  { type: "rect", glyph: "▭", label: "Rectangle" },
  { type: "ellipse", glyph: "◯", label: "Ellipse" },
  { type: "highlight", glyph: "▬", label: "Highlight" },
  { type: "underline", glyph: "▁", label: "Underline" },
  { type: "step", glyph: "①", label: "Step badge" },
  { type: "emoji", glyph: "☺", label: "Emoji" },
  { type: "draw", glyph: "✎", label: "Draw" },
  { type: "blur", glyph: "▨", label: "Blur" },
  { type: "blackout", glyph: "■", label: "Blackout" },
  { type: "image", glyph: "▤", label: "Image" },
  { type: "keys", glyph: "⌘", label: "Keys" },
  { type: "click", glyph: "●", label: "Click" },
];
```

Keep the existing `full` cap guard (`:85`) and the "That is all 64 overlays"
message (`:146`) — disable the grid rather than removing it.

Add the `7 / 64` counter beside the section label using `MAX_OVERLAYS`.

- [ ] **Step 2: Zoom, Cursor, Details — swap classes only**

These need no structural change. Replace `ui.sliderRow`/`ui.sliderName`/
`ui.slider`/`ui.sliderValue` triples with the `Slider` component, and any
mutually-exclusive button row with `ui.seg`. Do not change behaviour.

- [ ] **Step 3: Verify**

Run: `npm run dev && npm run lint && npm test`
Expected: every overlay type placeable; cap message still appears at 64; zoom
and cursor controls behave as before.

- [ ] **Step 4: Commit**

```bash
git add -A src/components/staging
git commit -m "feat(staging): restyle the remaining panels"
```

---

# Phase 4 — Sticky defaults

### Task 12: Extend `RecorderSettings` with staging defaults

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

### Task 13: Wire panels to read and write the defaults

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

### Task 14: Factory reset

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
