# For later

Ideas parked here so they're designed once, at the right phase. Not in any current plan.

## Recording polish (CleanShot X / Screen Studio style)

### 1. Framed capture: padding + colorful background — **shipped in Phase 2**
Shipped as `FrameConfig` (`{ enabled, padding, radius, shadow, background }`) in `src/lib/recording/types.ts`, laid out by `computeFrameLayout` in `geometry.ts`, drawn by `compositor.ts`, and persisted in `settings.ts`. The notes below are the original design.

Record the screen inset inside a larger canvas with a gradient / solid / image background, rounded corners, and a drop shadow. User picks the background like CleanShot's "Background" tool.

- **Where it lives:** Phase 2 `compositor.ts`. Today the canvas is locked to the screen's dimensions; add a `frame` config `{ padding, radius, shadow, background: BackgroundConfig }` that enlarges the canvas and draws background → inset screen (rounded clip) → camera bubble. The `BackgroundConfig` type from the camera-bubble backgrounds (`none | blur | color | image | video`) can be reused as-is for the frame background, minus `blur`.
- **Cost:** two extra `drawImage`/`fillRect` calls per frame. Fine at 60 fps.
- **Persist** in `settings.ts` next to bubble/background prefs.
- **Presets:** ship a few gradients in `public/backgrounds/`; allow image upload like the bubble backgrounds.

### 2. Mouse smoothing (synthetic, eased cursor)
Screen Studio-style cursor that glides between positions instead of jittering.

- **Constraint:** the browser never exposes the global cursor position, only the cursor baked into the pixels. So this is an **Electron-only** feature (Phase 4+): the main process polls `screen.getCursorScreenPoint()` at ~120 Hz and streams `{ t, x, y }` over IPC to the renderer.
- **Rendering:** request the display stream with `cursor: "never"` (hides the real cursor in the capture; Chromium honours it), then have the compositor draw a cursor sprite at an eased/interpolated position (spring or exponential smoothing, ~80–120 ms lag). The sprite must be scaled to the capture's device-pixel ratio and the source's crop offset (window/region captures need `source.bounds` from `desktopCapturer`).
- **Foundation to lay in Phase 2:** give the compositor a generic **overlay layer** interface (`draw(ctx, nowMs)`) so cursor, click ripples, and future annotations are plug-ins, not special cases.

### 3. Click notification (ripple / highlight on click)
Visual pulse where the user clicks.

- **Constraint:** global mouse-down events also aren't available in the browser. Electron main can get them via a native hook (`uiohook-napi`), or a cheaper approximation: poll `screen.getCursorScreenPoint()` and detect clicks from the OS via the same hook. Ship with the same IPC event stream as #2 (`{ t, x, y, type: "move" | "down" | "up" }`).
- **Rendering:** overlay layer that spawns an expanding, fading circle at each `down`; optional keystroke badge later.
- **Browser fallback:** inside a *tab* recording, `pointerdown` listeners in the page itself could drive the ripple, but that only covers the recorder's own tab, so probably not worth building.

### 4. Cursor/event sidecar (enables auto-zoom later)
If #2/#3 land, persist the event stream as a JSON sidecar next to the video in Drive (`<slug>-events.json`). That makes post-hoc auto-zoom ("zoom to where the cursor is active", Loom/Screen Studio) possible without re-recording, and lets the watch page render cursor effects on top of a clean recording instead of burning them in.

## Sequencing note
#1 shipped in Phase 2 (pure compositor work, browser-only). #2–#4 remain future work — a Phase 5 "desktop polish" after the Electron shell exists, since all three depend on OS-level cursor data. Phase 2 added the overlay-layer seam (`OverlayLayer`, `compositor.addOverlay`) so Phase 5 doesn't have to refactor the draw loop.

## Phase 1 follow-ups (non-blocking, from the final review, 2026-09-01)

- `src/app/layout.tsx`: Next auto-injects a relative `<link rel="icon" href="/favicon.ico?...">` from `src/app/favicon.ico`, which resolves to the wrong host on `jtylerray.com/v/*`. Move the icon to `public/` and keep only the absolute `metadata.icons` entry.
- `src/components/video-player.tsx` is currently unused; Phase 3's detail page should either reuse it or delete it.
- `/api/stream` `ETag` exposes `drive_file_id`; hash it (cheap) if that ever matters.
- HEAD with a Range on `/api/stream` is RFC-consistent now; rangeless GET on files > 32 MiB returns 206 by design (Chrome/Safari fine; watch Firefox).
- `use-view-tracker`: bfcache restores after `pagehide` never re-close a session (documented).
- `db.test.ts` is mostly mock plumbing; add a real integration test against a Supabase branch before Phase 3 grows the query surface.
- ~~Phase 2 must add the overlay-layer seam in the compositor (see "For later" above) and Safari `video/mp4` codec fallback.~~ Both shipped in Phase 2.
- Verification artefact: video `bc040bca-a0fd-44aa-a8f3-f5843685eeb5` (slug `uunrv7zm`, 700 KB of random bytes named `yoom-verify.webm`) exists in Drive + DB; delete it from the Phase 3 dashboard once that exists, or via SQL + Drive trash.
