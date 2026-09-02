# Phase 5: Post-recording editor — Design

**Status:** Spec, 2026-09-03. Turns the "Proposed Phase 5" and "Markers and attention
sections" notes in `docs/for-later.md` into a buildable design.

## Goals

1. Edit a recording after the fact from `/library/[id]`: **blur/redact** regions,
   numbered **callout** circles that pop in and out, **underline** and **highlight**
   marks, **cut** segments, **crop** the frame, animated **zoom**, and **attention**
   ranges ("pay attention here").
2. Edits are **non-destructive**: an edit-decision list in `videos.edits` (jsonb),
   rendered at playback on both `/library/[id]` and `/v/[slug]`. No re-encode, no new
   upload, instantly re-editable, thumbnail and analytics untouched.
3. **Markers** placed with ⌘⇧M while recording become first-class timeline objects and
   can be promoted to attention ranges in one click.
4. The public watch page stays cheap: it ships the **renderer only**, never the editor.
5. A later sub-phase (**5b**) burns the edit list into a new video file for clean
   downloads and weak devices.

## Non-goals

- Multi-track timeline, transitions, audio editing, ducking, or music.
- Text/speech overlays, captions, transcripts, auto-zoom from cursor data (that waits on
  the cursor sidecar, `for-later.md` #4).
- Multi-user or concurrent editing (single owner; last write wins).
- Server-side rendering/encoding. Export is browser-side or it does not ship.
- Editing the *source* file. The original Drive file is never mutated or deleted.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Destructive vs not | **Non-destructive first**, export second | Instant, reversible, no re-encode; export is additive and can slip without blocking the feature. |
| Time base | **Seconds, source time** — every stored `start`/`end`/`t` is an offset in the *original* recording | One base means cuts never invalidate overlay times. Edited (post-cut) time exists only in the UI and the scrubber, computed by a pure remap. |
| Coordinates | **Normalized 0..1 against the source video frame**, not the cropped or zoomed frame | Survives any display size, DPR, crop change, and zoom. A crop that moves must not drag every overlay with it. |
| Cuts | **Removed ranges** (`cuts: [{start, end}]`), kept sorted, merged and disjoint | Keeps the shipped Phase 3 schema and every existing row valid; `cuts: []` is a truthful "no edits" (kept-ranges would need `[[0, duration]]` as its neutral value, breaking `isEmptyEdits` and every row written before Phase 5); and duration is *not* reliably known at write time — MediaRecorder WebM often reports `Infinity` (see `use-view-tracker.ts`), so a kept-range list could not even be constructed on save. Merging on every mutation keeps the invariant local. |
| Caps | 64 overlays, 32 zooms, 64 cuts, 200 markers per video | jsonb row size and per-frame draw cost. `parseEdits` **truncates** (never rejects) so an over-long blob degrades instead of blanking; the editor disables the tool at the cap. |
| Editor bundle | Lazily mounted (`next/dynamic`, `ssr: false`) on the owner page only | `/v/[slug]` imports `src/lib/editor/render.ts` + `cuts.ts` + `zoom.ts` and nothing from `src/components/editor/*`. |

## Data model

`src/lib/edits.ts` already defines `Rect`, `Cut`, `Zoom`, `Overlay`, `Marker`,
`VideoEdits`, `EMPTY_EDITS`, `parseEdits`, `isEmptyEdits`, `hasDrawableEdits`. Phase 5
**extends it in place**, staying at `version: 1` — every addition is optional or a new
enum member, so old rows parse unchanged and new rows degrade gracefully on old code.

```ts
export type OverlayType =
  | "blur" | "callout" | "underline" | "highlight" | "attention";

export type Easing = "linear" | "ease-out" | "ease-in-out";

export type OverlayStyle = {
  color?: string;      // CSS colour
  opacity?: number;    // 0..1
  thickness?: number;  // normalized to frame height (underline/callout ring)
  radius?: number;     // normalized corner radius (highlight/blur)
  blur?: number;       // normalized blur radius (blur only)
};

export type Zoom = {
  start: number; end: number; rect: Rect;
  ease?: Easing;   // default "ease-in-out"
  ramp?: number;   // seconds of zoom-in/out ramp, default min(0.4, span/3)
};

export type Overlay = {
  type: OverlayType; start: number; end: number; rect: Rect;
  n?: number;              // callout badge number
  label?: string;          // attention chapter label
  color?: string;          // legacy Phase 3 field; falls back into style.color
  style?: OverlayStyle;
};
```

`attention` carries a full-frame `rect` (`{x:0,y:0,w:1,h:1}`) so the parser stays
uniform; the renderer ignores its rect and draws a border pulse instead.

**Invariants** (enforced by `parseEdits` and by every op in `src/lib/editor/edit-ops.ts`):
cuts sorted/merged/disjoint; `end > start` everywhere; rects clamped into `0..1`;
zooms sorted by `start` and non-overlapping (a new zoom trims the one it lands on);
markers sorted ascending; arrays truncated to the caps above.

## Rendering at playback

`EditPlayer` (`src/components/video/edit-player.tsx`) already sizes a `<canvas>` over the
`<video>` with a `ResizeObserver` and runs a rAF loop gated on `hasDrawableEdits`. Phase 5
fills that loop and adds three surrounding behaviours. All maths lives in pure modules
under `src/lib/editor/`; the component is glue.

- **Canvas overlays** — `drawEdits(ctx, source, edits, time, frame)` in
  `src/lib/editor/render.ts`, a pure function over a 2D context and a `FrameInfo`
  (`{cssWidth, cssHeight, dpr, videoWidth, videoHeight, crop}`) that maps normalized
  rects to device pixels.
  - **Blur** — draw the *video's own* region back over itself through
    `ctx.filter = "blur(Npx)"`, clipped to a rounded rect. The blurred source is first
    downscaled into a scratch canvas capped at 320 px on the long edge, then drawn up:
    that keeps 4K Safari cheap (the `for-later.md` cost note) and makes the blur radius
    resolution-independent.
  - **Callout** — a numbered ring: `arc` + stroke, then the number centred in it.
    Pop-in/out is a scale + opacity envelope, `ease-out-back` over 220 ms in and 160 ms
    out, driven off `time - overlay.start`.
  - **Underline / highlight** — rounded rects: underline strokes a thick line along the
    rect's bottom edge, highlight fills at `opacity` with `globalCompositeOperation =
    "multiply"` so text stays readable.
  - **Attention** — no canvas drawing; see below.
- **Zoom and crop** — never on the canvas. `zoomStateAt(edits, time)` returns
  `{scale, originX, originY}` (origin clamped so the scaled frame never exposes a blank
  edge) and the player writes it to a wrapper `<div>` as `transform: scale(s)` +
  `transform-origin: X% Y%`, applied to the video **and** the canvas together so overlays
  stay welded to the frame. Crop is the same wrapper with `overflow: hidden` and a fixed
  `aspect-ratio`. Interpolation is done per rAF frame in JS (not CSS `transition`) so
  scrubbing lands on the right value instantly.
- **Cuts** — a `timeupdate` handler asks `skipTarget(cuts, video.currentTime)`; if the
  playhead is inside a removed range it jumps to that range's end. The visible duration
  and scrubber use `editedDuration(cuts, duration)` and `sourceToEdited` /
  `editedToSource`; because the remap is needed, the player renders **its own scrubber**
  when `cuts.length > 0` and drops `controls` (native controls would show source time).
- **Attention ranges** — a `data-attention` attribute on the wrapper toggles a CSS
  keyframe border pulse defined in `src/app/globals.css`, plus a chapter pill row under
  the player listing each attention range's label (default "Pay attention here") which
  seeks on click.

## Editor UI (`/library/[id]`)

A client `EditorPanel`, lazily mounted under the player when the owner presses **Edit**.

- **Toolbox** — Blur · Callout · Underline · Highlight · Zoom · Cut · Crop · Attention,
  plus Select. Picking a tool arms drag-to-draw on the frame; the new item spans
  `[currentTime, currentTime + 3s]` (clamped to duration), or the current in/out points
  when both are set.
- **Frame overlay** — a transparent, pointer-enabled layer over the video: drag to draw a
  new rect, click to select, drag to move, eight handles to resize. All hit-testing is
  `src/lib/editor/hit-test.ts` against normalized coordinates.
- **Timeline** — a single track under the player showing, in lanes: cut ranges (struck
  out), overlay clips (coloured by type, drag body to move, drag edges to resize),
  attention ranges, marker ticks, and zoom keyframes (diamonds at each zoom's start/end).
  Clicking anywhere seeks; clicking a clip selects it.
- **Inspector** — numeric start/end, per-type style (colour, opacity, thickness, blur
  radius, callout number, attention label, zoom easing), and Delete.
- **Keys** — `I`/`O` set in/out; `C` cut the in/out range; `Delete`/`Backspace` delete the
  selection; `⌘Z` / `⇧⌘Z` undo/redo; `Space` play/pause; `,`/`.` step one frame;
  `M` promote the nearest marker to an attention range.
- **Undo/redo** — a bounded 50-entry stack of whole `VideoEdits` snapshots
  (`src/lib/editor/undo.ts`). Snapshots are small and this removes every class of
  partial-undo bug.

## Persistence

- `saveEdits(videoId, edits)` — a new Server Action in `src/app/(owner)/actions.ts`:
  re-checks `isOwner()` (server functions are reachable by direct POST), runs the untrusted
  payload through `parseEdits` **on the server** (so the caps and invariants are enforced
  regardless of the client), then calls the existing `db.setVideoEdits`, and
  `revalidatePath` for `/library/[id]` and `/v/[slug]`.
- **Optimistic UI** — the editor holds `VideoEdits` in React state and is the source of
  truth while open. Mutations apply locally and schedule a debounced (800 ms) save inside
  `startTransition`; a "Saving… / Saved / Couldn't save — retry" status sits next to the
  toolbox. A failed save keeps the local state and re-arms the retry, so nothing is lost.
- Single owner ⇒ last write wins. No version column, no conflict UI.

## Watch page

`/v/[slug]` already passes `parseEdits(video.edits)` into `WatchView` → `EditPlayer`, so
it inherits every renderer behaviour for free: overlays, cuts, zoom, crop. It adds the
attention chapter pill row and the border pulse. It must **not** import
`src/components/editor/*` — Task 20's verification greps the built route's chunk to prove
it.

## Sub-phase 5b: burned-in export

Later, additive, behind an "Export edited copy" button on `/library/[id]`.

- **Pipeline (v1, 1× realtime):** an offscreen canvas at the cropped output size; a hidden
  `<video>` playing the source; a rAF loop that draws the frame with zoom/crop applied and
  calls the same `drawEdits` used at playback; audio via
  `video.captureStream().getAudioTracks()` mixed into the canvas stream; `MediaRecorder`
  writes WebM. Cuts are handled by seeking across removed ranges and pausing the recorder
  during the seek. Reuses Phase 2's `fix-webm-duration`.
- **WebCodecs later:** `VideoEncoder`/`VideoDecoder` for faster-than-realtime, same
  `drawEdits` call, swapped in behind the same interface once v1 is proven.
- **Storage:** upload the result as a **new** Drive file via the existing resumable
  upload, then set `videos.original_drive_file_id = drive_file_id` (new column) and point
  `drive_file_id` at the export. The original is never trashed, so "Revert to original" is
  a one-row update. `edits` stays on the row, so the export is repeatable and the editor
  keeps working against the original.
- **Guardrails:** disabled while unsaved edits are pending; a progress bar with elapsed vs
  duration; cancel aborts the recorder and uploads nothing.

## Risks

- Safari `ctx.filter` support and cost — mitigated by the downscaled scratch canvas, and
  by a capability check that falls back to a solid-fill redact when `ctx.filter` is
  unsupported (a redact that fails **closed** is the only acceptable failure mode).
- Cut-skipping produces an audible seek gap; acceptable for v1, and export removes it.
- Zoom on a `transform`ed wrapper composites the video layer; verify on Windows Chrome.
