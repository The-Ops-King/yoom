# For later

Ideas parked here so they're designed once, at the right phase. Not in any current plan.

## Recording polish (CleanShot X / Screen Studio style)

### 1. Framed capture: padding + colorful background
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
Build #1 in Phase 2 (pure compositor work, browser-only). Build #2–#4 as a Phase 5 "desktop polish" after the Electron shell exists, since all three depend on OS-level cursor data. Phase 2 should still add the overlay-layer seam so Phase 5 doesn't have to refactor the draw loop.
