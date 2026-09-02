# Phase 5: Post-recording editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-03-phase5-editor-design.md`
**Status:** Not started.

## Goal

Give the owner a post-recording editor on `/library/[id]`: blur/redact regions, numbered
callouts that pop in and out, underlines, highlights, cuts, crop, animated zoom, and
"attention" ranges — all stored non-destructively as an edit-decision list in
`videos.edits` and rendered at playback by `EditPlayer` on both the owner page and the
public watch page. A later sub-phase (Tasks 23–26) burns the edit list into a new Drive
file and swaps `drive_file_id`, keeping the original.

## Architecture

- **One time base, one coordinate space.** Every stored time is seconds from the start of
  the *source* recording; every stored rect is normalized 0..1 against the *source* video
  frame. Edited (post-cut) time exists only in the UI, produced by pure remap functions.
- **Cuts are removed ranges**, kept sorted, merged and disjoint by `mergeCuts`, which
  `parseEdits` now applies. `cuts: []` stays a truthful "no edits", so every row written
  before Phase 5 remains valid.
- **Pure core, thin React.** All list operations, cut merging/remapping, zoom
  interpolation, hit-testing, the undo stack and the canvas renderer live in
  `src/lib/editor/*.ts` as pure functions with Vitest coverage. `src/components/editor/*`
  is glue: pointer events in, ops out, `VideoEdits` in state.
- **Renderer is shared, editor is not.** `/v/[slug]` imports only
  `src/lib/editor/{render,cuts,zoom}.ts`; `src/components/editor/*` is mounted lazily
  (`next/dynamic`, `ssr: false`) from the owner page alone.
- **Zoom and crop are CSS**, not canvas: a wrapper `<div>` gets
  `transform: scale(s)` + `transform-origin: X% Y%` applied to the video *and* the canvas
  together, recomputed per rAF frame in JS so scrubbing is exact.
- **Server re-validates.** `saveEdits` is a Server Action that re-checks `isOwner()` and
  runs the client payload back through `parseEdits` before `db.setVideoEdits`, so caps and
  invariants hold regardless of the caller.

## Tech Stack

Next.js 16.2.3 App Router (`'use server'`, `revalidatePath`, `next/dynamic`),
React 19.2.4 (`useReducer`, `useOptimistic`-free debounced `startTransition` saves),
TypeScript, Tailwind v4 (`@theme inline` tokens in `src/app/globals.css`),
Canvas 2D (`ctx.filter`, `roundRect`), `MediaRecorder` (sub-phase 5b),
Supabase JS (service role), Vitest 4 (`npm test`, node environment, `src/**/*.test.ts`).

---

## File Structure

### Created

| File | Responsibility |
|---|---|
| `src/lib/editor/cuts.ts` | `mergeCuts`, `totalCutDuration`, `editedDuration`, `sourceToEdited`, `editedToSource`, `skipTarget`. |
| `src/lib/editor/cuts.test.ts` | Unit tests for the cut algebra and time remapping. |
| `src/lib/editor/zoom.ts` | `ease`, `clampOrigin`, `zoomTarget`, `zoomStateAt`, `IDENTITY_ZOOM`. |
| `src/lib/editor/zoom.test.ts` | Unit tests for easing, clamping and interpolation. |
| `src/lib/editor/hit-test.ts` | `clampRect`, `rectFromDrag`, `containsPoint`, `handleAt`, `applyHandle`, `hitTestOverlays`. |
| `src/lib/editor/hit-test.test.ts` | Unit tests for drawing, hit-testing and handle drags. |
| `src/lib/editor/edit-ops.ts` | Pure `VideoEdits` mutations + caps: add/move/resize/delete overlay, style, cuts, zooms, crop, marker promotion. |
| `src/lib/editor/edit-ops.test.ts` | Unit tests for every op and every cap. |
| `src/lib/editor/undo.ts` | Bounded snapshot undo/redo stack. |
| `src/lib/editor/undo.test.ts` | Unit tests for the stack. |
| `src/lib/editor/render.ts` | Pure canvas renderer: `drawEdits`, `activeOverlays`, `calloutEnvelope`, `toPixels`. |
| `src/lib/editor/render.test.ts` | Renderer tests against a recording stub 2D context. |
| `src/lib/editor/export-plan.ts` | (5b) Pure export segment/duration planning. |
| `src/lib/editor/export-plan.test.ts` | (5b) Unit tests for the export plan. |
| `src/components/editor/use-editor.ts` | Editor state hook: undo stack + debounced optimistic save. |
| `src/components/editor/toolbox.tsx` | Tool buttons + save status. |
| `src/components/editor/frame-overlay.tsx` | Drag-to-draw / select / move / resize layer over the frame. |
| `src/components/editor/timeline.tsx` | Cut ranges, overlay clips, attention ranges, marker ticks, zoom keyframes. |
| `src/components/editor/inspector.tsx` | Per-item start/end/style editor + delete. |
| `src/components/editor/editor-panel.tsx` | Assembles the editor; owns hotkeys. |
| `src/components/editor/export-dialog.tsx` | (5b) Canvas + MediaRecorder export UI. |
| `src/components/video/attention-pills.tsx` | Chapter pills for attention ranges (watch + owner). |
| `supabase/migrations/20260903000000_phase5.sql` | (5b) `videos.original_drive_file_id`, `videos.exported_at`. |

### Modified

| File | Change |
|---|---|
| `src/lib/edits.ts` | `attention` overlay type; `Easing`; `OverlayStyle`; `Zoom.ease`/`ramp`; `Overlay.label`/`style`; caps; `parseEdits` merges cuts and truncates. |
| `src/lib/edits.test.ts` | Tests for the new fields, cut merging and the caps. |
| `src/components/video/edit-player.tsx` | Wires `drawEdits`, zoom/crop wrapper, cut skipping, remapped scrubber, attention pulse; new `overlay`/`onTimeUpdate` props for the editor. |
| `src/app/(owner)/actions.ts` | New `saveEdits` server action. |
| `src/app/(owner)/library/[id]/page.tsx` | Lazily mounts `EditorPanel`; passes `edits` + `saveEdits`. |
| `src/components/watch-view.tsx` | Renders `AttentionPills` under the player. |
| `src/app/globals.css` | `@keyframes yoom-attention` + `.attention-pulse`; editor timeline lane tokens. |
| `src/lib/db.ts` | (5b) `swapDriveFile(id, newFileId)`. |
| `README.md` | "Editing" section. |
| `docs/for-later.md` | Strike the Phase 5 proposal as shipped; park WebCodecs + auto-zoom. |

---
### Task 1: `src/lib/editor/cuts.ts` — cut algebra and time remapping

**Files:** `src/lib/editor/cuts.test.ts`, `src/lib/editor/cuts.ts`

- [ ] Write the failing test `src/lib/editor/cuts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  editedDuration,
  editedToSource,
  mergeCuts,
  skipTarget,
  sourceToEdited,
  totalCutDuration,
} from "@/lib/editor/cuts";

describe("mergeCuts", () => {
  it("sorts, merges overlaps and drops empty or invalid ranges", () => {
    expect(
      mergeCuts([
        { start: 5, end: 7 },
        { start: 1, end: 3 },
        { start: 2, end: 4 },
        { start: 9, end: 9 },
        { start: 8, end: 6 },
      ]),
    ).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 7 },
    ]);
  });

  it("merges ranges that only touch", () => {
    expect(mergeCuts([{ start: 0, end: 1 }, { start: 1, end: 2 }])).toEqual([
      { start: 0, end: 2 },
    ]);
  });

  it("clamps negative starts and never mutates its input", () => {
    const input = [{ start: -5, end: 2 }];
    expect(mergeCuts(input)).toEqual([{ start: 0, end: 2 }]);
    expect(input[0].start).toBe(-5);
  });
});

describe("totalCutDuration / editedDuration", () => {
  const cuts = [
    { start: 1, end: 3 },
    { start: 6, end: 8 },
  ];

  it("sums merged ranges", () => {
    expect(totalCutDuration(cuts)).toBe(4);
  });

  it("clamps to the source duration", () => {
    expect(editedDuration(cuts, 10)).toBe(6);
    expect(editedDuration(cuts, 7)).toBe(4);
    expect(editedDuration(cuts, 0)).toBe(0);
    expect(editedDuration([], 10)).toBe(10);
  });

  it("never returns a negative or non-finite duration", () => {
    expect(editedDuration([{ start: 0, end: 100 }], 10)).toBe(0);
    expect(editedDuration(cuts, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("sourceToEdited / editedToSource", () => {
  const cuts = [
    { start: 1, end: 3 },
    { start: 6, end: 8 },
  ];

  it("maps source time past removed ranges", () => {
    expect(sourceToEdited(cuts, 0)).toBe(0);
    expect(sourceToEdited(cuts, 1)).toBe(1);
    expect(sourceToEdited(cuts, 2)).toBe(1); // inside a cut collapses to its start
    expect(sourceToEdited(cuts, 3)).toBe(1);
    expect(sourceToEdited(cuts, 5)).toBe(3);
    expect(sourceToEdited(cuts, 10)).toBe(6);
  });

  it("maps edited time back onto the source", () => {
    expect(editedToSource(cuts, 0)).toBe(0);
    expect(editedToSource(cuts, 1)).toBe(3);
    expect(editedToSource(cuts, 3)).toBe(5);
    expect(editedToSource(cuts, 6)).toBe(10);
  });

  it("round-trips every kept source time", () => {
    for (const t of [0, 0.5, 3, 4.25, 5.9, 8, 9.5]) {
      expect(editedToSource(cuts, sourceToEdited(cuts, t))).toBeCloseTo(t, 6);
    }
  });
});

describe("skipTarget", () => {
  const cuts = [
    { start: 1, end: 3 },
    { start: 6, end: 8 },
  ];

  it("returns the end of the range the playhead sits in", () => {
    expect(skipTarget(cuts, 1)).toBe(3);
    expect(skipTarget(cuts, 2.5)).toBe(3);
    expect(skipTarget(cuts, 7)).toBe(8);
  });

  it("returns null outside every range, including the exact end", () => {
    expect(skipTarget(cuts, 0)).toBeNull();
    expect(skipTarget(cuts, 3)).toBeNull();
    expect(skipTarget(cuts, 9)).toBeNull();
    expect(skipTarget([], 1)).toBeNull();
  });
});
```

- [ ] Run `npx vitest run src/lib/editor/cuts.test.ts` — expected failure:
      `Error: Failed to load url @/lib/editor/cuts` (module does not exist).
- [ ] Write `src/lib/editor/cuts.ts`:

```ts
/**
 * Cut algebra. Cuts are *removed* ranges in source time (seconds).
 *
 * Every function below except `mergeCuts` assumes its input is already sorted,
 * merged and disjoint — the invariant `parseEdits` and `edit-ops.ts` maintain.
 */

import type { Cut } from "@/lib/edits";

/** Sort, clamp to >= 0, drop empty/invalid ranges and merge overlaps and touches. */
export function mergeCuts(cuts: readonly Cut[]): Cut[] {
  const valid = cuts
    .filter(
      (cut) =>
        Number.isFinite(cut.start) &&
        Number.isFinite(cut.end) &&
        cut.end > cut.start,
    )
    .map((cut) => ({ start: Math.max(0, cut.start), end: cut.end }))
    .sort((a, b) => a.start - b.start);

  const merged: Cut[] = [];
  for (const cut of valid) {
    const last = merged[merged.length - 1];
    if (last && cut.start <= last.end) {
      last.end = Math.max(last.end, cut.end);
    } else {
      merged.push({ start: cut.start, end: cut.end });
    }
  }
  return merged;
}

/** Total removed time. */
export function totalCutDuration(cuts: readonly Cut[]): number {
  let total = 0;
  for (const cut of cuts) total += cut.end - cut.start;
  return total;
}

/** Playable duration after cuts, clamped into `[0, duration]`. */
export function editedDuration(cuts: readonly Cut[], duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  let removed = 0;
  for (const cut of cuts) {
    const start = Math.min(cut.start, duration);
    const end = Math.min(cut.end, duration);
    if (end > start) removed += end - start;
  }
  return Math.max(0, duration - removed);
}

/** Source time -> edited time. A time inside a cut collapses to the cut's start. */
export function sourceToEdited(cuts: readonly Cut[], t: number): number {
  let removed = 0;
  for (const cut of cuts) {
    if (cut.start >= t) break;
    removed += Math.min(cut.end, t) - cut.start;
  }
  return Math.max(0, t - removed);
}

/** Edited time -> source time. Lands on the first kept instant at or after `e`. */
export function editedToSource(cuts: readonly Cut[], e: number): number {
  let t = Math.max(0, e);
  for (const cut of cuts) {
    if (cut.start <= t) t += cut.end - cut.start;
    else break;
  }
  return t;
}

/** When `t` falls inside a removed range, the time to seek to; otherwise null. */
export function skipTarget(cuts: readonly Cut[], t: number): number | null {
  for (const cut of cuts) {
    if (t >= cut.start && t < cut.end) return cut.end;
    if (cut.start > t) break;
  }
  return null;
}
```

- [ ] Run `npx vitest run src/lib/editor/cuts.test.ts` — all pass.
- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Commit:

```bash
git add src/lib/editor/cuts.ts src/lib/editor/cuts.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): add cut algebra and source/edited time remapping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 2: extend `src/lib/edits.ts` — attention, easing, style, caps

**Files:** `src/lib/edits.test.ts`, `src/lib/edits.ts`

- [ ] Append to `src/lib/edits.test.ts` (keep every existing test):

```ts
import {
  MAX_CUTS,
  MAX_MARKERS,
  MAX_OVERLAYS,
  MAX_ZOOMS,
} from "@/lib/edits";

describe("parseEdits — Phase 5 fields", () => {
  it("accepts the attention overlay type with a label", () => {
    const parsed = parseEdits({
      version: 1,
      overlays: [
        {
          type: "attention",
          start: 2,
          end: 5,
          rect: { x: 0, y: 0, w: 1, h: 1 },
          label: "Read this bit",
        },
      ],
    });
    expect(parsed.overlays).toHaveLength(1);
    expect(parsed.overlays[0].type).toBe("attention");
    expect(parsed.overlays[0].label).toBe("Read this bit");
  });

  it("keeps a valid style block and drops junk fields", () => {
    const parsed = parseEdits({
      version: 1,
      overlays: [
        {
          type: "highlight",
          start: 0,
          end: 1,
          rect: { x: 0, y: 0, w: 1, h: 1 },
          style: { color: "#ff0", opacity: 0.5, thickness: 0.01, evil: true },
        },
      ],
    });
    expect(parsed.overlays[0].style).toEqual({
      color: "#ff0",
      opacity: 0.5,
      thickness: 0.01,
    });
  });

  it("clamps style opacity into 0..1 and drops a non-finite one", () => {
    const style = (value: unknown) =>
      parseEdits({
        version: 1,
        overlays: [
          {
            type: "highlight",
            start: 0,
            end: 1,
            rect: { x: 0, y: 0, w: 1, h: 1 },
            style: { opacity: value },
          },
        ],
      }).overlays[0].style;
    expect(style(2)?.opacity).toBe(1);
    expect(style(-1)?.opacity).toBe(0);
    expect(style("x")).toBeUndefined();
  });

  it("keeps a known zoom easing and drops an unknown one", () => {
    const zooms = (ease: unknown) =>
      parseEdits({
        version: 1,
        zooms: [
          { start: 0, end: 2, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ease },
        ],
      }).zooms;
    expect(zooms("ease-out")[0].ease).toBe("ease-out");
    expect(zooms("bouncy")[0].ease).toBeUndefined();
  });

  it("merges cuts on parse", () => {
    expect(
      parseEdits({
        version: 1,
        cuts: [
          { start: 5, end: 7 },
          { start: 1, end: 3 },
          { start: 2, end: 4 },
        ],
      }).cuts,
    ).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 7 },
    ]);
  });

  it("truncates each list at its cap instead of rejecting the blob", () => {
    const rect = { x: 0, y: 0, w: 1, h: 1 };
    const parsed = parseEdits({
      version: 1,
      overlays: Array.from({ length: MAX_OVERLAYS + 10 }, () => ({
        type: "blur",
        start: 0,
        end: 1,
        rect,
      })),
      zooms: Array.from({ length: MAX_ZOOMS + 10 }, () => ({
        start: 0,
        end: 1,
        rect,
      })),
      cuts: Array.from({ length: MAX_CUTS + 10 }, (_, i) => ({
        start: i * 2,
        end: i * 2 + 1,
      })),
      markers: Array.from({ length: MAX_MARKERS + 10 }, (_, i) => ({ t: i })),
    });
    expect(parsed.overlays).toHaveLength(MAX_OVERLAYS);
    expect(parsed.zooms).toHaveLength(MAX_ZOOMS);
    expect(parsed.cuts).toHaveLength(MAX_CUTS);
    expect(parsed.markers).toHaveLength(MAX_MARKERS);
  });
});
```

- [ ] Run `npx vitest run src/lib/edits.test.ts` — expected failure:
      `MAX_OVERLAYS` is not exported / `attention` overlays are dropped.
- [ ] Edit `src/lib/edits.ts`. Replace the `OverlayType`, `Zoom` and `Overlay`
      declarations, and add the caps and style types, so the top of the file reads:

```ts
export type Rect = { x: number; y: number; w: number; h: number };

export type Cut = { start: number; end: number };

export type Easing = "linear" | "ease-out" | "ease-in-out";

export type Zoom = {
  start: number;
  end: number;
  rect: Rect;
  /** Interpolation curve for the ramp in and out. Default "ease-in-out". */
  ease?: Easing;
  /** Ramp length in seconds. Default `min(0.4, span / 3)`. */
  ramp?: number;
};

export type OverlayType =
  | "blur"
  | "callout"
  | "underline"
  | "highlight"
  | "attention";

export type OverlayStyle = {
  /** CSS colour. */
  color?: string;
  /** 0..1. */
  opacity?: number;
  /** Stroke/underline thickness, normalised to the frame height. */
  thickness?: number;
  /** Corner radius, normalised to the frame height. */
  radius?: number;
  /** Blur radius, normalised to the frame height. */
  blur?: number;
};

export type Overlay = {
  type: OverlayType;
  start: number;
  end: number;
  rect: Rect;
  /** Callout number badge. */
  n?: number;
  /** Attention-range chapter label. */
  label?: string;
  /** Phase 3 field; treated as `style.color` when `style` omits one. */
  color?: string;
  style?: OverlayStyle;
};

/**
 * Per-video caps. jsonb row size and per-frame draw cost both scale with these,
 * and `parseEdits` truncates rather than rejecting so an over-long blob degrades
 * to its first N items instead of blanking every edit on the video.
 */
export const MAX_OVERLAYS = 64;
export const MAX_ZOOMS = 32;
export const MAX_CUTS = 64;
export const MAX_MARKERS = 200;
```

- [ ] In the same file, add the parse helpers above `parseEdits`:

```ts
const EASINGS: Easing[] = ["linear", "ease-out", "ease-in-out"];

function unit(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === null) return null;
  return Math.min(1, Math.max(0, parsed));
}

function parseStyle(value: unknown): OverlayStyle | undefined {
  if (!isRecord(value)) return undefined;
  const style: OverlayStyle = {};
  if (typeof value.color === "string") style.color = value.color;
  const opacity = unit(value.opacity);
  if (opacity !== null) style.opacity = opacity;
  for (const key of ["thickness", "radius", "blur"] as const) {
    const parsed = num(value[key]);
    if (parsed !== null && parsed >= 0) style[key] = parsed;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}
```

- [ ] Update `OVERLAY_TYPES` to include `"attention"`, and inside `parseEdits`:
      cap each loop with a `length >= MAX_*` break; carry `label` and `style` on
      overlays; carry `ease` (only when in `EASINGS`) and a positive finite `ramp` on
      zooms; and return `cuts: mergeCuts(cuts).slice(0, MAX_CUTS)` and
      `markers: markers.slice(0, MAX_MARKERS)`:

```ts
const OVERLAY_TYPES: OverlayType[] = [
  "blur",
  "callout",
  "underline",
  "highlight",
  "attention",
];
```

```ts
  const zooms: Zoom[] = [];
  for (const raw of asArray(input.zooms)) {
    if (zooms.length >= MAX_ZOOMS) break;
    const span = parseSpan(raw);
    const rect = isRecord(raw) ? parseRect(raw.rect) : null;
    if (!span || !rect) continue;
    const zoom: Zoom = { ...span, rect };
    if (isRecord(raw)) {
      if (
        typeof raw.ease === "string" &&
        EASINGS.includes(raw.ease as Easing)
      ) {
        zoom.ease = raw.ease as Easing;
      }
      const ramp = num(raw.ramp);
      if (ramp !== null && ramp > 0) zoom.ramp = ramp;
    }
    zooms.push(zoom);
  }

  const overlays: Overlay[] = [];
  for (const raw of asArray(input.overlays)) {
    if (overlays.length >= MAX_OVERLAYS) break;
    if (!isRecord(raw)) continue;
    const type = raw.type;
    if (typeof type !== "string") continue;
    if (!OVERLAY_TYPES.includes(type as OverlayType)) continue;
    const span = parseSpan(raw);
    const rect = parseRect(raw.rect);
    if (!span || !rect) continue;
    const overlay: Overlay = { type: type as OverlayType, ...span, rect };
    const n = num(raw.n);
    if (n !== null) overlay.n = n;
    if (typeof raw.label === "string") overlay.label = raw.label;
    if (typeof raw.color === "string") overlay.color = raw.color;
    const style = parseStyle(raw.style);
    if (style) overlay.style = style;
    overlays.push(overlay);
  }

  const markers: Marker[] = [];
  for (const raw of asArray(input.markers)) {
    const marker = parseMarker(raw);
    if (marker) markers.push(marker);
  }
  markers.sort((a, b) => a.t - b.t);

  return {
    version: 1,
    cuts: mergeCuts(cuts).slice(0, MAX_CUTS),
    crop: parseRect(input.crop),
    zooms,
    overlays,
    markers: markers.slice(0, MAX_MARKERS),
  };
```

- [ ] Add `import { mergeCuts } from "@/lib/editor/cuts";` at the top of
      `src/lib/edits.ts`. (`cuts.ts` imports only the `Cut` *type* back, so the cycle is
      erased at compile time and there is no runtime cycle.)
- [ ] Also cap the `cuts` collection loop: `if (cuts.length >= MAX_CUTS * 2) break;`
      before parsing each span, so a hostile blob cannot make `mergeCuts` sort a
      million entries.
- [ ] Run `npx vitest run src/lib/edits.test.ts` — all pass.
- [ ] Run `npm test` — the whole suite still passes (existing `parseEdits` tests are
      unaffected: they use no cuts needing merge and no capped lists).
- [ ] Commit:

```bash
git add src/lib/edits.ts src/lib/edits.test.ts
git commit -m "$(cat <<'EOF'
feat(edits): add attention overlays, zoom easing, overlay style and per-list caps

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---
### Task 3: `src/lib/editor/zoom.ts` — easing and zoom interpolation

**Files:** `src/lib/editor/zoom.test.ts`, `src/lib/editor/zoom.ts`

- [ ] Write the failing test `src/lib/editor/zoom.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Zoom } from "@/lib/edits";
import {
  IDENTITY_ZOOM,
  clampOrigin,
  ease,
  zoomStateAt,
  zoomTarget,
} from "@/lib/editor/zoom";

describe("ease", () => {
  it("pins both ends for every curve", () => {
    for (const kind of ["linear", "ease-out", "ease-in-out"] as const) {
      expect(ease(kind, 0)).toBe(0);
      expect(ease(kind, 1)).toBe(1);
    }
  });

  it("clamps out-of-range progress", () => {
    expect(ease("linear", -1)).toBe(0);
    expect(ease("linear", 5)).toBe(1);
  });

  it("is monotonic", () => {
    for (const kind of ["linear", "ease-out", "ease-in-out"] as const) {
      let previous = -1;
      for (let i = 0; i <= 20; i += 1) {
        const value = ease(kind, i / 20);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });
});

describe("clampOrigin", () => {
  it("keeps the scaled frame inside the viewport", () => {
    expect(clampOrigin(2, 0, 0)).toEqual({ originX: 0.25, originY: 0.25 });
    expect(clampOrigin(2, 1, 1)).toEqual({ originX: 0.75, originY: 0.75 });
    expect(clampOrigin(4, 0.5, 0.9)).toEqual({ originX: 0.5, originY: 0.875 });
  });

  it("centres when there is nothing to clamp", () => {
    expect(clampOrigin(1, 0.1, 0.9)).toEqual({ originX: 0.5, originY: 0.5 });
    expect(clampOrigin(0.5, 0.1, 0.9)).toEqual({ originX: 0.5, originY: 0.5 });
  });
});

describe("zoomTarget", () => {
  it("scales so the whole rect is visible and centres on it", () => {
    expect(zoomTarget({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })).toEqual({
      scale: 2,
      originX: 0.5,
      originY: 0.5,
    });
  });

  it("uses the larger dimension so nothing is cropped away", () => {
    expect(zoomTarget({ x: 0, y: 0, w: 0.5, h: 0.25 }).scale).toBe(2);
  });

  it("clamps the scale into 1..8", () => {
    expect(zoomTarget({ x: 0, y: 0, w: 1, h: 1 }).scale).toBe(1);
    expect(zoomTarget({ x: 0, y: 0, w: 0.01, h: 0.01 }).scale).toBe(8);
  });
});

describe("zoomStateAt", () => {
  const zoom: Zoom = {
    start: 2,
    end: 6,
    rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    ease: "linear",
    ramp: 1,
  };

  it("is identity outside every zoom", () => {
    expect(zoomStateAt([zoom], 0)).toEqual(IDENTITY_ZOOM);
    expect(zoomStateAt([zoom], 6)).toEqual(IDENTITY_ZOOM);
    expect(zoomStateAt([], 3)).toEqual(IDENTITY_ZOOM);
  });

  it("ramps in, holds, and ramps out", () => {
    expect(zoomStateAt([zoom], 2).scale).toBeCloseTo(1, 6);
    expect(zoomStateAt([zoom], 2.5).scale).toBeCloseTo(1.5, 6);
    expect(zoomStateAt([zoom], 4).scale).toBeCloseTo(2, 6);
    expect(zoomStateAt([zoom], 5.5).scale).toBeCloseTo(1.5, 6);
  });

  it("defaults the ramp to min(0.4, span/3)", () => {
    const short: Zoom = { start: 0, end: 0.6, rect: zoom.rect, ease: "linear" };
    expect(zoomStateAt([short], 0.1).scale).toBeCloseTo(1.5, 6);
    const long: Zoom = { start: 0, end: 10, rect: zoom.rect, ease: "linear" };
    expect(zoomStateAt([long], 0.2).scale).toBeCloseTo(1.5, 6);
  });

  it("never returns an origin that would expose a blank edge", () => {
    const corner: Zoom = {
      start: 0,
      end: 4,
      rect: { x: 0, y: 0, w: 0.25, h: 0.25 },
      ease: "linear",
      ramp: 1,
    };
    const state = zoomStateAt([corner], 2);
    expect(state.originX).toBeGreaterThanOrEqual(0.5 / state.scale);
    expect(state.originX).toBeLessThanOrEqual(1 - 0.5 / state.scale);
  });

  it("picks the first zoom covering the time", () => {
    const second: Zoom = {
      start: 6,
      end: 10,
      rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      ease: "linear",
      ramp: 1,
    };
    expect(zoomStateAt([zoom, second], 8).scale).toBeCloseTo(2, 6);
  });
});
```

- [ ] Run `npx vitest run src/lib/editor/zoom.test.ts` — expected failure:
      `Error: Failed to load url @/lib/editor/zoom`.
- [ ] Write `src/lib/editor/zoom.ts`:

```ts
/**
 * Zoom interpolation. The player turns a `ZoomState` into a CSS transform on a
 * wrapper that holds both the <video> and the overlay <canvas>, so overlays stay
 * welded to the frame.
 */

import type { Easing, Rect, Zoom } from "@/lib/edits";

export type ZoomState = {
  scale: number;
  /** Transform origin as a fraction of the frame. */
  originX: number;
  originY: number;
};

export const IDENTITY_ZOOM: ZoomState = { scale: 1, originX: 0.5, originY: 0.5 };

export const MAX_ZOOM_SCALE = 8;
const DEFAULT_RAMP = 0.4;

export function ease(kind: Easing, progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  if (kind === "linear") return t;
  if (kind === "ease-out") return 1 - (1 - t) ** 3;
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Keep the scaled frame covering the viewport: origin ∈ [0.5/s, 1 - 0.5/s]. */
export function clampOrigin(
  scale: number,
  x: number,
  y: number,
): { originX: number; originY: number } {
  const half = 0.5 / scale;
  if (!(half < 0.5)) return { originX: 0.5, originY: 0.5 };
  const clamp = (value: number) => Math.min(1 - half, Math.max(half, value));
  return { originX: clamp(x), originY: clamp(y) };
}

/** The fully-zoomed state for a rect: the whole rect visible, centred. */
export function zoomTarget(rect: Rect): ZoomState {
  const span = Math.max(rect.w, rect.h);
  const scale = Math.min(
    MAX_ZOOM_SCALE,
    Math.max(1, span > 0 ? 1 / span : 1),
  );
  return {
    scale,
    ...clampOrigin(scale, rect.x + rect.w / 2, rect.y + rect.h / 2),
  };
}

function rampOf(zoom: Zoom): number {
  const span = zoom.end - zoom.start;
  if (zoom.ramp !== undefined && zoom.ramp > 0) {
    return Math.min(zoom.ramp, span / 2);
  }
  return Math.min(DEFAULT_RAMP, span / 3);
}

/** The interpolated zoom at `time`; identity when no zoom covers it. */
export function zoomStateAt(zooms: readonly Zoom[], time: number): ZoomState {
  for (const zoom of zooms) {
    if (time < zoom.start || time >= zoom.end) continue;
    const target = zoomTarget(zoom.rect);
    const ramp = rampOf(zoom);
    const progress =
      ramp <= 0
        ? 1
        : Math.min(1, (time - zoom.start) / ramp, (zoom.end - time) / ramp);
    const eased = ease(zoom.ease ?? "ease-in-out", progress);
    const scale = 1 + (target.scale - 1) * eased;
    return {
      scale,
      ...clampOrigin(
        scale,
        0.5 + (target.originX - 0.5) * eased,
        0.5 + (target.originY - 0.5) * eased,
      ),
    };
  }
  return IDENTITY_ZOOM;
}
```

- [ ] Run `npx vitest run src/lib/editor/zoom.test.ts` — all pass.
- [ ] Commit:

```bash
git add src/lib/editor/zoom.ts src/lib/editor/zoom.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): add eased zoom keyframe interpolation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 4: `src/lib/editor/hit-test.ts` — normalized geometry and hit-testing

**Files:** `src/lib/editor/hit-test.test.ts`, `src/lib/editor/hit-test.ts`

- [ ] Write the failing test `src/lib/editor/hit-test.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Overlay } from "@/lib/edits";
import {
  MIN_RECT,
  applyHandle,
  clampRect,
  containsPoint,
  handleAt,
  hitTestOverlays,
  rectFromDrag,
} from "@/lib/editor/hit-test";

describe("clampRect", () => {
  it("keeps a rect inside the frame and above the minimum size", () => {
    expect(clampRect({ x: -0.2, y: 0.5, w: 0.5, h: 0.8 })).toEqual({
      x: 0,
      y: 0.2,
      w: 0.5,
      h: 0.8,
    });
    const tiny = clampRect({ x: 0.5, y: 0.5, w: 0, h: -1 });
    expect(tiny.w).toBe(MIN_RECT);
    expect(tiny.h).toBe(MIN_RECT);
  });

  it("shrinks a rect larger than the frame", () => {
    expect(clampRect({ x: -1, y: -1, w: 3, h: 3 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});

describe("rectFromDrag", () => {
  it("normalises direction", () => {
    expect(rectFromDrag({ x: 0.8, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({
      x: 0.2,
      y: 0.1,
      w: 0.6000000000000001,
      h: 0.5,
    });
  });

  it("clamps a drag that leaves the frame", () => {
    const rect = rectFromDrag({ x: -0.5, y: 0.5 }, { x: 1.5, y: 1.5 });
    expect(rect.x).toBe(0);
    expect(rect.x + rect.w).toBeCloseTo(1, 6);
  });
});

describe("containsPoint / handleAt", () => {
  const rect = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

  it("detects inside and outside", () => {
    expect(containsPoint(rect, { x: 0.3, y: 0.3 })).toBe(true);
    expect(containsPoint(rect, { x: 0.1, y: 0.3 })).toBe(false);
  });

  it("finds each corner and edge handle", () => {
    expect(handleAt(rect, { x: 0.2, y: 0.2 }, 0.02)).toBe("nw");
    expect(handleAt(rect, { x: 0.6, y: 0.6 }, 0.02)).toBe("se");
    expect(handleAt(rect, { x: 0.4, y: 0.2 }, 0.02)).toBe("n");
    expect(handleAt(rect, { x: 0.6, y: 0.4 }, 0.02)).toBe("e");
  });

  it("falls back to move inside and null outside", () => {
    expect(handleAt(rect, { x: 0.4, y: 0.4 }, 0.02)).toBe("move");
    expect(handleAt(rect, { x: 0.9, y: 0.9 }, 0.02)).toBeNull();
  });
});

describe("applyHandle", () => {
  const rect = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

  it("moves without resizing", () => {
    expect(applyHandle(rect, "move", 0.1, -0.1)).toEqual({
      x: 0.30000000000000004,
      y: 0.1,
      w: 0.4,
      h: 0.4,
    });
  });

  it("resizes from the south-east corner", () => {
    const next = applyHandle(rect, "se", 0.1, 0.1);
    expect(next.x).toBeCloseTo(0.2, 6);
    expect(next.w).toBeCloseTo(0.5, 6);
    expect(next.h).toBeCloseTo(0.5, 6);
  });

  it("resizes from the north-west corner, moving the origin", () => {
    const next = applyHandle(rect, "nw", 0.1, 0.1);
    expect(next.x).toBeCloseTo(0.3, 6);
    expect(next.w).toBeCloseTo(0.3, 6);
  });

  it("never collapses below the minimum size", () => {
    const next = applyHandle(rect, "se", -1, -1);
    expect(next.w).toBe(MIN_RECT);
    expect(next.h).toBe(MIN_RECT);
  });
});

describe("hitTestOverlays", () => {
  const rect = { x: 0, y: 0, w: 0.5, h: 0.5 };
  const overlays: Overlay[] = [
    { type: "blur", start: 0, end: 5, rect },
    { type: "highlight", start: 1, end: 5, rect },
    { type: "callout", start: 10, end: 12, rect },
  ];

  it("returns the topmost overlay active at the time", () => {
    expect(hitTestOverlays(overlays, 2, { x: 0.1, y: 0.1 })).toBe(1);
  });

  it("ignores overlays outside the time span", () => {
    expect(hitTestOverlays(overlays, 0.5, { x: 0.1, y: 0.1 })).toBe(0);
    expect(hitTestOverlays(overlays, 11, { x: 0.1, y: 0.1 })).toBe(2);
  });

  it("returns null when nothing is under the point", () => {
    expect(hitTestOverlays(overlays, 2, { x: 0.9, y: 0.9 })).toBeNull();
    expect(hitTestOverlays(overlays, 7, { x: 0.1, y: 0.1 })).toBeNull();
  });

  it("skips attention overlays, which are not drawn on the frame", () => {
    const withAttention: Overlay[] = [
      ...overlays,
      { type: "attention", start: 0, end: 5, rect: { x: 0, y: 0, w: 1, h: 1 } },
    ];
    expect(hitTestOverlays(withAttention, 2, { x: 0.1, y: 0.1 })).toBe(1);
  });
});
```

- [ ] Run `npx vitest run src/lib/editor/hit-test.test.ts` — expected failure:
      `Error: Failed to load url @/lib/editor/hit-test`.
- [ ] Write `src/lib/editor/hit-test.ts`:

```ts
/**
 * Normalised (0..1) geometry for the drag-to-draw layer. Everything here is in
 * frame space, never pixels — the component converts once, at the boundary.
 */

import type { Overlay, Rect } from "@/lib/edits";

export type Point = { x: number; y: number };

export type Handle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "move";

/** Smallest drawable rect, as a fraction of the frame. */
export const MIN_RECT = 0.02;

export function clampRect(rect: Rect): Rect {
  const w = Math.min(1, Math.max(MIN_RECT, rect.w));
  const h = Math.min(1, Math.max(MIN_RECT, rect.h));
  return {
    x: Math.min(1 - w, Math.max(0, rect.x)),
    y: Math.min(1 - h, Math.max(0, rect.y)),
    w,
    h,
  };
}

export function rectFromDrag(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return clampRect({
    x,
    y,
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  });
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

/** The handle under `point`, "move" when inside the rect, else null. */
export function handleAt(
  rect: Rect,
  point: Point,
  tolerance: number,
): Handle | null {
  const left = Math.abs(point.x - rect.x) <= tolerance;
  const right = Math.abs(point.x - (rect.x + rect.w)) <= tolerance;
  const top = Math.abs(point.y - rect.y) <= tolerance;
  const bottom = Math.abs(point.y - (rect.y + rect.h)) <= tolerance;
  const withinX =
    point.x >= rect.x - tolerance && point.x <= rect.x + rect.w + tolerance;
  const withinY =
    point.y >= rect.y - tolerance && point.y <= rect.y + rect.h + tolerance;

  if (top && left) return "nw";
  if (top && right) return "ne";
  if (bottom && left) return "sw";
  if (bottom && right) return "se";
  if (top && withinX) return "n";
  if (bottom && withinX) return "s";
  if (left && withinY) return "w";
  if (right && withinY) return "e";
  return containsPoint(rect, point) ? "move" : null;
}

/** Apply a normalised drag delta to a rect through `handle`. */
export function applyHandle(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
): Rect {
  if (handle === "move") {
    return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy });
  }

  let { x, y, w, h } = rect;
  if (handle.includes("w")) {
    const shift = Math.min(dx, w - MIN_RECT);
    x += shift;
    w -= shift;
  }
  if (handle.includes("e")) {
    w += dx;
  }
  if (handle.includes("n")) {
    const shift = Math.min(dy, h - MIN_RECT);
    y += shift;
    h -= shift;
  }
  if (handle.includes("s")) {
    h += dy;
  }
  return clampRect({ x, y, w, h });
}

/**
 * Index of the topmost overlay active at `time` under `point`, else null.
 * Attention overlays are skipped: they render as a border pulse, not a rect.
 */
export function hitTestOverlays(
  overlays: readonly Overlay[],
  time: number,
  point: Point,
): number | null {
  for (let index = overlays.length - 1; index >= 0; index -= 1) {
    const overlay = overlays[index];
    if (overlay.type === "attention") continue;
    if (time < overlay.start || time >= overlay.end) continue;
    if (containsPoint(overlay.rect, point)) return index;
  }
  return null;
}
```

- [ ] Run `npx vitest run src/lib/editor/hit-test.test.ts` — all pass.
- [ ] Commit:

```bash
git add src/lib/editor/hit-test.ts src/lib/editor/hit-test.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): add normalised rect geometry, handles and overlay hit-testing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---
### Task 5: `src/lib/editor/edit-ops.ts` — pure edit-list operations

**Files:** `src/lib/editor/edit-ops.test.ts`, `src/lib/editor/edit-ops.ts`

- [ ] Write the failing test `src/lib/editor/edit-ops.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_CUTS,
  MAX_OVERLAYS,
  MAX_ZOOMS,
  type VideoEdits,
} from "@/lib/edits";
import {
  MIN_SPAN,
  addCut,
  addOverlay,
  addZoom,
  deleteCut,
  deleteOverlay,
  deleteZoom,
  moveOverlay,
  nextCalloutNumber,
  promoteMarker,
  resizeOverlay,
  setCrop,
  setOverlaySpan,
  setOverlayStyle,
} from "@/lib/editor/edit-ops";

const RECT = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

function base(): VideoEdits {
  return {
    version: 1,
    cuts: [],
    crop: null,
    zooms: [],
    overlays: [],
    markers: [],
  };
}

describe("addOverlay", () => {
  it("appends a clamped overlay and never mutates the input", () => {
    const before = base();
    const after = addOverlay(before, {
      type: "blur",
      start: 1,
      end: 4,
      rect: { x: -1, y: 0, w: 0.5, h: 0.5 },
    });
    expect(before.overlays).toHaveLength(0);
    expect(after.overlays).toHaveLength(1);
    expect(after.overlays[0].rect.x).toBe(0);
  });

  it("enforces a minimum span", () => {
    const after = addOverlay(base(), {
      type: "blur",
      start: 1,
      end: 1,
      rect: RECT,
    });
    expect(after.overlays[0].end).toBeCloseTo(1 + MIN_SPAN, 6);
  });

  it("refuses to exceed the overlay cap", () => {
    let edits = base();
    for (let i = 0; i < MAX_OVERLAYS + 5; i += 1) {
      edits = addOverlay(edits, { type: "blur", start: 0, end: 1, rect: RECT });
    }
    expect(edits.overlays).toHaveLength(MAX_OVERLAYS);
  });
});

describe("moveOverlay / resizeOverlay / deleteOverlay", () => {
  const seeded = addOverlay(base(), {
    type: "highlight",
    start: 0,
    end: 2,
    rect: RECT,
  });

  it("moves by a normalised delta", () => {
    expect(moveOverlay(seeded, 0, 0.1, 0).overlays[0].rect.x).toBeCloseTo(0.3, 6);
  });

  it("resizes through a handle", () => {
    expect(resizeOverlay(seeded, 0, "se", 0.1, 0).overlays[0].rect.w).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("deletes by index and ignores an out-of-range index", () => {
    expect(deleteOverlay(seeded, 0).overlays).toHaveLength(0);
    expect(deleteOverlay(seeded, 9).overlays).toHaveLength(1);
    expect(moveOverlay(seeded, 9, 0.1, 0)).toEqual(seeded);
  });
});

describe("setOverlayStyle / setOverlaySpan", () => {
  const seeded = addOverlay(base(), {
    type: "underline",
    start: 1,
    end: 3,
    rect: RECT,
  });

  it("merges style patches", () => {
    const once = setOverlayStyle(seeded, 0, { color: "#0f0" });
    const twice = setOverlayStyle(once, 0, { opacity: 0.4 });
    expect(twice.overlays[0].style).toEqual({ color: "#0f0", opacity: 0.4 });
  });

  it("keeps spans ordered and above the minimum", () => {
    expect(setOverlaySpan(seeded, 0, 5, 4).overlays[0]).toMatchObject({
      start: 5,
      end: 5 + MIN_SPAN,
    });
    expect(setOverlaySpan(seeded, 0, -3, 2).overlays[0].start).toBe(0);
  });
});

describe("addCut / deleteCut", () => {
  it("merges into the existing cut list", () => {
    const edits = addCut(addCut(base(), { start: 1, end: 3 }), {
      start: 2,
      end: 5,
    });
    expect(edits.cuts).toEqual([{ start: 1, end: 5 }]);
  });

  it("drops an empty range and respects the cap", () => {
    expect(addCut(base(), { start: 2, end: 2 }).cuts).toEqual([]);
    let edits = base();
    for (let i = 0; i < MAX_CUTS + 5; i += 1) {
      edits = addCut(edits, { start: i * 2, end: i * 2 + 1 });
    }
    expect(edits.cuts).toHaveLength(MAX_CUTS);
  });

  it("deletes by index", () => {
    const edits = addCut(addCut(base(), { start: 1, end: 2 }), {
      start: 5,
      end: 6,
    });
    expect(deleteCut(edits, 0).cuts).toEqual([{ start: 5, end: 6 }]);
  });
});

describe("addZoom / deleteZoom", () => {
  it("keeps zooms sorted and non-overlapping by trimming the neighbour", () => {
    const edits = addZoom(
      addZoom(base(), { start: 0, end: 4, rect: RECT }),
      { start: 3, end: 6, rect: RECT },
    );
    expect(edits.zooms.map((z) => [z.start, z.end])).toEqual([
      [0, 3],
      [3, 6],
    ]);
  });

  it("drops a zoom the new one fully covers", () => {
    const edits = addZoom(
      addZoom(base(), { start: 2, end: 3, rect: RECT }),
      { start: 0, end: 5, rect: RECT },
    );
    expect(edits.zooms).toHaveLength(1);
    expect(edits.zooms[0]).toMatchObject({ start: 0, end: 5 });
  });

  it("respects the zoom cap and deletes by index", () => {
    let edits = base();
    for (let i = 0; i < MAX_ZOOMS + 5; i += 1) {
      edits = addZoom(edits, { start: i * 2, end: i * 2 + 1, rect: RECT });
    }
    expect(edits.zooms).toHaveLength(MAX_ZOOMS);
    expect(deleteZoom(edits, 0).zooms).toHaveLength(MAX_ZOOMS - 1);
  });
});

describe("setCrop", () => {
  it("clamps a crop and clears with null", () => {
    expect(setCrop(base(), { x: -1, y: 0, w: 0.5, h: 0.5 }).crop?.x).toBe(0);
    expect(setCrop(setCrop(base(), RECT), null).crop).toBeNull();
  });
});

describe("promoteMarker", () => {
  const seeded: VideoEdits = { ...base(), markers: [{ t: 4 }, { t: 20 }] };

  it("creates an attention overlay centred on the marker", () => {
    const edits = promoteMarker(seeded, 0, 6);
    expect(edits.overlays).toHaveLength(1);
    expect(edits.overlays[0]).toMatchObject({
      type: "attention",
      start: 1,
      end: 7,
      rect: { x: 0, y: 0, w: 1, h: 1 },
    });
  });

  it("never starts before zero and ignores a bad index", () => {
    expect(promoteMarker(seeded, 0, 20).overlays[0].start).toBe(0);
    expect(promoteMarker(seeded, 5, 6)).toEqual(seeded);
  });
});

describe("nextCalloutNumber", () => {
  it("counts from one and skips used numbers", () => {
    expect(nextCalloutNumber(base())).toBe(1);
    const edits = addOverlay(base(), {
      type: "callout",
      start: 0,
      end: 1,
      rect: RECT,
      n: 3,
    });
    expect(nextCalloutNumber(edits)).toBe(4);
  });
});
```

- [ ] Run `npx vitest run src/lib/editor/edit-ops.test.ts` — expected failure:
      `Error: Failed to load url @/lib/editor/edit-ops`.
- [ ] Write `src/lib/editor/edit-ops.ts`:

```ts
/**
 * Pure operations over a `VideoEdits` value. Every function returns a new value
 * and never mutates its input, so the undo stack can hold plain snapshots.
 *
 * Each op re-establishes the invariants the renderer depends on: rects clamped
 * into the frame, spans ordered and at least `MIN_SPAN` long, cuts merged,
 * zooms sorted and disjoint, and every list under its cap.
 */

import {
  MAX_CUTS,
  MAX_OVERLAYS,
  MAX_ZOOMS,
  type Cut,
  type Overlay,
  type OverlayStyle,
  type Rect,
  type VideoEdits,
  type Zoom,
} from "@/lib/edits";
import { mergeCuts } from "./cuts";
import { clampRect, applyHandle, type Handle } from "./hit-test";

/** Shortest span an overlay or zoom may have, in seconds. */
export const MIN_SPAN = 0.1;
/** Span given to a freshly drawn overlay when no in/out points are set. */
export const DEFAULT_SPAN = 3;

function orderSpan(start: number, end: number): { start: number; end: number } {
  const from = Math.max(0, Number.isFinite(start) ? start : 0);
  const to = Number.isFinite(end) ? end : from;
  return { start: from, end: Math.max(to, from + MIN_SPAN) };
}

export function addOverlay(edits: VideoEdits, overlay: Overlay): VideoEdits {
  if (edits.overlays.length >= MAX_OVERLAYS) return edits;
  const span = orderSpan(overlay.start, overlay.end);
  return {
    ...edits,
    overlays: [
      ...edits.overlays,
      { ...overlay, ...span, rect: clampRect(overlay.rect) },
    ],
  };
}

function replaceOverlay(
  edits: VideoEdits,
  index: number,
  next: (overlay: Overlay) => Overlay,
): VideoEdits {
  const current = edits.overlays[index];
  if (!current) return edits;
  const overlays = edits.overlays.slice();
  overlays[index] = next(current);
  return { ...edits, overlays };
}

export function moveOverlay(
  edits: VideoEdits,
  index: number,
  dx: number,
  dy: number,
): VideoEdits {
  return replaceOverlay(edits, index, (overlay) => ({
    ...overlay,
    rect: applyHandle(overlay.rect, "move", dx, dy),
  }));
}

export function resizeOverlay(
  edits: VideoEdits,
  index: number,
  handle: Handle,
  dx: number,
  dy: number,
): VideoEdits {
  return replaceOverlay(edits, index, (overlay) => ({
    ...overlay,
    rect: applyHandle(overlay.rect, handle, dx, dy),
  }));
}

export function deleteOverlay(edits: VideoEdits, index: number): VideoEdits {
  if (!edits.overlays[index]) return edits;
  return {
    ...edits,
    overlays: edits.overlays.filter((_, i) => i !== index),
  };
}

export function setOverlayStyle(
  edits: VideoEdits,
  index: number,
  patch: OverlayStyle,
): VideoEdits {
  return replaceOverlay(edits, index, (overlay) => ({
    ...overlay,
    style: { ...overlay.style, ...patch },
  }));
}

export function setOverlayLabel(
  edits: VideoEdits,
  index: number,
  label: string,
): VideoEdits {
  return replaceOverlay(edits, index, (overlay) => ({ ...overlay, label }));
}

export function setOverlaySpan(
  edits: VideoEdits,
  index: number,
  start: number,
  end: number,
): VideoEdits {
  return replaceOverlay(edits, index, (overlay) => ({
    ...overlay,
    ...orderSpan(start, end),
  }));
}

export function addCut(edits: VideoEdits, cut: Cut): VideoEdits {
  if (!(cut.end > cut.start)) return edits;
  return {
    ...edits,
    cuts: mergeCuts([...edits.cuts, cut]).slice(0, MAX_CUTS),
  };
}

export function deleteCut(edits: VideoEdits, index: number): VideoEdits {
  if (!edits.cuts[index]) return edits;
  return { ...edits, cuts: edits.cuts.filter((_, i) => i !== index) };
}

/** Insert a zoom, trimming or dropping anything it overlaps, then re-sort. */
export function addZoom(edits: VideoEdits, zoom: Zoom): VideoEdits {
  if (edits.zooms.length >= MAX_ZOOMS) return edits;
  const span = orderSpan(zoom.start, zoom.end);
  const next: Zoom = { ...zoom, ...span, rect: clampRect(zoom.rect) };

  const kept: Zoom[] = [];
  for (const existing of edits.zooms) {
    if (existing.start >= next.start && existing.end <= next.end) continue;
    if (existing.end <= next.start || existing.start >= next.end) {
      kept.push(existing);
      continue;
    }
    if (existing.start < next.start) {
      kept.push({ ...existing, end: next.start });
    }
    if (existing.end > next.end) {
      kept.push({ ...existing, start: next.end });
    }
  }

  const zooms = [...kept, next]
    .filter((entry) => entry.end - entry.start >= MIN_SPAN)
    .sort((a, b) => a.start - b.start);
  return { ...edits, zooms };
}

export function deleteZoom(edits: VideoEdits, index: number): VideoEdits {
  if (!edits.zooms[index]) return edits;
  return { ...edits, zooms: edits.zooms.filter((_, i) => i !== index) };
}

export function setCrop(edits: VideoEdits, crop: Rect | null): VideoEdits {
  return { ...edits, crop: crop === null ? null : clampRect(crop) };
}

/** Turn a recorder marker into an attention range of `span` seconds around it. */
export function promoteMarker(
  edits: VideoEdits,
  markerIndex: number,
  span = 6,
): VideoEdits {
  const marker = edits.markers[markerIndex];
  if (!marker) return edits;
  const start = Math.max(0, marker.t - span / 2);
  return addOverlay(edits, {
    type: "attention",
    start,
    end: start + span,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    label: marker.label,
  });
}

export function nextCalloutNumber(edits: VideoEdits): number {
  let highest = 0;
  for (const overlay of edits.overlays) {
    if (overlay.type !== "callout") continue;
    if (typeof overlay.n === "number") highest = Math.max(highest, overlay.n);
  }
  return highest + 1;
}
```

- [ ] Run `npx vitest run src/lib/editor/edit-ops.test.ts` — all pass.
- [ ] Commit:

```bash
git add src/lib/editor/edit-ops.ts src/lib/editor/edit-ops.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): add pure edit-list operations with invariants and caps

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 6: `src/lib/editor/undo.ts` — bounded snapshot undo stack

**Files:** `src/lib/editor/undo.test.ts`, `src/lib/editor/undo.ts`

- [ ] Write the failing test `src/lib/editor/undo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  UNDO_LIMIT,
  canRedo,
  canUndo,
  createStack,
  push,
  redo,
  undo,
} from "@/lib/editor/undo";

describe("undo stack", () => {
  it("starts empty with no history", () => {
    const stack = createStack("a");
    expect(stack.present).toBe("a");
    expect(canUndo(stack)).toBe(false);
    expect(canRedo(stack)).toBe(false);
  });

  it("pushes, undoes and redoes", () => {
    const stack = push(push(createStack("a"), "b"), "c");
    expect(stack.present).toBe("c");
    const once = undo(stack);
    expect(once.present).toBe("b");
    expect(canRedo(once)).toBe(true);
    expect(redo(once).present).toBe("c");
    expect(undo(undo(stack)).present).toBe("a");
  });

  it("is a no-op at either end", () => {
    const stack = createStack("a");
    expect(undo(stack)).toBe(stack);
    expect(redo(stack)).toBe(stack);
  });

  it("drops the redo branch on a new push", () => {
    const stack = redo(undo(push(push(createStack("a"), "b"), "c")));
    const branched = push(undo(stack), "d");
    expect(branched.present).toBe("d");
    expect(canRedo(branched)).toBe(false);
  });

  it("ignores a push of the identical value", () => {
    const stack = push(createStack("a"), "a");
    expect(canUndo(stack)).toBe(false);
  });

  it("bounds the past at UNDO_LIMIT entries", () => {
    let stack = createStack(0);
    for (let i = 1; i <= UNDO_LIMIT + 20; i += 1) stack = push(stack, i);
    expect(stack.past).toHaveLength(UNDO_LIMIT);
    expect(stack.past[0]).toBe(20);
  });
});
```

- [ ] Run `npx vitest run src/lib/editor/undo.test.ts` — expected failure:
      `Error: Failed to load url @/lib/editor/undo`.
- [ ] Write `src/lib/editor/undo.ts`:

```ts
/**
 * A bounded whole-value undo stack. The editor snapshots the entire
 * `VideoEdits` object per mutation — small enough to be free, and it removes
 * every class of partial-undo bug an inverse-op stack would introduce.
 */

export type UndoStack<T> = {
  past: readonly T[];
  present: T;
  future: readonly T[];
};

export const UNDO_LIMIT = 50;

export function createStack<T>(present: T): UndoStack<T> {
  return { past: [], present, future: [] };
}

export function push<T>(stack: UndoStack<T>, next: T): UndoStack<T> {
  if (Object.is(next, stack.present)) return stack;
  const past = [...stack.past, stack.present];
  return {
    past: past.length > UNDO_LIMIT ? past.slice(past.length - UNDO_LIMIT) : past,
    present: next,
    future: [],
  };
}

export function canUndo<T>(stack: UndoStack<T>): boolean {
  return stack.past.length > 0;
}

export function canRedo<T>(stack: UndoStack<T>): boolean {
  return stack.future.length > 0;
}

export function undo<T>(stack: UndoStack<T>): UndoStack<T> {
  if (!canUndo(stack)) return stack;
  const present = stack.past[stack.past.length - 1];
  return {
    past: stack.past.slice(0, -1),
    present,
    future: [stack.present, ...stack.future],
  };
}

export function redo<T>(stack: UndoStack<T>): UndoStack<T> {
  if (!canRedo(stack)) return stack;
  const [present, ...future] = stack.future;
  return { past: [...stack.past, stack.present], present, future };
}
```

- [ ] Run `npx vitest run src/lib/editor/undo.test.ts` — all pass.
- [ ] Commit:

```bash
git add src/lib/editor/undo.ts src/lib/editor/undo.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): add a bounded snapshot undo/redo stack

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---
### Task 7: `src/lib/editor/render.ts` — the pure canvas renderer

**Files:** `src/lib/editor/render.test.ts`, `src/lib/editor/render.ts`

- [ ] Write the failing test `src/lib/editor/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Overlay, VideoEdits } from "@/lib/edits";
import {
  activeOverlays,
  attentionAt,
  calloutEnvelope,
  drawEdits,
  toPixels,
  type FrameInfo,
} from "@/lib/editor/render";

const FRAME: FrameInfo = {
  width: 1000,
  height: 500,
  videoWidth: 2000,
  videoHeight: 1000,
};

type Call = [string, ...unknown[]];

/** A recording stand-in for CanvasRenderingContext2D. */
function stubContext(options: { filter?: boolean } = {}) {
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const ctx: Record<string, unknown> = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    canvas: { width: 0, height: 0 },
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    clip: record("clip"),
    rect: record("rect"),
    roundRect: record("roundRect"),
    arc: record("arc"),
    fill: record("fill"),
    stroke: record("stroke"),
    fillRect: record("fillRect"),
    fillText: record("fillText"),
    clearRect: record("clearRect"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
  };
  if (options.filter !== false) ctx.filter = "none";
  ctx.drawImage = (...args: unknown[]) => {
    calls.push(["drawImage", ctx.filter, ...args]);
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls,
    names: () => calls.map((call) => call[0]),
  };
}

const SOURCE = {} as CanvasImageSource;

function edits(overlays: Overlay[]): VideoEdits {
  return {
    version: 1,
    cuts: [],
    crop: null,
    zooms: [],
    overlays,
    markers: [],
  };
}

describe("toPixels", () => {
  it("maps a normalised rect onto the canvas backing store", () => {
    expect(toPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, FRAME)).toEqual({
      x: 250,
      y: 250,
      w: 500,
      h: 125,
    });
  });
});

describe("activeOverlays / attentionAt", () => {
  const list: Overlay[] = [
    { type: "blur", start: 0, end: 2, rect: { x: 0, y: 0, w: 1, h: 1 } },
    { type: "callout", start: 3, end: 5, rect: { x: 0, y: 0, w: 1, h: 1 } },
    { type: "attention", start: 0, end: 4, rect: { x: 0, y: 0, w: 1, h: 1 } },
  ];

  it("returns only drawable overlays inside the span", () => {
    expect(activeOverlays(list, 1).map((o) => o.type)).toEqual(["blur"]);
    expect(activeOverlays(list, 2)).toEqual([]);
    expect(activeOverlays(list, 4).map((o) => o.type)).toEqual(["callout"]);
  });

  it("finds the attention range covering the time", () => {
    expect(attentionAt(list, 1)?.type).toBe("attention");
    expect(attentionAt(list, 4.5)).toBeNull();
  });
});

describe("calloutEnvelope", () => {
  it("is silent outside the span", () => {
    expect(calloutEnvelope(0, 1, 3)).toEqual({ alpha: 0, scale: 0 });
    expect(calloutEnvelope(3, 1, 3)).toEqual({ alpha: 0, scale: 0 });
  });

  it("pops in, holds at full size, and fades out", () => {
    expect(calloutEnvelope(1, 1, 3).alpha).toBe(0);
    expect(calloutEnvelope(2, 1, 3)).toEqual({ alpha: 1, scale: 1 });
    expect(calloutEnvelope(2.95, 1, 3).alpha).toBeLessThan(1);
  });

  it("overshoots on the way in", () => {
    const mid = calloutEnvelope(1.15, 1, 3);
    expect(mid.scale).toBeGreaterThan(1);
  });
});

describe("drawEdits", () => {
  it("draws nothing for an empty edit list", () => {
    const stub = stubContext();
    drawEdits(stub.ctx, SOURCE, edits([]), 1, FRAME);
    expect(stub.calls).toHaveLength(0);
  });

  it("draws nothing for overlays outside the current time", () => {
    const stub = stubContext();
    drawEdits(
      stub.ctx,
      SOURCE,
      edits([
        { type: "blur", start: 5, end: 6, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      ]),
      1,
      FRAME,
    );
    expect(stub.names()).not.toContain("drawImage");
  });

  it("redraws the source region through a blur filter", () => {
    const stub = stubContext();
    drawEdits(
      stub.ctx,
      SOURCE,
      edits([
        {
          type: "blur",
          start: 0,
          end: 5,
          rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        },
      ]),
      1,
      FRAME,
    );
    const draw = stub.calls.find((call) => call[0] === "drawImage");
    expect(draw).toBeDefined();
    expect(String(draw?.[1])).toMatch(/^blur\(\d+(\.\d+)?px\)$/);
    // source rect is in the video's intrinsic pixels, not canvas pixels
    expect(draw?.[3]).toBeCloseTo(0.1 * FRAME.videoWidth, 0);
    expect(stub.names()).toContain("clip");
  });

  it("falls back to a solid redact when ctx.filter is unsupported", () => {
    const stub = stubContext({ filter: false });
    drawEdits(
      stub.ctx,
      SOURCE,
      edits([
        { type: "blur", start: 0, end: 5, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      ]),
      1,
      FRAME,
    );
    expect(stub.names()).not.toContain("drawImage");
    expect(stub.names()).toContain("fill");
  });

  it("redacts rather than skipping when there is no source frame", () => {
    const stub = stubContext();
    drawEdits(
      stub.ctx,
      null,
      edits([
        { type: "blur", start: 0, end: 5, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      ]),
      1,
      FRAME,
    );
    expect(stub.names()).toContain("fill");
  });

  it("strokes a ring and a number for a callout", () => {
    const stub = stubContext();
    drawEdits(
      stub.ctx,
      SOURCE,
      edits([
        {
          type: "callout",
          start: 0,
          end: 5,
          rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
          n: 2,
        },
      ]),
      1,
      FRAME,
    );
    expect(stub.names()).toContain("arc");
    expect(stub.names()).toContain("stroke");
    expect(stub.calls.find((call) => call[0] === "fillText")?.[1]).toBe("2");
  });

  it("multiplies a highlight and fills an underline along the bottom edge", () => {
    const stub = stubContext();
    drawEdits(
      stub.ctx,
      SOURCE,
      edits([
        {
          type: "highlight",
          start: 0,
          end: 5,
          rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
        },
        {
          type: "underline",
          start: 0,
          end: 5,
          rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
          style: { thickness: 0.02 },
        },
      ]),
      1,
      FRAME,
    );
    const rects = stub.calls.filter((call) => call[0] === "fillRect");
    expect(rects).toHaveLength(2);
    // underline sits at the rect's bottom edge (0.5 * 500 = 250) and is
    // `thickness * frame.height` = 10px tall.
    expect(rects[1]?.[2]).toBeCloseTo(240, 0);
    expect(rects[1]?.[4]).toBeCloseTo(10, 0);
  });

  it("never draws attention overlays on the canvas", () => {
    const stub = stubContext();
    drawEdits(
      stub.ctx,
      SOURCE,
      edits([
        {
          type: "attention",
          start: 0,
          end: 5,
          rect: { x: 0, y: 0, w: 1, h: 1 },
        },
      ]),
      1,
      FRAME,
    );
    expect(stub.calls).toHaveLength(0);
  });
});
```

- [ ] Run `npx vitest run src/lib/editor/render.test.ts` — expected failure:
      `Error: Failed to load url @/lib/editor/render`.
- [ ] Write `src/lib/editor/render.ts`:

```ts
/**
 * The canvas renderer. Pure functions over a 2D context and a `FrameInfo` —
 * no DOM lookups, no component state — so both the player and the 5b export
 * can call exactly the same code, and a stub context can test it.
 *
 * Zoom, crop and attention are NOT drawn here: zoom/crop are a CSS transform on
 * the wrapper (which carries the canvas too, so overlays stay welded to the
 * frame), and attention is a border pulse plus a chapter pill.
 */

import type { Overlay, Rect, VideoEdits } from "@/lib/edits";

export type FrameInfo = {
  /** Canvas backing-store size, in device pixels. */
  width: number;
  height: number;
  /** The video's intrinsic size, used to cut blur source rects. */
  videoWidth: number;
  videoHeight: number;
};

export type PixelRect = { x: number; y: number; w: number; h: number };

const ACCENT = "#e85a4f";
const REDACT = "#1a1a1e";
const POP_IN = 0.22;
const POP_OUT = 0.16;
const BACK = 1.70158;
/** Longest edge of the downscaled blur buffer; keeps 4K Safari cheap. */
const BLUR_BUFFER_EDGE = 320;

export function toPixels(rect: Rect, frame: FrameInfo): PixelRect {
  return {
    x: rect.x * frame.width,
    y: rect.y * frame.height,
    w: rect.w * frame.width,
    h: rect.h * frame.height,
  };
}

/** Overlays that are drawn on the canvas and active at `time`. */
export function activeOverlays(
  overlays: readonly Overlay[],
  time: number,
): Overlay[] {
  return overlays.filter(
    (overlay) =>
      overlay.type !== "attention" &&
      time >= overlay.start &&
      time < overlay.end,
  );
}

/** The attention range covering `time`, if any. */
export function attentionAt(
  overlays: readonly Overlay[],
  time: number,
): Overlay | null {
  for (const overlay of overlays) {
    if (overlay.type !== "attention") continue;
    if (time >= overlay.start && time < overlay.end) return overlay;
  }
  return null;
}

/** Pop-in / pop-out envelope for callouts. */
export function calloutEnvelope(
  time: number,
  start: number,
  end: number,
): { alpha: number; scale: number } {
  if (time < start || time >= end) return { alpha: 0, scale: 0 };
  const inProgress = Math.min(1, (time - start) / POP_IN);
  const outProgress = Math.min(1, (end - time) / POP_OUT);
  const back =
    1 + BACK * (inProgress - 1) ** 3 + BACK * (inProgress - 1) ** 2;
  return {
    alpha: Math.min(inProgress, outProgress),
    scale: Math.max(0, back * outProgress),
  };
}

function colorOf(overlay: Overlay, fallback: string): string {
  return overlay.style?.color ?? overlay.color ?? fallback;
}

function path(
  ctx: CanvasRenderingContext2D,
  px: PixelRect,
  radius: number,
): void {
  ctx.beginPath();
  if (radius > 0 && typeof ctx.roundRect === "function") {
    ctx.roundRect(px.x, px.y, px.w, px.h, radius);
  } else {
    ctx.rect(px.x, px.y, px.w, px.h);
  }
}

function drawBlur(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource | null,
  overlay: Overlay,
  frame: FrameInfo,
  scratch: CanvasRenderingContext2D | null,
): void {
  const px = toPixels(overlay.rect, frame);
  const radius = (overlay.style?.radius ?? 0.015) * frame.height;
  const blur = Math.max(2, (overlay.style?.blur ?? 0.03) * frame.height);
  const canFilter = source !== null && typeof ctx.filter === "string";

  ctx.save();
  path(ctx, px, radius);
  ctx.clip();

  if (!canFilter) {
    // Fail closed: a redact that cannot blur must still hide the pixels.
    ctx.fillStyle = colorOf(overlay, REDACT);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Bleed the sampled region so the blur has neighbours to pull from.
  const bleedX = (blur * 2 * frame.videoWidth) / frame.width;
  const bleedY = (blur * 2 * frame.videoHeight) / frame.height;
  const sx = Math.max(0, overlay.rect.x * frame.videoWidth - bleedX);
  const sy = Math.max(0, overlay.rect.y * frame.videoHeight - bleedY);
  const sw = Math.min(
    frame.videoWidth - sx,
    overlay.rect.w * frame.videoWidth + bleedX * 2,
  );
  const sh = Math.min(
    frame.videoHeight - sy,
    overlay.rect.h * frame.videoHeight + bleedY * 2,
  );
  const dx = px.x - blur * 2;
  const dy = px.y - blur * 2;
  const dw = px.w + blur * 4;
  const dh = px.h + blur * 4;

  if (scratch) {
    const ratio = Math.min(1, BLUR_BUFFER_EDGE / Math.max(dw, dh, 1));
    const bw = Math.max(1, Math.round(dw * ratio));
    const bh = Math.max(1, Math.round(dh * ratio));
    if (scratch.canvas.width !== bw) scratch.canvas.width = bw;
    if (scratch.canvas.height !== bh) scratch.canvas.height = bh;
    scratch.clearRect(0, 0, bw, bh);
    scratch.filter = `blur(${Math.max(1, blur * ratio)}px)`;
    scratch.drawImage(source, sx, sy, sw, sh, 0, 0, bw, bh);
    scratch.filter = "none";
    ctx.drawImage(scratch.canvas, 0, 0, bw, bh, dx, dy, dw, dh);
  } else {
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.filter = "none";
  }
  ctx.restore();
}

function drawCallout(
  ctx: CanvasRenderingContext2D,
  overlay: Overlay,
  time: number,
  frame: FrameInfo,
): void {
  const envelope = calloutEnvelope(time, overlay.start, overlay.end);
  if (envelope.alpha <= 0 || envelope.scale <= 0) return;

  const px = toPixels(overlay.rect, frame);
  const cx = px.x + px.w / 2;
  const cy = px.y + px.h / 2;
  const radius = Math.max(1, (Math.min(px.w, px.h) / 2) * envelope.scale);
  const color = colorOf(overlay, ACCENT);

  ctx.save();
  ctx.globalAlpha = envelope.alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(
    2,
    (overlay.style?.thickness ?? 0.008) * frame.height,
  );
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (typeof overlay.n === "number") {
    const badge = Math.max(8, radius * 0.34);
    const bx = cx - radius * 0.7071;
    const by = cy - radius * 0.7071;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bx, by, badge, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(badge * 1.2)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(overlay.n), bx, by);
  }
  ctx.restore();
}

function drawHighlight(
  ctx: CanvasRenderingContext2D,
  overlay: Overlay,
  frame: FrameInfo,
): void {
  const px = toPixels(overlay.rect, frame);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = overlay.style?.opacity ?? 0.45;
  ctx.fillStyle = colorOf(overlay, "#ffe066");
  ctx.fillRect(px.x, px.y, px.w, px.h);
  ctx.restore();
}

function drawUnderline(
  ctx: CanvasRenderingContext2D,
  overlay: Overlay,
  frame: FrameInfo,
): void {
  const px = toPixels(overlay.rect, frame);
  const thickness = Math.max(
    2,
    (overlay.style?.thickness ?? 0.01) * frame.height,
  );
  ctx.save();
  ctx.globalAlpha = overlay.style?.opacity ?? 1;
  ctx.fillStyle = colorOf(overlay, ACCENT);
  ctx.fillRect(px.x, px.y + px.h - thickness, px.w, thickness);
  ctx.restore();
}

/**
 * Draw every overlay active at `time`. The caller clears the canvas first and
 * owns the transform; `source` is the video element (or any drawable frame) and
 * may be null before the first frame is decoded — blur then fails closed.
 * `scratch` is an optional offscreen 2D context used to downscale blurs.
 */
export function drawEdits(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource | null,
  edits: VideoEdits,
  time: number,
  frame: FrameInfo,
  scratch: CanvasRenderingContext2D | null = null,
): void {
  for (const overlay of activeOverlays(edits.overlays, time)) {
    switch (overlay.type) {
      case "blur":
        drawBlur(ctx, source, overlay, frame, scratch);
        break;
      case "callout":
        drawCallout(ctx, overlay, time, frame);
        break;
      case "highlight":
        drawHighlight(ctx, overlay, frame);
        break;
      case "underline":
        drawUnderline(ctx, overlay, frame);
        break;
      default:
        break;
    }
  }
}
```

- [ ] Run `npx vitest run src/lib/editor/render.test.ts` — all pass.
- [ ] Run `npm test` and `npx tsc --noEmit` — both clean.
- [ ] Commit:

```bash
git add src/lib/editor/render.ts src/lib/editor/render.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): add the pure canvas renderer for blur, callout, highlight and underline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---
### Task 8: `EditPlayer` renders the edit list

**Files:** `src/components/video/edit-player.tsx`

Rewrites the Phase 3 stub: the rAF loop now calls `drawEdits`, the video and canvas
share a crop window + zoom wrapper, cuts are skipped on `timeupdate`, and a remapped
scrubber replaces the native controls whenever cuts exist. New props let the editor
turn cut-skipping off and mount its own frame layer.

- [ ] Replace `src/components/video/edit-player.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hasDrawableEdits,
  type Marker,
  type VideoEdits,
} from "@/lib/edits";
import { fmtDuration } from "@/lib/format";
import {
  editedDuration,
  editedToSource,
  skipTarget,
  sourceToEdited,
} from "@/lib/editor/cuts";
import { drawEdits, type FrameInfo } from "@/lib/editor/render";
import { attentionAt } from "@/lib/editor/render";
import { IDENTITY_ZOOM, zoomStateAt } from "@/lib/editor/zoom";

export type EditPlayerProps = {
  src: string;
  poster?: string;
  edits: VideoEdits;
  /**
   * Supplied by the watch page so `useViewTracker` keeps owning the element,
   * and by the editor so it can seek and scrub.
   */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Recorder-placed timestamps; a tick bar renders under the video. */
  markers?: Marker[];
  className?: string;
  autoPlay?: boolean;
  /** Editor: false shows cut content instead of skipping it. */
  applyCuts?: boolean;
  /** Editor: false pins the frame at 1× so rects can be drawn accurately. */
  applyZoom?: boolean;
  /** Rendered above the canvas, inside the zoom wrapper (the editor's layer). */
  frameOverlay?: React.ReactNode;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
};

const DEFAULT_ASPECT = 16 / 9;

export function EditPlayer({
  src,
  poster,
  edits,
  videoRef,
  markers,
  className,
  autoPlay,
  applyCuts = true,
  applyZoom = true,
  frameOverlay,
  onTimeUpdate,
  onDurationChange,
}: EditPlayerProps) {
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? internalRef;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scratchRef = useRef<CanvasRenderingContext2D | null>(null);
  const reportedTimeRef = useRef(-1);

  const [duration, setDuration] = useState(0);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const crop = edits.crop;
  const cuts = applyCuts ? edits.cuts : [];
  const visibleDuration = editedDuration(cuts, duration);
  const attention = attentionAt(edits.overlays, time);

  // A dedicated offscreen buffer keeps blur cheap: the region is downscaled to
  // at most 320px before the filter runs, then drawn back up.
  useEffect(() => {
    const canvas = document.createElement("canvas");
    scratchRef.current = canvas.getContext("2d");
  }, []);

  // Keep the canvas backing store matched to the stage box and the DPR.
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  const needsLoop =
    hasDrawableEdits(edits) || edits.overlays.length > 0 || onTimeUpdate !== undefined;

  // One rAF loop drives the canvas, the zoom transform and the time readout.
  useEffect(() => {
    const video = ref.current;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!video || !canvas || !stage) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    if (!needsLoop) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      stage.style.transform = "";
      return;
    }

    let frameId = 0;
    const draw = () => {
      const now = video.currentTime;
      context.clearRect(0, 0, canvas.width, canvas.height);

      const zoom = applyZoom
        ? zoomStateAt(edits.zooms, now)
        : IDENTITY_ZOOM;
      stage.style.transformOrigin = `${zoom.originX * 100}% ${zoom.originY * 100}%`;
      stage.style.transform =
        zoom.scale === 1 ? "" : `scale(${zoom.scale.toFixed(4)})`;

      if (video.videoWidth > 0) {
        const frame: FrameInfo = {
          width: canvas.width,
          height: canvas.height,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        };
        drawEdits(context, video, edits, now, frame, scratchRef.current);
      }

      // Only re-render React when the tenth of a second changes.
      const rounded = Math.round(now * 10) / 10;
      if (rounded !== reportedTimeRef.current) {
        reportedTimeRef.current = rounded;
        setTime(rounded);
        onTimeUpdate?.(now);
      }

      frameId = window.requestAnimationFrame(draw);
    };
    frameId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frameId);
  }, [ref, edits, applyZoom, needsLoop, onTimeUpdate]);

  // Cuts: jump the playhead out of any removed range.
  useEffect(() => {
    const video = ref.current;
    if (!video || cuts.length === 0) return;
    const onTime = () => {
      const target = skipTarget(cuts, video.currentTime);
      if (target !== null) video.currentTime = target;
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onTime);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onTime);
    };
  }, [ref, cuts]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [ref]);

  const seekTo = useCallback(
    (seconds: number) => {
      const video = ref.current;
      if (video) video.currentTime = seconds;
    },
    [ref],
  );

  function onMetadata(video: HTMLVideoElement) {
    const value = video.duration;
    setDuration(Number.isFinite(value) ? value : 0);
    if (Number.isFinite(value)) onDurationChange?.(value);
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setAspect(video.videoWidth / video.videoHeight);
    }
  }

  const windowStyle = useMemo<React.CSSProperties>(() => {
    if (!crop) return { aspectRatio: `${aspect}` };
    return { aspectRatio: `${(aspect * crop.w) / crop.h}` };
  }, [aspect, crop]);

  const stageStyle = useMemo<React.CSSProperties>(() => {
    if (!crop) return { position: "absolute", inset: 0 };
    return {
      position: "absolute",
      width: `${100 / crop.w}%`,
      height: `${100 / crop.h}%`,
      left: `${(-crop.x / crop.w) * 100}%`,
      top: `${(-crop.y / crop.h) * 100}%`,
    };
  }, [crop]);

  // Native controls show *source* time, which is wrong once anything is cut.
  const ownControls = cuts.length > 0;
  const ticks = markers ?? [];
  const showTicks = ticks.length > 0 && duration > 0;

  return (
    <div className={className}>
      <div
        style={windowStyle}
        data-attention={attention ? "on" : undefined}
        className={`relative w-full overflow-hidden rounded-xl border border-border bg-black shadow-lg shadow-black/30 ${
          attention ? "attention-pulse" : ""
        }`}
      >
        <div ref={stageRef} style={stageStyle}>
          <video
            ref={ref}
            src={src}
            poster={poster}
            controls={!ownControls}
            preload="metadata"
            playsInline
            autoPlay={autoPlay}
            onLoadedMetadata={(event) => onMetadata(event.currentTarget)}
            onDurationChange={(event) => onMetadata(event.currentTarget)}
            className="block h-full w-full bg-black"
          />
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0"
          />
          {frameOverlay}
        </div>
      </div>

      {ownControls && (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const video = ref.current;
              if (!video) return;
              if (video.paused) void video.play();
              else video.pause();
            }}
            aria-label={playing ? "Pause" : "Play"}
            className="rounded-lg border border-border px-3 py-1 text-sm text-muted transition-colors hover:text-foreground"
          >
            {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0.1, visibleDuration)}
            step={0.05}
            value={Math.min(sourceToEdited(cuts, time), visibleDuration)}
            onChange={(event) =>
              seekTo(editedToSource(cuts, Number(event.target.value)))
            }
            aria-label="Seek"
            className="h-1 flex-1 accent-[var(--color-accent)]"
          />
          <span className="tabular-nums text-xs text-muted-dim">
            {fmtDuration(sourceToEdited(cuts, time) * 1000)} /{" "}
            {fmtDuration(visibleDuration * 1000)}
          </span>
        </div>
      )}

      {showTicks && (
        <div
          className="relative mt-1.5 h-4 rounded bg-border-subtle"
          role="group"
          aria-label="Markers"
        >
          {ticks.map((marker, index) => (
            <button
              key={`${marker.t}-${index}`}
              type="button"
              onClick={() => seekTo(marker.t)}
              title={marker.label ?? fmtDuration(marker.t * 1000)}
              aria-label={`Jump to ${fmtDuration(marker.t * 1000)}`}
              style={{
                left: `${Math.min(100, Math.max(0, (marker.t / duration) * 100))}%`,
              }}
              className="absolute top-0 h-4 min-w-[10px] -translate-x-1/2 rounded-sm bg-accent transition-transform hover:scale-x-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Run `npm run lint` — clean.
- [ ] Commit:

```bash
git add src/components/video/edit-player.tsx
git commit -m "$(cat <<'EOF'
feat(player): render overlays, zoom, crop and cuts in EditPlayer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 9: attention pulse + chapter pills

**Files:** `src/app/globals.css`, `src/components/video/attention-pills.tsx`

- [ ] Append to `src/app/globals.css`:

```css
/* Phase 5: attention ranges. The player sets data-attention="on" while the
   playhead is inside an attention overlay. */
@keyframes yoom-attention {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(232 90 79 / 0);
  }
  50% {
    box-shadow: 0 0 0 3px rgb(232 90 79 / 0.55);
  }
}

.attention-pulse {
  animation: yoom-attention 1.6s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .attention-pulse {
    animation: none;
    box-shadow: 0 0 0 3px rgb(232 90 79 / 0.45);
  }
}
```

- [ ] Write `src/components/video/attention-pills.tsx`:

```tsx
"use client";

import type { Overlay } from "@/lib/edits";
import { fmtDuration } from "@/lib/format";

export type AttentionPillsProps = {
  overlays: readonly Overlay[];
  /** Seeks the player to the range's start. */
  onSeek: (seconds: number) => void;
  /** Highlights the range covering the playhead. */
  currentTime?: number;
};

const DEFAULT_LABEL = "Pay attention here";

/** Chapter pills for every attention range, in time order. */
export function AttentionPills({
  overlays,
  onSeek,
  currentTime = -1,
}: AttentionPillsProps) {
  const ranges = overlays
    .filter((overlay) => overlay.type === "attention")
    .slice()
    .sort((a, b) => a.start - b.start);

  if (ranges.length === 0) return null;

  return (
    <nav aria-label="Attention sections" className="flex flex-wrap gap-2">
      {ranges.map((range, index) => {
        const active =
          currentTime >= range.start && currentTime < range.end;
        return (
          <button
            key={`${range.start}-${index}`}
            type="button"
            onClick={() => onSeek(range.start)}
            aria-current={active ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              active
                ? "border-accent bg-accent/15 text-foreground"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            <span className="tabular-nums text-muted-dim">
              {fmtDuration(range.start * 1000)}
            </span>{" "}
            {range.label?.trim() || DEFAULT_LABEL}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] Run `npx tsc --noEmit` and `npm run lint` — clean.
- [ ] Commit:

```bash
git add src/app/globals.css src/components/video/attention-pills.tsx
git commit -m "$(cat <<'EOF'
feat(player): add the attention border pulse and chapter pills

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 10: watch page renders attention chapters

**Files:** `src/components/watch-view.tsx`

- [ ] In `src/components/watch-view.tsx`, add the imports:

```tsx
import { AttentionPills } from "@/components/video/attention-pills";
```

- [ ] Add a `watchTime` state and feed it from the player, then render the pills
      between the player block and the title block:

```tsx
  const [watchTime, setWatchTime] = useState(0);
```

```tsx
        <EditPlayer
          src={`${apiBase}/api/stream/${video.id}`}
          poster={video.hasThumbnail ? `${apiBase}/api/thumb/${video.id}` : undefined}
          edits={edits}
          videoRef={videoRef}
          onTimeUpdate={setWatchTime}
        />
```

```tsx
      <AttentionPills
        overlays={edits.overlays}
        currentTime={watchTime}
        onSeek={(seconds) => {
          const element = videoRef.current;
          if (element) element.currentTime = seconds;
        }}
      />
```

- [ ] Run `npm run build`, then confirm the watch route ships no editor code:

```bash
npm run build
grep -rl "components/editor" .next/server/app/v 2>/dev/null; echo "exit=$?"
```

      Expect no file list and `exit=1` (grep found nothing).
- [ ] Commit:

```bash
git add src/components/watch-view.tsx
git commit -m "$(cat <<'EOF'
feat(watch): show attention chapter pills on the public watch page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 11: `saveEdits` server action

**Files:** `src/app/(owner)/actions.ts`

- [ ] Add to `src/app/(owner)/actions.ts` — extend the `db` import with `setVideoEdits`
      and add `import { parseEdits } from "@/lib/edits";`, then:

```ts
/**
 * Persist the edit-decision list. The payload is untrusted (server functions are
 * reachable by direct POST), so it is re-validated through `parseEdits` here —
 * that is where the caps and the cut/rect invariants are actually enforced.
 */
export async function saveEdits(
  videoId: string,
  payload: unknown,
): Promise<ActionState> {
  if (!(await isOwner())) return UNAUTHORIZED;
  if (!videoId) return { error: "Missing video." };

  const video = await getVideoById(videoId);
  if (!video) return { error: "Recording not found." };

  const edits = parseEdits(payload);
  try {
    await setVideoEdits(videoId, edits);
  } catch {
    return { error: "Could not save the edits." };
  }

  revalidateVideo(videoId);
  revalidatePath(`/v/${video.slug}`);
  return { ok: true };
}
```

- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Commit:

```bash
git add "src/app/(owner)/actions.ts"
git commit -m "$(cat <<'EOF'
feat(actions): add saveEdits with server-side edit-list revalidation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---
### Task 12: `use-editor.ts` — editor state, undo stack, optimistic save

**Files:** `src/components/editor/use-editor.ts`

- [ ] Write `src/components/editor/use-editor.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { VideoEdits } from "@/lib/edits";
import {
  canRedo as stackCanRedo,
  canUndo as stackCanUndo,
  createStack,
  push,
  redo as stackRedo,
  undo as stackUndo,
  type UndoStack,
} from "@/lib/editor/undo";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** What the toolbox, timeline and inspector all point at. */
export type Selection =
  | { kind: "overlay"; index: number }
  | { kind: "cut"; index: number }
  | { kind: "zoom"; index: number }
  | null;

export type SaveEdits = (
  videoId: string,
  edits: VideoEdits,
) => Promise<{ ok?: boolean; error?: string }>;

const DEBOUNCE_MS = 800;

export type Editor = {
  edits: VideoEdits;
  /** Apply a pure op and schedule a save. */
  apply: (op: (edits: VideoEdits) => VideoEdits) => void;
  /** Apply without pushing an undo entry (used mid-drag). */
  applyTransient: (op: (edits: VideoEdits) => VideoEdits) => void;
  /** Push the current value onto the undo stack (called at pointer-up). */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  status: SaveStatus;
  error: string | null;
  saveNow: () => void;
};

export function useEditor(
  videoId: string,
  initial: VideoEdits,
  save: SaveEdits,
): Editor {
  const [stack, setStack] = useState<UndoStack<VideoEdits>>(() =>
    createStack(initial),
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // The value the drag started from, so one drag is one undo entry.
  const dragBaseRef = useRef<VideoEdits | null>(null);
  const timerRef = useRef<number | null>(null);
  const latestRef = useRef(stack.present);
  latestRef.current = stack.present;

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const payload = latestRef.current;
    setStatus("saving");
    setError(null);
    startTransition(async () => {
      const result = await save(videoId, payload);
      if (result.error) {
        setStatus("error");
        setError(result.error);
      } else {
        setStatus("saved");
      }
    });
  }, [save, videoId]);

  const schedule = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);

  // A pending save must not be lost when the panel unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        void save(videoId, latestRef.current);
      }
    };
  }, [save, videoId]);

  const apply = useCallback(
    (op: (edits: VideoEdits) => VideoEdits) => {
      setStack((current) => push(current, op(current.present)));
      schedule();
    },
    [schedule],
  );

  const applyTransient = useCallback(
    (op: (edits: VideoEdits) => VideoEdits) => {
      setStack((current) => {
        if (dragBaseRef.current === null) dragBaseRef.current = current.present;
        return { ...current, present: op(current.present) };
      });
    },
    [],
  );

  const commit = useCallback(() => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (base === null) return;
    setStack((current) =>
      Object.is(base, current.present)
        ? current
        : { ...push({ ...current, present: base }, current.present) },
    );
    schedule();
  }, [schedule]);

  const undo = useCallback(() => {
    setStack((current) => stackUndo(current));
    schedule();
  }, [schedule]);

  const redo = useCallback(() => {
    setStack((current) => stackRedo(current));
    schedule();
  }, [schedule]);

  return {
    edits: stack.present,
    apply,
    applyTransient,
    commit,
    undo,
    redo,
    canUndo: stackCanUndo(stack),
    canRedo: stackCanRedo(stack),
    status,
    error,
    saveNow: flush,
  };
}
```

- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Commit:

```bash
git add src/components/editor/use-editor.ts
git commit -m "$(cat <<'EOF'
feat(editor): add the editor state hook with undo and debounced saving

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 13: `toolbox.tsx` — tool buttons, undo/redo, save status

**Files:** `src/components/editor/toolbox.tsx`

- [ ] Write `src/components/editor/toolbox.tsx`:

```tsx
"use client";

import type { SaveStatus } from "./use-editor";

export type EditorTool =
  | "select"
  | "blur"
  | "callout"
  | "underline"
  | "highlight"
  | "zoom"
  | "cut"
  | "crop"
  | "attention";

export const EDITOR_TOOLS: { id: EditorTool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click an item to select it" },
  { id: "blur", label: "Blur", hint: "Drag over anything to redact it" },
  { id: "callout", label: "Callout", hint: "Drag a numbered circle" },
  { id: "underline", label: "Underline", hint: "Drag over a line of text" },
  { id: "highlight", label: "Highlight", hint: "Drag to highlight" },
  { id: "zoom", label: "Zoom", hint: "Drag the region to zoom into" },
  { id: "cut", label: "Cut", hint: "Set I and O, then press C" },
  { id: "crop", label: "Crop", hint: "Drag the kept region of the frame" },
  { id: "attention", label: "Attention", hint: "Mark a range worth watching" },
];

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

export type ToolboxProps = {
  tool: EditorTool;
  onTool: (tool: EditorTool) => void;
  status: SaveStatus;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
};

export function Toolbox({
  tool,
  onTool,
  status,
  error,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRetry,
}: ToolboxProps) {
  const active = EDITOR_TOOLS.find((entry) => entry.id === tool);

  return (
    <div className="space-y-2">
      <div
        role="toolbar"
        aria-label="Editing tools"
        className="flex flex-wrap items-center gap-1.5"
      >
        {EDITOR_TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onTool(entry.id)}
            aria-pressed={entry.id === tool}
            title={entry.hint}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              entry.id === tool
                ? "border-accent bg-accent/15 text-foreground"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {entry.label}
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          Redo
        </button>

        <span
          aria-live="polite"
          className={`ml-auto text-xs ${
            status === "error" ? "text-accent" : "text-muted-dim"
          }`}
        >
          {status === "error" ? (error ?? STATUS_TEXT.error) : STATUS_TEXT[status]}
        </span>
        {status === "error" && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-accent px-3 py-1.5 text-xs text-foreground"
          >
            Retry
          </button>
        )}
      </div>

      {active && <p className="text-xs text-muted-dim">{active.hint}</p>}
    </div>
  );
}
```

- [ ] Run `npm run lint` — clean.
- [ ] Commit:

```bash
git add src/components/editor/toolbox.tsx
git commit -m "$(cat <<'EOF'
feat(editor): add the tool palette with undo/redo and save status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 14: `frame-overlay.tsx` — drag-to-draw, select, move, resize

**Files:** `src/components/editor/frame-overlay.tsx`

- [ ] Write `src/components/editor/frame-overlay.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import type { Rect, VideoEdits } from "@/lib/edits";
import {
  handleAt,
  hitTestOverlays,
  rectFromDrag,
  type Handle,
  type Point,
} from "@/lib/editor/hit-test";
import type { EditorTool } from "./toolbox";
import type { Selection } from "./use-editor";

export type FrameOverlayProps = {
  tool: EditorTool;
  edits: VideoEdits;
  time: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** A new rect was drawn with the active tool. */
  onDraw: (rect: Rect) => void;
  onMove: (index: number, dx: number, dy: number) => void;
  onResize: (index: number, handle: Handle, dx: number, dy: number) => void;
  onCommit: () => void;
};

type Drag =
  | { kind: "draw"; from: Point; to: Point }
  | { kind: "edit"; index: number; handle: Handle; last: Point };

/** Pointer tolerance for grabbing a resize handle, as a fraction of the frame. */
const TOLERANCE = 0.02;

export function FrameOverlay({
  tool,
  edits,
  time,
  selection,
  onSelect,
  onDraw,
  onMove,
  onResize,
  onCommit,
}: FrameOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);

  const selectedIndex =
    selection?.kind === "overlay" ? selection.index : null;
  const selected =
    selectedIndex === null ? null : (edits.overlays[selectedIndex] ?? null);

  function pointOf(event: React.PointerEvent): Point {
    const box = rootRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const point = pointOf(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "select") {
      if (selected) {
        const handle = handleAt(selected.rect, point, TOLERANCE);
        if (handle) {
          dragRef.current = {
            kind: "edit",
            index: selectedIndex as number,
            handle,
            last: point,
          };
          return;
        }
      }
      const hit = hitTestOverlays(edits.overlays, time, point);
      onSelect(hit === null ? null : { kind: "overlay", index: hit });
      dragRef.current =
        hit === null
          ? null
          : { kind: "edit", index: hit, handle: "move", last: point };
      return;
    }

    dragRef.current = { kind: "draw", from: point, to: point };
    setPreview(rectFromDrag(point, point));
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointOf(event);

    if (drag.kind === "draw") {
      drag.to = point;
      setPreview(rectFromDrag(drag.from, point));
      return;
    }

    const dx = point.x - drag.last.x;
    const dy = point.y - drag.last.y;
    drag.last = point;
    if (drag.handle === "move") onMove(drag.index, dx, dy);
    else onResize(drag.index, drag.handle, dx, dy);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (!drag) return;
    if (drag.kind === "draw") {
      const rect = rectFromDrag(drag.from, drag.to);
      setPreview(null);
      onDraw(rect);
      return;
    }
    onCommit();
  }

  const box = (rect: Rect): React.CSSProperties => ({
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  });

  const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const handleStyle: Record<string, React.CSSProperties> = {
    nw: { left: 0, top: 0 },
    n: { left: "50%", top: 0 },
    ne: { left: "100%", top: 0 },
    e: { left: "100%", top: "50%" },
    se: { left: "100%", top: "100%" },
    s: { left: "50%", top: "100%" },
    sw: { left: 0, top: "100%" },
    w: { left: 0, top: "50%" },
  };

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`absolute inset-0 ${
        tool === "select" ? "cursor-default" : "cursor-crosshair"
      }`}
    >
      {preview && (
        <div
          style={box(preview)}
          className="pointer-events-none absolute border border-dashed border-accent bg-accent/10"
        />
      )}

      {selected && (
        <div
          style={box(selected.rect)}
          className="pointer-events-none absolute border border-accent"
        >
          {handles.map((handle) => (
            <span
              key={handle}
              style={handleStyle[handle]}
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-accent"
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] Run `npm run lint` and `npx tsc --noEmit` — clean.
- [ ] Commit:

```bash
git add src/components/editor/frame-overlay.tsx
git commit -m "$(cat <<'EOF'
feat(editor): add the drag-to-draw frame layer with selection handles

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---
### Task 15: `timeline.tsx` — cuts, overlay clips, markers, zoom keyframes

**Files:** `src/components/editor/timeline.tsx`

- [ ] Write `src/components/editor/timeline.tsx`:

```tsx
"use client";

import { useRef } from "react";
import type { VideoEdits } from "@/lib/edits";
import { fmtDuration } from "@/lib/format";
import type { Selection } from "./use-editor";

export type TimelineProps = {
  edits: VideoEdits;
  /** Source duration in seconds. */
  duration: number;
  time: number;
  selection: Selection;
  inPoint: number | null;
  outPoint: number | null;
  onSeek: (seconds: number) => void;
  onSelect: (selection: Selection) => void;
  /** Drag an overlay clip's body (`edge` null) or one of its edges. */
  onDragOverlay: (
    index: number,
    edge: "start" | "end" | null,
    deltaSeconds: number,
  ) => void;
  onCommit: () => void;
};

const TYPE_COLOR: Record<string, string> = {
  blur: "bg-sky-500/70",
  callout: "bg-accent/80",
  underline: "bg-emerald-500/70",
  highlight: "bg-amber-400/70",
  attention: "bg-fuchsia-500/60",
};

type Drag = { index: number; edge: "start" | "end" | null; lastX: number };

export function Timeline({
  edits,
  duration,
  time,
  selection,
  inPoint,
  outPoint,
  onSeek,
  onSelect,
  onDragOverlay,
  onCommit,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const span = duration > 0 ? duration : 1;
  const pct = (seconds: number) =>
    `${Math.min(100, Math.max(0, (seconds / span) * 100))}%`;

  function secondsAt(clientX: number): number {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return Math.min(span, Math.max(0, ((clientX - box.left) / box.width) * span));
  }

  function secondsPerPixel(): number {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return span / box.width;
  }

  function startDrag(
    event: React.PointerEvent,
    index: number,
    edge: "start" | "end" | null,
  ) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { index, edge, lastX: event.clientX };
    onSelect({ kind: "overlay", index });
  }

  function moveDrag(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = (event.clientX - drag.lastX) * secondsPerPixel();
    drag.lastX = event.clientX;
    if (delta !== 0) onDragOverlay(drag.index, drag.edge, delta);
  }

  function endDrag(event: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit();
  }

  const isSelected = (kind: Selection extends null ? never : string, index: number) =>
    selection?.kind === kind && selection.index === index;

  return (
    <div className="space-y-1">
      <div
        ref={trackRef}
        onPointerDown={(event) => onSeek(secondsAt(event.clientX))}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(span)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={fmtDuration(time * 1000)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onSeek(Math.max(0, time - 1));
          if (event.key === "ArrowRight") onSeek(Math.min(span, time + 1));
        }}
        className="relative h-28 w-full select-none rounded-lg border border-border bg-surface"
      >
        {/* Lane 1: cuts */}
        <div className="absolute inset-x-0 top-0 h-6">
          {edits.cuts.map((cut, index) => (
            <button
              key={`cut-${cut.start}-${index}`}
              type="button"
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect({ kind: "cut", index });
              }}
              title={`Cut ${fmtDuration(cut.start * 1000)}–${fmtDuration(cut.end * 1000)}`}
              style={{ left: pct(cut.start), width: pct(cut.end - cut.start) }}
              className={`absolute top-1 h-4 rounded-sm bg-[repeating-linear-gradient(45deg,#5c5c66_0_4px,transparent_4px_8px)] ${
                isSelected("cut", index) ? "ring-1 ring-accent" : ""
              }`}
            />
          ))}
        </div>

        {/* Lane 2: overlay + attention clips */}
        <div className="absolute inset-x-0 top-7 h-12">
          {edits.overlays.map((overlay, index) => (
            <div
              key={`overlay-${index}`}
              onPointerDown={(event) => startDrag(event, index, null)}
              title={`${overlay.type} ${fmtDuration(overlay.start * 1000)}–${fmtDuration(overlay.end * 1000)}`}
              style={{
                left: pct(overlay.start),
                width: pct(Math.max(0.2, overlay.end - overlay.start)),
                top: overlay.type === "attention" ? 26 : 2,
              }}
              className={`absolute h-5 cursor-grab rounded-sm text-[10px] leading-5 text-white/90 ${
                TYPE_COLOR[overlay.type] ?? "bg-muted"
              } ${isSelected("overlay", index) ? "ring-1 ring-accent" : ""}`}
            >
              <span
                onPointerDown={(event) => startDrag(event, index, "start")}
                className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30"
              />
              <span className="pointer-events-none px-2">
                {overlay.type === "callout" && overlay.n
                  ? `${overlay.type} ${overlay.n}`
                  : overlay.type}
              </span>
              <span
                onPointerDown={(event) => startDrag(event, index, "end")}
                className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30"
              />
            </div>
          ))}
        </div>

        {/* Lane 3: zoom keyframes */}
        <div className="absolute inset-x-0 bottom-6 h-4">
          {edits.zooms.map((zoom, index) => (
            <button
              key={`zoom-${index}`}
              type="button"
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect({ kind: "zoom", index });
              }}
              title={`Zoom ${fmtDuration(zoom.start * 1000)}–${fmtDuration(zoom.end * 1000)}`}
              style={{ left: pct(zoom.start), width: pct(zoom.end - zoom.start) }}
              className={`absolute h-3 rounded-sm border border-accent/70 bg-accent/20 ${
                isSelected("zoom", index) ? "ring-1 ring-accent" : ""
              }`}
            />
          ))}
        </div>

        {/* Lane 4: markers */}
        <div className="absolute inset-x-0 bottom-0 h-5">
          {edits.markers.map((marker, index) => (
            <button
              key={`marker-${marker.t}-${index}`}
              type="button"
              onPointerDown={(event) => {
                event.stopPropagation();
                onSeek(marker.t);
              }}
              title={marker.label ?? fmtDuration(marker.t * 1000)}
              style={{ left: pct(marker.t) }}
              className="absolute bottom-1 h-3 w-[3px] -translate-x-1/2 rounded-sm bg-foreground/70"
            />
          ))}
        </div>

        {/* In / out points */}
        {inPoint !== null && (
          <div
            style={{ left: pct(inPoint) }}
            className="pointer-events-none absolute inset-y-0 w-px bg-emerald-400"
          />
        )}
        {outPoint !== null && (
          <div
            style={{ left: pct(outPoint) }}
            className="pointer-events-none absolute inset-y-0 w-px bg-amber-400"
          />
        )}

        {/* Playhead */}
        <div
          style={{ left: pct(time) }}
          className="pointer-events-none absolute inset-y-0 w-px bg-accent"
        />
      </div>

      <div className="flex justify-between text-[10px] tabular-nums text-muted-dim">
        <span>{fmtDuration(time * 1000)}</span>
        <span>{fmtDuration(duration * 1000)}</span>
      </div>
    </div>
  );
}
```

- [ ] Run `npm run lint` and `npx tsc --noEmit` — clean.
- [ ] Commit:

```bash
git add src/components/editor/timeline.tsx
git commit -m "$(cat <<'EOF'
feat(editor): add the timeline with cuts, clips, zoom keyframes and markers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 16: `inspector.tsx` — per-item properties

**Files:** `src/components/editor/inspector.tsx`

- [ ] Write `src/components/editor/inspector.tsx`:

```tsx
"use client";

import type { Easing, OverlayStyle, VideoEdits } from "@/lib/edits";
import { fmtDuration } from "@/lib/format";
import type { Selection } from "./use-editor";

export type InspectorProps = {
  edits: VideoEdits;
  selection: Selection;
  onSpan: (start: number, end: number) => void;
  onStyle: (patch: OverlayStyle) => void;
  onLabel: (label: string) => void;
  onNumber: (n: number) => void;
  onEase: (ease: Easing) => void;
  onDelete: () => void;
};

const FIELD =
  "w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-accent/50";

export function Inspector({
  edits,
  selection,
  onSpan,
  onStyle,
  onLabel,
  onNumber,
  onEase,
  onDelete,
}: InspectorProps) {
  if (!selection) {
    return (
      <p className="rounded-xl border border-border bg-surface p-3 text-xs text-muted-dim">
        Nothing selected. Pick a tool and drag on the frame, or click an item on
        the timeline.
      </p>
    );
  }

  const item =
    selection.kind === "overlay"
      ? edits.overlays[selection.index]
      : selection.kind === "zoom"
        ? edits.zooms[selection.index]
        : edits.cuts[selection.index];

  if (!item) return null;

  const isOverlay = selection.kind === "overlay";
  const overlay = isOverlay ? edits.overlays[selection.index] : null;
  const zoom = selection.kind === "zoom" ? edits.zooms[selection.index] : null;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <header className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-wider text-muted-dim">
          {overlay ? overlay.type : selection.kind}
        </h2>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:text-accent"
        >
          Delete
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] text-muted-dim">
            Start ({fmtDuration(item.start * 1000)})
          </span>
          <input
            type="number"
            step={0.1}
            min={0}
            value={Number(item.start.toFixed(2))}
            onChange={(event) => onSpan(Number(event.target.value), item.end)}
            className={FIELD}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted-dim">
            End ({fmtDuration(item.end * 1000)})
          </span>
          <input
            type="number"
            step={0.1}
            min={0}
            value={Number(item.end.toFixed(2))}
            onChange={(event) => onSpan(item.start, Number(event.target.value))}
            className={FIELD}
          />
        </label>
      </div>

      {overlay && overlay.type === "callout" && (
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-dim">Number</span>
          <input
            type="number"
            min={1}
            step={1}
            value={overlay.n ?? 1}
            onChange={(event) => onNumber(Number(event.target.value))}
            className={FIELD}
          />
        </label>
      )}

      {overlay && overlay.type === "attention" && (
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-dim">Chapter label</span>
          <input
            type="text"
            maxLength={80}
            value={overlay.label ?? ""}
            placeholder="Pay attention here"
            onChange={(event) => onLabel(event.target.value)}
            className={FIELD}
          />
        </label>
      )}

      {overlay && overlay.type !== "attention" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-dim">Colour</span>
            <input
              type="color"
              value={overlay.style?.color ?? overlay.color ?? "#e85a4f"}
              onChange={(event) => onStyle({ color: event.target.value })}
              className="h-7 w-full rounded-lg border border-border bg-surface"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-dim">
              {overlay.type === "blur" ? "Blur" : "Opacity"}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={
                overlay.type === "blur"
                  ? (overlay.style?.blur ?? 0.03) * 10
                  : (overlay.style?.opacity ?? 0.45)
              }
              onChange={(event) =>
                onStyle(
                  overlay.type === "blur"
                    ? { blur: Number(event.target.value) / 10 }
                    : { opacity: Number(event.target.value) },
                )
              }
              className="h-7 w-full accent-[var(--color-accent)]"
            />
          </label>
        </div>
      )}

      {zoom && (
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-dim">Easing</span>
          <select
            value={zoom.ease ?? "ease-in-out"}
            onChange={(event) => onEase(event.target.value as Easing)}
            className={FIELD}
          >
            <option value="ease-in-out">Ease in-out</option>
            <option value="ease-out">Ease out</option>
            <option value="linear">Linear</option>
          </select>
        </label>
      )}
    </section>
  );
}
```

- [ ] Run `npm run lint` and `npx tsc --noEmit` — clean.
- [ ] Commit:

```bash
git add src/components/editor/inspector.tsx
git commit -m "$(cat <<'EOF'
feat(editor): add the inspector for spans, style, labels and easing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---
### Task 17: `editor-panel.tsx` — assembly and hotkeys

**Files:** `src/components/editor/editor-panel.tsx`

- [ ] Write `src/components/editor/editor-panel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Easing, OverlayStyle, Rect, VideoEdits } from "@/lib/edits";
import { EditPlayer } from "@/components/video/edit-player";
import { AttentionPills } from "@/components/video/attention-pills";
import {
  DEFAULT_SPAN,
  addCut,
  addOverlay,
  addZoom,
  deleteCut,
  deleteOverlay,
  deleteZoom,
  moveOverlay,
  nextCalloutNumber,
  promoteMarker,
  resizeOverlay,
  setCrop,
  setOverlayLabel,
  setOverlaySpan,
  setOverlayStyle,
} from "@/lib/editor/edit-ops";
import type { Handle } from "@/lib/editor/hit-test";
import { FrameOverlay } from "./frame-overlay";
import { Inspector } from "./inspector";
import { Timeline } from "./timeline";
import { EDITOR_TOOLS, Toolbox, type EditorTool } from "./toolbox";
import { useEditor, type SaveEdits, type Selection } from "./use-editor";

export type EditorPanelProps = {
  videoId: string;
  src: string;
  poster?: string;
  initialEdits: VideoEdits;
  saveEdits: SaveEdits;
};

const DRAW_TOOLS: EditorTool[] = [
  "blur",
  "callout",
  "underline",
  "highlight",
  "attention",
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

export function EditorPanel({
  videoId,
  src,
  poster,
  initialEdits,
  saveEdits,
}: EditorPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const editor = useEditor(videoId, initialEdits, saveEdits);

  const [tool, setTool] = useState<EditorTool>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);

  const timeRef = useRef(0);
  timeRef.current = time;

  const seek = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.max(0, seconds);
  }, []);

  const spanForNewItem = useCallback((): { start: number; end: number } => {
    if (inPoint !== null && outPoint !== null && outPoint > inPoint) {
      return { start: inPoint, end: outPoint };
    }
    const start = timeRef.current;
    return { start, end: start + DEFAULT_SPAN };
  }, [inPoint, outPoint]);

  const onDraw = useCallback(
    (rect: Rect) => {
      const span = spanForNewItem();
      if (tool === "crop") {
        editor.apply((edits) => setCrop(edits, rect));
        setTool("select");
        return;
      }
      if (tool === "zoom") {
        editor.apply((edits) => addZoom(edits, { ...span, rect }));
        return;
      }
      if (!DRAW_TOOLS.includes(tool)) return;
      editor.apply((edits) =>
        addOverlay(edits, {
          type: tool,
          ...span,
          rect: tool === "attention" ? { x: 0, y: 0, w: 1, h: 1 } : rect,
          ...(tool === "callout" ? { n: nextCalloutNumber(edits) } : {}),
        }),
      );
    },
    [editor, spanForNewItem, tool],
  );

  const cutInOut = useCallback(() => {
    if (inPoint === null || outPoint === null || outPoint <= inPoint) return;
    editor.apply((edits) => addCut(edits, { start: inPoint, end: outPoint }));
    setInPoint(null);
    setOutPoint(null);
  }, [editor, inPoint, outPoint]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    const { kind, index } = selection;
    editor.apply((edits) =>
      kind === "overlay"
        ? deleteOverlay(edits, index)
        : kind === "cut"
          ? deleteCut(edits, index)
          : deleteZoom(edits, index),
    );
    setSelection(null);
  }, [editor, selection]);

  // Keyboard: I/O in-out, C cut, Delete, undo/redo, space, frame step, M promote.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const meta = event.metaKey || event.ctrlKey;

      if (meta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (meta) return;

      switch (key) {
        case "i":
          setInPoint(timeRef.current);
          break;
        case "o":
          setOutPoint(timeRef.current);
          break;
        case "c":
          cutInOut();
          break;
        case "delete":
        case "backspace":
          event.preventDefault();
          deleteSelection();
          break;
        case " ": {
          event.preventDefault();
          const video = videoRef.current;
          if (!video) break;
          if (video.paused) void video.play();
          else video.pause();
          break;
        }
        case ",":
          seek(timeRef.current - 1 / 30);
          break;
        case ".":
          seek(timeRef.current + 1 / 30);
          break;
        case "m": {
          const markers = editor.edits.markers;
          if (markers.length === 0) break;
          let nearest = 0;
          for (let i = 1; i < markers.length; i += 1) {
            if (
              Math.abs(markers[i].t - timeRef.current) <
              Math.abs(markers[nearest].t - timeRef.current)
            ) {
              nearest = i;
            }
          }
          editor.apply((edits) => promoteMarker(edits, nearest));
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cutInOut, deleteSelection, editor, seek]);

  const dragOverlay = useCallback(
    (index: number, edge: "start" | "end" | null, delta: number) => {
      editor.applyTransient((edits) => {
        const overlay = edits.overlays[index];
        if (!overlay) return edits;
        if (edge === "start") {
          return setOverlaySpan(edits, index, overlay.start + delta, overlay.end);
        }
        if (edge === "end") {
          return setOverlaySpan(edits, index, overlay.start, overlay.end + delta);
        }
        return setOverlaySpan(
          edits,
          index,
          overlay.start + delta,
          overlay.end + delta,
        );
      });
    },
    [editor],
  );

  const activeToolHint =
    EDITOR_TOOLS.find((entry) => entry.id === tool)?.hint ?? "";

  return (
    <section className="space-y-3" aria-label="Editor">
      <EditPlayer
        src={src}
        poster={poster}
        edits={editor.edits}
        videoRef={videoRef}
        applyCuts={preview}
        applyZoom={preview}
        onTimeUpdate={setTime}
        onDurationChange={setDuration}
        frameOverlay={
          preview ? null : (
            <FrameOverlay
              tool={tool}
              edits={editor.edits}
              time={time}
              selection={selection}
              onSelect={setSelection}
              onDraw={onDraw}
              onMove={(index, dx, dy) =>
                editor.applyTransient((edits) => moveOverlay(edits, index, dx, dy))
              }
              onResize={(index: number, handle: Handle, dx: number, dy: number) =>
                editor.applyTransient((edits) =>
                  resizeOverlay(edits, index, handle, dx, dy),
                )
              }
              onCommit={editor.commit}
            />
          )
        }
      />

      <AttentionPills
        overlays={editor.edits.overlays}
        currentTime={time}
        onSeek={seek}
      />

      <Toolbox
        tool={tool}
        onTool={setTool}
        status={editor.status}
        error={editor.error}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onRetry={editor.saveNow}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-dim">
        <button
          type="button"
          onClick={() => setPreview((value) => !value)}
          aria-pressed={preview}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
        >
          {preview ? "Editing" : "Preview"}
        </button>
        <button
          type="button"
          onClick={cutInOut}
          disabled={inPoint === null || outPoint === null}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          Cut in–out
        </button>
        <button
          type="button"
          onClick={() => editor.apply((edits) => setCrop(edits, null))}
          disabled={editor.edits.crop === null}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          Clear crop
        </button>
        <span>I / O set in–out · C cuts · ⌘Z undo · {activeToolHint}</span>
      </div>

      <Timeline
        edits={editor.edits}
        duration={duration}
        time={time}
        selection={selection}
        inPoint={inPoint}
        outPoint={outPoint}
        onSeek={seek}
        onSelect={setSelection}
        onDragOverlay={dragOverlay}
        onCommit={editor.commit}
      />

      <Inspector
        edits={editor.edits}
        selection={selection}
        onSpan={(start, end) =>
          selection?.kind === "overlay"
            ? editor.apply((edits) =>
                setOverlaySpan(edits, selection.index, start, end),
              )
            : undefined
        }
        onStyle={(patch: OverlayStyle) =>
          selection?.kind === "overlay"
            ? editor.apply((edits) =>
                setOverlayStyle(edits, selection.index, patch),
              )
            : undefined
        }
        onLabel={(label) =>
          selection?.kind === "overlay"
            ? editor.apply((edits) =>
                setOverlayLabel(edits, selection.index, label),
              )
            : undefined
        }
        onNumber={(n) =>
          selection?.kind === "overlay"
            ? editor.apply((edits) => {
                const overlays = edits.overlays.slice();
                const overlay = overlays[selection.index];
                if (!overlay) return edits;
                overlays[selection.index] = { ...overlay, n };
                return { ...edits, overlays };
              })
            : undefined
        }
        onEase={(ease: Easing) =>
          selection?.kind === "zoom"
            ? editor.apply((edits) => {
                const zooms = edits.zooms.slice();
                const zoom = zooms[selection.index];
                if (!zoom) return edits;
                zooms[selection.index] = { ...zoom, ease };
                return { ...edits, zooms };
              })
            : undefined
        }
        onDelete={deleteSelection}
      />
    </section>
  );
}
```

- [ ] Run `npm run lint` and `npx tsc --noEmit` — clean.
- [ ] Commit:

```bash
git add src/components/editor/editor-panel.tsx
git commit -m "$(cat <<'EOF'
feat(editor): assemble the editor panel with tools, timeline and hotkeys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 18: mount the editor on `/library/[id]`

**Files:** `src/app/(owner)/library/[id]/page.tsx`, `src/components/editor/editor-mount.tsx`

The page is a Server Component, so the lazy boundary needs a small client wrapper
(`next/dynamic` with `ssr: false` is not allowed in a Server Component).

- [ ] Write `src/components/editor/editor-mount.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { VideoEdits } from "@/lib/edits";
import type { SaveEdits } from "./use-editor";

// Lazy so the editor's code never lands in the initial detail-page bundle —
// and never in the watch page's, which does not import this file at all.
const EditorPanel = dynamic(
  () => import("./editor-panel").then((module) => module.EditorPanel),
  {
    ssr: false,
    loading: () => (
      <p className="text-xs text-muted-dim">Loading the editor…</p>
    ),
  },
);

export type EditorMountProps = {
  videoId: string;
  src: string;
  poster?: string;
  initialEdits: VideoEdits;
  saveEdits: SaveEdits;
  children: React.ReactNode;
};

/** Renders `children` (the read-only player) until the owner opens the editor. */
export function EditorMount({
  videoId,
  src,
  poster,
  initialEdits,
  saveEdits,
  children,
}: EditorMountProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      {open ? (
        <EditorPanel
          videoId={videoId}
          src={src}
          poster={poster}
          initialEdits={initialEdits}
          saveEdits={saveEdits}
        />
      ) : (
        children
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        {open ? "Done editing" : "Edit video"}
      </button>
    </div>
  );
}
```

- [ ] In `src/app/(owner)/library/[id]/page.tsx`, add the imports:

```tsx
import { saveEdits } from "@/app/(owner)/actions";
import { EditorMount } from "@/components/editor/editor-mount";
```

- [ ] Replace the `<EditPlayer …/>` block with:

```tsx
        <EditorMount
          videoId={video.id}
          src={`${base}/api/stream/${video.id}`}
          poster={
            video.thumbnail_drive_file_id
              ? `${base}/api/thumb/${video.id}`
              : undefined
          }
          initialEdits={edits}
          saveEdits={saveEdits}
        >
          <EditPlayer
            src={`${base}/api/stream/${video.id}`}
            poster={
              video.thumbnail_drive_file_id
                ? `${base}/api/thumb/${video.id}`
                : undefined
            }
            edits={edits}
            markers={edits.markers}
          />
        </EditorMount>
```

- [ ] In the same file, change the "Markers" sidebar `<li>` to a clickable row is **not**
      needed — the editor's timeline owns marker interaction. Leave the panel as is.
- [ ] Run `npm run build` — succeeds.
- [ ] Commit:

```bash
git add "src/app/(owner)/library/[id]/page.tsx" src/components/editor/editor-mount.tsx
git commit -m "$(cat <<'EOF'
feat(library): mount the lazy post-recording editor on the detail page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 19: full verification gate

**Files:** none (verification only)

- [ ] Run `npm test` — every suite passes; note the total count in the commit body.
- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Run `npm run lint` — clean.
- [ ] Run `npm run build` — succeeds.
- [ ] Confirm no placeholders were introduced:

```bash
grep -rnE "TODO|FIXME|placeholder|Phase 5:" src/lib/editor src/components/editor src/components/video
```

      Expect no matches (the Phase 3 `// Phase 5:` comment is gone with Task 8's rewrite).
- [ ] Confirm the watch route still carries no editor code:

```bash
grep -rl "components/editor" .next/server/app/v; echo "exit=$?"
```

      Expect `exit=1`.
- [ ] Commit nothing; this task is a gate. If any check fails, fix it in the owning task.

---
### Task 20: manual verification (controller-only)

**Files:** none

Run against a real recording in the library. Tyler performs these; an implementing
agent must not mark them done on its own.

- [ ] `npm run dev`, open `/library/<id>`, press **Edit video** — the editor mounts and
      the Network tab shows a separate chunk fetched only at that moment.
- [ ] Pick **Blur**, drag over some text — the region blurs, follows the video, and the
      status reads "Saving…" then "Saved" within ~1 s.
- [ ] Reload the page — the blur is still there (it round-tripped through jsonb).
- [ ] Pick **Callout**, drag a circle — it pops in with an overshoot and fades out at
      the end of its span; the badge shows `1`, and a second callout shows `2`.
- [ ] Pick **Underline** and **Highlight** — both draw; text under the highlight stays
      readable (multiply blend).
- [ ] Pick **Zoom**, drag a region — in **Preview** the frame eases in and back out.
- [ ] Press `I`, scrub forward, press `O`, press `C` — a cut appears on the timeline; in
      **Preview** playback jumps the removed range and the scrubber's total shrinks.
- [ ] Pick **Crop**, drag — the player's aspect ratio changes and overlays stay put.
- [ ] Pick **Attention**, drag — a pill appears; during the range the player border
      pulses.
- [ ] Select an item, press `Delete` — it goes; `⌘Z` brings it back; `⇧⌘Z` removes it
      again.
- [ ] Press `M` near a marker — an attention range appears around it.
- [ ] Open the public `/v/<slug>` in a private window — every edit renders, the pills
      show, and no editor chunk is requested.
- [ ] Safari check: blur renders (not a black box) and stays smooth at 1080p.
- [ ] Force a save failure (stop the dev server mid-edit) — the status shows
      "Couldn't save" with a working **Retry**, and no edit is lost.

---

### Task 21: docs

**Files:** `README.md`, `docs/for-later.md`

- [ ] Add an "Editing" section to `README.md` after the Dashboard section:

```md
### Editing

Open a recording at `/library/<id>` and press **Edit video**. Tools: Blur, Callout,
Underline, Highlight, Zoom, Cut, Crop, Attention. Drag on the frame to draw; drag clips
on the timeline to move or trim them. Keys: `I`/`O` set in/out, `C` cuts the in–out
range, `Delete` removes the selection, `⌘Z`/`⇧⌘Z` undo/redo, `Space` play/pause,
`,`/`.` step a frame, `M` promotes the nearest ⌘⇧M marker to an attention range.

Edits are **non-destructive**: they live in `videos.edits` (jsonb) and are rendered at
playback on both the library page and the public share link, so the original Drive file
is never touched and edits stay changeable. Attention ranges show as chapter pills on
the watch page.
```

- [ ] In `docs/for-later.md`, strike the "Proposed Phase 5 — Post-recording editor"
      heading's bullets as shipped, exactly as Phase 3's entries were struck, and leave
      two items parked: the WebCodecs export path and cursor-driven auto-zoom (which
      still waits on the cursor sidecar, #4).
- [ ] Commit:

```bash
git add README.md docs/for-later.md
git commit -m "$(cat <<'EOF'
docs: document the post-recording editor and park the remaining Phase 5 ideas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Sub-phase 5b — burned-in export

Additive and independent: Tasks 1–21 ship a complete feature without it. Do not start
5b until Task 20 is signed off.

### Task 22: export columns + `swapDriveFile`

**Files:** `supabase/migrations/20260903000000_phase5.sql`, `src/lib/db.ts`,
`src/lib/db-phase3.test.ts`

- [ ] Write `supabase/migrations/20260903000000_phase5.sql`:

```sql
-- Phase 5b: burned-in export. The original Drive file is never deleted, so
-- "revert to original" is a one-row update.
alter table public.videos
  add column if not exists original_drive_file_id text,
  add column if not exists exported_at timestamptz;

comment on column public.videos.original_drive_file_id is
  'Set when drive_file_id points at a burned-in export; holds the original upload.';
```

- [ ] **Controller-only:** apply the migration (`supabase db push` against the project).
      An implementing agent must not run this.
- [ ] Add `original_drive_file_id: string | null;` and `exported_at: string | null;` to
      the `Video` type in `src/lib/db.ts`, and add:

```ts
/**
 * Point the row at a burned-in export, remembering the original the first time.
 * Idempotent: re-exporting keeps the *first* original, never chaining exports.
 */
export async function swapDriveFile(
  id: string,
  exportFileId: string,
): Promise<Video | null> {
  const video = await getVideoById(id);
  if (!video) return null;
  const result = (await getSupabase()
    .from("videos")
    .update({
      drive_file_id: exportFileId,
      original_drive_file_id: video.original_drive_file_id ?? video.drive_file_id,
      exported_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single()) as QueryResult<Video>;
  return unwrap(result);
}

/** Undo an export: play the original again. The export file is left in Drive. */
export async function revertDriveFile(id: string): Promise<Video | null> {
  const video = await getVideoById(id);
  if (!video?.original_drive_file_id) return null;
  const result = (await getSupabase()
    .from("videos")
    .update({
      drive_file_id: video.original_drive_file_id,
      original_drive_file_id: null,
      exported_at: null,
    })
    .eq("id", id)
    .select("*")
    .single()) as QueryResult<Video>;
  return unwrap(result);
}
```

- [ ] Add tests to `src/lib/db-phase3.test.ts` (reusing its existing `chain()` stub) that
      `swapDriveFile` preserves an existing `original_drive_file_id` and that
      `revertDriveFile` returns null when there is none.
- [ ] Run `npx vitest run src/lib/db-phase3.test.ts` — passes.
- [ ] Commit:

```bash
git add supabase/migrations/20260903000000_phase5.sql src/lib/db.ts src/lib/db-phase3.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add export columns and drive-file swap/revert

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 23: `src/lib/editor/export-plan.ts` — pure export planning

**Files:** `src/lib/editor/export-plan.test.ts`, `src/lib/editor/export-plan.ts`

- [ ] Write the failing test `src/lib/editor/export-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { VideoEdits } from "@/lib/edits";
import { exportPlan, outputSize } from "@/lib/editor/export-plan";

function edits(patch: Partial<VideoEdits> = {}): VideoEdits {
  return {
    version: 1,
    cuts: [],
    crop: null,
    zooms: [],
    overlays: [],
    markers: [],
    ...patch,
  };
}

describe("outputSize", () => {
  it("uses the source size when there is no crop", () => {
    expect(outputSize(edits(), 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("crops to even dimensions so encoders accept it", () => {
    expect(
      outputSize(edits({ crop: { x: 0, y: 0, w: 0.5, h: 0.33 } }), 1921, 1081),
    ).toEqual({ width: 960, height: 356 });
  });
});

describe("exportPlan", () => {
  it("keeps the whole video when nothing is cut", () => {
    expect(exportPlan(edits(), 10)).toEqual({
      segments: [{ start: 0, end: 10 }],
      duration: 10,
    });
  });

  it("returns the kept segments between cuts", () => {
    const plan = exportPlan(
      edits({ cuts: [{ start: 2, end: 4 }, { start: 8, end: 9 }] }),
      10,
    );
    expect(plan.segments).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 8 },
      { start: 9, end: 10 },
    ]);
    expect(plan.duration).toBe(7);
  });

  it("drops a leading or trailing cut cleanly", () => {
    expect(exportPlan(edits({ cuts: [{ start: 0, end: 3 }] }), 10).segments).toEqual([
      { start: 3, end: 10 },
    ]);
    expect(exportPlan(edits({ cuts: [{ start: 7, end: 20 }] }), 10).segments).toEqual([
      { start: 0, end: 7 },
    ]);
  });

  it("returns no segments when everything is cut", () => {
    const plan = exportPlan(edits({ cuts: [{ start: 0, end: 10 }] }), 10);
    expect(plan.segments).toEqual([]);
    expect(plan.duration).toBe(0);
  });

  it("returns nothing for an unknown duration", () => {
    expect(exportPlan(edits(), Number.POSITIVE_INFINITY).segments).toEqual([]);
  });
});
```

- [ ] Run `npx vitest run src/lib/editor/export-plan.test.ts` — expected failure:
      `Error: Failed to load url @/lib/editor/export-plan`.
- [ ] Write `src/lib/editor/export-plan.ts`:

```ts
/**
 * Pure planning for the burned-in export: which source ranges to play, how long
 * the result will be, and the output frame size. The recorder walks `segments`
 * in order, seeking between them.
 */

import type { VideoEdits } from "@/lib/edits";
import { editedDuration } from "./cuts";

export type Segment = { start: number; end: number };

export type ExportPlan = { segments: Segment[]; duration: number };

/** Kept ranges — the complement of the (merged, disjoint) cuts. */
export function exportPlan(edits: VideoEdits, duration: number): ExportPlan {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { segments: [], duration: 0 };
  }

  const segments: Segment[] = [];
  let cursor = 0;
  for (const cut of edits.cuts) {
    const start = Math.min(cut.start, duration);
    const end = Math.min(cut.end, duration);
    if (start > cursor) segments.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < duration) segments.push({ start: cursor, end: duration });

  return { segments, duration: editedDuration(edits.cuts, duration) };
}

/** Output frame size after crop, rounded down to even numbers for encoders. */
export function outputSize(
  edits: VideoEdits,
  videoWidth: number,
  videoHeight: number,
): { width: number; height: number } {
  const crop = edits.crop;
  const width = crop ? videoWidth * crop.w : videoWidth;
  const height = crop ? videoHeight * crop.h : videoHeight;
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
  return crop
    ? { width: even(width), height: even(height) }
    : { width: Math.round(width), height: Math.round(height) };
}
```

- [ ] Run `npx vitest run src/lib/editor/export-plan.test.ts` — all pass.
- [ ] Commit:

```bash
git add src/lib/editor/export-plan.ts src/lib/editor/export-plan.test.ts
git commit -m "$(cat <<'EOF'
feat(export): add pure export segment and output-size planning

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 24: `finishExport` server action

**Files:** `src/app/(owner)/actions.ts`

- [ ] **Read first:** `src/app/api/upload/route.ts`, `src/app/api/upload/complete/route.ts`
      and `src/lib/upload-client.ts`. The export reuses the same resumable-session flow
      the recorder uses (request a session, PUT the blob straight to Drive, hand the
      resulting file id back to the app) — align the field names below with what those
      files actually return before writing any code.
- [ ] Add to `src/app/(owner)/actions.ts` (extend the `db` import with `swapDriveFile`
      and `revertDriveFile`):

```ts
/** Point the video at a freshly uploaded burned-in export. */
export async function finishExport(
  videoId: string,
  driveFileId: string,
): Promise<ActionState> {
  if (!(await isOwner())) return UNAUTHORIZED;
  if (!videoId || !driveFileId) return { error: "Missing export." };

  let swapped;
  try {
    swapped = await swapDriveFile(videoId, driveFileId);
  } catch {
    return { error: "Could not attach the export." };
  }
  if (!swapped) return { error: "Recording not found." };

  revalidateVideo(videoId);
  revalidatePath(`/v/${swapped.slug}`);
  return { ok: true };
}

/** Play the original again. The export file stays in Drive. */
export async function revertExport(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await isOwner())) return UNAUTHORIZED;

  const id = field(formData, "id");
  if (!id) return { error: "Missing video." };

  let reverted;
  try {
    reverted = await revertDriveFile(id);
  } catch {
    return { error: "Could not revert." };
  }
  if (!reverted) return { error: "This recording has no export." };

  revalidateVideo(id);
  revalidatePath(`/v/${reverted.slug}`);
  return { ok: true };
}
```

- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Commit:

```bash
git add "src/app/(owner)/actions.ts"
git commit -m "$(cat <<'EOF'
feat(actions): attach and revert burned-in exports

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 25: `export-dialog.tsx` — canvas + MediaRecorder at 1×

**Files:** `src/components/editor/export-dialog.tsx`, `src/components/editor/editor-panel.tsx`

- [ ] Write `src/components/editor/export-dialog.tsx`:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import type { VideoEdits } from "@/lib/edits";
import { exportPlan, outputSize } from "@/lib/editor/export-plan";
import { drawEdits, type FrameInfo } from "@/lib/editor/render";
import { zoomStateAt } from "@/lib/editor/zoom";

export type ExportDialogProps = {
  edits: VideoEdits;
  /** The stream URL of the source video. */
  src: string;
  /** Uploads the finished blob and returns the new Drive file id. */
  upload: (blob: Blob, onProgress: (fraction: number) => void) => Promise<string>;
  /** Attaches the uploaded file to the row (the `finishExport` action). */
  attach: (driveFileId: string) => Promise<{ ok?: boolean; error?: string }>;
  /** Blocked while there are unsaved edits. */
  disabled?: boolean;
};

type Phase = "idle" | "rendering" | "uploading" | "done" | "error";

const FPS = 30;
const BITS_PER_SECOND = 8_000_000;

export function ExportDialog({
  edits,
  src,
  upload,
  attach,
  disabled,
}: ExportDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    cancelRef.current = false;
    setPhase("rendering");
    setProgress(0);
    setMessage(null);

    const video = document.createElement("video");
    video.src = src;
    video.crossOrigin = "anonymous";
    video.muted = false;
    video.preload = "auto";

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Could not load the video."));
      });

      const plan = exportPlan(edits, video.duration);
      if (plan.segments.length === 0) {
        throw new Error("Everything is cut — nothing to export.");
      }

      const size = outputSize(edits, video.videoWidth, video.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      const scratch = document.createElement("canvas").getContext("2d");

      const stream = canvas.captureStream(FPS);
      // Chromium exposes the element's audio through captureStream(); when it
      // does not (Safari), the export is silent rather than failing.
      const withAudio = (
        video as HTMLVideoElement & { captureStream?: () => MediaStream }
      ).captureStream?.();
      for (const track of withAudio?.getAudioTracks() ?? []) {
        stream.addTrack(track);
      }

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : "video/webm",
        videoBitsPerSecond: BITS_PER_SECOND,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const finished = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      });

      const crop = edits.crop;
      const frame: FrameInfo = {
        width: canvas.width,
        height: canvas.height,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      };

      const drawFrame = () => {
        const now = video.currentTime;
        const zoom = zoomStateAt(edits.zooms, now);
        const sx = (crop?.x ?? 0) * video.videoWidth;
        const sy = (crop?.y ?? 0) * video.videoHeight;
        const sw = (crop?.w ?? 1) * video.videoWidth;
        const sh = (crop?.h ?? 1) * video.videoHeight;

        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.translate(zoom.originX * canvas.width, zoom.originY * canvas.height);
        context.scale(zoom.scale, zoom.scale);
        context.translate(
          -zoom.originX * canvas.width,
          -zoom.originY * canvas.height,
        );
        context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        drawEdits(context, video, edits, now, frame, scratch);
        context.restore();
      };

      const seek = (seconds: number) =>
        new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            resolve();
          };
          video.addEventListener("seeked", onSeeked);
          video.currentTime = seconds;
        });

      recorder.start(1000);
      let rendered = 0;

      for (const segment of plan.segments) {
        if (cancelRef.current) break;
        recorder.pause();
        await seek(segment.start);
        recorder.resume();
        await video.play();

        await new Promise<void>((resolve) => {
          const tick = () => {
            if (cancelRef.current || video.currentTime >= segment.end) {
              video.pause();
              resolve();
              return;
            }
            drawFrame();
            setProgress(
              Math.min(
                0.95,
                (rendered + (video.currentTime - segment.start)) / plan.duration,
              ),
            );
            window.requestAnimationFrame(tick);
          };
          window.requestAnimationFrame(tick);
        });

        rendered += segment.end - segment.start;
      }

      recorder.stop();
      const blob = await finished;
      if (cancelRef.current) {
        setPhase("idle");
        return;
      }

      setPhase("uploading");
      const driveFileId = await upload(blob, setProgress);
      const result = await attach(driveFileId);
      if (result.error) throw new Error(result.error);

      setPhase("done");
      setProgress(1);
      setMessage("Exported. The share link now plays the edited video.");
    } catch (error) {
      setPhase("error");
      setMessage(
        error instanceof Error ? error.message : "The export failed.",
      );
    }
  }, [attach, edits, src, upload]);

  const busy = phase === "rendering" || phase === "uploading";

  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <h2 className="text-[11px] uppercase tracking-wider text-muted-dim">
        Export
      </h2>
      <p className="text-xs text-muted">
        Burn the edits into a new video and point the share link at it. The
        original stays in Drive and the edit list stays editable. Rendering runs
        in real time in this tab — keep it open.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={disabled || busy}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? "Exporting…" : "Export edited copy"}
        </button>
        {busy && (
          <button
            type="button"
            onClick={() => {
              cancelRef.current = true;
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted"
          >
            Cancel
          </button>
        )}
        <span aria-live="polite" className="text-xs text-muted-dim">
          {busy ? `${Math.round(progress * 100)}%` : (message ?? "")}
        </span>
      </div>
      {phase === "error" && (
        <p className="text-xs text-accent">{message}</p>
      )}
    </section>
  );
}
```

- [ ] In `editor-panel.tsx`, render `<ExportDialog …/>` under the inspector, passing
      `disabled={editor.status === "saving"}`, the `upload` helper built on the
      resumable-session flow read in Task 24, and `attach` bound to `finishExport`.
- [ ] Run `npm run lint`, `npx tsc --noEmit`, `npm run build` — all clean.
- [ ] Commit:

```bash
git add src/components/editor/export-dialog.tsx src/components/editor/editor-panel.tsx
git commit -m "$(cat <<'EOF'
feat(export): burn the edit list into a new video with canvas + MediaRecorder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 26: export verification and docs (controller-only)

**Files:** `README.md`, `docs/for-later.md`

- [ ] Export a short (< 60 s) edited recording. Confirm: progress reaches 100 %, the new
      Drive file exists, `videos.drive_file_id` points at it, `original_drive_file_id`
      holds the old id, and `/v/<slug>` plays the burned-in video.
- [ ] Confirm the editor still works after an export (it edits the *original*, which is
      still reachable), and that a second export does **not** chain — the original id
      is unchanged.
- [ ] Confirm **Revert** restores the original.
- [ ] Confirm the download button returns the exported file.
- [ ] Add an "Export" paragraph to the README's Editing section and strike the export
      bullet in `docs/for-later.md`, leaving the WebCodecs faster-than-realtime path
      parked.
- [ ] Commit:

```bash
git add README.md docs/for-later.md
git commit -m "$(cat <<'EOF'
docs: document the burned-in export and park the WebCodecs path

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Self-review

**Spec coverage.** Every spec section maps to tasks. Data model → Task 2 (attention
type, `Easing`, `OverlayStyle`, `Zoom.ease`/`ramp`, caps) with cut merging from Task 1.
Rendering at playback: canvas overlays → Task 7 + Task 8; blur's downscaled scratch
buffer and the fail-closed redact → Task 7; zoom/crop as a wrapper transform → Tasks 3
and 8; cuts on `timeupdate` with an adjusted duration and scrubber → Tasks 1 and 8;
attention pulse + chapter pills → Task 9, on the watch page in Task 10. Editor UI:
toolbox → 13, drag-to-draw frame layer → 14 (geometry from 4), timeline with cut ranges,
overlay clips, marker ticks and zoom keyframes → 15, inspector → 16, I/O keys, undo/redo
and the rest of the hotkeys → 17 (stack from 6, ops from 5), mounting on `/library/[id]`
→ 18. Persistence: `saveEdits` + `parseEdits` revalidation → 11, optimistic debounced UI
→ 12. Watch page → 10 (with the bundle grep). Burned-in export → 22–26: MediaRecorder at
1× (23, 25), new Drive file with `drive_file_id` swapped and the original kept (22, 24),
WebCodecs left parked (26). The spec's four decisions are all realised in code: seconds
as the single time base (every op and remap), normalized-to-source rects (`clampRect`,
`toPixels`, blur's source-rect maths), cuts as removed ranges (`mergeCuts` and its
justification in Task 1's docblock), and the caps (Task 2, enforced again in Task 5).

**Placeholder scan.** No step says "implement X". Every created file is given in full:
six pure modules with their tests, the renderer with its stub-context test, the rewritten
`EditPlayer`, six editor components, the mount wrapper, both server-action blocks, the
CSS, the SQL, and the export pipeline. Task 19 greps for `TODO|FIXME|placeholder` and for
the now-removed `// Phase 5:` comment. Two steps are deliberately controller-only and
must not be executed by an agent: the Task 22 migration apply, and the manual checklists
in Tasks 20 and 26. Task 24's first step is a **read** step rather than invented code,
because the resumable-upload field names live in Phase 1/2 files this plan does not
restate; every other file is written against code quoted or read here.

**Type consistency.** `Rect`, `Cut`, `Zoom`, `Overlay`, `OverlayType`, `OverlayStyle`,
`Easing`, `Marker`, `VideoEdits` and the four `MAX_*` caps are declared once in
`src/lib/edits.ts` and imported everywhere else; nothing redefines them. `Handle` and
`Point` come only from `hit-test.ts` and are consumed by `edit-ops.ts`,
`frame-overlay.tsx` and `editor-panel.tsx`. `FrameInfo` and `PixelRect` come only from
`render.ts` and are consumed by `edit-player.tsx` and `export-dialog.tsx`. `ZoomState`
comes only from `zoom.ts`. `UndoStack` comes only from `undo.ts` and is used solely
inside `use-editor.ts`. `SaveStatus`, `Selection`, `SaveEdits` and `Editor` come only
from `use-editor.ts`; `EditorTool` and `EDITOR_TOOLS` only from `toolbox.tsx`.
`saveEdits`'s signature `(videoId: string, payload: unknown) => Promise<ActionState>` is
structurally assignable to `SaveEdits`, which is how the Server Component passes it
through `EditorMount` into a Client Component. `ActionState` stays the shared shape from
`actions.ts`. `EditPlayer`'s new props are additive and all optional, so the watch page's
existing call site keeps compiling; `applyCuts`/`applyZoom` default to `true`, which is
exactly the public-viewer behaviour.

**Ordering.** Tasks 1–7 are pure and testable with no DOM; 8–11 wire them into the
player, the CSS and the server; 12–18 build the editor on top; 19–21 verify and document;
22–26 add the export. `edits.ts` (Task 2) depends on `cuts.ts` (Task 1), which is why the
cut algebra comes first.

