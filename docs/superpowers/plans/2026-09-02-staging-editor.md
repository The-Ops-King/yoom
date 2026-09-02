# Staging Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record raw screen and camera files, then trim, place the camera bubble, frame, overlay, name, render and upload the take from one staging screen; add multi-select delete to the library.

**Architecture:** The recorder hook stops compositing live and runs one `MediaRecorder` per source. A pure edit list (`src/lib/edits.ts`, extended) drives one renderer (`src/lib/editor/render.ts`) that both the staging preview and the export (`src/lib/editor/export.ts`) call. Staging is a lazily-mounted client component tree under `src/components/staging/`. Library selection is a client wrapper around the existing server-rendered cards with one batch server action.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript 5, Tailwind 4, vitest 4, `fix-webm-duration`, Electron 44 (desktop shell), Supabase, Google Drive resumable upload.

**Spec:** `docs/superpowers/specs/2026-09-02-staging-editor-design.md`. Read it first.

**Deviation from spec §6:** the Electron render smoke script is replaced by a node test of `drawFrame` against a recording canvas stub (Task 9) plus the manual checklist (Task 20). Real-browser export is verified by hand.

**Conventions for every task:**
- Run tests with `npm test -- <path>` from the repo root (vitest, node environment, `@/` maps to `src/`).
- Type-check with `npx tsc --noEmit -p tsconfig.json`.
- Commit after each task with the trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016M9F4sHpEvocTyUjfo3Mra
  ```
- Read `node_modules/next/dist/docs/` before touching anything Next-specific; this Next has breaking changes.

---

## File map

**Create**
- `src/lib/editor/cuts.ts` (+ `.test.ts`) — kept ranges, edited-time remap, cut merging.
- `src/lib/editor/camera-track.ts` (+ `.test.ts`) — keyframe interpolation and upsert/remove.
- `src/lib/editor/zoom.ts` (+ `.test.ts`) — active zoom rect at a time, eased; non-overlapping insert.
- `src/lib/editor/edit-ops.ts` (+ `.test.ts`) — every pure mutation of `VideoEdits`.
- `src/lib/editor/undo.ts` (+ `.test.ts`) — bounded snapshot history.
- `src/lib/editor/render.ts` (+ `.test.ts`) — `drawFrame`.
- `src/lib/editor/export.ts` — `renderToBlob`.
- `src/lib/editor/use-staging-player.ts` — two synced `<video>`s, cut skipping, edited time.
- `src/components/staging/staging.tsx` — the screen; owns edit state, undo, details.
- `src/components/staging/preview.tsx` — canvas + camera drag layer + overlay draw layer.
- `src/components/staging/timeline.tsx` — scrubber, trim handles, cut bands, marker ticks, lanes.
- `src/components/staging/rail.tsx` — the six collapsible sections.
- `src/components/staging/details-form.tsx` — title / description / slug / thumbnail.
- `src/app/api/slug/route.ts` — owner-only slug availability check.
- `src/app/(owner)/library/library-grid.tsx` — client selection wrapper.
- `src/components/library/selection-bar.tsx`.

**Modify**
- `src/lib/edits.ts` — new fields and `"click"` overlay type.
- `src/lib/recording/settings.ts` — export `sanitizeFrame`.
- `src/lib/recording/types.ts` — drop `bubbleToggle` and `HudState.bubbleVisible`; add `StagingDefaults`.
- `src/lib/recording/recorder-machine.ts` — `review` → `staging`, `rendering` status, two blobs.
- `src/lib/recording/use-recorder.ts` — dual recorders, no compositor, `finish()`.
- `src/lib/recording/upload.ts` — title/description/slug/edits through to the server.
- `src/app/api/upload/route.ts`, `src/app/api/upload/complete/route.ts` — accept them.
- `src/components/recorder.tsx`, `src/components/recorder/preview-stage.tsx` — raw previews, mount `Staging`.
- `src/components/recorder/camera-bubble-controls.tsx` — shape/size only.
- `src/components/library/video-card.tsx`, `src/app/(owner)/library/page.tsx`, `src/app/(owner)/actions.ts`.
- `desktop/src/shared/ipc.ts`, `desktop/src/main/hud.ts`, `desktop/src/renderer/hud/{index.html,hud.ts,hud.css}`, `desktop/src/main/mapping.ts` (if it names `review`).
- `desktop/README.md`, `docs/overnight-2026-09-02.md`.

**Delete**
- `src/components/recorder/review.tsx`, `src/components/recorder/frame-picker.tsx` moves to `src/components/staging/frame-picker.tsx` (git mv), `src/components/recorder/bubble-drag-overlay.tsx`.

---

### Task 1: Extend the edit list schema

**Files:**
- Modify: `src/lib/recording/settings.ts`
- Modify: `src/lib/edits.ts`
- Test: `src/lib/edits.test.ts`

- [ ] **Step 1: Export `sanitizeFrame` from settings**

In `src/lib/recording/settings.ts`, replace the `frame:` block inside `sanitize()` with a call to a new exported function, added just above `sanitize`:

```ts
/** Clamp an untrusted frame config. Blob URLs are dropped (they do not survive a reload or an upload). */
export function sanitizeFrame(raw: unknown, fallback: FrameConfig = DEFAULT_FRAME): FrameConfig {
  const frameRaw = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: bool(frameRaw.enabled, fallback.enabled),
    padding: num(frameRaw.padding, fallback.padding, 0, 0.2),
    radius: num(frameRaw.radius, fallback.radius, 0, 0.1),
    shadow: bool(frameRaw.shadow, fallback.shadow),
    background: sanitizeBackground(frameRaw.background, fallback.background),
  };
}
```

and in `sanitize()`:

```ts
    frame: sanitizeFrame(r.frame),
```

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/edits.test.ts`:

```ts
describe("parseEdits staging fields", () => {
  const base = { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] };

  it("keeps trim, frame, camera and cameraOffsetMs", () => {
    const parsed = parseEdits({
      ...base,
      trim: { start: 1, end: 9 },
      frame: { enabled: true, padding: 0.1, radius: 0.02, shadow: false, background: { kind: "color", color: "#fff" } },
      camera: {
        shape: "circle",
        mirror: true,
        keyframes: [
          { t: 0, mode: "bubble", rect: { x: 0.7, y: 0.7, w: 0.2, h: 0.3 } },
          { t: 4, mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } },
        ],
      },
      cameraOffsetMs: 120,
    });
    expect(parsed.trim).toEqual({ start: 1, end: 9 });
    expect(parsed.frame?.padding).toBe(0.1);
    expect(parsed.camera?.keyframes).toHaveLength(2);
    expect(parsed.camera?.keyframes[1].mode).toBe("full");
    expect(parsed.cameraOffsetMs).toBe(120);
  });

  it("forces the first keyframe to t=0, sorts, and clamps rects", () => {
    const parsed = parseEdits({
      ...base,
      camera: {
        shape: "square",
        mirror: false,
        keyframes: [
          { t: 5, mode: "bubble", rect: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } },
          { t: 2, mode: "bubble", rect: { x: -1, y: 0, w: 2, h: 0.2 } },
        ],
      },
    });
    expect(parsed.camera?.keyframes.map((k) => k.t)).toEqual([0, 5]);
    expect(parsed.camera?.keyframes[0].rect).toEqual({ x: 0, y: 0, w: 1, h: 0.2 });
  });

  it("drops an invalid trim and clamps cameraOffsetMs", () => {
    const parsed = parseEdits({ ...base, trim: { start: 5, end: 2 }, cameraOffsetMs: 99999 });
    expect(parsed.trim).toBeUndefined();
    expect(parsed.cameraOffsetMs).toBe(5000);
  });

  it("accepts the click overlay type and truncates to 64 overlays", () => {
    const overlays = Array.from({ length: 70 }, (_, i) => ({
      type: "click", start: i, end: i + 0.5, rect: { x: 0.5, y: 0.5, w: 0.05, h: 0.05 },
    }));
    const parsed = parseEdits({ ...base, overlays });
    expect(parsed.overlays).toHaveLength(64);
    expect(parsed.overlays[0].type).toBe("click");
  });

  it("leaves rows without the new fields unchanged", () => {
    const parsed = parseEdits(base);
    expect(parsed.trim).toBeUndefined();
    expect(parsed.frame).toBeUndefined();
    expect(parsed.camera).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/lib/edits.test.ts`
Expected: FAIL — `trim` undefined, `camera` undefined, click overlay dropped.

- [ ] **Step 4: Implement**

In `src/lib/edits.ts`:

```ts
import { sanitizeFrame } from "@/lib/recording/settings";
import type { BubbleShape, FrameConfig } from "@/lib/recording/types";

export type OverlayType = "blur" | "callout" | "underline" | "highlight" | "click";

export type Zoom = { start: number; end: number; rect: Rect; ramp?: number };

export type CameraMode = "bubble" | "full";
export type CameraKeyframe = { t: number; mode: CameraMode; rect: Rect };
export type CameraTrack = {
  shape: BubbleShape;
  mirror: boolean;
  /** Sorted by t; the first is always t = 0. */
  keyframes: CameraKeyframe[];
};

export type VideoEdits = {
  version: 1;
  cuts: Cut[];
  crop: Rect | null;
  zooms: Zoom[];
  overlays: Overlay[];
  markers: Marker[];
  trim?: { start: number; end: number };
  frame?: FrameConfig;
  camera?: CameraTrack | null;
  cameraOffsetMs?: number;
};

export const MAX_OVERLAYS = 64;
export const MAX_CUTS = 64;
export const MAX_KEYFRAMES = 64;
export const MAX_ZOOMS = 32;
export const MAX_MARKERS = 200;
const OVERLAY_TYPES: OverlayType[] = ["blur", "callout", "underline", "highlight", "click"];
const SHAPES: BubbleShape[] = ["circle", "rounded", "square", "portrait", "full"];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function clampRect(r: Rect): Rect {
  const x = clamp01(r.x);
  const y = clamp01(r.y);
  return { x, y, w: Math.max(0.001, Math.min(1 - x, r.w)), h: Math.max(0.001, Math.min(1 - y, r.h)) };
}

function parseCamera(value: unknown): CameraTrack | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const shape = SHAPES.includes(value.shape as BubbleShape) ? (value.shape as BubbleShape) : "circle";
  const keyframes: CameraKeyframe[] = [];
  for (const raw of asArray(value.keyframes)) {
    if (!isRecord(raw)) continue;
    const t = num(raw.t);
    const rect = parseRect(raw.rect);
    if (t === null || t < 0 || !rect) continue;
    const mode: CameraMode = raw.mode === "full" ? "full" : "bubble";
    keyframes.push({ t, mode, rect: clampRect(rect) });
  }
  keyframes.sort((a, b) => a.t - b.t);
  if (keyframes.length === 0) return undefined;
  keyframes[0] = { ...keyframes[0], t: 0 };
  return { shape, mirror: value.mirror === true, keyframes: keyframes.slice(0, MAX_KEYFRAMES) };
}
```

In `parseEdits`, after the overlays loop apply `overlays.splice(MAX_OVERLAYS)`, `cuts.splice(MAX_CUTS)`, `markers.splice(MAX_MARKERS)`, `zooms.splice(MAX_ZOOMS)`; in the zooms loop also read `const ramp = num(raw.ramp); if (ramp !== null) zoom.ramp = Math.max(0, Math.min(2, ramp));` and clamp the rect with `clampRect`; and build the return value:

```ts
  const out: VideoEdits = { version: 1, cuts, crop: parseRect(input.crop), zooms, overlays, markers };
  const trim = parseSpan(input.trim);
  if (trim) out.trim = trim;
  if (isRecord(input.frame)) out.frame = sanitizeFrame(input.frame);
  const camera = parseCamera(input.camera);
  if (camera !== undefined) out.camera = camera;
  const offset = num(input.cameraOffsetMs);
  if (offset !== null) out.cameraOffsetMs = Math.max(-5000, Math.min(5000, offset));
  return out;
```

Also add `MAX_MARKERS` use: `complete/route.ts` already has its own `MAX_MARKERS = 500`; leave it, `parseEdits` truncates to 200 anyway.

- [ ] **Step 5: Run tests**

Run: `npm test -- src/lib/edits.test.ts src/lib/recording/settings.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/edits.ts src/lib/edits.test.ts src/lib/recording/settings.ts
git commit -m "feat(edits): trim, frame, camera track and click overlays in the edit list"
```

---

### Task 2: Cuts and edited-time remap

**Files:**
- Create: `src/lib/editor/cuts.ts`
- Test: `src/lib/editor/cuts.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { addCut, editedDuration, editedToSource, keptRanges, sourceToEdited } from "./cuts";

const edits = (over: object) => ({
  version: 1 as const, cuts: [], crop: null, zooms: [], overlays: [], markers: [], ...over,
});

describe("keptRanges", () => {
  it("is the whole take with no edits", () => {
    expect(keptRanges(edits({}), 10)).toEqual([{ start: 0, end: 10 }]);
  });
  it("applies trim then cuts", () => {
    const e = edits({ trim: { start: 1, end: 9 }, cuts: [{ start: 3, end: 4 }, { start: 8.5, end: 20 }] });
    expect(keptRanges(e, 10)).toEqual([{ start: 1, end: 3 }, { start: 4, end: 8.5 }]);
  });
  it("drops empty ranges", () => {
    expect(keptRanges(edits({ cuts: [{ start: 0, end: 10 }] }), 10)).toEqual([]);
  });
});

describe("time remap", () => {
  const e = edits({ cuts: [{ start: 2, end: 4 }] });
  it("editedDuration subtracts cuts", () => expect(editedDuration(e, 10)).toBe(8));
  it("sourceToEdited collapses a cut onto its start", () => {
    expect(sourceToEdited(e, 10, 1)).toBe(1);
    expect(sourceToEdited(e, 10, 3)).toBe(2);
    expect(sourceToEdited(e, 10, 6)).toBe(4);
  });
  it("editedToSource skips the cut", () => {
    expect(editedToSource(e, 10, 1)).toBe(1);
    expect(editedToSource(e, 10, 2)).toBe(4);
    expect(editedToSource(e, 10, 7.9)).toBeCloseTo(9.9);
  });
  it("round-trips inside kept ranges", () => {
    for (const t of [0, 1.5, 4.2, 9.99]) {
      expect(editedToSource(e, 10, sourceToEdited(e, 10, t))).toBeCloseTo(t);
    }
  });
});

describe("addCut", () => {
  it("merges overlapping and touching cuts and sorts", () => {
    const cuts = addCut(addCut([{ start: 5, end: 6 }], { start: 1, end: 2 }), { start: 1.5, end: 5 });
    expect(cuts).toEqual([{ start: 1, end: 6 }]);
  });
  it("ignores degenerate spans", () => {
    expect(addCut([], { start: 3, end: 3 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/editor/cuts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { Cut, VideoEdits } from "@/lib/edits";

export type Range = { start: number; end: number };

/** Ranges of source time that survive trim and cuts, sorted and disjoint. */
export function keptRanges(edits: VideoEdits, duration: number): Range[] {
  const start = Math.max(0, edits.trim?.start ?? 0);
  const end = Math.min(duration, edits.trim?.end ?? duration);
  let kept: Range[] = end > start ? [{ start, end }] : [];
  for (const cut of edits.cuts) {
    const next: Range[] = [];
    for (const r of kept) {
      if (cut.end <= r.start || cut.start >= r.end) { next.push(r); continue; }
      if (cut.start > r.start) next.push({ start: r.start, end: cut.start });
      if (cut.end < r.end) next.push({ start: cut.end, end: r.end });
    }
    kept = next;
  }
  return kept.filter((r) => r.end - r.start > 1e-6);
}

export function editedDuration(edits: VideoEdits, duration: number): number {
  return keptRanges(edits, duration).reduce((sum, r) => sum + (r.end - r.start), 0);
}

/** Source seconds → edited seconds. Inside a removed range, snaps to where that range collapses to. */
export function sourceToEdited(edits: VideoEdits, duration: number, t: number): number {
  let acc = 0;
  for (const r of keptRanges(edits, duration)) {
    if (t < r.start) return acc;
    if (t <= r.end) return acc + (t - r.start);
    acc += r.end - r.start;
  }
  return acc;
}

/** Edited seconds → source seconds. Past the end, returns the end of the last kept range. */
export function editedToSource(edits: VideoEdits, duration: number, t: number): number {
  const ranges = keptRanges(edits, duration);
  let acc = 0;
  for (const r of ranges) {
    const len = r.end - r.start;
    if (t <= acc + len) return r.start + (t - acc);
    acc += len;
  }
  return ranges.length ? ranges[ranges.length - 1].end : 0;
}

/** Insert a cut, keeping the list sorted, merged and disjoint. */
export function addCut(cuts: Cut[], cut: Cut): Cut[] {
  if (!(cut.end > cut.start)) return cuts;
  const all = [...cuts, cut].sort((a, b) => a.start - b.start);
  const out: Cut[] = [];
  for (const c of all) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else out.push({ ...c });
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/editor/cuts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/cuts.ts src/lib/editor/cuts.test.ts
git commit -m "feat(editor): kept ranges and edited-time remap"
```

---

### Task 3: Camera track interpolation

**Files:**
- Create: `src/lib/editor/camera-track.ts`
- Test: `src/lib/editor/camera-track.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { cameraAt, defaultCameraTrack, removeKeyframe, upsertKeyframe, CAMERA_ANIM_S } from "./camera-track";

const track = defaultCameraTrack("circle", "medium", 16 / 9);

describe("defaultCameraTrack", () => {
  it("has one keyframe at t=0 in the bottom-right, square in pixels", () => {
    const k = track.keyframes[0];
    expect(k.t).toBe(0);
    expect(k.mode).toBe("bubble");
    expect(k.rect.w).toBeCloseTo(0.22);
    // circle: h_norm = w_norm * screenAspect so the pixel box is square
    expect(k.rect.h).toBeCloseTo(0.22 * (16 / 9));
    expect(k.rect.x + k.rect.w).toBeLessThanOrEqual(1);
    expect(k.rect.y + k.rect.h).toBeLessThanOrEqual(1);
  });
});

describe("cameraAt", () => {
  const two = upsertKeyframe(track, 5, { mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } });
  it("returns the first keyframe before any change", () => {
    const s = cameraAt(two, 2);
    expect(s.mode).toBe("bubble");
    expect(s.fade).toBe(0);
  });
  it("cross-fades during the animation window after a keyframe", () => {
    const s = cameraAt(two, 5 + CAMERA_ANIM_S / 2);
    expect(s.fromMode).toBe("bubble");
    expect(s.mode).toBe("full");
    expect(s.fade).toBeGreaterThan(0);
    expect(s.fade).toBeLessThan(1);
  });
  it("settles after the window", () => {
    const s = cameraAt(two, 6);
    expect(s.mode).toBe("full");
    expect(s.fade).toBe(1);
    expect(s.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it("interpolates rect between bubble keyframes", () => {
    const moved = upsertKeyframe(track, 3, { rect: { x: 0.1, y: 0.1, w: 0.22, h: 0.22 * (16 / 9) } });
    const s = cameraAt(moved, 3 + CAMERA_ANIM_S / 2);
    expect(s.rect.x).toBeGreaterThan(0.1);
    expect(s.rect.x).toBeLessThan(track.keyframes[0].rect.x);
  });
});

describe("upsertKeyframe / removeKeyframe", () => {
  it("replaces a keyframe within tolerance instead of adding", () => {
    const a = upsertKeyframe(track, 2, { mode: "full" });
    const b = upsertKeyframe(a, 2.01, { mode: "bubble" });
    expect(b.keyframes).toHaveLength(2);
    expect(b.keyframes[1].mode).toBe("bubble");
  });
  it("inherits rect/mode from the previous keyframe", () => {
    const a = upsertKeyframe(track, 2, { mode: "full" });
    expect(a.keyframes[1].rect).toEqual(track.keyframes[0].rect);
  });
  it("never removes t=0", () => {
    expect(removeKeyframe(track, 0).keyframes).toHaveLength(1);
    const a = upsertKeyframe(track, 2, { mode: "full" });
    expect(removeKeyframe(a, 2).keyframes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/editor/camera-track.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { CameraKeyframe, CameraMode, CameraTrack, Rect } from "@/lib/edits";
import { easeInOutCubic, SIZE_FRACTION } from "@/lib/recording/geometry";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";

/** Seconds a move/resize/mode change takes to settle. Mirrors BUBBLE_ANIM_MS. */
export const CAMERA_ANIM_S = 0.3;
const TOLERANCE_S = 1 / 30;

export type CameraSample = {
  mode: CameraMode;
  /** Set while a mode change is still fading; `fade` is 0..1 towards `mode`. */
  fromMode?: CameraMode;
  fade: number;
  rect: Rect;
};

/** Height (normalized to the screen) for a bubble of normalized width `w`. */
export function bubbleHeightFor(shape: BubbleShape, w: number, screenAspect: number, cameraAspect = 16 / 9): number {
  switch (shape) {
    case "portrait": return (w * screenAspect * 16) / 9;
    case "rounded": return (w * screenAspect) / cameraAspect;
    case "full": return 1;
    default: return w * screenAspect; // circle / square: square in pixels
  }
}

export function defaultCameraTrack(shape: BubbleShape, size: BubbleSize, screenAspect: number, cameraAspect = 16 / 9): CameraTrack {
  const w = SIZE_FRACTION[size];
  const h = Math.min(1, bubbleHeightFor(shape, w, screenAspect, cameraAspect));
  const margin = 0.03;
  const rect: Rect = { x: 1 - w - margin, y: 1 - h - margin * screenAspect, w, h };
  return { shape: shape === "full" ? "circle" : shape, mirror: true, keyframes: [{ t: 0, mode: "bubble", rect }] };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
});

export function cameraAt(track: CameraTrack, t: number): CameraSample {
  const ks = track.keyframes;
  let i = 0;
  while (i + 1 < ks.length && ks[i + 1].t <= t) i += 1;
  const cur = ks[i];
  if (i === 0) return { mode: cur.mode, fade: 1, rect: cur.rect, ...(cur.mode === ks[0].mode ? { fade: 0 } : {}) };
  const prev = ks[i - 1];
  const p = Math.min(1, Math.max(0, (t - cur.t) / CAMERA_ANIM_S));
  const e = easeInOutCubic(p);
  const rect = p >= 1 ? cur.rect : lerpRect(prev.rect, cur.rect, e);
  if (prev.mode !== cur.mode && p < 1) return { mode: cur.mode, fromMode: prev.mode, fade: e, rect };
  return { mode: cur.mode, fade: 1, rect };
}

export function upsertKeyframe(track: CameraTrack, t: number, patch: Partial<Omit<CameraKeyframe, "t">>): CameraTrack {
  const time = Math.max(0, t);
  const ks = [...track.keyframes];
  const idx = ks.findIndex((k) => Math.abs(k.t - time) <= TOLERANCE_S);
  if (idx >= 0) {
    ks[idx] = { ...ks[idx], ...patch };
  } else {
    let prev = ks[0];
    for (const k of ks) if (k.t <= time) prev = k;
    ks.push({ t: time, mode: prev.mode, rect: prev.rect, ...patch });
    ks.sort((a, b) => a.t - b.t);
  }
  ks[0] = { ...ks[0], t: 0 };
  return { ...track, keyframes: ks.slice(0, 64) };
}

export function removeKeyframe(track: CameraTrack, t: number): CameraTrack {
  const ks = track.keyframes.filter((k, i) => i === 0 || Math.abs(k.t - t) > TOLERANCE_S);
  return { ...track, keyframes: ks };
}
```

Note on the first-keyframe `fade`: the test expects `fade: 0` before any change; the spread above yields `fade: 0` for `i === 0`. Simplify to `if (i === 0) return { mode: cur.mode, fade: 0, rect: cur.rect };` — the renderer treats `fade 0 with no fromMode` and `fade 1` identically (no cross-fade).

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/editor/camera-track.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/camera-track.ts src/lib/editor/camera-track.test.ts
git commit -m "feat(editor): camera keyframe track with eased interpolation"
```

---

### Task 3b: Zoom helpers

**Files:**
- Create: `src/lib/editor/zoom.ts`
- Test: `src/lib/editor/zoom.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { FULL_RECT, insertZoom, toOutput, zoomAt } from "./zoom";

const z = { start: 2, end: 6, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };

describe("zoomAt", () => {
  it("is the full frame outside any zoom", () => {
    expect(zoomAt([z], 0)).toEqual(FULL_RECT);
    expect(zoomAt([z], 7)).toEqual(FULL_RECT);
  });
  it("holds the rect in the middle and eases at both ends", () => {
    expect(zoomAt([z], 4)).toEqual(z.rect);
    const enter = zoomAt([z], 2.2);
    expect(enter.w).toBeGreaterThan(0.5);
    expect(enter.w).toBeLessThan(1);
    const exit = zoomAt([z], 5.8);
    expect(exit.w).toBeGreaterThan(0.5);
    expect(exit.w).toBeLessThan(1);
  });
  it("respects a custom ramp and a zero ramp", () => {
    expect(zoomAt([{ ...z, ramp: 0 }], 2.01)).toEqual(z.rect);
    expect(zoomAt([{ ...z, ramp: 1 }], 2.5).w).toBeGreaterThan(zoomAt([z], 2.5).w);
  });
});

describe("insertZoom", () => {
  it("keeps zooms sorted and trims the one it lands on", () => {
    const out = insertZoom([z], { start: 5, end: 8, rect: z.rect });
    expect(out).toEqual([{ ...z, end: 5 }, { start: 5, end: 8, rect: z.rect }]);
  });
  it("drops a zoom it fully covers", () => {
    const out = insertZoom([z], { start: 1, end: 9, rect: z.rect });
    expect(out).toHaveLength(1);
    expect(out[0].start).toBe(1);
  });
});

describe("toOutput", () => {
  it("maps a source rect through the zoom", () => {
    const view = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    expect(toOutput({ x: 0.75, y: 0.75, w: 0.125, h: 0.125 }, view)).toEqual({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
    expect(toOutput({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, FULL_RECT)).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/editor/zoom.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { Rect, Zoom } from "@/lib/edits";
import { easeInOutCubic } from "@/lib/recording/geometry";

export const FULL_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 };
export const DEFAULT_RAMP_S = 0.4;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
});

/** The normalized source rect on screen at `t`: the whole frame, or an eased zoom. */
export function zoomAt(zooms: Zoom[], t: number): Rect {
  const z = zooms.find((zz) => t >= zz.start && t <= zz.end);
  if (!z) return FULL_RECT;
  const span = z.end - z.start;
  const ramp = Math.min(z.ramp ?? DEFAULT_RAMP_S, span / 3);
  if (ramp <= 0) return z.rect;
  const sinceStart = t - z.start;
  const untilEnd = z.end - t;
  if (sinceStart < ramp) return lerpRect(FULL_RECT, z.rect, easeInOutCubic(sinceStart / ramp));
  if (untilEnd < ramp) return lerpRect(z.rect, FULL_RECT, easeInOutCubic(1 - untilEnd / ramp));
  return z.rect;
}

/** Insert a zoom, trimming or dropping any it overlaps so the list stays disjoint and sorted. */
export function insertZoom(zooms: Zoom[], zoom: Zoom): Zoom[] {
  if (!(zoom.end > zoom.start)) return zooms;
  const out: Zoom[] = [];
  for (const z of zooms) {
    if (z.end <= zoom.start || z.start >= zoom.end) { out.push(z); continue; }
    if (z.start < zoom.start) out.push({ ...z, end: zoom.start });
    if (z.end > zoom.end) out.push({ ...z, start: zoom.end });
  }
  out.push(zoom);
  return out.filter((z) => z.end - z.start > 0.05).sort((a, b) => a.start - b.start).slice(0, 32);
}

/** Map a source-normalized rect into view-normalized space for the current zoom `view`. */
export function toOutput(rect: Rect, view: Rect): Rect {
  return { x: (rect.x - view.x) / view.w, y: (rect.y - view.y) / view.h, w: rect.w / view.w, h: rect.h / view.h };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/editor/zoom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/zoom.ts src/lib/editor/zoom.test.ts
git commit -m "feat(editor): eased zoom rect and non-overlapping insert"
```

---

### Task 4: Edit ops and undo history

**Files:**
- Create: `src/lib/editor/edit-ops.ts`, `src/lib/editor/undo.ts`
- Test: `src/lib/editor/edit-ops.test.ts`, `src/lib/editor/undo.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/editor/edit-ops.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_EDITS, parseEdits } from "@/lib/edits";
import { defaultCameraTrack } from "./camera-track";
import * as ops from "./edit-ops";

const start = () => parseEdits(EMPTY_EDITS);

describe("edit-ops", () => {
  it("setTrim clamps into the duration and orders start/end", () => {
    const e = ops.setTrim(start(), 12, { start: -1, end: 20 });
    expect(e.trim).toEqual({ start: 0, end: 12 });
  });
  it("addCut and removeCut", () => {
    let e = ops.addCut(start(), { start: 1, end: 2 });
    e = ops.addCut(e, { start: 1.5, end: 3 });
    expect(e.cuts).toEqual([{ start: 1, end: 3 }]);
    expect(ops.removeCut(e, 0).cuts).toEqual([]);
  });
  it("addOverlay assigns callout numbers and respects the cap", () => {
    let e = start();
    e = ops.addOverlay(e, { type: "callout", start: 0, end: 3, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    e = ops.addOverlay(e, { type: "callout", start: 0, end: 3, rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } });
    expect(e.overlays.map((o) => o.n)).toEqual([1, 2]);
    for (let i = 0; i < 70; i++) e = ops.addOverlay(e, { type: "blur", start: i, end: i + 1, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    expect(e.overlays).toHaveLength(64);
  });
  it("updateOverlay keeps end > start", () => {
    let e = ops.addOverlay(start(), { type: "blur", start: 2, end: 5, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    e = ops.updateOverlay(e, 0, { end: 1 });
    expect(e.overlays[0].end).toBeGreaterThan(e.overlays[0].start);
  });
  it("camera ops route through the track helpers", () => {
    let e = ops.setCamera(start(), defaultCameraTrack("circle", "small", 16 / 9));
    e = ops.upsertCameraKeyframe(e, 3, { mode: "full" });
    expect(e.camera?.keyframes).toHaveLength(2);
    e = ops.removeCameraKeyframe(e, 3);
    expect(e.camera?.keyframes).toHaveLength(1);
    expect(ops.setCameraOffset(e, 9999).cameraOffsetMs).toBe(5000);
  });
  it("zoom ops keep the list disjoint", () => {
    let e = ops.addZoom(start(), { start: 1, end: 4, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    e = ops.addZoom(e, { start: 3, end: 6, rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } });
    expect(e.zooms.map((z) => [z.start, z.end])).toEqual([[1, 3], [3, 6]]);
    e = ops.updateZoom(e, 1, { end: 2 });
    expect(e.zooms[1].end).toBeGreaterThan(e.zooms[1].start);
    expect(ops.removeZoom(e, 0).zooms).toHaveLength(1);
  });
});
```

`src/lib/editor/undo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHistory, push, redo, undo, canUndo, canRedo } from "./undo";

describe("undo history", () => {
  it("pushes, undoes and redoes", () => {
    let h = createHistory(0);
    h = push(h, 1);
    h = push(h, 2);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(false);
  });
  it("a push after undo drops the redo branch", () => {
    let h = push(push(createHistory(0), 1), 2);
    h = undo(h);
    h = push(h, 9);
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toBe(1);
  });
  it("caps at 50 past entries", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 80; i++) h = push(h, i);
    expect(h.past).toHaveLength(50);
    expect(canUndo(h)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/editor/edit-ops.test.ts src/lib/editor/undo.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `undo.ts`**

```ts
export type History<T> = { past: T[]; present: T; future: T[] };
const CAP = 50;

export const createHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] });

export function push<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-CAP), present: next, future: [] };
}
export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const past = h.past.slice(0, -1);
  return { past, present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}
export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...future] = h.future;
  return { past: [...h.past, h.present], present: next, future };
}
export const canUndo = <T,>(h: History<T>) => h.past.length > 0;
export const canRedo = <T,>(h: History<T>) => h.future.length > 0;
```

- [ ] **Step 4: Implement `edit-ops.ts`**

```ts
import { MAX_OVERLAYS, type CameraKeyframe, type CameraTrack, type Cut, type Overlay, type VideoEdits, type Zoom } from "@/lib/edits";
import { insertZoom } from "./zoom";
import type { FrameConfig } from "@/lib/recording/types";
import { addCut as mergeCut } from "./cuts";
import { removeKeyframe, upsertKeyframe } from "./camera-track";

const MIN_SPAN = 0.1;

export function setTrim(e: VideoEdits, duration: number, trim: { start: number; end: number }): VideoEdits {
  const start = Math.max(0, Math.min(duration, Math.min(trim.start, trim.end)));
  const end = Math.max(start + MIN_SPAN, Math.min(duration, Math.max(trim.start, trim.end)));
  return { ...e, trim: { start, end: Math.min(duration, end) } };
}

export const addCut = (e: VideoEdits, cut: Cut): VideoEdits => ({ ...e, cuts: mergeCut(e.cuts, cut).slice(0, 64) });
export const removeCut = (e: VideoEdits, index: number): VideoEdits => ({ ...e, cuts: e.cuts.filter((_, i) => i !== index) });

export function addOverlay(e: VideoEdits, overlay: Overlay): VideoEdits {
  if (e.overlays.length >= MAX_OVERLAYS) return e;
  const next = { ...overlay };
  if (next.type === "callout" && next.n === undefined) {
    next.n = e.overlays.filter((o) => o.type === "callout").length + 1;
  }
  return { ...e, overlays: [...e.overlays, next] };
}

export function updateOverlay(e: VideoEdits, index: number, patch: Partial<Overlay>): VideoEdits {
  return {
    ...e,
    overlays: e.overlays.map((o, i) => {
      if (i !== index) return o;
      const merged = { ...o, ...patch };
      if (merged.end <= merged.start) merged.end = merged.start + MIN_SPAN;
      return merged;
    }),
  };
}

export const removeOverlay = (e: VideoEdits, index: number): VideoEdits => ({ ...e, overlays: e.overlays.filter((_, i) => i !== index) });
export const setFrame = (e: VideoEdits, frame: FrameConfig): VideoEdits => ({ ...e, frame });
export const setCamera = (e: VideoEdits, camera: CameraTrack | null): VideoEdits => ({ ...e, camera });

export function upsertCameraKeyframe(e: VideoEdits, t: number, patch: Partial<Omit<CameraKeyframe, "t">>): VideoEdits {
  return e.camera ? { ...e, camera: upsertKeyframe(e.camera, t, patch) } : e;
}
export function removeCameraKeyframe(e: VideoEdits, t: number): VideoEdits {
  return e.camera ? { ...e, camera: removeKeyframe(e.camera, t) } : e;
}
export const setCameraOffset = (e: VideoEdits, ms: number): VideoEdits => ({ ...e, cameraOffsetMs: Math.max(-5000, Math.min(5000, Math.round(ms))) });

export const addZoom = (e: VideoEdits, zoom: Zoom): VideoEdits => ({ ...e, zooms: insertZoom(e.zooms, zoom) });
export const removeZoom = (e: VideoEdits, index: number): VideoEdits => ({ ...e, zooms: e.zooms.filter((_, i) => i !== index) });
export function updateZoom(e: VideoEdits, index: number, patch: Partial<Zoom>): VideoEdits {
  const cur = e.zooms[index];
  if (!cur) return e;
  const next = { ...cur, ...patch };
  if (next.end <= next.start) next.end = next.start + MIN_SPAN;
  return { ...e, zooms: insertZoom(e.zooms.filter((_, i) => i !== index), next) };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/lib/editor`
Expected: PASS (cuts, camera-track, edit-ops, undo).

- [ ] **Step 6: Commit**

```bash
git add src/lib/editor
git commit -m "feat(editor): pure edit ops and bounded undo history"
```

---

### Task 5: Recorder machine — staging and rendering statuses

**Files:**
- Modify: `src/lib/recording/recorder-machine.ts`
- Modify: `src/lib/recording/types.ts`
- Test: `src/lib/recording/recorder-machine.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/recording/recorder-machine.test.ts`:

```ts
describe("staging and rendering", () => {
  const blob = new Blob(["x"], { type: "video/webm" });
  function toStopping() {
    let s = initialRecorderState();
    s = recorderReducer(s, { type: "ACQUIRE" });
    s = recorderReducer(s, { type: "ACQUIRED", surface: "monitor", hasSystemAudio: true, hasCamera: true });
    s = recorderReducer(s, { type: "START" });
    s = recorderReducer(s, { type: "SKIP_COUNTDOWN" });
    s = recorderReducer(s, { type: "STOP" });
    return s;
  }

  it("BLOB_READY lands in staging with both blobs and the offset", () => {
    const s = recorderReducer(toStopping(), {
      type: "BLOB_READY", blob, cameraBlob: blob, cameraOffsetMs: 40, durationMs: 1000, width: 100, height: 50,
    });
    expect(s.status).toBe("staging");
    expect(s.cameraBlob).toBe(blob);
    expect(s.cameraOffsetMs).toBe(40);
  });

  it("RENDER → RENDER_PROGRESS → RENDER_DONE → uploading; RENDER_FAILED returns to staging", () => {
    let s = recorderReducer(toStopping(), {
      type: "BLOB_READY", blob, cameraBlob: null, cameraOffsetMs: 0, durationMs: 1000, width: 100, height: 50,
    });
    s = recorderReducer(s, { type: "RENDER" });
    expect(s.status).toBe("rendering");
    s = recorderReducer(s, { type: "RENDER_PROGRESS", percent: 40 });
    expect(s.renderProgress).toBe(40);
    const failed = recorderReducer(s, { type: "RENDER_FAILED", error: "nope" });
    expect(failed.status).toBe("staging");
    expect(failed.error).toBe("nope");
    s = recorderReducer(s, { type: "RENDER_DONE" });
    expect(s.status).toBe("uploading");
    expect(s.uploadProgress).toBe(0);
  });

  it("UPLOAD_FAILED returns to staging and DISCARD clears both blobs", () => {
    let s = recorderReducer(toStopping(), {
      type: "BLOB_READY", blob, cameraBlob: blob, cameraOffsetMs: 0, durationMs: 1000, width: 100, height: 50,
    });
    s = recorderReducer(s, { type: "RENDER" });
    s = recorderReducer(s, { type: "RENDER_DONE" });
    s = recorderReducer(s, { type: "UPLOAD_FAILED", error: "x" });
    expect(s.status).toBe("staging");
    s = recorderReducer(s, { type: "DISCARD" });
    expect(s.blob).toBeNull();
    expect(s.cameraBlob).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/recording/recorder-machine.test.ts`
Expected: FAIL — type errors on `cameraBlob`, status `"review"`.

- [ ] **Step 3: Implement**

In `recorder-machine.ts`:

- `RecorderStatus`: replace `"review"` with `"staging"` and add `"rendering"` after it.
- `RecorderState`: add `cameraBlob: Blob | null; cameraOffsetMs: number; renderProgress: number;` after `blob`.
- `initialRecorderState`: add `cameraBlob: null, cameraOffsetMs: 0, renderProgress: 0`.
- `RecorderEvent`: `BLOB_READY` gains `cameraBlob: Blob | null; cameraOffsetMs: number`; replace `{ type: "UPLOAD" }` with `{ type: "RENDER" } | { type: "RENDER_PROGRESS"; percent: number } | { type: "RENDER_DONE" } | { type: "RENDER_FAILED"; error: string }`.
- Reducer:

```ts
    case "BLOB_READY":
      if (state.status !== "stopping") return state;
      return {
        ...state, status: "staging", blob: event.blob, cameraBlob: event.cameraBlob,
        cameraOffsetMs: event.cameraOffsetMs, durationMs: event.durationMs, width: event.width, height: event.height,
        renderProgress: 0, error: "",
      };

    case "DISCARD":
      if (state.status !== "staging") return state;
      return { ...state, status: state.streamsAlive ? "setup" : "idle", blob: null, cameraBlob: null,
        cameraOffsetMs: 0, durationMs: 0, elapsedMs: 0, markers: [], error: "", notice: "" };

    case "RENDER":
      if (state.status !== "staging") return state;
      return { ...state, status: "rendering", renderProgress: 0, error: "" };
    case "RENDER_PROGRESS":
      if (state.status !== "rendering") return state;
      return { ...state, renderProgress: event.percent };
    case "RENDER_FAILED":
      if (state.status !== "rendering") return state;
      return { ...state, status: "staging", error: event.error };
    case "RENDER_DONE":
      if (state.status !== "rendering") return state;
      return { ...state, status: "uploading", uploadProgress: 0, error: "" };
```

`UPLOAD_FAILED` → `status: "staging"`. `UPLOAD_DONE` also sets `cameraBlob: null`. `RECORD_FAILED` sets `cameraBlob: null`. Every place that reads `"review"` in this file becomes `"staging"`.

In `src/lib/recording/types.ts`:
- `DesktopShortcut`: remove `"bubbleToggle"` and its comment.
- `HudStatus`: `"review"` → `"staging"`, add `"rendering"`.
- `HudState`: remove `bubbleVisible`.

- [ ] **Step 4: Run tests and type-check**

Run: `npm test -- src/lib/recording/recorder-machine.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: machine tests PASS; tsc reports errors only in `use-recorder.ts`, `recorder.tsx`, `desktop-bridge.ts` (fixed in Tasks 7 and 11). Note them; do not fix here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recording/recorder-machine.ts src/lib/recording/recorder-machine.test.ts src/lib/recording/types.ts
git commit -m "feat(recorder): staging and rendering statuses, camera blob in the machine"
```

---

### Task 6: Upload API accepts details and edits

**Files:**
- Modify: `src/app/api/upload/route.ts`
- Modify: `src/app/api/upload/complete/route.ts`
- Create: `src/app/api/slug/route.ts`
- Modify: `src/lib/recording/upload.ts`
- Test: `src/lib/recording/upload.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/recording/upload.test.ts` (it already stubs `fetch`; follow its existing pattern for the stub):

```ts
it("sends title, description, slug and edits to /api/upload/complete", async () => {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    if (url === "/api/upload") return new Response(JSON.stringify({ sessionUri: "s", slug: "my-slug" }));
    if (url === "s") return new Response(JSON.stringify({ id: "drive1" }), { status: 200 });
    if (url === "/api/upload/complete") return new Response(JSON.stringify({ id: "v1", slug: "my-slug", url: "u" }));
    return new Response("{}");
  });
  await uploadRecording({
    blob: new Blob(["abc"], { type: "video/webm" }), durationMs: 10, width: 1, height: 1, thumbnail: null,
    onProgress: () => {}, title: "T", description: "D", slug: "my-slug",
    edits: { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [{ t: 1 }] },
  });
  const start = calls.find((c) => c.url === "/api/upload")!.body as Record<string, unknown>;
  expect(start.slug).toBe("my-slug");
  const complete = calls.find((c) => c.url === "/api/upload/complete")!.body as Record<string, unknown>;
  expect(complete.title).toBe("T");
  expect(complete.description).toBe("D");
  expect(complete.slug).toBe("my-slug");
  expect((complete.edits as { markers: unknown[] }).markers).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/recording/upload.test.ts`
Expected: FAIL — `title` not in `UploadRecordingInput`.

- [ ] **Step 3: Update `upload.ts`**

Replace `markers?: Marker[]` in `UploadRecordingInput` with:

```ts
  title: string;
  description: string;
  /** The slug the user chose in staging; empty means "let the server pick". */
  slug: string;
  /** The whole staging edit list; the server re-validates it. */
  edits: VideoEdits;
```

(import `VideoEdits` from `@/lib/edits`; drop the `Marker` import). In the `/api/upload` body add `slug: slug || undefined`. In the complete body replace `title: defaultRecordingTitle(now), slug: reservedSlug, markers` with `title: title.trim() || defaultRecordingTitle(now), description, slug: reservedSlug, edits`. Destructure the new fields from `input`.

- [ ] **Step 4: Update `/api/upload`**

In `src/app/api/upload/route.ts` add `slug?: string` to the body type and, before creating the session:

```ts
  let slug = newSlug();
  if (typeof body.slug === "string" && body.slug) {
    const wanted = normalizeSlug(body.slug);
    if (!SLUG_RE.test(wanted)) return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    if (await isSlugTaken(wanted)) return NextResponse.json({ error: "That link is already taken" }, { status: 409 });
    slug = wanted;
  }
```

and return `{ sessionUri, slug }`. Import `isSlugTaken` from `@/lib/db` and `normalizeSlug, SLUG_RE` from `@/lib/slug`. This route is already owner-gated by `src/proxy.ts`; confirm with `grep -n "api/upload" src/proxy.ts` and do not add a second gate.

- [ ] **Step 5: Update `/api/upload/complete`**

Add `description?: string; edits?: unknown` to the body type. Replace the markers block with:

```ts
  // The staging edit list. `parseEdits` is the single normaliser: caps, clamps
  // and unknown keys are all handled there, so a hostile client cannot stuff
  // the column. Legacy clients that still send `markers` alone are honoured.
  const edits = parseEdits(
    body.edits && typeof body.edits === "object"
      ? body.edits
      : { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: Array.isArray(body.markers) ? body.markers : [] },
  );
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : null;
```

and pass `description` into `insertVideo` (check `NewVideo` in `db.ts` has `description`; if it is named differently, use that name). Remove `MAX_MARKERS` and the `Marker` import.

- [ ] **Step 6: Slug availability route**

`src/app/api/slug/route.ts`:

```ts
import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth";
import { isSlugTaken } from "@/lib/db";
import { normalizeSlug, SLUG_RE } from "@/lib/slug";

export async function GET(request: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const raw = new URL(request.url).searchParams.get("slug") ?? "";
  const slug = normalizeSlug(raw);
  if (!SLUG_RE.test(slug)) return NextResponse.json({ slug, valid: false, available: false });
  return NextResponse.json({ slug, valid: true, available: !(await isSlugTaken(slug)) });
}
```

- [ ] **Step 7: Run tests and type-check**

Run: `npm test -- src/lib/recording/upload.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: upload tests PASS; remaining tsc errors only in `use-recorder.ts` (it still calls `uploadRecording` with `markers`) and the files noted in Task 5.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/upload src/app/api/slug src/lib/recording/upload.ts src/lib/recording/upload.test.ts
git commit -m "feat(upload): carry title, description, chosen slug and edit list to the server"
```

---

### Task 7: Recorder hook — two raw recorders, no compositor

**Files:**
- Modify: `src/lib/recording/use-recorder.ts`
- Modify: `src/lib/recording/desktop-bridge.ts`

This task is a rewrite of the capture path. Work section by section; each bullet names the existing section comment in the file.

- [ ] **Step 1: Imports and result type**

Remove the imports of `Compositor`, `computeFrameLayout`, `displayPosToCanvasPos`, `createFpsOverlay`, `createNoopOverlay`, `debugOverlaysEnabled`, and every `onDesktopBubble*` / `setDesktopBubble*` / `setDesktopCameraDevice` / `setDesktopRecordingActive` import. Add:

```ts
import type { VideoEdits } from "@/lib/edits";
import { renderToBlob, type RenderSources } from "@/lib/editor/export";
```

Replace `canvasRef`, `reviewUrl`, `thumbnailUrl`, `dimensions` in `UseRecorderResult` with:

```ts
  /** Raw screen preview while configuring (screen and screen+camera). */
  screenVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Raw camera preview while configuring (camera and screen+camera). */
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Object URLs for the two raw files while staging; null outside staging. */
  staging: { screenUrl: string | null; cameraUrl: string | null } | null;
```

and replace `discard/upload/setBubble/setFrame` in `actions` with:

```ts
    discard(): void;
    /** Render the edit list to one file, then upload it with the details. */
    finish(input: FinishInput): void;
    cancelRender(): void;
    setBubble(patch: Partial<BubbleConfig>): void;
    setFrame(patch: Partial<FrameConfig>): void;
```

Add near the top:

```ts
export interface FinishInput {
  edits: VideoEdits;
  title: string;
  description: string;
  slug: string;
  /** Edited-timeline second to grab the thumbnail from. */
  thumbnailAt: number;
}
```

- [ ] **Step 2: Refs**

Remove `compositorRef`, `thumbnailRef`, `thumbnailTimerRef`, `prevFrameSrcRef`, `cameraAspect` state, `dimensions` state, `reviewUrl`/`thumbnailUrl` state. Add:

```ts
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraChunksRef = useRef<Blob[]>([]);
  const screenStartRef = useRef(0);
  const cameraStartRef = useRef(0);
  const renderAbortRef = useRef<AbortController | null>(null);
  const [staging, setStaging] = useState<{ screenUrl: string | null; cameraUrl: string | null } | null>(null);
```

- [ ] **Step 3: `teardown`**

Remove the compositor and thumbnail-timer lines. Add `if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null; cameraRecorderRef.current = null;`.

- [ ] **Step 4: `acquire`**

Delete the `if (!canvasRef.current) throw` check and the whole "Compositor for camera and screen+camera" block. Replace it with previews:

```ts
      if (screenVideoRef.current && screenStreamRef.current) {
        screenVideoRef.current.srcObject = screenStreamRef.current;
        void screenVideoRef.current.play().catch(() => {});
      }
      if (cameraVideoRef.current && cameraStreamRef.current) {
        cameraVideoRef.current.srcObject = cameraStreamRef.current;
        void cameraVideoRef.current.play().catch(() => {});
      }
```

Remove the `setCameraAspect` lines and the "Recorder canvas is not mounted" error branch.

- [ ] **Step 5: Delete the "push config into the compositor" effects** (both `useEffect`s under that comment) and the whole "floating desktop bubble" section (`desktopBubbleActive` through the `onDesktopBubbleMove` effect). Delete the `bubbleToggle` branch in the desktop shortcut handler.

- [ ] **Step 6: `beginRecording`**

Replace the body up to `chunksRef.current = [];` with:

```ts
    const current = stateRef.current;
    const mixer = mixerRef.current;
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0] ?? null;
    const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0] ?? null;
    const primaryTrack = current.mode === "camera" ? cameraTrack : screenTrack;
    if (!primaryTrack) {
      dispatch({ type: "RECORD_FAILED", error: "Could not start the encoder." });
      return;
    }
    const settings = primaryTrack.getSettings();
    dimensionsRef.current = { width: settings.width ?? null, height: settings.height ?? null };
    // Audio always rides the primary file; the secondary camera file is video-only.
    const recordStream = new MediaStream(mixer ? [primaryTrack, mixer.outputTrack] : [primaryTrack]);
    const cameraStream =
      current.mode === "screen+camera" && cameraTrack ? new MediaStream([cameraTrack]) : null;
```

After the primary `recorder` is constructed (keep `videoBitsPerSecond` as is), remove the `thumbnailTimerRef` block and add the camera recorder:

```ts
    cameraChunksRef.current = [];
    cameraRecorderRef.current = null;
    if (cameraStream) {
      const camRecorder = new MediaRecorder(cameraStream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 4_000_000,
      });
      camRecorder.ondataavailable = (e) => { if (e.data.size > 0) cameraChunksRef.current.push(e.data); };
      camRecorder.onstart = () => { cameraStartRef.current = performance.now(); };
      camRecorder.onerror = (e) => console.warn("[Yoom] camera MediaRecorder error", e);
      cameraRecorderRef.current = camRecorder;
    }
    recorder.onstart = () => { screenStartRef.current = performance.now(); };
    // Same tick, so the two `onstart` stamps differ only by encoder start-up skew.
    recorder.start(250);
    cameraRecorderRef.current?.start(250);
```

Keep `recorder.onstop = () => void finishRecording();`.

- [ ] **Step 7: Pause/resume/stop effect**

Mirror every `recorder.pause()`, `recorder.resume()`, `recorder.stop()` onto `cameraRecorderRef.current` when it exists and is in the matching state.

- [ ] **Step 8: Delete `captureThumbnail`.** `finishRecording` becomes:

```ts
  const finishRecording = useCallback(async () => {
    if (chunksRef.current.length === 0) {
      recorderRef.current = null;
      cameraRecorderRef.current = null;
      dispatch({ type: "RECORD_FAILED", error: "Recording captured no data. Please try again." });
      return;
    }
    // The camera recorder was stopped in the same effect; wait for its last chunk.
    const cam = cameraRecorderRef.current;
    if (cam && cam.state !== "inactive") {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        cam.addEventListener("stop", done, { once: true });
        window.setTimeout(done, 2000);
      });
    }
    const durationMs = Math.max(0, Math.round(performance.now() - startedAtRef.current - pausedTotalRef.current));
    const recorder = recorderRef.current;
    const type = recorder?.mimeType?.split(";")[0] || "video/webm";
    recorderRef.current = null;
    cameraRecorderRef.current = null;

    const patch = async (chunks: Blob[]): Promise<Blob> => {
      const raw = new Blob(chunks, { type });
      if (!type.includes("webm")) return raw;
      try { return await fixWebmDuration(raw, durationMs, { logger: false }); }
      catch (err) { console.warn("[Yoom] could not patch WebM duration", err); return raw; }
    };
    const blob = await patch(chunksRef.current);
    const cameraBlob = cameraChunksRef.current.length > 0 ? await patch(cameraChunksRef.current) : null;
    chunksRef.current = [];
    cameraChunksRef.current = [];
    const cameraOffsetMs = cameraBlob ? Math.round(cameraStartRef.current - screenStartRef.current) : 0;
    const { width, height } = dimensionsRef.current;
    dispatch({ type: "BLOB_READY", blob, cameraBlob, cameraOffsetMs, durationMs, width, height });
  }, []);
```

- [ ] **Step 9: Staging object URLs** — replace the two "review object URLs" effects with:

```ts
  useEffect(() => {
    if (state.status !== "staging" || !state.blob) { setStaging(null); return; }
    const screenUrl = URL.createObjectURL(state.blob);
    const cameraUrl = state.cameraBlob ? URL.createObjectURL(state.cameraBlob) : null;
    setStaging({ screenUrl, cameraUrl });
    return () => { URL.revokeObjectURL(screenUrl); if (cameraUrl) URL.revokeObjectURL(cameraUrl); };
  }, [state.status, state.blob, state.cameraBlob]);
```

The object URLs must also survive `rendering` and `uploading` (export reads them): change the guard to `if ((state.status !== "staging" && state.status !== "rendering" && state.status !== "uploading") || !state.blob)`.

- [ ] **Step 10: `finish` replaces `upload`**

```ts
  const finish = useCallback(async (input: FinishInput) => {
    const current = stateRef.current;
    if (current.status !== "staging" || !current.blob) return;
    const sources: RenderSources = {
      screen: current.mode === "camera" ? null : current.blob,
      camera: current.mode === "screen" ? null : current.mode === "camera" ? current.blob : current.cameraBlob,
      mode: current.mode,
      durationMs: current.durationMs,
    };
    dispatch({ type: "RENDER" });
    const abort = new AbortController();
    renderAbortRef.current = abort;
    let rendered: { blob: Blob; thumbnail: Blob | null; width: number; height: number };
    try {
      rendered = await renderToBlob(sources, input.edits, {
        thumbnailAt: input.thumbnailAt,
        onProgress: (percent) => dispatch({ type: "RENDER_PROGRESS", percent }),
        signal: abort.signal,
      });
    } catch (err) {
      renderAbortRef.current = null;
      dispatch({ type: "RENDER_FAILED", error: abort.signal.aborted ? "" : err instanceof Error ? err.message : "Render failed." });
      return;
    }
    renderAbortRef.current = null;
    dispatch({ type: "RENDER_DONE" });
    teardown();
    dispatch({ type: "STREAM_ENDED" });
    copiedRef.current = false;
    let reservedSlug = "";
    try {
      const result = await uploadRecording({
        blob: rendered.blob,
        durationMs: Math.round(rendered.blob.size > 0 ? editedDurationMs(input.edits, current.durationMs) : current.durationMs),
        width: rendered.width, height: rendered.height, thumbnail: rendered.thumbnail,
        title: input.title, description: input.description, slug: input.slug, edits: input.edits,
        onProgress: (percent) => dispatch({ type: "UPLOAD_PROGRESS", percent }),
        onSlug: (url) => {
          reservedSlug = url.slice(url.lastIndexOf("/") + 1);
          navigator.clipboard.writeText(url).then(() => { copiedRef.current = true; }).catch(() => {});
        },
      });
      if (reservedSlug && result.slug !== reservedSlug) copiedRef.current = false;
      dispatch({ type: "UPLOAD_DONE", videoId: result.id, shareUrl: result.url });
      router.push(`/library/${result.id}${copiedRef.current ? "?new=1" : ""}`);
    } catch (err) {
      dispatch({ type: "UPLOAD_FAILED", error: err instanceof Error ? err.message : "Upload failed. Please try again." });
    }
  }, [router, teardown]);

  const cancelRender = useCallback(() => renderAbortRef.current?.abort(), []);
```

with the helper at module level:

```ts
import { editedDuration } from "@/lib/editor/cuts";
const editedDurationMs = (edits: VideoEdits, durationMs: number) => editedDuration(edits, durationMs / 1000) * 1000;
```

- [ ] **Step 11: Leave-page guard, HUD push, actions, return**

- Guard: `"review"` → `"staging"`, add `state.status === "rendering"`.
- HUD push: `"review"` → `"staging"`, add `"rendering"` to both lists; drop `bubbleVisible`; drop it from the effect deps.
- Delete the "Polled rather than pushed" dimensions effect.
- `actions`: remove `upload`, `setBubble`'s compositor branch (keep the dispatch), add `finish: (input: FinishInput) => void finish(input)`, `cancelRender`.
- Return `{ state, capabilities, desktop, screenVideoRef, cameraVideoRef, staging, getLevel, actions }`.

- [ ] **Step 12: Desktop bridge**

In `src/lib/recording/desktop-bridge.ts` delete `onDesktopBubbleMove`, `onDesktopBubbleAppearance`, `setDesktopBubbleVisible`, `setDesktopBubbleAppearance`, `setDesktopRecordingActive`, `setDesktopCameraDevice` and their type imports. Update `desktop-bridge.test.ts` to drop the tests for those functions.

- [ ] **Step 13: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors only in `recorder.tsx`, `preview-stage.tsx`, `camera-bubble-controls.tsx`, and the missing `@/lib/editor/export` (Tasks 9–11). Run `npm test -- src/lib/recording` and expect PASS.

- [ ] **Step 14: Commit**

```bash
git add src/lib/recording
git commit -m "feat(recorder): record raw screen and camera files; render+upload in finish()"
```

---

### Task 8: Renderer — `drawFrame`

**Files:**
- Create: `src/lib/editor/render.ts`
- Test: `src/lib/editor/render.test.ts`

- [ ] **Step 1: Write the failing test**

The test drives `drawFrame` with a recording `CanvasRenderingContext2D` stub and fake video sources.

```ts
import { describe, expect, it } from "vitest";
import { parseEdits } from "@/lib/edits";
import { defaultCameraTrack } from "./camera-track";
import { drawFrame, outputSize, type RenderInputs } from "./render";

type Call = [string, unknown[]];
function fakeCtx() {
  const calls: Call[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "calls") return calls;
      return (...args: unknown[]) => { calls.push([String(prop), args]); return undefined; };
    },
    set() { return true; },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D & { calls: Call[] };
}
const video = (w: number, h: number) => ({ videoWidth: w, videoHeight: h, readyState: 4 }) as unknown as HTMLVideoElement;

const base = parseEdits({ version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] });

describe("outputSize", () => {
  it("matches the source with framing off and pads with it on", () => {
    expect(outputSize(1920, 1080, base)).toEqual({ width: 1920, height: 1080 });
    const framed = { ...base, frame: { enabled: true, padding: 0.05, radius: 0.01, shadow: false, background: { kind: "color" as const, color: "#000" } } };
    expect(outputSize(1920, 1080, framed)).toEqual({ width: 2112, height: 1272 });
  });
});

describe("drawFrame", () => {
  const inputs = (edits = base): RenderInputs => ({
    screen: video(1920, 1080), camera: video(1280, 720), mode: "screen+camera",
    edits, background: null,
  });
  it("draws the screen, then the camera clipped, then overlays", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: defaultCameraTrack("circle", "medium", 16 / 9),
      overlays: [{ type: "blur" as const, start: 0, end: 5, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }] };
    drawFrame(ctx, inputs(e), 1, 1920, 1080);
    const names = ctx.calls.map((c) => c[0]);
    const firstDraw = names.indexOf("drawImage");
    expect(firstDraw).toBeGreaterThanOrEqual(0);
    expect(names.filter((n) => n === "drawImage").length).toBeGreaterThanOrEqual(3); // screen, camera, blur scratch
    expect(names.indexOf("clip")).toBeGreaterThan(firstDraw);
  });
  it("draws the zoomed source region when a zoom is active", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: null, zooms: [{ start: 0, end: 10, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, ramp: 0 }] };
    drawFrame(ctx, inputs(e), 5, 1920, 1080);
    const draw = ctx.calls.find((c) => c[0] === "drawImage")!;
    expect(draw[1].slice(1, 5)).toEqual([480, 270, 960, 540]);
  });
  it("skips overlays outside their span and the camera when the track is null", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: null, overlays: [{ type: "blur" as const, start: 5, end: 6, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } }] };
    drawFrame(ctx, inputs(e), 1, 1920, 1080);
    expect(ctx.calls.filter((c) => c[0] === "drawImage")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/editor/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { Overlay, Rect, VideoEdits } from "@/lib/edits";
import { computeFrameLayout, coverCrop, shapeRadius } from "@/lib/recording/geometry";
import type { BackgroundConfig, RecordingMode } from "@/lib/recording/types";
import { cameraAt } from "./camera-track";
import { FULL_RECT, toOutput, zoomAt } from "./zoom";

export type DrawableSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

export interface RenderInputs {
  screen: HTMLVideoElement | null;
  camera: HTMLVideoElement | null;
  mode: RecordingMode;
  edits: VideoEdits;
  /** Decoded frame background media (image or looping video), or null for none/colour. */
  background: HTMLImageElement | HTMLVideoElement | null;
}

/** The output canvas size for a source of `w`×`h`. */
export function outputSize(w: number, h: number, edits: VideoEdits): { width: number; height: number } {
  if (!edits.frame?.enabled) return { width: w + (w % 2), height: h + (h % 2) };
  const l = computeFrameLayout(w, h, edits.frame);
  return { width: l.canvasW, height: l.canvasH };
}

function primary(inputs: RenderInputs): HTMLVideoElement | null {
  return inputs.mode === "camera" ? inputs.camera : inputs.screen;
}

function roundedPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (rr > 0 && "roundRect" in p) (p as Path2D & { roundRect: Function }).roundRect(x, y, w, h, rr);
  else p.rect(x, y, w, h);
  return p;
}

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, cfg: BackgroundConfig | undefined, media: RenderInputs["background"]) {
  ctx.fillStyle = cfg?.color ?? "#1a1a1e";
  ctx.fillRect(0, 0, W, H);
  if (!media || !cfg || (cfg.kind !== "image" && cfg.kind !== "video")) return;
  const mw = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const mh = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (mw <= 0 || mh <= 0) return;
  const c = coverCrop(mw, mh, W, H);
  ctx.drawImage(media, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
}

let scratch: HTMLCanvasElement | null = null;
function scratchCanvas(): HTMLCanvasElement {
  if (!scratch) scratch = document.createElement("canvas");
  return scratch;
}

function drawOverlay(ctx: CanvasRenderingContext2D, o: Overlay, t: number, content: Rect, W: number) {
  const x = content.x + o.rect.x * content.w;
  const y = content.y + o.rect.y * content.h;
  const w = o.rect.w * content.w;
  const h = o.rect.h * content.h;
  const color = o.color ?? "#f5c542";
  ctx.save();
  switch (o.type) {
    case "blur": {
      // Downscale the region 8× into a scratch canvas and draw it back up: cheap
      // and works without ctx.filter. Fail closed: if anything is missing, fill.
      const s = typeof document !== "undefined" ? scratchCanvas() : null;
      const sctx = s?.getContext("2d");
      if (s && sctx && w >= 8 && h >= 8) {
        s.width = Math.max(1, Math.round(w / 8)); s.height = Math.max(1, Math.round(h / 8));
        sctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, s.width, s.height);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(s, 0, 0, s.width, s.height, x, y, w, h);
      } else {
        ctx.fillStyle = "#3a3a40"; ctx.fillRect(x, y, w, h);
      }
      break;
    }
    case "highlight":
      ctx.globalAlpha = 0.35; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); break;
    case "underline":
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, W * 0.003);
      ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke(); break;
    case "callout": {
      const r = Math.max(w, h) / 2;
      const cx = x + w / 2, cy = y + h / 2;
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, W * 0.004);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      const badge = Math.max(18, W * 0.018);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx + r * 0.75, cy - r * 0.75, badge / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111"; ctx.font = `bold ${badge * 0.65}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(o.n ?? ""), cx + r * 0.75, cy - r * 0.75);
      break;
    }
    case "click": {
      const p = Math.min(1, (t - o.start) / Math.max(0.05, o.end - o.start));
      const cx = x + w / 2, cy = y + h / 2;
      ctx.globalAlpha = 1 - p; ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, W * 0.003);
      ctx.beginPath(); ctx.arc(cx, cy, W * 0.01 + p * W * 0.03, 0, Math.PI * 2); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * Draw one frame at source time `t` into a `W`×`H` context. Pure with respect
 * to the inputs: the preview and the export both call exactly this.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, inputs: RenderInputs, t: number, W: number, H: number): void {
  const src = primary(inputs);
  const sw = src?.videoWidth ?? 0, sh = src?.videoHeight ?? 0;
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  if (!src || sw <= 0 || sh <= 0) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.restore(); return; }

  const frame = inputs.edits.frame;
  const framed = frame?.enabled === true;
  // Zoom: the part of the source that fills the content box this frame.
  const view = zoomAt(inputs.edits.zooms, t);
  const sx = view.x * sw, sy = view.y * sh, svw = view.w * sw, svh = view.h * sh;
  let content: Rect;
  if (framed && frame) {
    const layout = computeFrameLayout(sw, sh, frame);
    const scale = Math.min(W / layout.canvasW, H / layout.canvasH);
    content = { x: layout.dest.x * scale, y: layout.dest.y * scale, w: layout.dest.w * scale, h: layout.dest.h * scale };
    const radius = layout.radius * scale;
    drawBackground(ctx, W, H, frame.background, inputs.background);
    if (frame.shadow) {
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = W * 0.02; ctx.shadowOffsetY = W * 0.008;
      ctx.fillStyle = "#000"; ctx.fill(roundedPath(content.x, content.y, content.w, content.h, radius)); ctx.restore();
    }
    ctx.save(); ctx.clip(roundedPath(content.x, content.y, content.w, content.h, radius));
    ctx.drawImage(src, sx, sy, svw, svh, content.x, content.y, content.w, content.h); ctx.restore();
  } else {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const scale = Math.min(W / sw, H / sh);
    content = { x: (W - sw * scale) / 2, y: (H - sh * scale) / 2, w: sw * scale, h: sh * scale };
    ctx.drawImage(src, sx, sy, svw, svh, content.x, content.y, content.w, content.h);
  }

  // Camera (screen+camera only; camera-only mode already drew the camera as `src`).
  const cam = inputs.camera;
  const track = inputs.edits.camera;
  if (inputs.mode === "screen+camera" && cam && track && cam.videoWidth > 0) {
    const s = cameraAt(track, t);
    const drawCam = (mode: "bubble" | "full", rect: Rect, alpha: number) => {
      const box = mode === "full"
        ? content
        : { x: content.x + rect.x * content.w, y: content.y + rect.y * content.h, w: rect.w * content.w, h: rect.h * content.h };
      if (box.w < 1 || box.h < 1) return;
      const crop = coverCrop(cam.videoWidth, cam.videoHeight, box.w, box.h);
      const r = mode === "full" ? 0 : shapeRadius(track.shape, box.w, box.h);
      ctx.save(); ctx.globalAlpha = alpha; ctx.clip(roundedPath(box.x, box.y, box.w, box.h, r));
      if (track.mirror) { ctx.translate(box.x + box.w, box.y); ctx.scale(-1, 1); ctx.drawImage(cam, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, box.w, box.h); }
      else ctx.drawImage(cam, crop.sx, crop.sy, crop.sw, crop.sh, box.x, box.y, box.w, box.h);
      ctx.restore();
      if (mode === "bubble") { ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = Math.max(2, W * 0.0015); ctx.stroke(roundedPath(box.x, box.y, box.w, box.h, r)); ctx.restore(); }
    };
    if (s.fromMode && s.fade < 1) { drawCam(s.fromMode, s.rect, 1 - s.fade); drawCam(s.mode, s.rect, s.fade); }
    else drawCam(s.mode, s.rect, 1);
  }

  // Overlays live on source pixels, so they move with the zoom; the bubble did not.
  for (const o of inputs.edits.overlays) {
    if (t < o.start || t > o.end) continue;
    const mapped = view === FULL_RECT ? o : { ...o, rect: toOutput(o.rect, view) };
    drawOverlay(ctx, mapped, t, content, W);
  }
  ctx.restore();
}
```

The test's fake ctx has no `.canvas`, so guard the blur branch: `const source = (ctx as { canvas?: HTMLCanvasElement }).canvas; if (s && sctx && source && w >= 8 && h >= 8)`. In node, `document` is undefined, so the blur falls to the solid fill; the test counts `drawImage` calls "≥ 3" — adjust that expectation to `>= 2` (screen + camera) since the blur fallback fills instead. Update the test comment accordingly.

`shapeRadius` and `coverCrop` come from `geometry.ts`; check their signatures with `grep -n "export function shapeRadius\|export function coverCrop" src/lib/recording/geometry.ts`.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/editor/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/render.ts src/lib/editor/render.test.ts
git commit -m "feat(editor): one drawFrame for preview and export"
```

---

### Task 9: Export — `renderToBlob`

**Files:**
- Create: `src/lib/editor/export.ts`

No node test is possible (needs `MediaRecorder`, `captureStream`); verified in Task 20's manual checklist. Keep it small and obviously correct.

- [ ] **Step 1: Implement**

```ts
import fixWebmDuration from "fix-webm-duration";
import type { VideoEdits } from "@/lib/edits";
import type { RecordingMode } from "@/lib/recording/types";
import { editedToSource, keptRanges } from "./cuts";
import { drawFrame, outputSize, type RenderInputs } from "./render";

export interface RenderSources {
  screen: Blob | null;
  camera: Blob | null;
  mode: RecordingMode;
  durationMs: number;
}

export interface RenderOptions {
  /** Edited-timeline second for the thumbnail. */
  thumbnailAt: number;
  onProgress: (percent: number) => void;
  signal: AbortSignal;
  fps?: number;
}

export interface RenderResult { blob: Blob; thumbnail: Blob | null; width: number; height: number }

const CODECS = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

function makeVideo(blob: Blob, muted: boolean): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.src = URL.createObjectURL(blob);
    el.muted = muted; el.playsInline = true; el.preload = "auto";
    el.onloadedmetadata = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode the recording."));
  });
}

function seek(el: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(el.currentTime - t) < 0.02) return resolve();
    el.addEventListener("seeked", () => resolve(), { once: true });
    el.currentTime = t;
  });
}

export async function loadBackground(edits: VideoEdits): Promise<HTMLImageElement | HTMLVideoElement | null> {
  const bg = edits.frame?.enabled ? edits.frame.background : undefined;
  if (!bg?.src || (bg.kind !== "image" && bg.kind !== "video")) return null;
  if (bg.kind === "video") {
    const v = document.createElement("video");
    v.src = bg.src; v.loop = true; v.muted = true; v.playsInline = true; v.crossOrigin = "anonymous";
    await v.play().catch(() => {});
    return v;
  }
  const img = new Image(); img.crossOrigin = "anonymous"; img.src = bg.src;
  await img.decode().catch(() => {});
  return img;
}

/**
 * Plays the kept ranges once in real time, drawing every frame through
 * `drawFrame` into an offscreen canvas that a MediaRecorder encodes.
 */
export async function renderToBlob(sources: RenderSources, edits: VideoEdits, opts: RenderOptions): Promise<RenderResult> {
  const fps = opts.fps ?? 30;
  const primaryBlob = sources.mode === "camera" ? sources.camera : sources.screen;
  if (!primaryBlob) throw new Error("Nothing to render.");
  const primary = await makeVideo(primaryBlob, false);
  const camera = sources.mode === "screen+camera" && sources.camera ? await makeVideo(sources.camera, true) : null;
  const background = await loadBackground(edits);
  const duration = sources.durationMs / 1000;
  const offset = (edits.cameraOffsetMs ?? 0) / 1000;

  const { width, height } = outputSize(primary.videoWidth, primary.videoHeight, edits);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("No 2D context.");

  const inputs: RenderInputs = {
    screen: sources.mode === "camera" ? null : primary,
    camera: sources.mode === "camera" ? primary : camera,
    mode: sources.mode, edits, background,
  };

  const stream = canvas.captureStream(fps);
  const audioStream = (primary as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
  audioStream?.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mimeType = CODECS.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 10_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const ranges = keptRanges(edits, duration);
  const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
  if (total <= 0) throw new Error("Everything is cut. Keep at least part of the take.");
  let done = 0;
  let thumbnail: Blob | null = null;
  const thumbSource = editedToSource(edits, duration, opts.thumbnailAt);

  const cleanup = () => {
    primary.pause(); camera?.pause();
    URL.revokeObjectURL(primary.src); if (camera) URL.revokeObjectURL(camera.src);
    stream.getTracks().forEach((t) => t.stop());
  };

  try {
    recorder.start(250);
    recorder.pause();
    for (const r of ranges) {
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      await seek(primary, r.start);
      if (camera) await seek(camera, Math.max(0, r.start + offset));
      recorder.resume();
      await primary.play();
      if (camera) await camera.play().catch(() => {});
      await new Promise<void>((resolve, reject) => {
        let raf = 0;
        const tick = () => {
          if (opts.signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
          const t = primary.currentTime;
          if (camera && Math.abs(camera.currentTime - (t + offset)) > 0.08) camera.currentTime = Math.max(0, t + offset);
          drawFrame(ctx, inputs, t, width, height);
          if (!thumbnail && t >= thumbSource) {
            canvas.toBlob((b) => { thumbnail = b; }, "image/jpeg", 0.8);
          }
          opts.onProgress(Math.min(99, Math.round(((done + (t - r.start)) / total) * 100)));
          if (t >= r.end || primary.ended) return resolve();
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        opts.signal.addEventListener("abort", () => cancelAnimationFrame(raf), { once: true });
      });
      primary.pause(); camera?.pause();
      recorder.pause();
      done += r.end - r.start;
    }
    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
    recorder.stop();
    await stopped;
  } catch (err) {
    if (recorder.state !== "inactive") { recorder.ondataavailable = null; recorder.stop(); }
    cleanup();
    throw err;
  }
  cleanup();

  const type = recorder.mimeType?.split(";")[0] || "video/webm";
  let blob = new Blob(chunks, { type });
  try { blob = await fixWebmDuration(blob, Math.round(total * 1000), { logger: false }); } catch { /* keep raw */ }
  if (!thumbnail) {
    drawFrame(ctx, inputs, thumbSource, width, height);
    thumbnail = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.8));
  }
  opts.onProgress(100);
  return { blob, thumbnail, width, height };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `@/lib/editor/export` resolves; remaining errors only in the recorder UI files.

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/export.ts
git commit -m "feat(editor): real-time export through drawFrame into a MediaRecorder"
```

---

### Task 10: Staging player hook

**Files:**
- Create: `src/lib/editor/use-staging-player.ts`

- [ ] **Step 1: Implement**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoEdits } from "@/lib/edits";
import type { RecordingMode } from "@/lib/recording/types";
import { editedDuration, editedToSource, keptRanges, sourceToEdited } from "./cuts";
import { drawFrame, outputSize, type RenderInputs } from "./render";
import { loadBackground } from "./export";

export interface StagingPlayer {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Source time, seconds. */
  time: number;
  editedTime: number;
  editedDuration: number;
  playing: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Seek to a SOURCE time. */
  seek(t: number): void;
  /** Seek to an EDITED time. */
  seekEdited(t: number): void;
  step(frames: number): void;
  /** The output size for the current edits (for the preview's aspect box). */
  size: { width: number; height: number };
}

export function useStagingPlayer(
  screenUrl: string | null,
  cameraUrl: string | null,
  mode: RecordingMode,
  durationMs: number,
  edits: VideoEdits,
): StagingPlayer {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const primaryRef = useRef<HTMLVideoElement | null>(null);
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const bgRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [size, setSize] = useState({ width: 16, height: 9 });
  const duration = durationMs / 1000;

  // Hidden decoders.
  useEffect(() => {
    const primary = document.createElement("video");
    primary.src = (mode === "camera" ? cameraUrl : screenUrl) ?? "";
    primary.playsInline = true; primary.preload = "auto";
    primaryRef.current = primary;
    let camera: HTMLVideoElement | null = null;
    if (mode === "screen+camera" && cameraUrl) {
      camera = document.createElement("video");
      camera.src = cameraUrl; camera.muted = true; camera.playsInline = true; camera.preload = "auto";
      cameraRef.current = camera;
    }
    primary.onloadedmetadata = () => setSize(outputSize(primary.videoWidth, primary.videoHeight, editsRef.current));
    primary.onended = () => setPlaying(false);
    return () => { primary.pause(); camera?.pause(); primaryRef.current = null; cameraRef.current = null; };
  }, [screenUrl, cameraUrl, mode]);

  useEffect(() => {
    const p = primaryRef.current;
    if (p && p.videoWidth > 0) setSize(outputSize(p.videoWidth, p.videoHeight, edits));
    let alive = true;
    void loadBackground(edits).then((bg) => { if (alive) bgRef.current = bg; });
    return () => { alive = false; };
  }, [edits.frame]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw loop: runs always (paused frames re-draw when edits change).
  useEffect(() => {
    let raf = 0;
    const offset = () => (editsRef.current.cameraOffsetMs ?? 0) / 1000;
    const tick = () => {
      const canvas = canvasRef.current, p = primaryRef.current;
      if (canvas && p) {
        const ctx = canvas.getContext("2d");
        const e = editsRef.current;
        let t = p.currentTime;
        // Skip removed ranges while playing.
        if (!p.paused) {
          const kept = keptRanges(e, duration);
          const inside = kept.find((r) => t >= r.start && t < r.end);
          if (!inside) {
            const next = kept.find((r) => r.start > t);
            if (next) { p.currentTime = next.start; t = next.start; }
            else { p.pause(); setPlaying(false); }
          }
        }
        const cam = cameraRef.current;
        if (cam && Math.abs(cam.currentTime - (t + offset())) > 0.08) cam.currentTime = Math.max(0, t + offset());
        if (cam && !p.paused && cam.paused) void cam.play().catch(() => {});
        if (cam && p.paused && !cam.paused) cam.pause();
        if (ctx && canvas.width > 0) {
          const inputs: RenderInputs = {
            screen: mode === "camera" ? null : p, camera: mode === "camera" ? p : cam, mode, edits: e, background: bgRef.current,
          };
          drawFrame(ctx, inputs, t, canvas.width, canvas.height);
        }
        setTime((prev) => (Math.abs(prev - t) > 1 / 120 ? t : prev));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, mode]);

  const seek = useCallback((t: number) => {
    const p = primaryRef.current; if (!p) return;
    p.currentTime = Math.max(0, Math.min(duration, t));
    setTime(p.currentTime);
  }, [duration]);
  const seekEdited = useCallback((t: number) => seek(editedToSource(editsRef.current, duration, t)), [seek, duration]);
  const play = useCallback(() => {
    const p = primaryRef.current; if (!p) return;
    const kept = keptRanges(editsRef.current, duration);
    if (kept.length && !kept.some((r) => p.currentTime >= r.start && p.currentTime < r.end)) {
      const next = kept.find((r) => r.start > p.currentTime) ?? kept[0];
      p.currentTime = next.start;
    }
    void p.play().then(() => setPlaying(true)).catch(() => {});
  }, [duration]);
  const pause = useCallback(() => { primaryRef.current?.pause(); setPlaying(false); }, []);
  const toggle = useCallback(() => (primaryRef.current?.paused ? play() : pause()), [play, pause]);
  const step = useCallback((frames: number) => { pause(); seek((primaryRef.current?.currentTime ?? 0) + frames / 30); }, [pause, seek]);

  return {
    canvasRef, time, playing, play, pause, toggle, seek, seekEdited, step, size,
    editedTime: sourceToEdited(edits, duration, time),
    editedDuration: editedDuration(edits, duration),
  };
}
```

- [ ] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit -p tsconfig.json` (no new errors from this file).

```bash
git add src/lib/editor/use-staging-player.ts
git commit -m "feat(editor): staging playback hook with synced camera and cut skipping"
```

---

### Task 11: Recorder UI — raw previews, shape/size picker, mount staging

**Files:**
- Modify: `src/components/recorder.tsx`, `src/components/recorder/preview-stage.tsx`, `src/components/recorder/camera-bubble-controls.tsx`
- Delete: `src/components/recorder/review.tsx`, `src/components/recorder/bubble-drag-overlay.tsx`
- Move: `src/components/recorder/frame-picker.tsx` → `src/components/staging/frame-picker.tsx`
- Create: `src/components/staging/staging.tsx` (placeholder in this task; filled in Task 12)

- [ ] **Step 1: `preview-stage.tsx`**

Replace the props and body:

```tsx
interface PreviewStageProps {
  mode: RecordingMode;
  status: string;
  elapsedMs: number;
  markFlash?: boolean;
  screenVideoRef: RefObject<HTMLVideoElement | null>;
  cameraVideoRef: RefObject<HTMLVideoElement | null>;
}
```

Body: the outer div as before but `showStage = status !== "idle" && status !== "acquiring" && status !== "staging" && status !== "rendering"`. Inside: the screen `<video ref={screenVideoRef}>` full-size when `mode !== "camera"`; the camera `<video ref={cameraVideoRef} muted playsInline autoPlay>` full-size when `mode === "camera"`, otherwise a `w-32 aspect-video` thumbnail absolutely positioned bottom-right with `rounded-lg border border-border` and the mirrored look (`style={{ transform: "scaleX(-1)" }}`), labelled with a tiny "camera · placed after recording" caption. Keep the REC chip. Remove `BubbleDragOverlay` and the canvas.

- [ ] **Step 2: `camera-bubble-controls.tsx`**

Drop the visibility switch and the `full` shape option (full-screen is a staging keyframe now). Keep shape (circle/rounded/square/portrait) and size. Title the box "Camera bubble default" with a caption "You place it after recording."

- [ ] **Step 3: `recorder.tsx`**

- Destructure `{ state, capabilities, desktop, screenVideoRef, cameraVideoRef, staging, getLevel, actions }`.
- Remove the `FramePicker` import and block. Remove `Review` import.
- Add `const Staging = dynamic(() => import("./staging/staging").then((m) => m.Staging), { ssr: false });` (`import dynamic from "next/dynamic"`).
- Replace the `state.status === "uploading"` early-return with one covering both `rendering` and `uploading`, showing `state.renderProgress` labelled "Rendering" with a Cancel button calling `actions.cancelRender()`, or `state.uploadProgress` labelled "Uploading".
- Replace the `state.status === "review" ? <Review …/>` branch with:

```tsx
      {state.status === "staging" && staging ? (
        <Staging
          mode={state.mode}
          screenUrl={staging.screenUrl}
          cameraUrl={staging.cameraUrl}
          durationMs={state.durationMs}
          cameraOffsetMs={state.cameraOffsetMs}
          markers={state.markers}
          defaults={{ bubble: state.bubble, frame: state.frame }}
          error={state.error}
          onFinish={actions.finish}
          onDiscard={actions.discard}
        />
      ) : ( …existing configure/capture UI… )}
```

- Pass `screenVideoRef`/`cameraVideoRef` to `PreviewStage`; drop the removed props. The PreviewStage must stay mounted (hidden) during staging so the refs survive; it already hides via `showStage`.
- The hotkey hint line: drop the "floating controls" phrasing to "the controls pill".

- [ ] **Step 4: Placeholder `staging.tsx`** so the tree compiles:

```tsx
"use client";
import type { Marker, VideoEdits } from "@/lib/edits";
import type { FinishInput } from "@/lib/recording/use-recorder";
import type { BubbleConfig, FrameConfig, RecordingMode } from "@/lib/recording/types";

export interface StagingProps {
  mode: RecordingMode;
  screenUrl: string | null;
  cameraUrl: string | null;
  durationMs: number;
  cameraOffsetMs: number;
  markers: Marker[];
  defaults: { bubble: BubbleConfig; frame: FrameConfig };
  error: string;
  onFinish: (input: FinishInput) => void;
  onDiscard: () => void;
}
export function Staging(_props: StagingProps) { return <div>Staging</div>; }
```

- [ ] **Step 5: Move and fix the frame picker**

`git mv src/components/recorder/frame-picker.tsx src/components/staging/frame-picker.tsx`; remove the `locked` prop and every `disabled={locked}`. `git rm src/components/recorder/review.tsx src/components/recorder/bubble-drag-overlay.tsx`.

- [ ] **Step 6: Type-check, lint, run the app**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: clean. Then `npm run dev`, open `http://localhost:3000`, set up a screen+camera recording, confirm the raw screen preview and the camera thumbnail show, record 5 s, stop, and see the "Staging" placeholder.

- [ ] **Step 7: Commit**

```bash
git add -A src/components
git commit -m "feat(recorder): raw previews, bubble defaults only, staging mount point"
```

---

### Task 12: Staging screen — state, undo, layout, keys

**Files:**
- Modify: `src/components/staging/staging.tsx`
- Create: `src/components/staging/preview.tsx`, `src/components/staging/timeline.tsx`, `src/components/staging/rail.tsx`, `src/components/staging/details-form.tsx`

This task builds the shell with a working preview and timeline; Tasks 13–15 fill the rail sections.

- [ ] **Step 1: `staging.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseEdits, type Overlay, type VideoEdits } from "@/lib/edits";
import { defaultCameraTrack } from "@/lib/editor/camera-track";
import * as ops from "@/lib/editor/edit-ops";
import { canRedo, canUndo, createHistory, push, redo, undo, type History } from "@/lib/editor/undo";
import { useStagingPlayer } from "@/lib/editor/use-staging-player";
import { defaultRecordingTitle } from "@/lib/recording/upload";
import { Preview } from "./preview";
import { Timeline } from "./timeline";
import { Rail, type RailSection } from "./rail";
import type { StagingProps } from "./types";

export type { StagingProps } from "./types";

export type Details = { title: string; description: string; slug: string; thumbnailAt: number };
export type Tool = "select" | "blur" | "callout" | "highlight" | "underline" | "zoom";

const STORAGE_KEY = "yoom.staging.v1";

function initialEdits(p: StagingProps, screenAspect: number): VideoEdits {
  const base = parseEdits({ version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: p.markers });
  base.cameraOffsetMs = p.cameraOffsetMs;
  base.frame = p.defaults.frame;
  base.camera = p.mode === "screen+camera" ? defaultCameraTrack(p.defaults.bubble.shape, p.defaults.bubble.size, screenAspect) : null;
  return base;
}

export function Staging(props: StagingProps) {
  const [history, setHistory] = useState<History<VideoEdits>>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) { const j = JSON.parse(saved); if (j.durationMs === props.durationMs) return createHistory(parseEdits(j.edits)); }
    } catch { /* fresh */ }
    return createHistory(initialEdits(props, 16 / 9));
  });
  const edits = history.present;
  const [details, setDetails] = useState<Details>(() => {
    try { const j = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null"); if (j?.details) return j.details; } catch { /* fresh */ }
    return { title: defaultRecordingTitle(), description: "", slug: "", thumbnailAt: 1 };
  });
  const [section, setSection] = useState<RailSection>("trim");
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<Selection>(null);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);

  const player = useStagingPlayer(props.screenUrl, props.cameraUrl, props.mode, props.durationMs, edits);
  const duration = props.durationMs / 1000;

  // Once the real aspect is known, rebuild the default bubble if it is untouched.
  useEffect(() => {
    if (player.size.width <= 16 || !edits.camera || edits.camera.keyframes.length !== 1) return;
    const aspect = player.size.width / player.size.height;
    setHistory((h) => ({ ...h, present: ops.setCamera(h.present, defaultCameraTrack(edits.camera!.shape, props.defaults.bubble.size, aspect)) }));
  }, [player.size.width, player.size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ durationMs: props.durationMs, edits, details })); } catch { /* ignore */ }
  }, [edits, details, props.durationMs]);

  const apply = useCallback((fn: (e: VideoEdits) => VideoEdits) => setHistory((h) => push(h, fn(h.present))), []);
  /** Live drags update `present` without a history entry; call `commit` on release. */
  const applyLive = useCallback((fn: (e: VideoEdits) => VideoEdits) => setHistory((h) => ({ ...h, present: fn(h.present) })), []);
  const commit = useCallback((from: VideoEdits) => setHistory((h) => (h.present === from ? h : { past: [...h.past, from].slice(-50), present: h.present, future: [] })), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); setHistory((h) => (e.shiftKey ? redo(h) : undo(h))); return; }
      if (e.key === " ") { e.preventDefault(); player.toggle(); return; }
      if (e.key === ",") player.step(-1);
      if (e.key === ".") player.step(1);
      if (e.key.toLowerCase() === "i") setInPoint(player.time);
      if (e.key.toLowerCase() === "o") setOutPoint(player.time);
      if (e.key.toLowerCase() === "c" && inPoint !== null && outPoint !== null) {
        apply((ed) => ops.addCut(ed, { start: Math.min(inPoint, outPoint), end: Math.max(inPoint, outPoint) }));
        setInPoint(null); setOutPoint(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        if (selected.kind === "overlay") apply((ed) => ops.removeOverlay(ed, selected.index));
        if (selected.kind === "cut") apply((ed) => ops.removeCut(ed, selected.index));
        if (selected.kind === "zoom") apply((ed) => ops.removeZoom(ed, selected.index));
        if (selected.kind === "keyframe" && selected.t !== undefined) apply((ed) => ops.removeCameraKeyframe(ed, selected.t!));
        setSelected(null);
      }
      if (e.key === "Escape") { setTool("select"); setSelected(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply, inPoint, outPoint, player, selected]);

  const addOverlayAt = useCallback((type: Overlay["type"], rect: Overlay["rect"]) => {
    const start = inPoint !== null && outPoint !== null ? Math.min(inPoint, outPoint) : player.time;
    const end = inPoint !== null && outPoint !== null ? Math.max(inPoint, outPoint) : Math.min(duration, player.time + 3);
    apply((ed) => ops.addOverlay(ed, { type, start, end, rect }));
    setSelected({ kind: "overlay", index: edits.overlays.length });
    setTool("select");
  }, [apply, duration, edits.overlays.length, inPoint, outPoint, player.time]);

  const addZoomAt = useCallback((rect: Overlay["rect"]) => {
    const start = inPoint !== null && outPoint !== null ? Math.min(inPoint, outPoint) : player.time;
    const end = inPoint !== null && outPoint !== null ? Math.max(inPoint, outPoint) : Math.min(duration, player.time + 3);
    apply((ed) => ops.addZoom(ed, { start, end, rect }));
    setTool("select");
  }, [apply, duration, inPoint, outPoint, player.time]);

  const finish = useCallback(() => {
    props.onFinish({ edits, title: details.title, description: details.description, slug: details.slug, thumbnailAt: details.thumbnailAt });
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, [details, edits, props]);

  const discard = useCallback(() => {
    if (!window.confirm("Discard this take? Both recordings are thrown away.")) return;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    props.onDiscard();
  }, [props]);

  const ctx = useMemo(() => ({
    edits, apply, applyLive, commit, player, duration, mode: props.mode, tool, setTool, selected, setSelected,
    inPoint, outPoint, setInPoint, setOutPoint, details, setDetails, addOverlayAt, addZoomAt, finish, discard, error: props.error,
    canUndo: canUndo(history), canRedo: canRedo(history),
    undo: () => setHistory(undo), redo: () => setHistory(redo),
  }), [edits, apply, applyLive, commit, player, duration, props.mode, props.error, tool, selected, inPoint, outPoint, details, addOverlayAt, addZoomAt, finish, discard, history]);

  return (
    <div className="grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <Preview ctx={ctx} />
        <Timeline ctx={ctx} />
      </div>
      <Rail ctx={ctx} section={section} onSection={setSection} />
    </div>
  );
}

export type StagingContext = ReturnType<typeof useStagingContextType>;
// Helper only for the type above; never called.
function useStagingContextType() { return null as unknown as Parameters<typeof Preview>[0]["ctx"]; }
```

Define the shared context type explicitly instead of the helper at the bottom — put this in `src/components/staging/types.ts` along with `StagingProps` (moved from the placeholder):

```ts
import type { Overlay, VideoEdits } from "@/lib/edits";
import type { StagingPlayer } from "@/lib/editor/use-staging-player";
import type { FinishInput } from "@/lib/recording/use-recorder";
import type { BubbleConfig, FrameConfig, RecordingMode } from "@/lib/recording/types";
import type { Marker } from "@/lib/edits";

export interface StagingProps { /* as in Task 11 */ }
export type Details = { title: string; description: string; slug: string; thumbnailAt: number };
export type Tool = "select" | "blur" | "callout" | "highlight" | "underline" | "zoom";
export type Selection = { kind: "overlay" | "cut" | "keyframe" | "zoom"; index: number; t?: number } | null;

export interface StagingContext {
  edits: VideoEdits;
  apply(fn: (e: VideoEdits) => VideoEdits): void;
  applyLive(fn: (e: VideoEdits) => VideoEdits): void;
  commit(from: VideoEdits): void;
  player: StagingPlayer;
  duration: number;
  mode: RecordingMode;
  tool: Tool; setTool(t: Tool): void;
  selected: Selection; setSelected(s: Selection): void;
  inPoint: number | null; outPoint: number | null;
  setInPoint(t: number | null): void; setOutPoint(t: number | null): void;
  details: Details; setDetails(d: Details | ((d: Details) => Details)): void;
  addOverlayAt(type: Overlay["type"], rect: Overlay["rect"]): void;
  addZoomAt(rect: Overlay["rect"]): void;
  finish(): void; discard(): void; error: string;
  canUndo: boolean; canRedo: boolean; undo(): void; redo(): void;
}
```

and delete the `StagingContext` helper lines from `staging.tsx`, importing the type instead. Every child takes `{ ctx: StagingContext }`.

- [ ] **Step 2: `preview.tsx`** (camera drag + overlay draw come in Tasks 13 and 15; here it is canvas + play button)

```tsx
"use client";
import { useEffect } from "react";
import type { StagingContext } from "./types";
import { CameraLayer } from "./camera-layer";
import { OverlayLayer } from "./overlay-layer";

export function Preview({ ctx }: { ctx: StagingContext }) {
  const { player } = ctx;
  useEffect(() => {
    const c = player.canvasRef.current;
    if (c && (c.width !== player.size.width || c.height !== player.size.height)) { c.width = player.size.width; c.height = player.size.height; }
  }, [player.canvasRef, player.size]);
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border bg-black shadow-lg shadow-black/30"
      style={{ aspectRatio: `${player.size.width} / ${player.size.height}` }}>
      <canvas ref={player.canvasRef} className="h-full w-full" />
      <CameraLayer ctx={ctx} />
      <OverlayLayer ctx={ctx} />
      <button type="button" onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"}
        className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur">
        {player.playing ? "Pause" : "Play"} · space
      </button>
    </div>
  );
}
```

Create `camera-layer.tsx` and `overlay-layer.tsx` as `export function CameraLayer() { return null; }` / `OverlayLayer` placeholders for now.

- [ ] **Step 3: `timeline.tsx`**

One track, 100% wide, in **source** time (simplest for trim/cut/keyframe editing; the readout shows edited time). Elements: trim shading outside `trim`, cut bands (click to select, red when selected), marker ticks, zoom clips on their own lane (select, drag body/edges → `ops.updateZoom`), keyframe diamonds on a lower lane (click selects `{kind:"keyframe", t}`, drag moves in time via `applyLive`/`commit`), overlay clips on a third lane (click selects; drag body moves start/end together; drag either edge resizes), playhead, in/out markers. Pointer math: `t = duration * (clientX - rect.left) / rect.width`. Trim handles at both ends, draggable, calling `ops.setTrim`. Show `fmt(player.editedTime) / fmt(player.editedDuration)` right-aligned. Use `formatElapsed` from `preview-stage.tsx`.

Implement with `onPointerDown` capturing on each element, a `dragRef` describing what is dragged (`{ kind, index, edge?, from: edits }`), and window `pointermove`/`pointerup` listeners added on drag start. Clicking the empty track seeks. Keep the whole file under ~250 lines; it is plain divs with absolute positioning (`left: ${(t / duration) * 100}%`).

- [ ] **Step 4: `rail.tsx`**

```tsx
"use client";
import type { StagingContext } from "./types";
import { TrimSection } from "./sections/trim";
import { CameraSection } from "./sections/camera";
import { FrameSection } from "./sections/frame";
import { ZoomSection } from "./sections/zoom";
import { OverlaysSection } from "./sections/overlays";
import { DetailsForm } from "./details-form";
import { UploadSection } from "./sections/upload";

export type RailSection = "trim" | "camera" | "frame" | "zoom" | "overlays" | "details" | "upload";
const SECTIONS: { id: RailSection; label: string }[] = [
  { id: "trim", label: "Trim & cut" }, { id: "camera", label: "Camera" }, { id: "frame", label: "Frame" },
  { id: "zoom", label: "Zoom" }, { id: "overlays", label: "Overlays" }, { id: "details", label: "Details" }, { id: "upload", label: "Upload" },
];

export function Rail({ ctx, section, onSection }: { ctx: StagingContext; section: RailSection; onSection: (s: RailSection) => void }) {
  return (
    <aside className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex gap-1">
          <button type="button" disabled={!ctx.canUndo} onClick={ctx.undo} className="rounded px-2 py-1 text-xs text-muted disabled:opacity-30">Undo</button>
          <button type="button" disabled={!ctx.canRedo} onClick={ctx.redo} className="rounded px-2 py-1 text-xs text-muted disabled:opacity-30">Redo</button>
        </div>
        <button type="button" onClick={ctx.discard} className="text-xs text-red-400/80 hover:text-red-300">Discard</button>
      </div>
      {SECTIONS.filter((s) => s.id !== "camera" || ctx.mode === "screen+camera").map((s) => (
        <section key={s.id} className="rounded-lg border border-border bg-surface">
          <button type="button" onClick={() => onSection(s.id)} aria-expanded={section === s.id}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-dim">
            {s.label}<span>{section === s.id ? "–" : "+"}</span>
          </button>
          {section === s.id && (
            <div className="border-t border-border p-3">
              {s.id === "trim" && <TrimSection ctx={ctx} />}
              {s.id === "camera" && <CameraSection ctx={ctx} />}
              {s.id === "frame" && <FrameSection ctx={ctx} />}
              {s.id === "zoom" && <ZoomSection ctx={ctx} />}
              {s.id === "overlays" && <OverlaysSection ctx={ctx} />}
              {s.id === "details" && <DetailsForm ctx={ctx} />}
              {s.id === "upload" && <UploadSection ctx={ctx} />}
            </div>
          )}
        </section>
      ))}
    </aside>
  );
}
```

Create each section file under `src/components/staging/sections/` as a stub returning `null` now; they are filled in Tasks 13–15. `details-form.tsx` and `sections/upload.tsx` are filled in Task 15.

- [ ] **Step 5: `TrimSection`** (fill now, it is small)

Buttons: "Set in (I)", "Set out (O)", "Cut in→out (C)" (disabled unless both set), the list of cuts with a remove button each, and a "Reset trim" button. Show the markers list with "Cut 2 s before" / "Cut 2 s after" buttons per marker (`ops.addCut(ed, { start: max(0, t-2), end: t })` etc.).

- [ ] **Step 6: Run the app**

Record a take, reach staging, confirm: canvas plays with sound, space toggles, I/O/C cuts a range, the cut is skipped on playback, ⌘Z undoes it, a reload of the page restores the cut list (edits persist; media does not — the page returns to idle, which is expected).

- [ ] **Step 7: Commit**

```bash
git add src/components/staging
git commit -m "feat(staging): screen shell with preview, timeline, trim/cut, undo, keys"
```

---

### Task 13: Camera section and drag layer

**Files:**
- Modify: `src/components/staging/camera-layer.tsx`, `src/components/staging/sections/camera.tsx`

- [ ] **Step 1: `camera-layer.tsx`**

A transparent absolutely-positioned layer over the canvas, only when `ctx.mode === "screen+camera" && ctx.edits.camera`. Compute the content rect the same way `drawFrame` does (framing on: `computeFrameLayout` scaled to the element size; off: letterboxed), then the bubble box from `cameraAt(track, player.time).rect`. Render a `div` at that box with a dashed outline, `cursor: move`, and one corner handle bottom-right (`cursor: nwse-resize`). In `full` mode render nothing but a small "Full screen" badge.

Drag: on pointerdown capture `from = ctx.edits`, the start pointer position and the start rect. On move, `ctx.applyLive((e) => ops.upsertCameraKeyframe(e, player.time, { rect }))` with the new normalized rect (move: translate; resize: change `w` and derive `h` with `bubbleHeightFor(track.shape, w, contentAspect)`; clamp into 0..1). On pointerup `ctx.commit(from)`. Pause playback on drag start.

- [ ] **Step 2: `sections/camera.tsx`**

- Shape buttons (circle / rounded / square / portrait) → `ops.setCamera(e, { ...e.camera, shape })` and, to keep the pixel box consistent, re-derive `h` on every keyframe with `bubbleHeightFor`.
- Mirror toggle.
- "Full screen at playhead" / "Bubble at playhead" toggle → `ops.upsertCameraKeyframe(e, player.time, { mode })`.
- Size presets S/M/L → keyframe at playhead with `w = SIZE_FRACTION[size]`.
- Keyframe list: time, mode, "Go" (seek) and "Remove" (disabled for t=0).
- Sync slider `-500…500 ms`, step 10 → `ops.setCameraOffset` via `applyLive` on input, `commit` on change.

- [ ] **Step 3: Verify** in the app: drag the bubble at 0 s, seek to 4 s, drag again, scrub between and watch it ease; toggle full screen at 6 s and see the cross-fade; the timeline shows three diamonds.

- [ ] **Step 4: Commit**

```bash
git add src/components/staging
git commit -m "feat(staging): camera keyframes by dragging on the preview"
```

---

### Task 14: Frame and overlays sections, overlay draw layer

**Files:**
- Modify: `src/components/staging/sections/frame.tsx`, `src/components/staging/sections/overlays.tsx`, `src/components/staging/overlay-layer.tsx`

- [ ] **Step 1: `sections/frame.tsx`**

```tsx
import { FramePicker } from "../frame-picker";
import * as ops from "@/lib/editor/edit-ops";
import { DEFAULT_FRAME } from "@/lib/recording/settings";
export function FrameSection({ ctx }: { ctx: StagingContext }) {
  const frame = ctx.edits.frame ?? DEFAULT_FRAME;
  return <FramePicker frame={frame} onChange={(patch) => ctx.apply((e) => ops.setFrame(e, { ...frame, ...patch }))} />;
}
```

The frame picker's uploaded-image path creates a `blob:` URL; keep it (the export loads it; `parseEdits` on the server drops it, which is fine because the rendered file already has the background).

- [ ] **Step 2: `sections/overlays.tsx`**

Tool buttons: Blur, Callout, Highlight, Underline → `ctx.setTool(tool)`; the active one is accented; a hint "drag on the video to draw". When `ctx.selected?.kind === "overlay"`, an inspector: start/end number inputs (step 0.1, `ops.updateOverlay`), colour input (not for blur), callout number input, and Delete.

- [ ] **Step 2b: `sections/zoom.tsx`**

A "Zoom" tool button (`ctx.setTool("zoom")`) with the hint "drag the region to zoom into; it holds for 3 s or the in/out range". "Focus whole take" button: `ctx.addZoomAt` with in/out cleared and `start: 0, end: duration` — implement by calling `ctx.apply((e) => ops.addZoom(e, { start: 0, end: ctx.duration, rect: lastRect }))` where `lastRect` is the selected zoom's rect or the centre half of the frame. When `ctx.selected?.kind === "zoom"`, an inspector: start/end inputs, ramp input (0–2 s, step 0.1) via `ops.updateZoom`, Delete. The list of zooms with "Go" and "Remove".

- [ ] **Step 3: `overlay-layer.tsx`**

Over the canvas: when `ctx.tool !== "select"`, pointerdown starts a rubber-band rect (normalized to the content rect, same math as the camera layer); pointerup with a rect larger than 0.5% in both axes calls `ctx.addOverlayAt(tool, rect)`, or `ctx.addZoomAt(rect)` when `tool === "zoom"`. For zoom, the rubber band is constrained to the source aspect (derive `h` from `w` so the zoomed view is not stretched) and the rect is expressed in **source** space: since a zoom may already be active at the playhead, map the drawn view-space rect back through `zoomAt(edits.zooms, player.time)` (inverse of `toOutput`: `x = view.x + r.x * view.w`, etc.). Overlays drawn while zoomed are mapped the same way so they land on the pixels the user saw. When `tool === "select"`, render each overlay active at `player.time` as an outlined box; click selects, drag moves, corner handle resizes (`applyLive` / `commit`, same pattern as the camera layer). Pointer events on this layer must not swallow the camera layer's when the tool is select: render the overlay layer **below** the camera layer in `preview.tsx` and give the camera bubble box `pointer-events: auto` only over its own rect.

- [ ] **Step 4: Verify**: draw a blur over a region, confirm it renders pixelated on the canvas, spans 3 s on the timeline, selecting and pressing Delete removes it; framing on with the Sunset preset pads the preview. Zoom: drag a region at 2 s, scrub across 1.6–2.4 s and see the ease-in, the hold, and the ease-out at the end; draw a callout while zoomed and confirm it stays on the same pixels after the zoom ends; the bubble does not move with the zoom.

- [ ] **Step 5: Commit**

```bash
git add src/components/staging
git commit -m "feat(staging): frame picker, zoom tool and drag-to-draw overlays"
```

---

### Task 15: Details and upload sections

**Files:**
- Modify: `src/components/staging/details-form.tsx`, `src/components/staging/sections/upload.tsx`

- [ ] **Step 1: `details-form.tsx`**

Title input, description textarea, slug input with a debounced (400 ms) `GET /api/slug?slug=…` check showing "available" / "taken" / "3–40 lowercase letters, numbers or hyphens"; empty slug means "auto". "Use this frame for the thumbnail" button sets `details.thumbnailAt = player.editedTime` and shows the chosen time. Normalise the slug with `normalizeSlug` from `@/lib/slug` as the user types.

- [ ] **Step 2: `sections/upload.tsx`**

Summary line: `fmt(player.editedDuration)` and `size.width × size.height`. Upload button: disabled when the slug check is pending or says "taken", or when `keptRanges` is empty. On click `ctx.finish()`. Show `ctx.error` beneath in red when present (a failed render or upload returns here with the message).

- [ ] **Step 3: Verify end to end**: pick a slug, upload; watch the Rendering bar reach 100%, then Uploading, then land on `/library/[id]` with the toast, the chosen slug in the link, the framed and cut video playing with the bubble in the right places and the blur applied. Download the file from the detail page and confirm the duration equals the edited duration.

- [ ] **Step 4: Commit**

```bash
git add src/components/staging
git commit -m "feat(staging): details, slug check, thumbnail frame and upload"
```

---

### Task 16: Desktop shell — HUD without the camera button

**Files:**
- Modify: `desktop/src/shared/ipc.ts`, `desktop/src/main/hud.ts`, `desktop/src/main/mapping.ts`, `desktop/src/main/mapping.test.ts`, `desktop/src/renderer/hud/index.html`, `desktop/src/renderer/hud/hud.ts`, `desktop/src/renderer/hud/hud.css`

- [ ] **Step 1: Types**

`ipc.ts`: remove `"bubbleToggle"` from `DesktopShortcut` (and its comment); `HudStatus`: `"review"` → `"staging"`, add `"rendering"`; remove `bubbleVisible` from `HudState`.

- [ ] **Step 2: Main**

`hud.ts`: remove `bubbleVisible` from `INITIAL` and `parseHudState`; remove `"bubbleToggle"` from `ACTIONS`; update `STATUSES` for the renamed/added statuses. `mapping.ts`: `grep -n review desktop/src/main/mapping.ts` — rename to `staging` and treat `rendering` like `staging` (recorder window shown). Update the corresponding cases in `mapping.test.ts`.

- [ ] **Step 3: Renderer**

`index.html`: delete the `#camera` button. `hud.ts`: delete the `camera` element lookup, the two `camera.*` lines in `apply`, and the `["camera","bubbleToggle"]` row. `hud.css`: remove any `#camera` rule. If the pill width is hard-coded in `hud.ts` (main) as 320, reduce to 280.

- [ ] **Step 4: Test and run**

Run: `cd desktop && npm run typecheck && npm test`
Expected: PASS. Then `YOOM_DESKTOP_TOKEN="$(grep '^DESKTOP_TOKEN=' ../.env.local | cut -d= -f2-)" npm run dev` with the web dev server up: record a take from the tray, confirm the pill shows pause/stop/mark/discard only, no bubble window appears, and stopping returns to the recorder window in staging.

- [ ] **Step 5: Commit**

```bash
git add desktop/src
git commit -m "feat(desktop): HUD drops the camera toggle; staging/rendering statuses"
```

---

### Task 17: Batch delete server action

**Files:**
- Modify: `src/app/(owner)/actions.ts`
- Test: `src/app/(owner)/actions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ isOwner: vi.fn(async () => true) }));
vi.mock("@/lib/google-drive", () => ({ trashFile: vi.fn(async () => undefined) }));
const softDeleteVideo = vi.fn();
vi.mock("@/lib/db", () => ({
  softDeleteVideo: (id: string) => softDeleteVideo(id),
  changeSlug: vi.fn(), getVideoById: vi.fn(), isSlugTaken: vi.fn(), updateSettings: vi.fn(), updateVideoMeta: vi.fn(),
}));

import { deleteVideos } from "./actions";

const UUID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

beforeEach(() => softDeleteVideo.mockReset());

describe("deleteVideos", () => {
  it("deletes each id and reports failures by id", async () => {
    softDeleteVideo
      .mockResolvedValueOnce({ id: UUID(1), slug: "a", drive_file_id: "d1", thumbnail_drive_file_id: null })
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(null);
    const result = await deleteVideos([UUID(1), UUID(2), UUID(3)]);
    expect(result.deleted).toEqual([UUID(1)]);
    expect(result.failed.map((f) => f.id)).toEqual([UUID(2), UUID(3)]);
  });
  it("rejects malformed ids without touching the db", async () => {
    const result = await deleteVideos(["nope"]);
    expect(result.failed[0].error).toMatch(/invalid/i);
    expect(softDeleteVideo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- "src/app/(owner)/actions.test.ts"`
Expected: FAIL — `deleteVideos` is not exported.

- [ ] **Step 3: Implement**

Refactor the body of `deleteVideo` into a helper and add the batch action:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Soft-delete one row and best-effort trash its Drive files. Returns the row, or null when already gone. */
async function deleteOne(id: string) {
  const deleted = await softDeleteVideo(id);
  if (deleted) {
    for (const fileId of [deleted.drive_file_id, deleted.thumbnail_drive_file_id]) {
      if (!fileId) continue;
      try { await trashFile(fileId); } catch (error) { console.error("Drive trash failed", fileId, error); }
    }
    revalidatePath(`/v/${deleted.slug}`);
  }
  revalidateVideo(id);
  return deleted;
}

export type BatchDeleteResult = { deleted: string[]; failed: { id: string; error: string }[] };

export async function deleteVideos(ids: string[]): Promise<BatchDeleteResult> {
  if (!(await isOwner())) return { deleted: [], failed: ids.map((id) => ({ id, error: "Not signed in." })) };
  const result: BatchDeleteResult = { deleted: [], failed: [] };
  for (const id of Array.from(new Set(ids)).slice(0, 200)) {
    if (!UUID_RE.test(id)) { result.failed.push({ id, error: "Invalid id." }); continue; }
    try {
      const row = await deleteOne(id);
      if (row) result.deleted.push(id);
      else result.failed.push({ id, error: "Already deleted." });
    } catch {
      result.failed.push({ id, error: "Could not delete." });
    }
  }
  revalidatePath("/library");
  return result;
}
```

and make `deleteVideo` call `deleteOne(id)` inside its existing try/catch, then `redirect("/library")`.

- [ ] **Step 4: Run tests**

Run: `npm test -- "src/app/(owner)/actions.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(owner)/actions.ts" "src/app/(owner)/actions.test.ts"
git commit -m "feat(library): batch delete server action with per-id failures"
```

---

### Task 18: Library multi-select UI

**Files:**
- Create: `src/app/(owner)/library/library-grid.tsx`, `src/components/library/selection-bar.tsx`
- Modify: `src/components/library/video-card.tsx`, `src/app/(owner)/library/page.tsx`

- [ ] **Step 1: `video-card.tsx`**

Add props `selectable: boolean; selected: boolean; anySelected: boolean; onToggle(shift: boolean): void`. Render a checkbox `button` at top-left of the thumbnail: `opacity-0 group-hover:opacity-100` normally, `opacity-100` when `anySelected`. `aria-pressed={selected}`. Selected cards get `border-accent ring-2 ring-accent/40`. Wrap the `<Link>`'s `onClick`: when `anySelected`, `e.preventDefault(); onToggle(e.shiftKey)`.

- [ ] **Step 2: `selection-bar.tsx`**

```tsx
"use client";
export function SelectionBar({ count, total, pending, onAll, onClear, onDelete, failures }: {
  count: number; total: number; pending: boolean; onAll(): void; onClear(): void; onDelete(): void;
  failures: { id: string; title: string; error: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
      <span className="text-sm text-foreground">{count} selected</span>
      <button type="button" onClick={onAll} disabled={count === total} className="text-xs text-muted hover:text-foreground disabled:opacity-40">Select all</button>
      <button type="button" onClick={onClear} className="text-xs text-muted hover:text-foreground">Clear</button>
      <button type="button" onClick={onDelete} disabled={pending}
        className="ml-auto rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-400/90 hover:bg-red-500/10 disabled:opacity-40">
        {pending ? "Deleting…" : `Delete ${count}`}
      </button>
      {failures.length > 0 && (
        <p className="w-full text-xs text-red-400/90">
          Could not delete: {failures.map((f) => `${f.title} (${f.error})`).join(", ")}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `library-grid.tsx`**

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VideoListItem } from "@/lib/db";
import { deleteVideos } from "@/app/(owner)/actions";
import { VideoCard } from "@/components/library/video-card";
import { SelectionBar } from "@/components/library/selection-bar";

export function LibraryGrid({ videos, apiBase, toolbar }: { videos: VideoListItem[]; apiBase: string; toolbar: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ id: string; title: string; error: string }[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();

  const toggle = (id: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && last) {
        const a = videos.findIndex((v) => v.id === last), b = videos.findIndex((v) => v.id === id);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(videos[i].id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLast(id);
  };

  const remove = () => {
    const ids = [...selected];
    if (!window.confirm(`Delete ${ids.length} recording${ids.length === 1 ? "" : "s"}? Share links stop working and the Drive files move to Trash.`)) return;
    start(async () => {
      const result = await deleteVideos(ids);
      const byId = new Map(videos.map((v) => [v.id, v.title]));
      setFailures(result.failed.map((f) => ({ ...f, title: byId.get(f.id) ?? f.id })));
      setSelected(new Set(result.failed.map((f) => f.id)));
      router.refresh();
    });
  };

  return (
    <>
      {selected.size > 0 ? (
        <SelectionBar count={selected.size} total={videos.length} pending={pending} failures={failures}
          onAll={() => setSelected(new Set(videos.map((v) => v.id)))} onClear={() => { setSelected(new Set()); setFailures([]); }} onDelete={remove} />
      ) : toolbar}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} apiBase={apiBase} selectable selected={selected.has(video.id)}
            anySelected={selected.size > 0} onToggle={(shift) => toggle(video.id, shift)} />
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 4: `page.tsx`**

Replace the toolbar + grid with `<LibraryGrid videos={videos} apiBase={base} toolbar={<LibraryToolbar q={q} sort={sort} count={videos.length} />} />` (keep the empty-state branch as is). `VideoListItem` must be serialisable across the server/client boundary; it already is (plain JSON).

- [ ] **Step 5: Verify**: hover shows the checkbox; select two, shift-click a third further down selects the range; Delete asks once, removes them, the grid refreshes. `npm run lint && npx tsc --noEmit -p tsconfig.json` clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(owner)/library" src/components/library
git commit -m "feat(library): multi-select with shift-range and batch delete"
```

---

### Task 19: Remove dead compositor code paths and settings

**Files:**
- Modify: `src/lib/recording/settings.ts`, `src/lib/recording/settings.test.ts`, `src/lib/recording/types.ts`, `src/lib/recording/compositor.ts`, `src/lib/recording/overlays.ts`

- [ ] **Step 1:** `BubbleConfig.visible` and `.pos` are no longer meaningful. Keep them in the type for the stored-settings shape (v2 key stays valid) but stop dispatching `visible` anywhere; update the settings test title "defaults system audio on and the bubble visible" to only assert the audio defaults.
- [ ] **Step 2:** `compositor.ts` and `overlays.ts` are no longer imported by anything. Run `grep -rn "compositor\|createFpsOverlay" src --include=*.ts --include=*.tsx | grep -v test`. If only tests reference them, delete `compositor.ts`, `overlays.ts`, `overlays.test.ts`, and any compositor test; keep `geometry.ts` (used by the renderer). If something still imports them, leave them and note it in the commit.
- [ ] **Step 3:** `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json` clean.
- [ ] **Step 4: Commit**

```bash
git add -A src/lib/recording
git commit -m "chore(recording): drop the live compositor and overlay seam"
```

---

### Task 20: Docs and manual checklist

**Files:**
- Modify: `desktop/README.md`, `docs/overnight-2026-09-02.md`

- [ ] **Step 1: README** — rewrite item 3 ("A floating camera bubble") to say the bubble is placed in staging after the take and no bubble window is shown; rewrite item 4 to list the four HUD controls; delete the `bubbleToggle` mention and the "Show/hide the camera bubble" row in the HUD table; replace the "review page" wording with "staging".

- [ ] **Step 2: Manual checklist** — append a section "Staging editor" to `docs/overnight-2026-09-02.md`:

```markdown
## Staging editor — manual test

- [ ] Screen+camera take, 20 s. Staging opens with the bubble bottom-right. Drag it top-left at 5 s, full screen at 10 s, back to bubble at 15 s. Scrub: eases between, cross-fades on mode changes.
- [ ] Camera-only take: no Camera section; frame and overlays still apply.
- [ ] Trim 1 s off each end, cut 3–5 s. Playback skips the cut; readout shows edited duration.
- [ ] Blur over a text field; callout numbered 1; highlight. All render on the canvas and in the export.
- [ ] Frame on, Sunset preset, padding 0.08. Preview and export are padded.
- [ ] Zoom into a quarter of the screen 8–12 s with ramp 0.4; a second zoom "focus whole take" on a window region. Export eases in and out; overlays inside the zoom stay on their pixels; the bubble stays put.
- [ ] Details: custom slug, "taken" shown for an existing slug. Thumbnail from 7 s.
- [ ] Upload: Rendering bar advances; Cancel mid-render returns to staging with nothing uploaded (check the library). Upload again to completion; the link on the clipboard opens the video; duration = edited duration; thumbnail is the chosen frame.
- [ ] Reload during staging: page returns to idle (media gone), no crash; next take starts clean.
- [ ] Desktop: HUD has pause/stop/mark/discard only; no bubble window; recorder window returns on stop.
- [ ] Library: select 3, delete; with one already deleted in another tab, the bar names it as failed and keeps it selected.
```

- [ ] **Step 3: Commit**

```bash
git add desktop/README.md docs/overnight-2026-09-02.md
git commit -m "docs: staging editor and multi-select delete"
```

---

## Self-review

**Spec coverage.** §1 recording → Tasks 5, 7, 11, 16. §2 staging (seven sections incl. Zoom, keys, undo, sessionStorage, playback sync) → Tasks 10, 12–15. §3 data model and helpers → Tasks 1–4 (zoom helpers Task 3b). §4 renderer/export/upload/thumbnail/`videos.edits` → Tasks 6, 8, 9, 7 (`finish`). §5 multi-select → Tasks 17, 18. §6 tests → unit tests in Tasks 1–5, 8, 17; manual checklist Task 20; the Electron render script is replaced as stated in the header. Non-goal "click ripples" → schema and renderer accept `click` (Tasks 1, 8), no producer.

**Type consistency.** `FinishInput` (Task 7) is what `Staging.onFinish` (Tasks 11, 12) sends. `RenderSources`/`RenderResult` (Task 9) match `finish()` (Task 7). `StagingContext` (Task 12 `types.ts`) is what every section imports. `ops.*` names match Task 4. `HudStatus` values agree between `types.ts` (Task 5) and `ipc.ts` (Task 16). `cameraAt` returns `{ mode, fromMode?, fade, rect }` and the renderer reads exactly those.

**Placeholders.** Tasks 12–15 describe UI in prose where the code is long-form Tailwind markup; every behaviour named there maps to a named op or hook method defined earlier. The `preview.tsx`/`rail.tsx` stubs are explicitly filled in later tasks.
