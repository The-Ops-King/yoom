# Staging editor restyle — design

**Date:** 2026-09-07
**Status:** approved, ready for planning
**Reference:** [Recordly](https://github.com/webadderallorg/Recordly) (AGPL-3.0) — used as a **design reference only**

---

## What this is

Rebuild the staging editor's UI and UX along the lines of Recordly's editor, in
Yoom's own stack and palette. Nothing about how recording or rendering works
changes: two takes still land as two files, the camera is still keyframed in
post, and every recording still uploads and comes back as `jtylerray.com/v/<slug>`.

### Why not fork Recordly

We considered vendoring the Recordly source into `desktop/` and retiring Yoom's
editor. Rejected on the facts:

- Recordly's webcam is a **static overlay**. `webcamOverlay.ts` is 262 lines with
  no mention of keyframes or interpolation. Yoom's `CameraTrack` keyframes
  `mode`, `rect`, `shape` and `pan` over time. Forking would have been a
  downgrade in the one area that matters most here.
- Recordly has no hosting, so no title, description, slug, or share link. All of
  it would have had to be rebuilt inside their codebase.
- AGPL-3.0 with a SaaS reciprocity clause. Taking UI/UX ideas carries no
  obligation; copying code would.

**No Recordly code is copied.** Layout, control idioms and interaction patterns
are reimplemented in Yoom's components.

---

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ ↶ ↷   Q3 planning walkthrough   /v/q3-planning  Discard  Upload │  top bar
├──────────────────────────────────────────┬────┬──────────────┤
│                                          │ ◉  │              │
│                                          │ ▣  │   Camera     │  icon strip
│              preview                     │ ⌕  │   panel      │  + one panel
│                                          │ ◈  │              │
│                                          │ ➤  │              │
│                                          │ ✎  │              │
├──────────────────────────────────────────┴────┴──────────────┤
│  ✂ Split  ⌦ Cut      0:19  ◀◀ ▶ ▶▶  0:43      🔊 100%  ⌕ Fit │  transport
├──────────────────────────────────────────────────────────────┤
│ Clip     ▓▓▓▓▓▓▓░░░▓▓▓▓▓▓▓▓▓▓▓▓▓                             │
│ Zoom       ░░[1.5×]░░░░[2×]░░░                                │  timeline
│ Camera     ◆░░░░░░░░░░░░░░◆░░░                                │
│ Clicks     ●░░●░░○░░●░░░░░░░░░                                │
│ Overlays ░░[caption]░░░░[arrow]░                              │
│          ░░░░[step badge]░░░░░░                               │
│          ░░░░░[blur]░░░░░░░░░░░                               │
└──────────────────────────────────────────────────────────────┘
```

The rail stays on the **right**, where it is today. Everything else follows
Recordly's shape: a top bar, an icon strip showing one panel at a time, a
transport row, and a full-width multi-lane timeline.

### Why one panel at a time

Today's rail is an accordion of eight sections in 320px, several of which can be
open at once. Showing exactly one panel is the single biggest calm-per-pixel win
available, and it is independent of which side the rail sits on.

---

## Information architecture

Eight accordion sections become **six icons** plus two things that stop being
panels.

| Icon | Panel | From |
|---|---|---|
| ◉ | Camera | `sections/camera.tsx` |
| ▣ | Frame | `sections/frame.tsx` |
| ⌕ | Zoom | `sections/zoom.tsx` |
| ◈ | Overlays | `sections/overlays.tsx` |
| ➤ | Cursor & clicks | `sections/cursor.tsx` |
| ✎ | Details | `sections/details-form.tsx` + `frame-picker` poster |

**Trim & cut** dissolves into the Clip lane plus `Split` / `Cut` in the
transport. Today it renders cuts as a text list of `0:12 → 0:18` rows; as
draggable lane blocks they are visible and directly editable.

**Upload** dissolves into the top-bar button. The section is only slug validation
plus submit, so it does not need a panel. Slug editing lives in Details, with the
resolved URL shown in the top bar.

### Selection drives the rail

Selecting an object in the preview or timeline opens its panel: click the camera
bubble → Camera; click an overlay → Overlays with that overlay selected. The
existing `Selection` type (`{kind: "overlay" | "cut" | "keyframe" | "zoom", index}`)
already carries what this needs; it gains `"camera"` and `"click"` kinds.

---

## Timeline

Five lane groups, top to bottom: **Clip, Zoom, Camera, Clicks, Overlays.**

- **Clip** — the take, with cuts drawn as hatched regions. Trim handles at both ends.
- **Zoom** — `Zoom[]` blocks labelled with their factor. `kind: "follow"` blocks
  get a distinct marker from `static`.
- **Camera** — a diamond per `CameraKeyframe`. Dragging moves `t`.
- **Clicks** — one dot per `ClickMark`. Filled when `on`, hollow when off; clicking
  toggles. This is the click-highlight selection, and Recordly has no equivalent.
- **Overlays** — one or more packed rows, below.

### Overlay row packing

Overlays must never visually overlap, so the lane splits into as many rows as
there are simultaneous overlays.

```
sort overlays by start
for each overlay:
    place in the first row whose last block ends <= this.start
    if no such row exists, open a new row
```

Greedy first-fit over intervals sorted by start time is provably minimal — the
row count equals the maximum number of overlapping overlays and never exceeds it.
Rows are reused: an overlay starting after an earlier one ends goes back into the
earlier row.

Recomputed whenever an overlay is added, removed, moved or resized.

**No cap on rows.** `MAX_OVERLAYS` is 64, so a pathological project could produce
many rows; past 8 the timeline body scrolls vertically. Nothing is hidden and
there are no special cases. The selected overlay's row is reported in its panel
as `Row 2 of 3`.

---

## Panels

Every panel uses one control vocabulary, continuing the consolidation already
started in `staging/ui.ts`:

- **Section header** — mono uppercase label, `Reset` on the right.
- **Segmented control** — mutually exclusive choices, accent fill on the selection.
- **Filled-bar slider** — label left, value right, accent fill showing position.
  Replaces the current label/track/value row.
- **Swatch grid** — backgrounds and colours.
- **Toggle** — booleans.

### Camera

Backed by `CameraTrack` and `CameraKeyframe`.

| Control | Field | Notes |
|---|---|---|
| Mode | `keyframe.mode` | `bubble` / `full` / `hidden` |
| Shape | `track.shape`, `keyframe.shape` | `circle` / `rounded` / `square` / `portrait` / `full` — **five**, not three |
| Size | `keyframe.rect.w` | height derives from shape and aspect |
| X / Y | `keyframe.rect` | numeric, and draggable in the preview |
| Crop pan | `keyframe.pan` | 2-axis draggable pad, not two sliders |
| Mirror | `track.mirror` | toggle |
| Sync offset | `cameraOffsetMs` | the A/V nudge between the two takes |
| Keyframes | `track.keyframes` | chips at each `t`, plus "add at playhead" |

`pan` and `cameraOffsetMs` are currently under-exposed; on a two-file pipeline
the sync nudge is the control most likely to be needed and hardest to find.

### Frame

Backed by `FrameConfig`.

| Control | Field | Range |
|---|---|---|
| Framed capture | `enabled` | boolean |
| Background kind | `background.kind` | `none` / `color` / `image` / `video` |
| Presets | `background.presetId` | 16 gradients, 8-wide grid, no scroll |
| Custom | `background.src` | upload, plus saved wallpapers |
| Padding | `padding` | 0–0.2 of source width, shown as 0–20% |
| Radius | `radius` | 0–0.1 of source width, shown as 0–10% |
| Shadow | `shadow` | **0–1, shown as 0–100%** — see migration |

### Overlays

All fifteen `OverlayType` values in a 5×3 tool grid: `text · arrow · line · rect ·
ellipse · highlight · underline · step · emoji · draw · blur · blackout · image ·
keys · click`. A counter shows `7 / 64`.

Below the grid, properties for the current selection — colour swatches,
`thickness` (0–`MAX_OVERLAY_THICKNESS`), `ArrowStyle` for arrows and lines, step
number for badges, in/out timing, and the packed row readout.

### Cursor & clicks

Keeps today's cursor controls. Click highlighting moves its primary interaction
to the timeline dots; the panel holds the **style** of the highlight — colour,
size, ripple duration — and a "highlight all / none" pair.

### Details

Title, description, slug with availability check, and the poster frame picker.
Title and slug also render in the top bar, editable in place; both surfaces write
the same state.

---

## Sticky defaults

Appearance settles once and persists. Content does not.

**Sticky** — written to `localStorage["yoom.recorder.v3"]` on change, debounced:

- Frame: `enabled`, `padding`, `radius`, `shadow`, `background`
- Camera: `shape`, `mirror`, the `t = 0` keyframe's `rect` and `pan`
- Overlay defaults: colour, `thickness`, `ArrowStyle`
- Click highlight: colour, size, ripple duration
- Zoom defaults: `ramp`, `kind`

**Per-recording** — never sticky: cuts, placed zooms, placed overlays, individual
`ClickMark.on` toggles, camera keyframes after `t = 0`, title, description, slug.

The mechanism already exists. `persistFrame()` merges a `FrameConfig` into the
stored settings and is already called from `sections/frame.tsx`, so the frame
block is sticky today; shadow becomes sticky for free once it is part of
`FrameConfig`. This work extends `RecorderSettings` with the camera, overlay,
click and zoom default blocks and applies the same merge-and-sanitize pattern.

**Known limitation:** `localStorage` is per-origin-partition, so the desktop
shell and a browser tab keep separate defaults. Accepted — a single user on a
single machine will normally use one of them. Moving to Supabase later is a
contained change behind `loadSettings` / `saveSettings`.

### Reset

`Reset` in a panel header restores **your saved defaults**, not factory values —
resetting to factory would fight the sticky behaviour. A quieter
**Restore factory defaults** lives in settings and clears the stored block.

---

## Model change: `shadow`

`FrameConfig.shadow` becomes a number.

```ts
- shadow: boolean;
+ /** Shadow strength, 0..1. 0 is no shadow. */
+ shadow: number;
```

`render.ts:596` currently draws a fixed shadow when the flag is set:

```js
ctx.shadowColor  = "rgba(0,0,0,0.45)";
ctx.shadowBlur   = W * 0.02;
ctx.shadowOffsetY = W * 0.008;
```

Strength `s` scales all three proportionally, with `s = 1` at **twice** today's
values:

| | `s = 0` | `s = 0.5` (today) | `s = 1` |
|---|---|---|---|
| alpha | 0 | 0.45 | 0.90 |
| blur | 0 | `W * 0.02` | `W * 0.04` |
| offsetY | 0 | `W * 0.008` | `W * 0.016` |

Scaling all three together keeps the shadow's shape constant so it reads as one
control, and putting today's look at the midpoint leaves room to go both softer
and heavier.

Migration in `sanitizeFrame`: `true` → `0.5` (pixel-identical to today), `false`
→ `0`, a number clamps to 0..1, anything else falls back to
`DEFAULT_FRAME.shadow`. Stored `videos.edits` rows carry frames too, so
`parseEdits` must accept both shapes — the boolean form is read forever and never
written again. `DEFAULT_FRAME.shadow` becomes `0.5`.

This is the only data-model change in the project.

---

## Phasing

Each phase leaves the editor working.

1. **Shell** — top bar, icon strip, single-panel rail, transport row. Existing
   section components render unchanged inside the new frame.
2. **Control vocabulary** — segmented controls, filled-bar sliders, swatch grids
   in `ui.ts`; panels adopt them. Shadow becomes a slider, with the migration.
3. **Timeline** — lane rendering, Clip with cuts, Zoom, Camera, Clicks lanes.
   Trim & cut retires here.
4. **Overlay row packing** — the greedy assignment, scrolling lane area, row readout.
5. **Selection wiring** — preview and timeline selection opens the matching panel.
6. **Sticky defaults** — extend `RecorderSettings`, wire panels, reset semantics.

---

## Testing

- **Unit** — row packing is the piece most worth testing directly: minimality,
  row reuse after a gap, ties where one overlay starts exactly as another ends,
  and stability of assignment under add/move/resize. `sanitizeFrame`'s shadow
  migration gets cases for `true`, `false`, in-range, out-of-range and garbage.
  Sticky-default merge and sanitize follow the existing `settings.test.ts` shape.
- **Component** — panels render every control from a given `VideoEdits`, and
  selection opens the right panel.
- **Manual** — anything touching real media: camera sync offset against a real
  two-file take, background rendering, and the packed lanes with genuinely
  overlapping overlays.

---

## Out of scope

- Recording, capture and the desktop shell
- The render pipeline and upload
- The `/v/` viewer, library and analytics
- Recordly features not asked for: captions, speed regions, extensions,
  marketplace, GIF export, project files
