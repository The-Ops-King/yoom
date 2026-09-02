# Staging editor: record raw, compose in post — Design

**Status:** Spec, 2026-09-02. Supersedes the recording half of the Phase 4.1 HUD
and reshapes Phase 5 (`2026-09-03-phase5-editor-design.md`) into a **pre-upload**
staging step. Phase 5's edit-list conventions, caps, and renderer ideas are kept;
its "edit after upload on `/library/[id]`" framing is replaced by this document.

## Goals

1. **Nothing to manage while recording.** Before a take you choose what to share and
   a default bubble shape and size. During the take the only UI is the HUD pill:
   pause/play, mark, restart, trash. No camera bubble is shown on screen and nothing
   is composited live.
2. **Everything happens in staging, before upload.** After the take: trim and cut,
   place/move/resize/full-screen the camera bubble over time, choose padding and
   background, add blurs/callouts/highlights, set title/description/slug and the
   thumbnail frame, then Upload. Upload renders one final file, uploads it, copies
   the share link, and lands on the library page for the video.
3. **One renderer.** The staging preview and the export use the same draw function,
   so what you see is what gets uploaded.
4. **Library multi-select delete.**

## Non-goals

- Live compositing, live bubble preview, or the floating bubble window during a take.
  The desktop bubble window and its IPC stay in the tree but are no longer opened
  by the recorder flow; removing them is a later cleanup.
- Hiding the HUD from the capture. macOS 14+ ScreenCaptureKit ignores
  `setContentProtection`, and Electron exposes no window-exclusion filter. The pill
  appears in the recording; the existing `YOOM_HUD_HIDE_WHILE_RECORDING` opt-in stays
  available.
- Click ripples. They need global mouse-click capture in the desktop shell (a native
  hook), which is its own follow-up. The overlay schema and renderer are shaped so a
  `click` overlay type slots in without changes elsewhere.
- Editing after upload. `videos.edits` still stores the list so a later phase can
  re-open it, but no editor is mounted on `/library/[id]` in this phase.
- Faster-than-realtime export (WebCodecs). The render loop is built behind an
  interface that a WebCodecs encoder can replace later.
- Audio editing, transitions, captions, crop.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| What the take records | **Two raw files**: screen (with mixed audio) and camera (video only). Camera-only mode records **one** file: camera video with mic audio. | Bubble placement, size, and full-screen moments become post decisions. Nothing is burned in that cannot be changed. |
| Sync | Both `MediaRecorder`s start on the same tick; the first `dataavailable`/frame timestamps are recorded and the difference stored as `cameraOffsetMs`. | Sub-100 ms alignment is enough for a picture-in-picture bubble; a slider in the Camera section corrects any visible drift. |
| Final artifact | **Burn in on Upload**, one WebM, real-time render in the foreground with progress and cancel. | Two files cannot be played back in sync on the watch page reliably. Background render would need the shell to keep a hidden renderer alive after navigation for no real gain now. |
| Where edits live | `videos.edits` (existing jsonb), the staging list verbatim. | Keeps the list for a later re-edit/re-render; the watch page ignores it because the upload is already rendered. |
| Coordinates and time | Seconds of **source** time; rects normalized 0..1 against the **screen** frame (or the camera frame in camera-only mode). | Phase 5 conventions; survives any output size or frame padding. |
| Trim vs cuts | `trim: {start, end}` is separate from `cuts[]`. | The timeline shows trim as greyed ends and cuts as struck-out ranges; export treats both as removed. |
| Caps | 64 overlays, 64 cuts, 64 camera keyframes, 32 zooms, 200 markers. `parseEdits` truncates, never rejects. | Same reasoning as Phase 5. |

## 1. Recording

**Pre-record UI** (existing recorder page, simplified): mode picker (screen,
screen+camera, camera), source picker, mic/system-audio controls with level meter,
camera device, and the bubble **shape** and **size** picker. The frame picker moves
out of this screen entirely. The live `PreviewStage` keeps showing the raw screen
and a raw camera thumbnail so the user can confirm sources; no compositing.

**Take:**

- `use-recorder.ts` opens the screen and camera streams and the audio mixer as today,
  but instead of feeding the compositor it starts:
  - `screenRecorder = new MediaRecorder(screenVideoTrack + mixedAudioTrack)`
  - `cameraRecorder = new MediaRecorder(cameraVideoTrack)` (screen+camera mode only)
  - camera-only mode: `cameraRecorder = new MediaRecorder(cameraVideoTrack + mixedAudioTrack)` and no screen recorder.
- Both are started in the same synchronous block. `performance.now()` at each
  recorder's `start` event is captured; `cameraOffsetMs = cameraStart - screenStart`.
- Pause/resume pauses both. Markers append `{ t }` in screen-recorder time. Restart
  and trash discard both. Stop waits for both `stop` events, runs
  `fix-webm-duration` on each blob, and moves to `staging` with two object URLs.
- The recorder machine's `review` status is renamed `staging`. The state carries
  `screenUrl`, `cameraUrl | null`, `cameraOffsetMs`, `markers`, `durationMs`, and the
  pre-record defaults (bubble shape/size, last-used frame config).

**HUD:** pause/play, mark, restart, trash. The camera toggle button and the
`bubbleToggle` shortcut are removed. The shell no longer opens the bubble window
from the recorder flow (`setBubbleVisible` is never sent true).

## 2. Staging

Replaces `Review`. Route stays `/` in the `staging` status; the page is a client
component mounted lazily (`next/dynamic`, `ssr: false`) because it depends on
canvas, `MediaRecorder`, and the two object URLs.

Layout: canvas preview on top, timeline under it, tool rail on the right (stacked
below on narrow widths). The rail has seven sections in this order; each is a
collapsible panel and only one is open at a time.

1. **Trim and cut.** In/out handles at the timeline ends set `trim`. `I`/`O` set
   in/out at the playhead; `C` adds a cut for the in/out range. Cuts are struck-out
   bands; clicking one selects it, `Delete` removes it. Markers render as ticks; a
   marker's context menu offers "cut 2 s before / after" shortcuts.
2. **Camera** (hidden in camera-only or screen-only mode). Shape (circle, rounded,
   square, portrait), mirror, and the keyframe list. Dragging the bubble on the
   preview moves it; dragging a corner handle resizes it; **Full screen** and
   **Hide camera** set `mode` (`"bubble" | "full" | "hidden"`); the shape buttons
   and S/M/L set the shape and width. Any change at time `t` upserts a keyframe
   at `t`. A keyframe means "be in this state **at** `t`": its eased transition
   occupies `[t - 0.3 s, t]` (`lerpRect` + `easeInOutCubic`, with `mode` and
   `shape` cross-fading over the same window), so an edit made at the playhead is
   visible at the playhead. The `t = 0` keyframe has no transition. `shape` is
   per-keyframe and optional; `track.shape` is the default for keyframes without
   one.
   Keyframes render as diamonds on a camera lane; drag to move in time, `Delete`
   removes (the `t = 0` keyframe cannot be removed). A **Sync** slider (±500 ms)
   adjusts `cameraOffsetMs`.
3. **Frame.** The existing `FramePicker` unchanged: enabled, padding, radius,
   shadow, background (none / colour / preset image / uploaded image / video).
4. **Zoom.** Pick the tool, drag a rectangle on the preview: the view eases into that
   region over 0.4 s at the playhead, holds for 3 s (or the in/out range), and eases
   back out. Zooms render as clips on their own lane; drag body/edges to move/resize
   in time, drag the rectangle on the preview to reposition. "Focus on one window" is
   one zoom spanning the whole take. Zooms never overlap: a new one trims the one it
   lands on. Overlays are drawn in zoomed space (they stay on the pixels they mark);
   the camera bubble stays anchored to the output frame, as in Loom.
5. **Overlays.** Blur, callout, highlight, underline. Pick a tool, drag on the
   preview to draw; the new item spans `[playhead, playhead + 3 s]` or the in/out
   range when both are set. Overlays render as clips on an overlay lane; drag body
   to move, edges to resize. The inspector shows start/end, colour, opacity,
   thickness, blur radius, callout number.
6. **Details.** Title (default: date-time as today), description, slug (with the
   existing availability check), thumbnail frame (a "Use this frame" button at the
   playhead; default is 1 s into the edited timeline).
7. **Upload.** Summary line (edited duration, output size), the Upload button, the
   render progress bar with Cancel, and Discard.

**Playback in preview.** Two hidden `<video>` elements. The screen video is the
clock; on each animation frame the camera video is nudged if it drifts more than
80 ms from `screenTime + cameraOffsetMs / 1000`. Seeking through a cut jumps to
the next kept range. The custom scrubber shows **edited** time via the Phase 5
`sourceToEdited` / `editedToSource` remap.

**Undo/redo.** A bounded 50-entry stack of whole edit-list snapshots (`⌘Z`, `⇧⌘Z`).
Details (title/description/slug) are outside the stack.

**Persistence while staging.** The edit list and details are held in React state
and mirrored to `sessionStorage` every change, keyed by a take id, so a reload
does not lose edits. The media blobs themselves cannot survive a reload; the
existing unsaved-work `beforeunload` guard stays armed from take start until
upload completes or Discard.

## 3. Data model

`src/lib/edits.ts` extends `VideoEdits` in place, still `version: 1`; every new
field is optional so existing rows parse unchanged.

```ts
export type CameraMode = "bubble" | "full" | "hidden";
export type CameraKeyframe = { t: number; mode: CameraMode; rect: Rect; shape?: BubbleShape };

export type CameraTrack = {
  shape: BubbleShape;          // default for keyframes with no `shape` of their own
  mirror: boolean;
  keyframes: CameraKeyframe[]; // sorted by t, first is t = 0, ≤ 64
};

export type VideoEdits = {
  version: 1;
  cuts: Cut[];
  crop: Rect | null;
  zooms: Zoom[];
  overlays: Overlay[];
  markers: Marker[];
  // new
  trim?: { start: number; end: number };
  frame?: FrameConfig;          // from src/lib/recording/types
  camera?: CameraTrack | null;  // null / absent = no camera file
  cameraOffsetMs?: number;
};
```

`Rect` here is the normalized `{x, y, w, h}` from `edits.ts`, not the recorder's
`Rect` with a crop; the bubble's cover-crop is computed at draw time from the camera
aspect. `OverlayType` gains `"click"` in the enum now (renderer draws a ripple at
`rect` centre) so the follow-up only has to produce data.

`parseEdits` validates: `trim.end > trim.start`; keyframes sorted, first `t` forced
to 0, rects clamped; `frame` run through the frame branch of the settings sanitizer, which `settings.ts` exports as a new `sanitizeFrame`; `cameraOffsetMs` clamped to ±5000.

Pure helpers, each with tests:

- `src/lib/editor/camera-track.ts` — `cameraAt(track, t) → {mode, rect, opacity}`
  (interpolation and cross-fade), `upsertKeyframe`, `removeKeyframe`.
- `src/lib/editor/cuts.ts` — `keptRanges(edits, duration)`, `editedDuration`,
  `sourceToEdited`, `editedToSource`, `addCut` (merge/sort).
- `src/lib/editor/edit-ops.ts` — every mutation as a pure `(edits, …) → edits`.
- `src/lib/editor/undo.ts`.

## 4. Renderer, export, upload

**Renderer** (`src/lib/editor/render.ts`): `drawFrame(ctx, sources, t, edits, out)`.

1. Output size from `computeFrameLayout(screenW, screenH, edits.frame)` (existing
   geometry) — with framing off it is the source size. Camera-only mode uses the
   camera dimensions as the "screen."
2. Background (colour / image / video) via the existing compositor background code,
   then the screen drawn into `layout.dest` with `layout.radius` and shadow.
3. Zoom: `zoomAt(zooms, t)` gives the source rect to show (the whole frame when no
   zoom is active, eased over `ramp` seconds at each end). The screen is drawn with
   that rect as its source crop into `layout.dest`; a `toOutput(rect)` helper maps
   source-normalized rects through the zoom for the overlays step.
4. Camera: `cameraAt(track, t)`. `full` draws the camera cover-cropped over the
   whole content rect; `bubble` draws it clipped to `roundedBubblePath` at the
   interpolated rect (scaled from normalized to `layout.dest`). Cross-fade opacity
   applies during a mode switch.
5. Overlays active at `t`, in array order, mapped through `toOutput`, (blur uses a downscaled
   scratch canvas and `ctx.filter`, falling back to solid fill where unsupported).

The staging preview calls `drawFrame` each animation frame into a visible canvas.
The compositor's background helpers and `roundedBubblePath` are exported for reuse
rather than duplicated; the compositor itself is no longer instantiated by the
recorder.

**Export** (`src/lib/editor/export.ts`): `renderToBlob(sources, edits, onProgress,
signal) → Promise<Blob>`.

- Offscreen canvas at output size; `canvas.captureStream(30)`; audio from
  `screenVideo.captureStream().getAudioTracks()` (camera file in camera-only mode)
  merged in; `MediaRecorder` at the existing bitrate/mime selection from `upload.ts`.
- Plays each kept range in order: seek both videos to range start, `play()`, draw on
  every `requestVideoFrameCallback` (rAF fallback), `pause()` at range end; the
  recorder is paused during seeks so cuts are gapless in the output.
- Progress = rendered edited seconds / `editedDuration`. `signal.abort()` stops the
  recorder and rejects; nothing is uploaded.
- Result goes through `fix-webm-duration`, then the existing chunked upload with
  the title/description/slug from Details. Thumbnail: `drawFrame` at the chosen
  time into a JPEG, uploaded via the existing thumbnail route. `videos.edits` is set
  to the staging list in the same `complete` call (new optional field, validated
  server-side with `parseEdits`).
- On success: copy the share link, revoke object URLs, navigate to
  `/library/[id]?new=1` as today.

## 5. Library multi-select delete

- `VideoCard` gains a checkbox (top-left of the thumbnail) that is visible on hover
  and always visible while any card is selected. Shift-click selects the range from
  the last clicked card. Clicking the card body while in selection mode toggles
  instead of navigating.
- Selection state lives in a client `LibraryGrid` wrapper around the existing server
  page output (cards receive `selected`/`onToggle`).
- While the selection is non-empty, `LibraryToolbar` is replaced by a selection bar:
  "N selected", Select all, Clear, Delete.
- Delete: one `window.confirm` with the count, then a new server action
  `deleteVideos(ids: string[])` that re-checks `isOwner()`, validates each id, and
  calls the existing per-video soft-delete + Drive trash in sequence, collecting
  failures. Returns `{ deleted: string[], failed: {id, title, error}[] }`; the bar
  shows failures by title and keeps them selected. `revalidatePath("/library")`.

## 6. Testing

- Unit: `parseEdits` extensions, `camera-track` interpolation and cross-fade timing,
  `cuts` remap round-trips, `edit-ops` invariants, `undo` bounds, `deleteVideos`
  partial-failure shape (db mocked as in `db-phase3.test.ts`).
- Render: a vitest browser-less test is not possible for canvas; instead a script
  under `scripts/` renders two 3-second synthetic streams through `renderToBlob` in
  Electron's renderer (`npm run test:render` in `desktop/`) and asserts duration
  within 100 ms and output dimensions equal to `computeFrameLayout`.
- Manual checklist appended to `docs/overnight-2026-09-02.md`: screen+camera take
  with two keyframes and a full-screen segment; camera-only take; trim + two cuts;
  blur over a password field; cancel mid-render leaves no upload; reload during
  staging keeps edits; multi-select delete of three videos with one forced failure.

## Risks

- `MediaRecorder` on two tracks in one page doubles encoder load on the recording
  machine; the desktop shell is the target and handles it, but the browser fallback
  on a weak laptop may drop camera frames. Mitigation: camera recorder capped at
  720p/24 fps.
- Real-time export means a long take waits its own length before upload. Accepted
  for v1; WebCodecs later.
- Safari lacks `ctx.filter`; blur falls back to solid redact (fail closed).
