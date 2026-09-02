# Phase 2: Recorder upgrades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single 470-line `src/components/recorder.tsx` into a Loom-grade recorder: three capture modes with surface hints, a pre-mixed audio track so mic **and** system audio can both be on and be toggled mid-recording, a draggable camera bubble with shapes/sizes/mirror and an on/off toggle, MediaPipe virtual backgrounds (blur / color / image / **looping video**), CleanShot-style framed capture (padding + gradient background + rounded inset + shadow), countdown / pause / restart / review, hotkeys, an Electron-ready media-source seam, and a plug-in overlay-layer seam in the compositor. The Phase 1 upload flow (`uploadToDrive` → `/api/upload` → `/api/upload/complete` → `/api/upload/thumbnail`) is preserved byte-for-byte, just relocated. `npm run build` and `npm test` pass at every commit.

**Architecture:**
- **One seam for media.** `src/lib/recording/media-sources.ts` is the only file that touches `navigator.mediaDevices`. `getProvider()` returns `{ ...browserProvider, ...window.__yoomDesktop?.mediaSources }`, so Phase 4's Electron preload can override `getDisplay` and `capabilities` without the recorder knowing. `desktop-bridge.ts` declares that global and nothing else.
- **Audio is pre-mixed.** `AudioMixer` owns an `AudioContext` graph (`MediaStreamSource → Gain → MediaStreamDestination`, plus a parallel `Analyser` per source for meters). `mixer.outputTrack` exists from before `MediaRecorder.start()` and never changes, so toggling mic or system audio is a 20 ms gain ramp, not a track swap. This is the fix for `recorder.tsx:222-229`, where mic *replaced* system audio.
- **Rendering is React-free.** `Compositor` owns a `requestAnimationFrame` loop, cached `Path2D` objects, an offscreen camera-layer canvas, and a list of `OverlayLayer`s. React only calls imperative setters (`setBubble`, `setBackground`, `setFrame`). Nothing in the draw loop reads React state.
- **Overlay-layer seam (for-later #2–#4).** `interface OverlayLayer { id: string; draw(ctx, frame: FrameInfo): void }` registered with `compositor.addOverlay(layer)`. Phase 5's eased cursor and click ripples become overlays instead of a draw-loop refactor. Phase 2 ships two trivial built-ins (`createNoopOverlay`, `createFpsOverlay` behind `NEXT_PUBLIC_YOOM_DEBUG_FPS`) so the seam is exercised and unit-tested. **The REC chip / timestamp is deliberately *not* burned into the frame** — it lives in the DOM over the preview.
- **Framed capture (for-later #1).** `FrameConfig { enabled, padding, radius, shadow, background }` enlarges the canvas around the screen source and draws gradient/color/image/video → shadow → rounded-clipped screen → bubble → overlays. Off by default, persisted in settings, four gradient presets shipped as SVG in `public/backgrounds/`.
- **State is a pure reducer.** `recorder-machine.ts` is a plain `(state, event) => state` function with no timers, no media, no React — fully unit-testable. `use-recorder.ts` is the only place effects live.
- **Segmentation never blocks the loop.** `PersonSegmenter` runs its own `requestVideoFrameCallback` loop at 256 px wide and writes an alpha mask into a canvas the compositor samples whenever it happens to be ready.

**Tech Stack:** Next.js 16.2.3 App Router, React 19.2.4, TypeScript 5, Tailwind v4 (tokens: `background`, `surface`, `surface-raised`, `border`, `border-subtle`, `foreground`, `muted`, `muted-dim`, `accent`, `accent-hover`), Vitest 4 (node environment, `@` alias, `server-only` stub, `src/**/*.test.ts`), `@mediapipe/tasks-vision@1.0.1` (pinned; `npm view` confirms `latest` = `1.0.1`), `fix-webm-duration` (unchanged from Phase 1), Node 20 for `scripts/copy-mediapipe.mjs` and `scripts/make-backgrounds.mjs`.

**Deviations from the spec's module list (deliberate, see Self-review):**
- Added `src/lib/recording/types.ts` — every shared type lives there so `overlays.ts`, `settings.ts` and the components can import types without importing the compositor's browser code. `compositor.ts` re-exports them for spec fidelity.
- Added `src/lib/recording/presets.ts` (background + frame preset catalogues) and `src/lib/recording/upload.ts` (the Phase 1 upload flow, extracted so it is unit-testable with a stubbed `fetch`; `use-recorder.ts` calls it).
- Added `src/components/recorder/frame-picker.tsx` (Tyler's framed-capture requirement, not in the original spec component list).

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/lib/recording/types.ts` | Every shared recording type: modes, surface prefs, bubble/background/frame configs, `Rect`, `FrameInfo`, `OverlayLayer`, `Capabilities`, `MediaSourceProvider`, `DisplayCapture`. |
| `src/lib/recording/desktop-bridge.ts` | Declares `window.__yoomDesktop` (version 1) and `getDesktopBridge()` / `isDesktop()` accessors. Nothing else touches the global. |
| `src/lib/recording/media-sources.ts` | Only file calling `navigator.mediaDevices`. Pure `displayConstraints/cameraConstraints/micConstraints`, `browserProvider`, `getProvider()` merge, `browserCapabilities()`. |
| `src/lib/recording/media-sources.test.ts` | Constraint shape + provider-merge + capability tests. |
| `src/lib/recording/settings.ts` | `loadSettings()` / `saveSettings()` / `DEFAULT_SETTINGS` against `localStorage["yoom.recorder.v1"]`, with per-field validation and non-persistable (object-URL) background/frame sources stripped. |
| `src/lib/recording/settings.test.ts` | Load/save/merge/validation tests with a stubbed `localStorage`. |
| `src/lib/recording/recorder-machine.ts` | Pure reducer: states, events, `initialRecorderState()`, `recorderReducer()`, `MAX_DURATION_MS`. |
| `src/lib/recording/recorder-machine.test.ts` | Every transition, including illegal-event no-ops. |
| `src/lib/recording/audio-mixer.ts` | `AudioMixer` class: gain-ramped mic/system sources into one `outputTrack`, analyser levels. |
| `src/lib/recording/audio-mixer.test.ts` | Graph wiring, ramps, disconnect-on-disable, level maths, `close()` — with a stubbed `AudioContext`. |
| `src/lib/recording/geometry.ts` | Pure layout maths: `computeBubbleRect`, `coverCrop`, `bubblePath`, `computeFrameLayout`, `clampNormalized`, `pointerToNormalized`. |
| `src/lib/recording/geometry.test.ts` | Rect/crop/clamp/frame-layout maths; `bubblePath` against a `Path2D` stub. |
| `src/lib/recording/overlays.ts` | `createNoopOverlay()`, `createFpsOverlay()`, `debugOverlaysEnabled()` — exercises the `OverlayLayer` seam. |
| `src/lib/recording/overlays.test.ts` | FPS smoothing + draw calls against a fake 2D context. |
| `src/lib/recording/compositor.ts` | `Compositor` class: rAF draw loop, cached paths, offscreen camera layer, background/frame rendering, overlay dispatch, `captureStream`, `snapshot`. Re-exports the geometry helpers + types. |
| `src/lib/recording/presets.ts` | `BACKGROUND_PRESETS` and `FRAME_PRESETS` catalogues pointing at `public/backgrounds/*.svg`. |
| `src/lib/recording/segmentation.ts` | `PersonSegmenter`: lazy `@mediapipe/tasks-vision` import, own `requestVideoFrameCallback` loop, smoothed alpha `mask` canvas. |
| `src/lib/recording/upload.ts` | `uploadRecording()` — the Phase 1 `/api/upload` → `uploadToDrive` → `/api/upload/complete` → `/api/upload/thumbnail` flow, unchanged, extracted and testable. |
| `src/lib/recording/upload.test.ts` | Flow order, payload shapes, non-fatal thumbnail failure, error propagation (stubbed `fetch`). |
| `src/lib/recording/use-recorder.ts` | The single hook: owns refs for streams/mixer/compositor/segmenter/MediaRecorder/chunks, wires the reducer, timers, hotkeys, bridge shortcuts, thumbnail, upload. |
| `src/components/recorder/mode-picker.tsx` | Screen+Cam / Screen / Camera cards + Entire screen / Window / Tab segmented control + live surface badge. |
| `src/components/recorder/preview-stage.tsx` | Canvas (composited modes) or `<video>` (screen-only) stage + REC/paused chip + drag overlay slot. |
| `src/components/recorder/bubble-drag-overlay.tsx` | Pointer-capture drag that writes a clamped normalized bubble centre. |
| `src/components/recorder/camera-bubble-controls.tsx` | Bubble on/off, shape, size, mirror. |
| `src/components/recorder/background-picker.tsx` | none / blur / colour swatches / preset grid / image upload / video upload (looping). |
| `src/components/recorder/frame-picker.tsx` | Framed-capture toggle, padding, radius, shadow, gradient presets, custom colour/image. |
| `src/components/recorder/audio-controls.tsx` | Mic + system-audio toggles, device pickers, macOS tab-only notice. |
| `src/components/recorder/level-meter.tsx` | 8-segment meter polling `getLevel` at 100 ms. |
| `src/components/recorder/countdown.tsx` | Full-bleed 3-2-1 with Skip. |
| `src/components/recorder/review.tsx` | Object-URL player, duration, thumbnail, Upload / Discard / Restart. |
| `scripts/copy-mediapipe.mjs` | Copies `@mediapipe/tasks-vision/wasm/*` → `public/mediapipe/wasm/`, downloads + caches `selfie_segmenter.tflite` → `public/models/`. Runs in `predev`/`prebuild`. |
| `scripts/make-backgrounds.mjs` | Emits the four gradient preset SVGs into `public/backgrounds/`. |
| `public/backgrounds/*.svg` | Four gradient presets (`sunset`, `ocean`, `graphite`, `mint`), generated, committed. |
| `public/mediapipe/`, `public/models/` | Generated at `predev`/`prebuild`; git-ignored. |

**Modified**

| Path | Change |
|---|---|
| `src/components/recorder.tsx` | Shrinks to a ~130-line shell that calls `useRecorder()` and renders the sub-components. |
| `src/components/device-selector.tsx` | Enumerates through `getProvider()` instead of `navigator.mediaDevices`; same props. |
| `package.json` | `@mediapipe/tasks-vision` dependency; `predev`/`prebuild` scripts. |
| `.gitignore` | Ignore `public/mediapipe/` and `public/models/`. |
| `docs/for-later.md` | Tick off #1 (shipped) and note the overlay seam exists. |

**Deleted**

| Path | Reason |
|---|---|
| `src/components/recording-preview.tsx` | Replaced by `src/components/recorder/preview-stage.tsx`. |

---

## Task 1: Shared recording types + desktop bridge

**Files:** `src/lib/recording/types.ts`, `src/lib/recording/desktop-bridge.ts`, `src/lib/recording/desktop-bridge.test.ts`

- [ ] Write the failing test `src/lib/recording/desktop-bridge.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopBridge, isDesktop } from "./desktop-bridge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop-bridge", () => {
  it("returns null when there is no window", () => {
    vi.stubGlobal("window", undefined);
    expect(getDesktopBridge()).toBeNull();
    expect(isDesktop()).toBe(false);
  });

  it("returns null when the global is absent", () => {
    vi.stubGlobal("window", {});
    expect(getDesktopBridge()).toBeNull();
    expect(isDesktop()).toBe(false);
  });

  it("ignores a bridge with the wrong version", () => {
    vi.stubGlobal("window", { __yoomDesktop: { version: 2, isDesktop: true } });
    expect(getDesktopBridge()).toBeNull();
  });

  it("returns a version-1 bridge", () => {
    const bridge = { version: 1 as const, isDesktop: true };
    vi.stubGlobal("window", { __yoomDesktop: bridge });
    expect(getDesktopBridge()).toBe(bridge);
    expect(isDesktop()).toBe(true);
  });
});
```

- [ ] Run `npx vitest run src/lib/recording/desktop-bridge.test.ts` — expect failure: `Failed to resolve import "./desktop-bridge"`.

- [ ] Create `src/lib/recording/types.ts`:

```ts
/** Every shared type for the recording stack. No runtime code lives here. */

export type RecordingMode = "screen" | "camera" | "screen+camera";
export type SurfacePref = "monitor" | "window" | "browser";

// ---------- media sources ----------

export type SystemAudioSupport = "full" | "tab-only" | "none";

export interface Capabilities {
  /** How much system audio this runtime can capture. */
  systemAudio: SystemAudioSupport;
  /** True when a native (Electron) source picker replaces Chrome's sheet. */
  nativePicker: boolean;
  /** True when `displaySurface` constraints actually steer the picker. */
  surfaceHints: boolean;
}

export interface DisplayCapture {
  stream: MediaStream;
  /** What the user actually chose, read back from the track settings. */
  surface: SurfacePref | "unknown";
  hasSystemAudio: boolean;
}

export interface MediaSourceProvider {
  getDisplay(pref: SurfacePref): Promise<DisplayCapture>;
  getCamera(deviceId?: string): Promise<MediaStream>;
  getMic(deviceId?: string): Promise<MediaStream>;
  warmPermissions(kind: "audioinput" | "videoinput"): Promise<void>;
  enumerateDevices(kind: "audioinput" | "videoinput"): Promise<MediaDeviceInfo[]>;
  capabilities(): Capabilities;
}

// ---------- desktop bridge ----------

export interface DesktopBridge {
  version: 1;
  isDesktop?: boolean;
  mediaSources?: Partial<MediaSourceProvider>;
  capabilities?: Partial<Capabilities>;
  onShortcut?(cb: (action: "toggle" | "pause") => void): () => void;
}

// ---------- compositor ----------

export type BubbleShape = "circle" | "rounded" | "square" | "portrait" | "full";
export type BubbleSize = "small" | "medium" | "large";

export interface BubbleConfig {
  shape: BubbleShape;
  size: BubbleSize;
  /** Normalized centre of the bubble within the canvas, 0..1. */
  pos: { x: number; y: number };
  mirror: boolean;
  /** Tyler: hide/show mid-recording without touching the camera track. */
  visible: boolean;
}

export type BackgroundKind = "none" | "blur" | "color" | "image" | "video";

export interface BackgroundConfig {
  kind: BackgroundKind;
  /** CSS colour for `kind: "color"`. */
  color?: string;
  /** URL for `kind: "image" | "video"` — a `/backgrounds/...` path or a blob: URL. */
  src?: string;
  /** Set when `src` came from the preset catalogue; used to re-select on reload. */
  presetId?: string;
}

export interface FrameConfig {
  enabled: boolean;
  /** Padding as a fraction of the source width, 0..0.2. */
  padding: number;
  /** Corner radius as a fraction of the source width, 0..0.1. */
  radius: number;
  shadow: boolean;
  /** `blur` is meaningless here; the picker only offers none/color/image/video. */
  background: BackgroundConfig;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** object-fit: cover source rect for the media drawn into this rect. */
  crop: CropRect;
}

export interface FrameLayout {
  canvasW: number;
  canvasH: number;
  dest: { x: number; y: number; w: number; h: number };
  radius: number;
}

/** Handed to every overlay layer once per composited frame. */
export interface FrameInfo {
  width: number;
  height: number;
  /** `performance.now()` at the top of this frame. */
  nowMs: number;
  /** Milliseconds since the previous composited frame. */
  deltaMs: number;
  frameIndex: number;
  /** Where the screen was drawn, or null in camera-only layout. */
  screenRect: { x: number; y: number; w: number; h: number } | null;
  /** Where the bubble was drawn, or null when hidden / absent. */
  bubbleRect: Rect | null;
}

/**
 * The compositor's plug-in seam. Phase 5 (eased cursor, click ripples,
 * annotations) registers layers here instead of editing the draw loop.
 */
export interface OverlayLayer {
  id: string;
  draw(ctx: CanvasRenderingContext2D, frame: FrameInfo): void;
}

// ---------- settings ----------

export interface RecorderSettings {
  mode: RecordingMode;
  surfacePref: SurfacePref;
  micId: string;
  cameraId: string;
  micOn: boolean;
  systemOn: boolean;
  bubble: BubbleConfig;
  background: BackgroundConfig;
  frame: FrameConfig;
}
```

- [ ] Create `src/lib/recording/desktop-bridge.ts`:

```ts
import type { DesktopBridge } from "./types";

declare global {
  interface Window {
    __yoomDesktop?: DesktopBridge;
  }
}

/**
 * The Electron seam. Phase 4's preload calls
 * `exposeInMainWorld('__yoomDesktop', { version: 1, isDesktop: true, ... })`.
 * Only a version-1 bridge is honoured, so a future breaking change degrades to
 * plain browser behaviour instead of crashing.
 */
export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.__yoomDesktop;
  if (!bridge || bridge.version !== 1) return null;
  return bridge;
}

export function isDesktop(): boolean {
  return getDesktopBridge()?.isDesktop === true;
}

/** Subscribe to a global hotkey forwarded by the desktop shell. */
export function onDesktopShortcut(
  cb: (action: "toggle" | "pause") => void,
): () => void {
  const bridge = getDesktopBridge();
  if (!bridge?.onShortcut) return () => {};
  return bridge.onShortcut(cb);
}
```

- [ ] Run `npx vitest run src/lib/recording/desktop-bridge.test.ts` — expect PASS (4 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/lib/recording/types.ts src/lib/recording/desktop-bridge.ts src/lib/recording/desktop-bridge.test.ts
git commit -m "feat(recording): shared types and Electron desktop bridge seam

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 2: `media-sources.ts` — the only file touching `navigator.mediaDevices`

**Files:** `src/lib/recording/media-sources.ts`, `src/lib/recording/media-sources.test.ts`

- [ ] Write the failing test `src/lib/recording/media-sources.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserCapabilities,
  cameraConstraints,
  displayConstraints,
  getProvider,
  micConstraints,
  readSurface,
} from "./media-sources";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("displayConstraints", () => {
  it("asks for the requested surface at 60fps/4K", () => {
    const c = displayConstraints("window");
    expect(c.video).toMatchObject({
      displaySurface: "window",
      frameRate: { ideal: 60 },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
    });
  });

  it("always requests system audio with processing disabled", () => {
    const c = displayConstraints("monitor");
    expect(c.audio).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(c.systemAudio).toBe("include");
    expect(c.surfaceSwitching).toBe("include");
    expect(c.selfBrowserSurface).toBe("exclude");
    expect(c.preferCurrentTab).toBe(false);
  });

  it("allows the recorder's own tab to be picked for browser capture", () => {
    expect(displayConstraints("browser").selfBrowserSurface).toBe("include");
  });
});

describe("cameraConstraints / micConstraints", () => {
  it("omits deviceId when none is given", () => {
    expect(cameraConstraints()).toEqual({
      frameRate: { ideal: 60, min: 30 },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    });
    expect(micConstraints()).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it("pins the deviceId exactly when given", () => {
    expect(cameraConstraints("cam-1").deviceId).toEqual({ exact: "cam-1" });
    expect(micConstraints("mic-1").deviceId).toEqual({ exact: "mic-1" });
  });
});

describe("readSurface", () => {
  it("maps known display surfaces", () => {
    expect(readSurface({ displaySurface: "monitor" })).toBe("monitor");
    expect(readSurface({ displaySurface: "browser" })).toBe("browser");
  });

  it("falls back to unknown", () => {
    expect(readSurface({})).toBe("unknown");
    expect(readSurface({ displaySurface: "application" })).toBe("unknown");
  });
});

describe("browserCapabilities", () => {
  it("reports tab-only system audio on macOS", () => {
    expect(browserCapabilities("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140"))
      .toEqual({ systemAudio: "tab-only", nativePicker: false, surfaceHints: true });
  });

  it("reports full system audio on Windows Chrome", () => {
    expect(browserCapabilities("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140").systemAudio)
      .toBe("full");
  });

  it("reports none on Safari and Firefox", () => {
    expect(browserCapabilities("Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15").systemAudio)
      .toBe("none");
    expect(browserCapabilities("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/130").systemAudio)
      .toBe("none");
  });
});

describe("getProvider", () => {
  it("returns the browser provider when no bridge is present", () => {
    vi.stubGlobal("window", {});
    const p = getProvider();
    expect(typeof p.getDisplay).toBe("function");
    expect(p.capabilities().nativePicker).toBe(false);
  });

  it("lets the desktop bridge override individual methods", async () => {
    const getDisplay = vi.fn().mockResolvedValue({
      stream: {} as MediaStream,
      surface: "monitor",
      hasSystemAudio: true,
    });
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        isDesktop: true,
        mediaSources: { getDisplay },
        capabilities: { systemAudio: "full", nativePicker: true },
      },
      navigator: { userAgent: "Mozilla/5.0 (Macintosh) Chrome/140" },
    });

    const p = getProvider();
    await p.getDisplay("monitor");
    expect(getDisplay).toHaveBeenCalledWith("monitor");
    // Bridge capabilities are merged over the browser's, field by field.
    expect(p.capabilities()).toEqual({
      systemAudio: "full",
      nativePicker: true,
      surfaceHints: true,
    });
  });
});
```

- [ ] Run `npx vitest run src/lib/recording/media-sources.test.ts` — expect failure: `Failed to resolve import "./media-sources"`.

- [ ] Create `src/lib/recording/media-sources.ts`:

```ts
import { getDesktopBridge } from "./desktop-bridge";
import type {
  Capabilities,
  DisplayCapture,
  MediaSourceProvider,
  SurfacePref,
} from "./types";

/**
 * `getDisplayMedia` constraints. Pure so it can be asserted in a node test.
 * Chrome only treats `displaySurface` as a hint that pre-selects a tab in the
 * picker; the user can still pick anything, which is why the caller reads the
 * real surface back off the track.
 */
export function displayConstraints(pref: SurfacePref): DisplayMediaStreamOptions &
  Record<string, unknown> {
  return {
    video: {
      displaySurface: pref,
      frameRate: { ideal: 60 },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    systemAudio: "include",
    surfaceSwitching: "include",
    // For tab capture the user may legitimately want to share the recorder's
    // own tab (e.g. a slide deck open next to it); for screens/windows we hide
    // it to avoid the infinity-mirror.
    selfBrowserSurface: pref === "browser" ? "include" : "exclude",
    preferCurrentTab: false,
  };
}

export function cameraConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    frameRate: { ideal: 60, min: 30 },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

export function micConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

export function readSurface(
  settings: Pick<MediaTrackSettings, "displaySurface"> | Record<string, unknown>,
): SurfacePref | "unknown" {
  const s = (settings as { displaySurface?: string }).displaySurface;
  if (s === "monitor" || s === "window" || s === "browser") return s;
  return "unknown";
}

/**
 * What the *browser* can do. macOS Chrome only delivers system audio for tab
 * captures (an OS restriction); Windows Chrome delivers it for screens and
 * windows too; Safari and Firefox deliver none.
 */
export function browserCapabilities(userAgent: string): Capabilities {
  const ua = userAgent;
  const isFirefox = /Firefox\//.test(ua);
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua);
  const isMac = /Macintosh|Mac OS X/.test(ua);

  let systemAudio: Capabilities["systemAudio"] = "full";
  if (isFirefox || isSafari) systemAudio = "none";
  else if (isMac) systemAudio = "tab-only";

  return {
    systemAudio,
    nativePicker: false,
    surfaceHints: !isFirefox && !isSafari,
  };
}

function mediaDevices(): MediaDevices {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    throw new Error("This browser cannot capture media.");
  }
  return navigator.mediaDevices;
}

export const browserProvider: MediaSourceProvider = {
  async getDisplay(pref: SurfacePref): Promise<DisplayCapture> {
    const stream = await mediaDevices().getDisplayMedia(
      displayConstraints(pref) as DisplayMediaStreamOptions,
    );
    const track = stream.getVideoTracks()[0];
    return {
      stream,
      surface: track ? readSurface(track.getSettings()) : "unknown",
      hasSystemAudio: stream.getAudioTracks().length > 0,
    };
  },

  getCamera(deviceId?: string): Promise<MediaStream> {
    // Never ask for audio here — the mic is always its own stream so the mixer
    // owns it and a camera restart cannot drop the microphone.
    return mediaDevices().getUserMedia({
      video: cameraConstraints(deviceId),
      audio: false,
    });
  },

  getMic(deviceId?: string): Promise<MediaStream> {
    return mediaDevices().getUserMedia({ audio: micConstraints(deviceId), video: false });
  },

  async warmPermissions(kind: "audioinput" | "videoinput"): Promise<void> {
    try {
      const stream = await mediaDevices().getUserMedia(
        kind === "audioinput" ? { audio: true } : { video: true },
      );
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Denied — device labels stay blank, which the picker handles.
    }
  },

  async enumerateDevices(kind: "audioinput" | "videoinput"): Promise<MediaDeviceInfo[]> {
    const all = await mediaDevices().enumerateDevices();
    return all.filter((d) => d.kind === kind);
  },

  capabilities(): Capabilities {
    const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
    return browserCapabilities(ua);
  },
};

/**
 * The provider the whole app uses. Electron's preload supplies overrides for
 * `getDisplay` (native picker + CoreAudio loopback) and `capabilities`.
 */
export function getProvider(): MediaSourceProvider {
  const bridge = getDesktopBridge();
  if (!bridge) return browserProvider;

  const merged: MediaSourceProvider = { ...browserProvider, ...bridge.mediaSources };

  if (bridge.capabilities) {
    const overrides = bridge.capabilities;
    const base = bridge.mediaSources?.capabilities ?? browserProvider.capabilities;
    merged.capabilities = () => ({ ...base(), ...overrides });
  }

  return merged;
}
```

- [ ] Run `npx vitest run src/lib/recording/media-sources.test.ts` — expect PASS (11 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/lib/recording/media-sources.ts src/lib/recording/media-sources.test.ts
git commit -m "feat(recording): media-sources provider with Electron override seam

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 3: Route `DeviceSelector` through the provider

**Files:** `src/components/device-selector.tsx`

No behaviour change — this only removes the second `navigator.mediaDevices` call site so Electron can override it. Props stay identical, so `recorder.tsx` is untouched.

- [ ] Replace `src/components/device-selector.tsx` entirely:

```tsx
"use client";

import { useEffect, useState } from "react";
import { getProvider } from "@/lib/recording/media-sources";

interface DeviceSelectorProps {
  kind: "audioinput" | "videoinput";
  label: string;
  value: string;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
}

export function DeviceSelector({
  kind,
  label,
  value,
  onChange,
  disabled = false,
}: DeviceSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    const provider = getProvider();

    async function loadDevices() {
      // Labels are only exposed after a permission grant.
      await provider.warmPermissions(kind);
      const filtered = await provider.enumerateDevices(kind);
      if (cancelled) return;
      setDevices(filtered);
      if (filtered.length > 0 && !value) onChange(filtered[0].deviceId);
    }

    void loadDevices();

    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    const onChangeDevices = () => {
      void provider.enumerateDevices(kind).then((d) => {
        if (!cancelled) setDevices(d);
      });
    };
    md?.addEventListener?.("devicechange", onChangeDevices);

    return () => {
      cancelled = true;
      md?.removeEventListener?.("devicechange", onChangeDevices);
    };
    // `value`/`onChange` are intentionally excluded: re-running on every
    // selection would re-prompt for permissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-dim uppercase tracking-wider">
        {label}
      </label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="device-select w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {devices.length === 0 && <option value="">No devices found</option>}
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label ||
              `${kind === "audioinput" ? "Microphone" : "Camera"} ${device.deviceId.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] Run `npm run lint` — expect PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Manual smoke: `npm run dev`, load `/`, confirm the Microphone and Camera dropdowns still populate.
- [ ] Commit:

```bash
git add src/components/device-selector.tsx
git commit -m "refactor(recorder): enumerate devices through the media-source provider

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 4: `settings.ts` — persisted recorder preferences

**Files:** `src/lib/recording/settings.ts`, `src/lib/recording/settings.test.ts`

- [ ] Write the failing test `src/lib/recording/settings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  saveSettings,
} from "./settings";

function makeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  storage = makeStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults system audio on and the bubble visible", () => {
    expect(DEFAULT_SETTINGS.systemOn).toBe(true);
    expect(DEFAULT_SETTINGS.micOn).toBe(true);
    expect(DEFAULT_SETTINGS.bubble.visible).toBe(true);
    expect(DEFAULT_SETTINGS.frame.enabled).toBe(false);
  });

  it("merges stored values over the defaults", () => {
    storage.map.set(
      SETTINGS_KEY,
      JSON.stringify({ mode: "camera", micOn: false, bubble: { shape: "square" } }),
    );
    const s = loadSettings();
    expect(s.mode).toBe("camera");
    expect(s.micOn).toBe(false);
    expect(s.bubble.shape).toBe("square");
    // untouched nested fields keep their defaults
    expect(s.bubble.size).toBe(DEFAULT_SETTINGS.bubble.size);
  });

  it("rejects invalid enum values and out-of-range numbers", () => {
    storage.map.set(
      SETTINGS_KEY,
      JSON.stringify({
        mode: "hologram",
        surfacePref: "nope",
        bubble: { shape: "triangle", size: "huge", pos: { x: 9, y: -4 } },
        frame: { enabled: true, padding: 5, radius: -1 },
      }),
    );
    const s = loadSettings();
    expect(s.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(s.surfacePref).toBe(DEFAULT_SETTINGS.surfacePref);
    expect(s.bubble.shape).toBe(DEFAULT_SETTINGS.bubble.shape);
    expect(s.bubble.size).toBe(DEFAULT_SETTINGS.bubble.size);
    expect(s.bubble.pos).toEqual({ x: 1, y: 0 });
    expect(s.frame.enabled).toBe(true);
    expect(s.frame.padding).toBe(0.2);
    expect(s.frame.radius).toBe(0);
  });

  it("survives corrupt JSON", () => {
    storage.map.set(SETTINGS_KEY, "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saveSettings", () => {
  it("round-trips through localStorage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, cameraId: "cam-9", systemOn: false });
    const s = loadSettings();
    expect(s.cameraId).toBe("cam-9");
    expect(s.systemOn).toBe(false);
  });

  it("drops blob: sources that cannot survive a reload", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      background: { kind: "video", src: "blob:http://x/abc" },
      frame: {
        ...DEFAULT_SETTINGS.frame,
        background: { kind: "image", src: "blob:http://x/def" },
      },
    });
    const s = loadSettings();
    expect(s.background).toEqual({ kind: "none" });
    expect(s.frame.background).toEqual({ kind: "none" });
  });

  it("keeps preset sources served from /backgrounds", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      background: { kind: "image", src: "/backgrounds/ocean.svg", presetId: "ocean" },
    });
    expect(loadSettings().background).toEqual({
      kind: "image",
      src: "/backgrounds/ocean.svg",
      presetId: "ocean",
    });
  });

  it("never throws when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] Run `npx vitest run src/lib/recording/settings.test.ts` — expect failure: `Failed to resolve import "./settings"`.

- [ ] Create `src/lib/recording/settings.ts`:

```ts
import type {
  BackgroundConfig,
  BackgroundKind,
  BubbleConfig,
  BubbleShape,
  BubbleSize,
  FrameConfig,
  RecorderSettings,
  RecordingMode,
  SurfacePref,
} from "./types";

export const SETTINGS_KEY = "yoom.recorder.v1";

export const DEFAULT_BUBBLE: BubbleConfig = {
  shape: "circle",
  size: "medium",
  pos: { x: 0.86, y: 0.82 },
  mirror: true,
  visible: true,
};

export const DEFAULT_BACKGROUND: BackgroundConfig = { kind: "none" };

export const DEFAULT_FRAME: FrameConfig = {
  enabled: false,
  padding: 0.05,
  radius: 0.012,
  shadow: true,
  background: { kind: "color", color: "#1a1a1e" },
};

export const DEFAULT_SETTINGS: RecorderSettings = {
  mode: "screen+camera",
  surfacePref: "monitor",
  micId: "",
  cameraId: "",
  micOn: true,
  // System audio is on by default per the spec; the UI explains when the
  // platform cannot deliver it.
  systemOn: true,
  bubble: DEFAULT_BUBBLE,
  background: DEFAULT_BACKGROUND,
  frame: DEFAULT_FRAME,
};

const MODES: RecordingMode[] = ["screen", "camera", "screen+camera"];
const SURFACES: SurfacePref[] = ["monitor", "window", "browser"];
const SHAPES: BubbleShape[] = ["circle", "rounded", "square", "portrait", "full"];
const SIZES: BubbleSize[] = ["small", "medium", "large"];
const KINDS: BackgroundKind[] = ["none", "blur", "color", "image", "video"];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Only same-origin `/`-rooted URLs survive a reload; blob: URLs do not. */
function persistableSrc(src: string | undefined): string | undefined {
  return src && src.startsWith("/") ? src : undefined;
}

function sanitizeBackground(
  raw: unknown,
  fallback: BackgroundConfig,
): BackgroundConfig {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const kind = pick(r.kind, KINDS, fallback.kind);
  const src = persistableSrc(typeof r.src === "string" ? r.src : undefined);
  if ((kind === "image" || kind === "video") && !src) return { kind: "none" };
  const out: BackgroundConfig = { kind };
  if (typeof r.color === "string") out.color = r.color;
  if (src) out.src = src;
  if (typeof r.presetId === "string") out.presetId = r.presetId;
  return out;
}

function sanitize(raw: unknown): RecorderSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const r = raw as Record<string, unknown>;
  const bubbleRaw = (r.bubble ?? {}) as Record<string, unknown>;
  const posRaw = (bubbleRaw.pos ?? {}) as Record<string, unknown>;
  const frameRaw = (r.frame ?? {}) as Record<string, unknown>;

  return {
    mode: pick(r.mode, MODES, DEFAULT_SETTINGS.mode),
    surfacePref: pick(r.surfacePref, SURFACES, DEFAULT_SETTINGS.surfacePref),
    micId: str(r.micId, DEFAULT_SETTINGS.micId),
    cameraId: str(r.cameraId, DEFAULT_SETTINGS.cameraId),
    micOn: bool(r.micOn, DEFAULT_SETTINGS.micOn),
    systemOn: bool(r.systemOn, DEFAULT_SETTINGS.systemOn),
    bubble: {
      shape: pick(bubbleRaw.shape, SHAPES, DEFAULT_BUBBLE.shape),
      size: pick(bubbleRaw.size, SIZES, DEFAULT_BUBBLE.size),
      pos: {
        x: num(posRaw.x, DEFAULT_BUBBLE.pos.x, 0, 1),
        y: num(posRaw.y, DEFAULT_BUBBLE.pos.y, 0, 1),
      },
      mirror: bool(bubbleRaw.mirror, DEFAULT_BUBBLE.mirror),
      visible: bool(bubbleRaw.visible, DEFAULT_BUBBLE.visible),
    },
    background: sanitizeBackground(r.background, DEFAULT_BACKGROUND),
    frame: {
      enabled: bool(frameRaw.enabled, DEFAULT_FRAME.enabled),
      padding: num(frameRaw.padding, DEFAULT_FRAME.padding, 0, 0.2),
      radius: num(frameRaw.radius, DEFAULT_FRAME.radius, 0, 0.1),
      shadow: bool(frameRaw.shadow, DEFAULT_FRAME.shadow),
      background: sanitizeBackground(frameRaw.background, DEFAULT_FRAME.background),
    },
  };
}

export function loadSettings(): RecorderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: RecorderSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitize(settings)));
  } catch {
    // Private mode / storage disabled — preferences simply do not persist.
  }
}
```

- [ ] Run `npx vitest run src/lib/recording/settings.test.ts` — expect PASS (9 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/lib/recording/settings.ts src/lib/recording/settings.test.ts
git commit -m "feat(recording): persisted recorder settings with validation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 5: `recorder-machine.ts` — the pure reducer

**Files:** `src/lib/recording/recorder-machine.ts`, `src/lib/recording/recorder-machine.test.ts`

- [ ] Write the failing test `src/lib/recording/recorder-machine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import {
  MAX_DURATION_MS,
  initialRecorderState,
  recorderReducer,
  type RecorderEvent,
  type RecorderState,
} from "./recorder-machine";

const init = () => initialRecorderState(DEFAULT_SETTINGS);

function run(state: RecorderState, events: RecorderEvent[]): RecorderState {
  return events.reduce(recorderReducer, state);
}

const ACQUIRED: RecorderEvent = {
  type: "ACQUIRED",
  surface: "monitor",
  hasSystemAudio: true,
  hasCamera: true,
};

describe("initialRecorderState", () => {
  it("starts idle with the persisted preferences applied", () => {
    const s = init();
    expect(s.status).toBe("idle");
    expect(s.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(s.micOn).toBe(true);
    expect(s.systemOn).toBe(true);
    expect(s.streamsAlive).toBe(false);
  });
});

describe("acquisition", () => {
  it("idle → acquiring → setup", () => {
    const s = run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);
    expect(s.status).toBe("setup");
    expect(s.surface).toBe("monitor");
    expect(s.hasSystemAudio).toBe(true);
    expect(s.streamsAlive).toBe(true);
    expect(s.error).toBe("");
  });

  it("ACQUIRE_FAILED goes to error and clears streams", () => {
    const s = run(init(), [{ type: "ACQUIRE" }, { type: "ACQUIRE_FAILED", error: "denied" }]);
    expect(s.status).toBe("error");
    expect(s.error).toBe("denied");
    expect(s.streamsAlive).toBe(false);
  });

  it("RESET from error returns to idle keeping preferences", () => {
    const s = run(init(), [
      { type: "SELECT_MODE", mode: "camera" },
      { type: "ACQUIRE" },
      { type: "ACQUIRE_FAILED", error: "denied" },
      { type: "RESET" },
    ]);
    expect(s.status).toBe("idle");
    expect(s.mode).toBe("camera");
    expect(s.error).toBe("");
  });

  it("ignores ACQUIRED when not acquiring", () => {
    const s = init();
    expect(recorderReducer(s, ACQUIRED)).toBe(s);
  });
});

describe("mode and surface selection", () => {
  it("SELECT_MODE and SET_SURFACE_PREF only apply while idle or in setup", () => {
    const idle = recorderReducer(init(), { type: "SELECT_MODE", mode: "screen" });
    expect(idle.mode).toBe("screen");

    const recording = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
    ]);
    expect(recording.status).toBe("recording");
    expect(recorderReducer(recording, { type: "SELECT_MODE", mode: "camera" })).toBe(recording);
    expect(
      recorderReducer(recording, { type: "SET_SURFACE_PREF", pref: "window" }),
    ).toBe(recording);
  });
});

describe("countdown and recording", () => {
  const setup = () => run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);

  it("START enters a 3-second countdown", () => {
    const s = recorderReducer(setup(), { type: "START" });
    expect(s.status).toBe("countdown");
    expect(s.countdown).toBe(3);
  });

  it("COUNTDOWN_TICK walks down and then starts recording", () => {
    let s = recorderReducer(setup(), { type: "START" });
    s = recorderReducer(s, { type: "COUNTDOWN_TICK" });
    expect(s.countdown).toBe(2);
    s = recorderReducer(s, { type: "COUNTDOWN_TICK" });
    expect(s.countdown).toBe(1);
    s = recorderReducer(s, { type: "COUNTDOWN_TICK" });
    expect(s.status).toBe("recording");
    expect(s.elapsedMs).toBe(0);
  });

  it("SKIP_COUNTDOWN jumps straight to recording", () => {
    const s = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    expect(s.status).toBe("recording");
  });

  it("TICK accumulates elapsed only while recording", () => {
    const rec = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    const ticked = recorderReducer(rec, { type: "TICK", elapsedMs: 4200 });
    expect(ticked.elapsedMs).toBe(4200);

    const paused = recorderReducer(ticked, { type: "PAUSE" });
    expect(paused.status).toBe("paused");
    expect(recorderReducer(paused, { type: "TICK", elapsedMs: 9999 }).elapsedMs).toBe(4200);
  });

  it("PAUSE ⇄ RESUME", () => {
    const rec = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    const paused = recorderReducer(rec, { type: "PAUSE" });
    expect(paused.status).toBe("paused");
    expect(recorderReducer(paused, { type: "RESUME" }).status).toBe("recording");
    // PAUSE while paused is a no-op
    expect(recorderReducer(paused, { type: "PAUSE" })).toBe(paused);
  });

  it("STOP from recording and from paused both go to stopping", () => {
    const rec = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    expect(recorderReducer(rec, { type: "STOP" }).status).toBe("stopping");
    const paused = recorderReducer(rec, { type: "PAUSE" });
    expect(recorderReducer(paused, { type: "STOP" }).status).toBe("stopping");
  });

  it("MAX_DURATION stops the recording", () => {
    const rec = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    const s = recorderReducer(rec, { type: "MAX_DURATION" });
    expect(s.status).toBe("stopping");
    expect(s.notice).toContain("30");
    expect(MAX_DURATION_MS).toBe(30 * 60 * 1000);
  });

  it("RESTART clears elapsed and returns to countdown", () => {
    const rec = run(setup(), [
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "TICK", elapsedMs: 5000 },
      { type: "RESTART" },
    ]);
    expect(rec.status).toBe("countdown");
    expect(rec.countdown).toBe(3);
    expect(rec.elapsedMs).toBe(0);
  });
});

describe("STREAM_ENDED", () => {
  it("in setup returns to idle", () => {
    const s = run(init(), [{ type: "ACQUIRE" }, ACQUIRED, { type: "STREAM_ENDED" }]);
    expect(s.status).toBe("idle");
    expect(s.streamsAlive).toBe(false);
  });

  it("while recording stops the recording", () => {
    const s = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "STREAM_ENDED" },
    ]);
    expect(s.status).toBe("stopping");
    expect(s.streamsAlive).toBe(false);
  });
});

describe("review, upload and done", () => {
  const stopped = () =>
    run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "TICK", elapsedMs: 12_000 },
      { type: "STOP" },
    ]);

  const blob = { size: 1234 } as Blob;

  it("BLOB_READY moves to review with the recording metadata", () => {
    const s = recorderReducer(stopped(), {
      type: "BLOB_READY",
      blob,
      durationMs: 12_000,
      width: 1920,
      height: 1080,
    });
    expect(s.status).toBe("review");
    expect(s.blob).toBe(blob);
    expect(s.durationMs).toBe(12_000);
    expect(s.width).toBe(1920);
  });

  it("DISCARD returns to setup while streams are alive and to idle otherwise", () => {
    const review = recorderReducer(stopped(), {
      type: "BLOB_READY",
      blob,
      durationMs: 1,
      width: 2,
      height: 3,
    });
    expect(recorderReducer(review, { type: "DISCARD" }).status).toBe("setup");
    expect(recorderReducer(review, { type: "DISCARD" }).blob).toBeNull();

    const dead = { ...review, streamsAlive: false };
    expect(recorderReducer(dead, { type: "DISCARD" }).status).toBe("idle");
  });

  it("UPLOAD → UPLOAD_PROGRESS → UPLOAD_DONE", () => {
    const review = recorderReducer(stopped(), {
      type: "BLOB_READY",
      blob,
      durationMs: 1,
      width: 2,
      height: 3,
    });
    let s = recorderReducer(review, { type: "UPLOAD" });
    expect(s.status).toBe("uploading");
    expect(s.uploadProgress).toBe(0);
    s = recorderReducer(s, { type: "UPLOAD_PROGRESS", percent: 62 });
    expect(s.uploadProgress).toBe(62);
    s = recorderReducer(s, {
      type: "UPLOAD_DONE",
      videoId: "vid-1",
      shareUrl: "https://jtylerray.com/v/abc",
    });
    expect(s.status).toBe("done");
    expect(s.shareUrl).toBe("https://jtylerray.com/v/abc");
    expect(s.blob).toBeNull();
  });

  it("UPLOAD_FAILED returns to review with an error so the blob can be retried", () => {
    const uploading = run(stopped(), [
      { type: "BLOB_READY", blob, durationMs: 1, width: 2, height: 3 },
      { type: "UPLOAD" },
      { type: "UPLOAD_FAILED", error: "network" },
    ]);
    expect(uploading.status).toBe("review");
    expect(uploading.error).toBe("network");
    expect(uploading.blob).toBe(blob);
  });
});

describe("live toggles", () => {
  it("TOGGLE_MIC / TOGGLE_SYSTEM flip in any state", () => {
    const rec = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
    ]);
    expect(recorderReducer(rec, { type: "TOGGLE_MIC" }).micOn).toBe(false);
    expect(recorderReducer(rec, { type: "TOGGLE_SYSTEM" }).systemOn).toBe(false);
    expect(
      recorderReducer(rec, { type: "TOGGLE_MIC", on: true }).micOn,
    ).toBe(true);
  });

  it("SET_BUBBLE merges partial bubble config", () => {
    const rec = run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);
    const s = recorderReducer(rec, { type: "SET_BUBBLE", patch: { visible: false } });
    expect(s.bubble.visible).toBe(false);
    expect(s.bubble.shape).toBe(DEFAULT_SETTINGS.bubble.shape);
  });

  it("SET_BACKGROUND and SET_FRAME replace/merge their configs", () => {
    const s0 = run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);
    const s1 = recorderReducer(s0, {
      type: "SET_BACKGROUND",
      background: { kind: "color", color: "#123456" },
    });
    expect(s1.background).toEqual({ kind: "color", color: "#123456" });
    const s2 = recorderReducer(s1, { type: "SET_FRAME", patch: { enabled: true } });
    expect(s2.frame.enabled).toBe(true);
    expect(s2.frame.padding).toBe(DEFAULT_SETTINGS.frame.padding);
  });

  it("SET_DEVICE stores mic and camera ids", () => {
    const s = run(init(), [
      { type: "SET_DEVICE", kind: "mic", deviceId: "m1" },
      { type: "SET_DEVICE", kind: "camera", deviceId: "c1" },
    ]);
    expect(s.micId).toBe("m1");
    expect(s.cameraId).toBe("c1");
  });
});

describe("unknown transitions", () => {
  it("returns the same object reference for a no-op", () => {
    const s = init();
    expect(recorderReducer(s, { type: "PAUSE" })).toBe(s);
    expect(recorderReducer(s, { type: "UPLOAD" })).toBe(s);
    expect(recorderReducer(s, { type: "COUNTDOWN_TICK" })).toBe(s);
  });
});
```

- [ ] Run `npx vitest run src/lib/recording/recorder-machine.test.ts` — expect failure: `Failed to resolve import "./recorder-machine"`.

- [ ] Create `src/lib/recording/recorder-machine.ts`:

```ts
import { DEFAULT_SETTINGS } from "./settings";
import type {
  BackgroundConfig,
  BubbleConfig,
  FrameConfig,
  RecorderSettings,
  RecordingMode,
  SurfacePref,
} from "./types";

export const COUNTDOWN_SECONDS = 3;
export const MAX_DURATION_MS = 30 * 60 * 1000;

export type RecorderStatus =
  | "idle"
  | "acquiring"
  | "setup"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "review"
  | "uploading"
  | "done"
  | "error";

export interface RecorderState {
  status: RecorderStatus;

  // preferences (mirrored into settings.ts by the hook)
  mode: RecordingMode;
  surfacePref: SurfacePref;
  micId: string;
  cameraId: string;
  micOn: boolean;
  systemOn: boolean;
  bubble: BubbleConfig;
  background: BackgroundConfig;
  frame: FrameConfig;

  // live capture facts
  streamsAlive: boolean;
  surface: SurfacePref | "unknown" | null;
  hasSystemAudio: boolean;
  hasCamera: boolean;

  // timing
  countdown: number;
  elapsedMs: number;

  // result
  blob: Blob | null;
  durationMs: number;
  width: number | null;
  height: number | null;

  // upload
  uploadProgress: number;
  videoId: string;
  shareUrl: string;

  // messaging
  error: string;
  notice: string;
}

export type RecorderEvent =
  | { type: "SELECT_MODE"; mode: RecordingMode }
  | { type: "SET_SURFACE_PREF"; pref: SurfacePref }
  | { type: "SET_DEVICE"; kind: "mic" | "camera"; deviceId: string }
  | { type: "ACQUIRE" }
  | {
      type: "ACQUIRED";
      surface: SurfacePref | "unknown";
      hasSystemAudio: boolean;
      hasCamera: boolean;
    }
  | { type: "ACQUIRE_FAILED"; error: string }
  | { type: "START" }
  | { type: "COUNTDOWN_TICK" }
  | { type: "SKIP_COUNTDOWN" }
  | { type: "TICK"; elapsedMs: number }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "STOP" }
  | { type: "RESTART" }
  | { type: "MAX_DURATION" }
  | { type: "STREAM_ENDED" }
  | {
      type: "BLOB_READY";
      blob: Blob;
      durationMs: number;
      width: number | null;
      height: number | null;
    }
  | { type: "DISCARD" }
  | { type: "UPLOAD" }
  | { type: "UPLOAD_PROGRESS"; percent: number }
  | { type: "UPLOAD_DONE"; videoId: string; shareUrl: string }
  | { type: "UPLOAD_FAILED"; error: string }
  | { type: "RESET" }
  | { type: "TOGGLE_MIC"; on?: boolean }
  | { type: "TOGGLE_SYSTEM"; on?: boolean }
  | { type: "SET_BUBBLE"; patch: Partial<BubbleConfig> }
  | { type: "SET_BACKGROUND"; background: BackgroundConfig }
  | { type: "SET_FRAME"; patch: Partial<FrameConfig> };

export function initialRecorderState(
  settings: RecorderSettings = DEFAULT_SETTINGS,
): RecorderState {
  return {
    status: "idle",
    mode: settings.mode,
    surfacePref: settings.surfacePref,
    micId: settings.micId,
    cameraId: settings.cameraId,
    micOn: settings.micOn,
    systemOn: settings.systemOn,
    bubble: settings.bubble,
    background: settings.background,
    frame: settings.frame,
    streamsAlive: false,
    surface: null,
    hasSystemAudio: false,
    hasCamera: false,
    countdown: COUNTDOWN_SECONDS,
    elapsedMs: 0,
    blob: null,
    durationMs: 0,
    width: null,
    height: null,
    uploadProgress: 0,
    videoId: "",
    shareUrl: "",
    error: "",
    notice: "",
  };
}

const CONFIGURABLE: RecorderStatus[] = ["idle", "setup"];
const LIVE: RecorderStatus[] = ["countdown", "recording", "paused"];

/**
 * Pure. No timers, no media, no React. The hook owns every side effect and
 * feeds facts back in as events.
 */
export function recorderReducer(
  state: RecorderState,
  event: RecorderEvent,
): RecorderState {
  switch (event.type) {
    case "SELECT_MODE":
      if (!CONFIGURABLE.includes(state.status)) return state;
      if (state.mode === event.mode) return state;
      // Changing mode invalidates any acquired stream; the hook tears them down
      // when it sees `streamsAlive` flip to false.
      return {
        ...state,
        mode: event.mode,
        status: "idle",
        streamsAlive: false,
        surface: null,
        hasSystemAudio: false,
        hasCamera: false,
        error: "",
      };

    case "SET_SURFACE_PREF":
      if (!CONFIGURABLE.includes(state.status)) return state;
      return { ...state, surfacePref: event.pref };

    case "SET_DEVICE":
      return event.kind === "mic"
        ? { ...state, micId: event.deviceId }
        : { ...state, cameraId: event.deviceId };

    case "ACQUIRE":
      if (state.status !== "idle" && state.status !== "error") return state;
      return { ...state, status: "acquiring", error: "", notice: "" };

    case "ACQUIRED":
      if (state.status !== "acquiring") return state;
      return {
        ...state,
        status: "setup",
        streamsAlive: true,
        surface: event.surface,
        hasSystemAudio: event.hasSystemAudio,
        hasCamera: event.hasCamera,
        error: "",
      };

    case "ACQUIRE_FAILED":
      return {
        ...state,
        status: "error",
        streamsAlive: false,
        surface: null,
        error: event.error,
      };

    case "START":
      if (state.status !== "setup") return state;
      return {
        ...state,
        status: "countdown",
        countdown: COUNTDOWN_SECONDS,
        elapsedMs: 0,
        notice: "",
      };

    case "COUNTDOWN_TICK": {
      if (state.status !== "countdown") return state;
      const next = state.countdown - 1;
      if (next > 0) return { ...state, countdown: next };
      return { ...state, status: "recording", countdown: 0, elapsedMs: 0 };
    }

    case "SKIP_COUNTDOWN":
      if (state.status !== "countdown") return state;
      return { ...state, status: "recording", countdown: 0, elapsedMs: 0 };

    case "TICK":
      if (state.status !== "recording") return state;
      return { ...state, elapsedMs: event.elapsedMs };

    case "PAUSE":
      if (state.status !== "recording") return state;
      return { ...state, status: "paused" };

    case "RESUME":
      if (state.status !== "paused") return state;
      return { ...state, status: "recording" };

    case "STOP":
      if (state.status !== "recording" && state.status !== "paused") return state;
      return { ...state, status: "stopping" };

    case "MAX_DURATION":
      if (state.status !== "recording" && state.status !== "paused") return state;
      return {
        ...state,
        status: "stopping",
        notice: "Reached the 30 minute limit — wrapping up.",
      };

    case "RESTART":
      if (!LIVE.includes(state.status)) return state;
      return {
        ...state,
        status: "countdown",
        countdown: COUNTDOWN_SECONDS,
        elapsedMs: 0,
        blob: null,
        error: "",
      };

    case "STREAM_ENDED": {
      if (state.status === "recording" || state.status === "paused") {
        return { ...state, status: "stopping", streamsAlive: false };
      }
      if (state.status === "setup" || state.status === "countdown") {
        return { ...state, status: "idle", streamsAlive: false, surface: null };
      }
      if (!state.streamsAlive) return state;
      return { ...state, streamsAlive: false };
    }

    case "BLOB_READY":
      if (state.status !== "stopping") return state;
      return {
        ...state,
        status: "review",
        blob: event.blob,
        durationMs: event.durationMs,
        width: event.width,
        height: event.height,
      };

    case "DISCARD":
      if (state.status !== "review") return state;
      return {
        ...state,
        status: state.streamsAlive ? "setup" : "idle",
        blob: null,
        durationMs: 0,
        elapsedMs: 0,
        error: "",
        notice: "",
      };

    case "UPLOAD":
      if (state.status !== "review") return state;
      return { ...state, status: "uploading", uploadProgress: 0, error: "" };

    case "UPLOAD_PROGRESS":
      if (state.status !== "uploading") return state;
      return { ...state, uploadProgress: event.percent };

    case "UPLOAD_DONE":
      if (state.status !== "uploading") return state;
      return {
        ...state,
        status: "done",
        blob: null,
        uploadProgress: 100,
        videoId: event.videoId,
        shareUrl: event.shareUrl,
      };

    case "UPLOAD_FAILED":
      if (state.status !== "uploading") return state;
      // Stay on review so the user can retry without losing the recording.
      return { ...state, status: "review", error: event.error };

    case "RESET":
      return {
        ...initialRecorderState({
          mode: state.mode,
          surfacePref: state.surfacePref,
          micId: state.micId,
          cameraId: state.cameraId,
          micOn: state.micOn,
          systemOn: state.systemOn,
          bubble: state.bubble,
          background: state.background,
          frame: state.frame,
        }),
      };

    case "TOGGLE_MIC":
      return { ...state, micOn: event.on ?? !state.micOn };

    case "TOGGLE_SYSTEM":
      return { ...state, systemOn: event.on ?? !state.systemOn };

    case "SET_BUBBLE":
      return { ...state, bubble: { ...state.bubble, ...event.patch } };

    case "SET_BACKGROUND":
      return { ...state, background: event.background };

    case "SET_FRAME":
      return { ...state, frame: { ...state.frame, ...event.patch } };

    default:
      return state;
  }
}
```

- [ ] Run `npx vitest run src/lib/recording/recorder-machine.test.ts` — expect PASS (24 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/lib/recording/recorder-machine.ts src/lib/recording/recorder-machine.test.ts
git commit -m "feat(recording): pure recorder state machine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 6: `audio-mixer.ts` — one output track, gain-ramped toggles

This is the fix for the Phase 1 defect at `recorder.tsx:222-229` where a mic replaced system audio.

**Files:** `src/lib/recording/audio-mixer.ts`, `src/lib/recording/audio-mixer.test.ts`

- [ ] Write the failing test `src/lib/recording/audio-mixer.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioMixer } from "./audio-mixer";

class FakeParam {
  value = 1;
  calls: Array<[string, number, number]> = [];
  cancelScheduledValues(t: number) {
    this.calls.push(["cancel", 0, t]);
  }
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.value = v;
    this.calls.push(["ramp", v, t]);
  }
}

class FakeNode {
  connected: FakeNode[] = [];
  disconnectCount = 0;
  connect(target: FakeNode) {
    this.connected.push(target);
    return target;
  }
  disconnect() {
    this.disconnectCount += 1;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  frequencyBinCount = 128;
  private level = 0;
  setLevel(v: number) {
    this.level = v;
  }
  getByteTimeDomainData(arr: Uint8Array) {
    arr.fill(128 + Math.round(this.level * 127));
  }
}

class FakeDestination extends FakeNode {
  stream = { getAudioTracks: () => [{ kind: "audio", id: "out" }] } as unknown as MediaStream;
}

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  sources: FakeNode[] = [];
  gains: FakeGain[] = [];
  analysers: FakeAnalyser[] = [];
  destination = new FakeDestination();
  closed = false;
  resumed = 0;

  createMediaStreamSource() {
    const n = new FakeNode();
    this.sources.push(n);
    return n;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createAnalyser() {
    const a = new FakeAnalyser();
    this.analysers.push(a);
    return a;
  }
  createMediaStreamDestination() {
    return this.destination;
  }
  async resume() {
    this.resumed += 1;
    this.state = "running";
  }
  async close() {
    this.closed = true;
    this.state = "closed";
  }
}

const fakeStream = () => ({ getAudioTracks: () => [{ kind: "audio" }] }) as unknown as MediaStream;

let ctx: FakeAudioContext;
let mixer: AudioMixer;

beforeEach(() => {
  ctx = new FakeAudioContext();
  mixer = new AudioMixer(ctx as unknown as AudioContext);
});

describe("AudioMixer", () => {
  it("exposes an output track before any source is added", () => {
    expect(mixer.outputTrack).toBeTruthy();
    expect(mixer.outputStream.getAudioTracks()).toHaveLength(1);
  });

  it("wires source → gain → destination and source → analyser (pre-gain)", () => {
    mixer.addSource("mic", fakeStream());
    const [source] = ctx.sources;
    const [gain] = ctx.gains;
    const [analyser] = ctx.analysers;
    expect(source.connected).toContain(gain);
    expect(gain.connected).toContain(ctx.destination);
    // The analyser taps the raw source so the meter still moves while muted —
    // that's how the UI can warn "you're talking but the mic is off".
    expect(source.connected).toContain(analyser);
    expect(gain.connected).not.toContain(analyser);
    expect(analyser.fftSize).toBe(256);
  });

  it("starts enabled at unity gain", () => {
    mixer.addSource("mic", fakeStream());
    expect(mixer.isEnabled("mic")).toBe(true);
    expect(ctx.gains[0].gain.value).toBe(1);
  });

  it("adds a source disabled when asked", () => {
    mixer.addSource("system", fakeStream(), { enabled: false });
    expect(mixer.isEnabled("system")).toBe(false);
    expect(ctx.gains[0].gain.value).toBe(0);
  });

  it("ramps to 0 over 20ms and disconnects on disable", () => {
    vi.useFakeTimers();
    mixer.addSource("mic", fakeStream());
    const gain = ctx.gains[0];
    mixer.setEnabled("mic", false);
    expect(gain.gain.calls.some(([k, v]) => k === "ramp" && v === 0)).toBe(true);
    expect(gain.disconnectCount).toBe(0);
    vi.advanceTimersByTime(40);
    expect(gain.disconnectCount).toBe(1);
    vi.useRealTimers();
  });

  it("reconnects and ramps back up on enable", () => {
    vi.useFakeTimers();
    mixer.addSource("mic", fakeStream());
    const gain = ctx.gains[0];
    mixer.setEnabled("mic", false);
    vi.advanceTimersByTime(40);
    mixer.setEnabled("mic", true);
    expect(gain.connected.filter((n) => n === ctx.destination).length).toBe(2);
    expect(gain.gain.calls.at(-1)?.[1]).toBe(1);
    vi.useRealTimers();
  });

  it("is idempotent when toggling to the current value", () => {
    mixer.addSource("mic", fakeStream());
    const before = ctx.gains[0].gain.calls.length;
    mixer.setEnabled("mic", true);
    expect(ctx.gains[0].gain.calls.length).toBe(before);
  });

  it("reports 0 for an unknown source and a positive level for a loud one", () => {
    expect(mixer.getLevel("mic")).toBe(0);
    mixer.addSource("mic", fakeStream());
    ctx.analysers[0].setLevel(0.5);
    expect(mixer.getLevel("mic")).toBeGreaterThan(0.4);
    expect(mixer.getLevel("mic")).toBeLessThanOrEqual(1);
  });

  it("still reports the live level for a disabled source (meter shows input while muted)", () => {
    mixer.addSource("mic", fakeStream());
    ctx.analysers[0].setLevel(0.9);
    mixer.setEnabled("mic", false);
    expect(mixer.getLevel("mic")).toBeGreaterThan(0.5);
  });

  it("replaces a source when the same id is added twice", () => {
    mixer.addSource("mic", fakeStream());
    const first = ctx.gains[0];
    mixer.addSource("mic", fakeStream());
    expect(first.disconnectCount).toBeGreaterThan(0);
    expect(ctx.gains).toHaveLength(2);
    expect(mixer.sourceIds()).toEqual(["mic"]);
  });

  it("removeSource disconnects and forgets it", () => {
    mixer.addSource("system", fakeStream());
    mixer.removeSource("system");
    expect(mixer.hasSource("system")).toBe(false);
    expect(ctx.gains[0].disconnectCount).toBeGreaterThan(0);
  });

  it("close() disconnects everything and closes the context", async () => {
    mixer.addSource("mic", fakeStream());
    mixer.addSource("system", fakeStream());
    await mixer.close();
    expect(ctx.closed).toBe(true);
    expect(mixer.sourceIds()).toEqual([]);
  });

  it("resume() resumes a suspended context", async () => {
    ctx.state = "suspended";
    await mixer.resume();
    expect(ctx.resumed).toBe(1);
  });
});
```

- [ ] Run `npx vitest run src/lib/recording/audio-mixer.test.ts` — expect failure: `Failed to resolve import "./audio-mixer"`.

- [ ] Create `src/lib/recording/audio-mixer.ts`:

```ts
export type AudioSourceId = "mic" | "system";

const RAMP_SECONDS = 0.02;
const DISCONNECT_DELAY_MS = 30;

interface MixerSource {
  stream: MediaStream;
  node: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  buffer: Uint8Array;
  enabled: boolean;
  connected: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Mixes the microphone and system audio into a single output track that exists
 * for the whole recording. MediaRecorder cannot gain or drop tracks after
 * `start()`, so enabling/disabling a source is a 20 ms gain ramp (no click)
 * followed by a disconnect — the recorded track never changes identity.
 */
export class AudioMixer {
  private ctx: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private sources = new Map<AudioSourceId, MixerSource>();

  readonly outputStream: MediaStream;
  readonly outputTrack: MediaStreamTrack;

  constructor(ctx?: AudioContext) {
    this.ctx =
      ctx ??
      new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
    this.destination = this.ctx.createMediaStreamDestination();
    this.outputStream = this.destination.stream;
    this.outputTrack = this.destination.stream.getAudioTracks()[0];
  }

  /** Browsers require a user gesture; the hook calls this from the click. */
  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  addSource(
    id: AudioSourceId,
    stream: MediaStream,
    options: { enabled?: boolean } = {},
  ): void {
    if (this.sources.has(id)) this.removeSource(id);

    const enabled = options.enabled ?? true;
    const node = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;

    node.connect(gain);
    // The analyser taps the raw source (pre-gain) so the meter keeps moving
    // while muted; the UI uses that to warn when you talk with the mic off.
    node.connect(analyser);
    gain.gain.value = enabled ? 1 : 0;
    if (enabled) gain.connect(this.destination);

    this.sources.set(id, {
      stream,
      node,
      gain,
      analyser,
      buffer: new Uint8Array(analyser.frequencyBinCount),
      enabled,
      connected: enabled,
      disconnectTimer: null,
    });
  }

  hasSource(id: AudioSourceId): boolean {
    return this.sources.has(id);
  }

  sourceIds(): AudioSourceId[] {
    return [...this.sources.keys()];
  }

  isEnabled(id: AudioSourceId): boolean {
    return this.sources.get(id)?.enabled ?? false;
  }

  setEnabled(id: AudioSourceId, on: boolean): void {
    const src = this.sources.get(id);
    if (!src || src.enabled === on) return;
    src.enabled = on;

    const now = this.ctx.currentTime;
    if (on) {
      if (src.disconnectTimer) {
        clearTimeout(src.disconnectTimer);
        src.disconnectTimer = null;
      }
      if (!src.connected) {
        src.gain.connect(this.destination);
        src.connected = true;
      }
      src.gain.gain.cancelScheduledValues(now);
      src.gain.gain.setValueAtTime(0, now);
      src.gain.gain.linearRampToValueAtTime(1, now + RAMP_SECONDS);
    } else {
      src.gain.gain.cancelScheduledValues(now);
      src.gain.gain.setValueAtTime(src.gain.gain.value, now);
      src.gain.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS);
      src.disconnectTimer = setTimeout(() => {
        src.disconnectTimer = null;
        if (src.enabled || !src.connected) return;
        try {
          src.gain.disconnect(this.destination);
        } catch {
          // Already disconnected.
        }
        src.connected = false;
      }, DISCONNECT_DELAY_MS);
    }
  }

  /** RMS level 0..1 for a meter. Returns 0 for unknown sources; muted sources still report input. */
  getLevel(id: AudioSourceId): number {
    const src = this.sources.get(id);
    if (!src) return 0;
    src.analyser.getByteTimeDomainData(src.buffer);
    let sum = 0;
    for (let i = 0; i < src.buffer.length; i += 1) {
      const v = (src.buffer[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / src.buffer.length);
    // A little headroom so normal speech fills most of the meter.
    return Math.min(1, rms * 1.8);
  }

  removeSource(id: AudioSourceId): void {
    const src = this.sources.get(id);
    if (!src) return;
    if (src.disconnectTimer) clearTimeout(src.disconnectTimer);
    try {
      src.node.disconnect();
    } catch {
      /* already gone */
    }
    try {
      src.gain.disconnect();
    } catch {
      /* already gone */
    }
    try {
      src.analyser.disconnect();
    } catch {
      /* already gone */
    }
    this.sources.delete(id);
  }

  async close(): Promise<void> {
    for (const id of [...this.sources.keys()]) this.removeSource(id);
    try {
      await this.ctx.close();
    } catch {
      // Already closed.
    }
  }
}
```

- [ ] Run `npx vitest run src/lib/recording/audio-mixer.test.ts` — expect PASS (14 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/lib/recording/audio-mixer.ts src/lib/recording/audio-mixer.test.ts
git commit -m "feat(recording): AudioMixer with a stable output track and ramped toggles

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 7: `geometry.ts` — pure compositor maths

**Files:** `src/lib/recording/geometry.ts`, `src/lib/recording/geometry.test.ts`

- [ ] Write the failing test `src/lib/recording/geometry.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BUBBLE, DEFAULT_FRAME } from "./settings";
import {
  bubblePath,
  clampNormalized,
  computeBubbleRect,
  computeFrameLayout,
  coverCrop,
  pointerToNormalized,
  SIZE_FRACTION,
} from "./geometry";
import type { BubbleConfig } from "./types";

const bubble = (patch: Partial<BubbleConfig> = {}): BubbleConfig => ({
  ...DEFAULT_BUBBLE,
  ...patch,
});

describe("coverCrop", () => {
  it("crops the sides of a wide source into a square", () => {
    expect(coverCrop(1920, 1080, 100, 100)).toEqual({
      sx: 420,
      sy: 0,
      sw: 1080,
      sh: 1080,
    });
  });

  it("crops the top and bottom of a tall source into a wide box", () => {
    expect(coverCrop(1080, 1920, 160, 90)).toEqual({
      sx: 0,
      sy: 656.25,
      sw: 1080,
      sh: 607.5,
    });
  });

  it("returns the whole source when aspects match", () => {
    expect(coverCrop(1280, 720, 640, 360)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it("is safe with degenerate sizes", () => {
    expect(coverCrop(0, 0, 100, 100)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(coverCrop(100, 100, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
  });
});

describe("clampNormalized", () => {
  it("clamps into 0..1", () => {
    expect(clampNormalized(-2)).toBe(0);
    expect(clampNormalized(3)).toBe(1);
    expect(clampNormalized(0.4)).toBe(0.4);
    expect(clampNormalized(Number.NaN)).toBe(0.5);
  });
});

describe("computeBubbleRect", () => {
  it("sizes the bubble as a fraction of canvas width", () => {
    expect(SIZE_FRACTION).toEqual({ small: 0.15, medium: 0.22, large: 0.3 });
    const r = computeBubbleRect(1000, 1000, 1280, 720, bubble({ size: "small", pos: { x: 0.5, y: 0.5 } }));
    expect(r.w).toBe(150);
    expect(r.h).toBe(150); // circle is 1:1
  });

  it("uses 9:16 for portrait and the camera aspect for rounded", () => {
    const portrait = computeBubbleRect(1000, 2000, 1280, 720, bubble({ shape: "portrait", size: "medium" }));
    expect(portrait.w).toBe(220);
    expect(portrait.h).toBe(Math.round((220 * 16) / 9));

    const rounded = computeBubbleRect(1000, 1000, 1280, 720, bubble({ shape: "rounded", size: "medium" }));
    expect(rounded.h).toBe(Math.round(220 * (720 / 1280)));
  });

  it("fills the canvas for the full shape", () => {
    const r = computeBubbleRect(1600, 900, 1280, 720, bubble({ shape: "full" }));
    expect(r).toMatchObject({ x: 0, y: 0, w: 1600, h: 900 });
  });

  it("centres on the normalized position", () => {
    const r = computeBubbleRect(1000, 1000, 1000, 1000, bubble({ size: "small", pos: { x: 0.5, y: 0.25 } }));
    expect(r.x + r.w / 2).toBe(500);
    expect(r.y + r.h / 2).toBe(250);
  });

  it("clamps the bubble inside the canvas", () => {
    const r = computeBubbleRect(1000, 1000, 1000, 1000, bubble({ size: "small", pos: { x: 1, y: 1 } }));
    expect(r.x + r.w).toBe(1000);
    expect(r.y + r.h).toBe(1000);
    const r2 = computeBubbleRect(1000, 1000, 1000, 1000, bubble({ size: "small", pos: { x: 0, y: 0 } }));
    expect(r2.x).toBe(0);
    expect(r2.y).toBe(0);
  });

  it("centres rather than exploding when the bubble is larger than the canvas", () => {
    const r = computeBubbleRect(100, 100, 1280, 720, bubble({ shape: "portrait", size: "large" }));
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.y)).toBe(true);
  });

  it("carries an object-fit-cover crop for the camera", () => {
    const r = computeBubbleRect(1000, 1000, 1280, 720, bubble({ size: "small" }));
    expect(r.crop).toEqual(coverCrop(1280, 720, r.w, r.h));
  });

  it("returns a zero-size rect when the canvas is empty", () => {
    expect(computeBubbleRect(0, 0, 1280, 720, bubble()).w).toBe(0);
  });
});

describe("computeFrameLayout", () => {
  it("is a pass-through when disabled", () => {
    expect(computeFrameLayout(1920, 1080, { ...DEFAULT_FRAME, enabled: false })).toEqual({
      canvasW: 1920,
      canvasH: 1080,
      dest: { x: 0, y: 0, w: 1920, h: 1080 },
      radius: 0,
    });
  });

  it("pads the canvas symmetrically and keeps even dimensions", () => {
    const l = computeFrameLayout(1920, 1080, {
      ...DEFAULT_FRAME,
      enabled: true,
      padding: 0.05,
      radius: 0.01,
    });
    expect(l.canvasW).toBe(2112); // 1920 + 2*96
    expect(l.canvasH).toBe(1272); // 1080 + 2*96
    expect(l.canvasW % 2).toBe(0);
    expect(l.canvasH % 2).toBe(0);
    expect(l.dest).toEqual({ x: 96, y: 96, w: 1920, h: 1080 });
    expect(l.radius).toBe(19);
  });

  it("clamps padding and radius to their allowed ranges", () => {
    const l = computeFrameLayout(1000, 1000, {
      ...DEFAULT_FRAME,
      enabled: true,
      padding: 9,
      radius: -3,
    });
    expect(l.canvasW).toBe(1400); // padding clamped to 0.2
    expect(l.radius).toBe(0);
  });

  it("is a pass-through for degenerate sources", () => {
    expect(computeFrameLayout(0, 0, { ...DEFAULT_FRAME, enabled: true }).canvasW).toBe(0);
  });
});

describe("pointerToNormalized", () => {
  it("maps a client point inside a rect to 0..1", () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(pointerToNormalized(300, 150, rect)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps points outside the rect", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(pointerToNormalized(-40, 400, rect)).toEqual({ x: 0, y: 1 });
  });

  it("returns the centre for a zero-size rect", () => {
    expect(pointerToNormalized(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });
});

describe("bubblePath", () => {
  class StubPath2D {
    ops: string[] = [];
    ellipse() {
      this.ops.push("ellipse");
    }
    rect() {
      this.ops.push("rect");
    }
    roundRect() {
      this.ops.push("roundRect");
    }
    closePath() {
      this.ops.push("close");
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an ellipse for circle, a rect for square and a roundRect otherwise", () => {
    vi.stubGlobal("Path2D", StubPath2D);
    const rect = { x: 0, y: 0, w: 100, h: 100, crop: { sx: 0, sy: 0, sw: 1, sh: 1 } };

    expect((bubblePath(rect, "circle") as unknown as StubPath2D).ops).toContain("ellipse");
    expect((bubblePath(rect, "square") as unknown as StubPath2D).ops).toContain("rect");
    expect((bubblePath(rect, "rounded") as unknown as StubPath2D).ops).toContain("roundRect");
    expect((bubblePath(rect, "portrait") as unknown as StubPath2D).ops).toContain("roundRect");
    expect((bubblePath(rect, "full") as unknown as StubPath2D).ops).toContain("rect");
  });

  it("falls back to rect when roundRect is unavailable", () => {
    class NoRoundRect {
      ops: string[] = [];
      rect() {
        this.ops.push("rect");
      }
      ellipse() {
        this.ops.push("ellipse");
      }
      closePath() {}
    }
    vi.stubGlobal("Path2D", NoRoundRect);
    const rect = { x: 0, y: 0, w: 100, h: 60, crop: { sx: 0, sy: 0, sw: 1, sh: 1 } };
    expect((bubblePath(rect, "rounded") as unknown as NoRoundRect).ops).toEqual(["rect"]);
  });
});
```

- [ ] Run `npx vitest run src/lib/recording/geometry.test.ts` — expect failure: `Failed to resolve import "./geometry"`.

- [ ] Create `src/lib/recording/geometry.ts`:

```ts
import type {
  BubbleConfig,
  BubbleShape,
  BubbleSize,
  CropRect,
  FrameConfig,
  FrameLayout,
  Rect,
} from "./types";

/** Bubble width as a fraction of the canvas width. */
export const SIZE_FRACTION: Record<BubbleSize, number> = {
  small: 0.15,
  medium: 0.22,
  large: 0.3,
};

/** Corner radius of a `rounded`/`portrait` bubble, as a fraction of its short side. */
export const BUBBLE_RADIUS_FRACTION = 0.14;

export function clampNormalized(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/** `object-fit: cover` source rect for drawing srcW×srcH into dstW×dstH. */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): CropRect {
  if (srcW <= 0 || srcH <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  if (dstW <= 0 || dstH <= 0) return { sx: 0, sy: 0, sw: srcW, sh: srcH };

  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;

  if (srcAspect > dstAspect) {
    const sw = srcH * dstAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / dstAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

/**
 * Where the camera bubble lands on a W×H canvas. Pure — the whole layout can be
 * asserted in a node test without a canvas.
 */
export function computeBubbleRect(
  W: number,
  H: number,
  camW: number,
  camH: number,
  cfg: BubbleConfig,
): Rect {
  if (W <= 0 || H <= 0) {
    return { x: 0, y: 0, w: 0, h: 0, crop: { sx: 0, sy: 0, sw: 0, sh: 0 } };
  }

  if (cfg.shape === "full") {
    return { x: 0, y: 0, w: W, h: H, crop: coverCrop(camW, camH, W, H) };
  }

  const w = Math.round(W * SIZE_FRACTION[cfg.size]);
  let h: number;
  switch (cfg.shape) {
    case "circle":
    case "square":
      h = w;
      break;
    case "portrait":
      h = Math.round((w * 16) / 9);
      break;
    case "rounded":
    default:
      h = Math.round(w * (camH > 0 && camW > 0 ? camH / camW : 9 / 16));
      break;
  }

  const cx = clampRange(clampNormalized(cfg.pos.x) * W, w / 2, W - w / 2);
  const cy = clampRange(clampNormalized(cfg.pos.y) * H, h / 2, H - h / 2);

  return {
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    w,
    h,
    crop: coverCrop(camW, camH, w, h),
  };
}

/** The clip/stroke path for a bubble. Uses the global `Path2D`. */
export function bubblePath(rect: Rect, shape: BubbleShape): Path2D {
  const path = new Path2D();
  const { x, y, w, h } = rect;

  if (shape === "circle") {
    path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    path.closePath();
    return path;
  }

  if (shape === "square" || shape === "full") {
    path.rect(x, y, w, h);
    return path;
  }

  const radius = Math.round(Math.min(w, h) * BUBBLE_RADIUS_FRACTION);
  const maybeRound = path as Path2D & {
    roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
  };
  if (typeof maybeRound.roundRect === "function") {
    maybeRound.roundRect(x, y, w, h, radius);
  } else {
    // Safari < 16.4 and the node test stub.
    path.rect(x, y, w, h);
  }
  return path;
}

/**
 * Framed capture (for-later #1): enlarge the canvas and inset the screen.
 * Canvas dimensions are forced even because some encoders reject odd sizes.
 */
export function computeFrameLayout(
  srcW: number,
  srcH: number,
  frame: FrameConfig,
): FrameLayout {
  const passthrough: FrameLayout = {
    canvasW: srcW,
    canvasH: srcH,
    dest: { x: 0, y: 0, w: srcW, h: srcH },
    radius: 0,
  };
  if (!frame.enabled || srcW <= 0 || srcH <= 0) return passthrough;

  const pad = Math.round(srcW * clampRange(frame.padding, 0, 0.2));
  const even = (n: number) => (n % 2 === 0 ? n : n + 1);
  const canvasW = even(srcW + pad * 2);
  const canvasH = even(srcH + pad * 2);

  return {
    canvasW,
    canvasH,
    dest: {
      x: Math.round((canvasW - srcW) / 2),
      y: Math.round((canvasH - srcH) / 2),
      w: srcW,
      h: srcH,
    },
    radius: Math.round(srcW * clampRange(frame.radius, 0, 0.1)),
  };
}

/** Drag helper: a client point inside a DOM rect → a normalized bubble centre. */
export function pointerToNormalized(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 };
  return {
    x: clampNormalized((clientX - rect.left) / rect.width),
    y: clampNormalized((clientY - rect.top) / rect.height),
  };
}
```

- [ ] Run `npx vitest run src/lib/recording/geometry.test.ts` — expect PASS (19 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/lib/recording/geometry.ts src/lib/recording/geometry.test.ts
git commit -m "feat(recording): pure bubble/frame layout geometry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 8: `overlays.ts` — the overlay-layer seam and its built-ins

This exists so for-later #2–#4 (eased cursor, click ripples, annotations) can plug into the draw loop in Phase 5 without touching `compositor.ts`. Phase 2 ships two trivial layers. **The REC indicator is not burned in** — it stays in the DOM.

**Files:** `src/lib/recording/overlays.ts`, `src/lib/recording/overlays.test.ts`

- [ ] Write the failing test `src/lib/recording/overlays.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFpsOverlay, createNoopOverlay, debugOverlaysEnabled } from "./overlays";
import type { FrameInfo } from "./types";

function fakeCtx() {
  const calls: string[] = [];
  return {
    calls,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    fillRect: () => calls.push("fillRect"),
    fillText: (text: string) => calls.push(`fillText:${text}`),
    set font(v: string) {
      calls.push(`font:${v}`);
    },
    set fillStyle(v: string) {
      calls.push(`fillStyle:${v}`);
    },
    set textBaseline(v: string) {
      calls.push(`baseline:${v}`);
    },
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
}

const frame = (patch: Partial<FrameInfo> = {}): FrameInfo => ({
  width: 1920,
  height: 1080,
  nowMs: 1000,
  deltaMs: 16.7,
  frameIndex: 1,
  screenRect: { x: 0, y: 0, w: 1920, h: 1080 },
  bubbleRect: null,
  ...patch,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createNoopOverlay", () => {
  it("has a stable id and draws nothing", () => {
    const ctx = fakeCtx();
    const layer = createNoopOverlay();
    expect(layer.id).toBe("noop");
    layer.draw(ctx, frame());
    expect((ctx as unknown as { calls: string[] }).calls).toEqual([]);
  });
});

describe("createFpsOverlay", () => {
  it("draws a readout once it has a delta", () => {
    const ctx = fakeCtx();
    const layer = createFpsOverlay();
    expect(layer.id).toBe("debug-fps");
    layer.draw(ctx, frame({ deltaMs: 16.666 }));
    const calls = (ctx as unknown as { calls: string[] }).calls;
    expect(calls.some((c) => c.startsWith("fillText:60"))).toBe(true);
    expect(calls).toContain("save");
    expect(calls).toContain("restore");
  });

  it("smooths across frames instead of jumping", () => {
    const ctx = fakeCtx();
    const layer = createFpsOverlay();
    layer.draw(ctx, frame({ deltaMs: 16.666 }));
    layer.draw(ctx, frame({ deltaMs: 100, frameIndex: 2 }));
    const last = (ctx as unknown as { calls: string[] }).calls
      .filter((c) => c.startsWith("fillText:"))
      .at(-1)!;
    const fps = Number(last.split(":")[1].split(" ")[0]);
    // 60 → 10 fps instantly would be a jump; smoothing keeps it in between.
    expect(fps).toBeGreaterThan(10);
    expect(fps).toBeLessThan(60);
  });

  it("ignores a zero or negative delta", () => {
    const ctx = fakeCtx();
    const layer = createFpsOverlay();
    expect(() => layer.draw(ctx, frame({ deltaMs: 0 }))).not.toThrow();
  });
});

describe("debugOverlaysEnabled", () => {
  it("is off unless the env flag is exactly '1'", () => {
    expect(debugOverlaysEnabled(undefined)).toBe(false);
    expect(debugOverlaysEnabled("0")).toBe(false);
    expect(debugOverlaysEnabled("1")).toBe(true);
  });
});
```

- [ ] Run `npx vitest run src/lib/recording/overlays.test.ts` — expect failure: `Failed to resolve import "./overlays"`.

- [ ] Create `src/lib/recording/overlays.ts`:

```ts
import type { FrameInfo, OverlayLayer } from "./types";

/**
 * The seam Phase 5 plugs into: `compositor.addOverlay(layer)` calls
 * `layer.draw(ctx, frame)` once per composited frame, after the screen and the
 * camera bubble, in registration order. Layers must not mutate the context
 * state without save/restore.
 */
export type { OverlayLayer, FrameInfo };

/** The trivial built-in: proves the seam is wired without changing pixels. */
export function createNoopOverlay(id = "noop"): OverlayLayer {
  return {
    id,
    draw() {
      // Intentionally empty.
    },
  };
}

/**
 * Debug-only FPS readout, drawn top-left. Gated by
 * `NEXT_PUBLIC_YOOM_DEBUG_FPS=1` so it never burns into a real recording.
 */
export function createFpsOverlay(id = "debug-fps"): OverlayLayer {
  let smoothed = 0;

  return {
    id,
    draw(ctx: CanvasRenderingContext2D, frame: FrameInfo) {
      if (frame.deltaMs > 0) {
        const instant = 1000 / frame.deltaMs;
        smoothed = smoothed === 0 ? instant : smoothed * 0.9 + instant * 0.1;
      }
      const fps = Math.round(smoothed);
      const text = `${fps} fps · ${frame.width}×${frame.height}`;

      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(16, 16, 220, 34);
      ctx.fillStyle = "#f0f0f2";
      ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 28, 33);
      ctx.restore();
    },
  };
}

export function debugOverlaysEnabled(
  flag: string | undefined = process.env.NEXT_PUBLIC_YOOM_DEBUG_FPS,
): boolean {
  return flag === "1";
}
```

- [ ] Run `npx vitest run src/lib/recording/overlays.test.ts` — expect PASS (5 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/lib/recording/overlays.ts src/lib/recording/overlays.test.ts
git commit -m "feat(recording): OverlayLayer seam with noop and debug FPS built-ins

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 9: `compositor.ts` — the React-free draw loop, frame and overlays

Browser-only; verified in the Task 22 matrix, not by unit tests. The maths it depends on is already covered by Task 7.

**Files:** `src/lib/recording/compositor.ts`

- [ ] Create `src/lib/recording/compositor.ts`:

```ts
import {
  bubblePath,
  computeBubbleRect,
  computeFrameLayout,
  coverCrop,
} from "./geometry";
import type {
  BackgroundConfig,
  BubbleConfig,
  FrameConfig,
  FrameInfo,
  OverlayLayer,
  Rect,
} from "./types";

export {
  bubblePath,
  computeBubbleRect,
  computeFrameLayout,
  coverCrop,
  SIZE_FRACTION,
} from "./geometry";
export type {
  BackgroundConfig,
  BackgroundKind,
  BubbleConfig,
  BubbleShape,
  BubbleSize,
  FrameConfig,
  FrameInfo,
  OverlayLayer,
  Rect,
} from "./types";

export type CompositorLayout = "camera" | "screen+camera";

export interface CompositorSources {
  screen?: MediaStream | null;
  camera?: MediaStream | null;
  /** Alpha mask produced by `PersonSegmenter`; ignored while null. */
  maskCanvas?: HTMLCanvasElement | null;
}

function makeVideo(stream: MediaStream): HTMLVideoElement {
  const el = document.createElement("video");
  el.srcObject = stream;
  el.muted = true;
  el.playsInline = true;
  el.autoplay = true;
  void el.play().catch(() => {});
  return el;
}

/** A hidden, looping, muted <video> for a video background. */
function makeMediaBackgroundVideo(src: string): HTMLVideoElement {
  const el = document.createElement("video");
  el.src = src;
  el.loop = true;
  el.muted = true;
  el.playsInline = true;
  el.autoplay = true;
  el.crossOrigin = "anonymous";
  void el.play().catch(() => {});
  return el;
}

function makeImage(src: string): HTMLImageElement {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  return img;
}

interface ResolvedBackground {
  cfg: BackgroundConfig;
  image: HTMLImageElement | null;
  video: HTMLVideoElement | null;
}

function resolveBackground(cfg: BackgroundConfig): ResolvedBackground {
  return {
    cfg,
    image: cfg.kind === "image" && cfg.src ? makeImage(cfg.src) : null,
    video: cfg.kind === "video" && cfg.src ? makeMediaBackgroundVideo(cfg.src) : null,
  };
}

function releaseBackground(bg: ResolvedBackground | null): void {
  if (!bg) return;
  if (bg.video) {
    bg.video.pause();
    bg.video.removeAttribute("src");
    bg.video.load();
  }
  if (bg.image) bg.image.src = "";
}

function isDrawable(el: HTMLImageElement | HTMLVideoElement | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLVideoElement) return el.readyState >= 2 && el.videoWidth > 0;
  return el.complete && el.naturalWidth > 0;
}

/**
 * Owns the canvas and the rAF loop. Nothing here reads React state — the hook
 * pushes config in through the setters, which only flip dirty flags.
 */
export class Compositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layout: CompositorLayout;

  private screenVideo: HTMLVideoElement | null = null;
  private cameraVideo: HTMLVideoElement | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;

  private bubble: BubbleConfig | null = null;
  private frame: FrameConfig | null = null;
  private background: ResolvedBackground | null = null;
  private frameBackground: ResolvedBackground | null = null;

  private overlays: OverlayLayer[] = [];

  private rafId = 0;
  private running = false;
  private sizeLocked = false;
  private frameIndex = 0;
  private lastFrameMs = 0;

  private cachedRect: Rect | null = null;
  private cachedPath: Path2D | null = null;
  private cacheKey = "";

  private layerCanvas: HTMLCanvasElement;
  private layerCtx: CanvasRenderingContext2D;

  private stream: MediaStream | null = null;

  constructor(canvas: HTMLCanvasElement, layout: CompositorLayout) {
    this.canvas = canvas;
    this.layout = layout;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get a 2D context for the compositor.");
    this.ctx = ctx;

    this.layerCanvas = document.createElement("canvas");
    const layerCtx = this.layerCanvas.getContext("2d");
    if (!layerCtx) throw new Error("Could not get a 2D context for the camera layer.");
    this.layerCtx = layerCtx;
  }

  setSources(sources: CompositorSources): void {
    if (sources.screen !== undefined) {
      this.screenVideo?.pause();
      this.screenVideo = sources.screen ? makeVideo(sources.screen) : null;
    }
    if (sources.camera !== undefined) {
      this.cameraVideo?.pause();
      this.cameraVideo = sources.camera ? makeVideo(sources.camera) : null;
    }
    if (sources.maskCanvas !== undefined) this.maskCanvas = sources.maskCanvas;
    this.cacheKey = "";
  }

  setBubble(cfg: BubbleConfig): void {
    this.bubble = cfg;
    this.cacheKey = "";
  }

  setBackground(cfg: BackgroundConfig): void {
    if (
      this.background &&
      this.background.cfg.kind === cfg.kind &&
      this.background.cfg.src === cfg.src &&
      this.background.cfg.color === cfg.color
    ) {
      return;
    }
    releaseBackground(this.background);
    this.background = resolveBackground(cfg);
  }

  setFrame(cfg: FrameConfig): void {
    const bgChanged =
      !this.frameBackground ||
      this.frameBackground.cfg.kind !== cfg.background.kind ||
      this.frameBackground.cfg.src !== cfg.background.src ||
      this.frameBackground.cfg.color !== cfg.background.color;

    // Padding / enabled / radius change the canvas size or the inset, which
    // the encoder cannot follow once recording. After `lockSize()` only the
    // background and shadow may change; the geometry stays as it was locked.
    this.frame =
      this.sizeLocked && this.frame
        ? {
            ...cfg,
            enabled: this.frame.enabled,
            padding: this.frame.padding,
            radius: this.frame.radius,
          }
        : cfg;
    if (bgChanged) {
      releaseBackground(this.frameBackground);
      this.frameBackground = resolveBackground(cfg.background);
    }
    this.cacheKey = "";
  }

  /**
   * The <video> the compositor decodes the camera stream into. The segmenter
   * reads frames from this same element so the camera is decoded once.
   */
  cameraElement(): HTMLVideoElement | null {
    return this.cameraVideo;
  }

  addOverlay(layer: OverlayLayer): () => void {
    this.overlays = [...this.overlays.filter((l) => l.id !== layer.id), layer];
    return () => this.removeOverlay(layer.id);
  }

  removeOverlay(id: string): void {
    this.overlays = this.overlays.filter((l) => l.id !== id);
  }

  bubbleRect(): Rect | null {
    return this.cachedRect;
  }

  /** Resolves once the first real frame has been painted. */
  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    this.running = true;
    this.frameIndex = 0;
    this.lastFrameMs = 0;

    return new Promise<void>((resolve) => {
      let resolved = false;
      const tick = () => {
        if (!this.running) return;
        const painted = this.drawFrame();
        if (painted && !resolved) {
          resolved = true;
          resolve();
        }
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    });
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Locks the canvas size; call once the first frame is up, before recording. */
  lockSize(): void {
    this.sizeLocked = true;
  }

  captureStream(fps: number): MediaStream {
    this.stream = this.canvas.captureStream(fps);
    return this.stream;
  }

  snapshot(): Promise<Blob | null> {
    if (this.canvas.width === 0) return Promise.resolve(null);
    return new Promise((resolve) =>
      this.canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8),
    );
  }

  dispose(): void {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.screenVideo?.pause();
    this.cameraVideo?.pause();
    if (this.screenVideo) this.screenVideo.srcObject = null;
    if (this.cameraVideo) this.cameraVideo.srcObject = null;
    this.screenVideo = null;
    this.cameraVideo = null;
    releaseBackground(this.background);
    releaseBackground(this.frameBackground);
    this.background = null;
    this.frameBackground = null;
    this.overlays = [];
  }

  // ---------- drawing ----------

  private sourceSize(): { w: number; h: number } {
    if (this.layout === "screen+camera" && this.screenVideo) {
      return { w: this.screenVideo.videoWidth, h: this.screenVideo.videoHeight };
    }
    if (this.cameraVideo) {
      return { w: this.cameraVideo.videoWidth, h: this.cameraVideo.videoHeight };
    }
    return { w: 0, h: 0 };
  }

  /** Returns true when a real frame was painted. */
  private drawFrame(): boolean {
    const src = this.sourceSize();
    if (src.w <= 0 || src.h <= 0) return false;

    const frameCfg = this.frame;
    const layout =
      this.layout === "screen+camera" && frameCfg
        ? computeFrameLayout(src.w, src.h, frameCfg)
        : {
            canvasW: src.w,
            canvasH: src.h,
            dest: { x: 0, y: 0, w: src.w, h: src.h },
            radius: 0,
          };

    if (
      !this.sizeLocked &&
      (this.canvas.width !== layout.canvasW || this.canvas.height !== layout.canvasH)
    ) {
      this.canvas.width = layout.canvasW;
      this.canvas.height = layout.canvasH;
      this.cacheKey = "";
    }

    const W = this.canvas.width;
    const H = this.canvas.height;
    if (W === 0 || H === 0) return false;

    const nowMs = performance.now();
    const deltaMs = this.lastFrameMs === 0 ? 0 : nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;

    const ctx = this.ctx;
    ctx.save();
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // 1. background / frame
    let screenRect: { x: number; y: number; w: number; h: number } | null = null;
    if (this.layout === "screen+camera" && this.screenVideo) {
      const framed = frameCfg?.enabled === true;
      if (framed) {
        this.drawFrameBackground(ctx, W, H);
        // Letterbox the source into the padded area if the canvas was locked
        // before a surface switch changed the source dimensions.
        const dest = this.fitInto(src.w, src.h, layout.dest, W, H, framed);
        if (frameCfg?.shadow) {
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.45)";
          ctx.shadowBlur = Math.round(W * 0.02);
          ctx.shadowOffsetY = Math.round(W * 0.008);
          ctx.fillStyle = "#000";
          this.fillRounded(ctx, dest, layout.radius);
          ctx.restore();
        }
        ctx.save();
        this.clipRounded(ctx, dest, layout.radius);
        ctx.drawImage(this.screenVideo, dest.x, dest.y, dest.w, dest.h);
        ctx.restore();
        screenRect = dest;
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        const dest = this.fitInto(src.w, src.h, { x: 0, y: 0, w: W, h: H }, W, H, false);
        ctx.drawImage(this.screenVideo, dest.x, dest.y, dest.w, dest.h);
        screenRect = dest;
      }
    } else {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
    }

    // 2. camera bubble
    let rect: Rect | null = null;
    const cam = this.cameraVideo;
    const bubble = this.bubble;
    const camW = cam?.videoWidth ?? 0;
    const camH = cam?.videoHeight ?? 0;

    if (cam && bubble && bubble.visible && camW > 0 && camH > 0) {
      const key = [
        W,
        H,
        camW,
        camH,
        bubble.shape,
        bubble.size,
        bubble.pos.x.toFixed(4),
        bubble.pos.y.toFixed(4),
      ].join("|");
      if (key !== this.cacheKey) {
        this.cachedRect = computeBubbleRect(W, H, camW, camH, bubble);
        this.cachedPath = bubblePath(this.cachedRect, bubble.shape);
        this.cacheKey = key;
      }
      rect = this.cachedRect;

      if (rect && rect.w > 0 && rect.h > 0) {
        this.drawCameraLayer(cam, rect, bubble);
        ctx.save();
        ctx.clip(this.cachedPath!);
        ctx.drawImage(this.layerCanvas, rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
        if (bubble.shape !== "full") {
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.2)";
          ctx.lineWidth = Math.max(2, Math.round(W * 0.0015));
          ctx.stroke(this.cachedPath!);
          ctx.restore();
        }
      }
    } else {
      this.cachedRect = null;
    }

    ctx.restore();

    // 3. overlays — the seam. Each layer gets a clean context.
    if (this.overlays.length > 0) {
      const info: FrameInfo = {
        width: W,
        height: H,
        nowMs,
        deltaMs,
        frameIndex: this.frameIndex,
        screenRect,
        bubbleRect: rect,
      };
      for (const layer of this.overlays) {
        ctx.save();
        try {
          layer.draw(ctx, info);
        } catch {
          // A broken overlay must never kill the recording.
        }
        ctx.restore();
      }
    }

    this.frameIndex += 1;
    return true;
  }

  /** Letterbox srcW×srcH into `box`, preserving aspect. */
  private fitInto(
    srcW: number,
    srcH: number,
    box: { x: number; y: number; w: number; h: number },
    W: number,
    H: number,
    framed: boolean,
  ): { x: number; y: number; w: number; h: number } {
    const maxW = framed ? box.w : W;
    const maxH = framed ? box.h : H;
    const scale = Math.min(maxW / srcW, maxH / srcH);
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    return {
      x: Math.round(box.x + (maxW - w) / 2),
      y: Math.round(box.y + (maxH - h) / 2),
      w,
      h,
    };
  }

  private roundedPath(
    box: { x: number; y: number; w: number; h: number },
    radius: number,
  ): Path2D {
    const p = new Path2D();
    const maybe = p as Path2D & {
      roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
    };
    if (radius > 0 && typeof maybe.roundRect === "function") {
      maybe.roundRect(box.x, box.y, box.w, box.h, radius);
    } else {
      p.rect(box.x, box.y, box.w, box.h);
    }
    return p;
  }

  private fillRounded(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; w: number; h: number },
    radius: number,
  ): void {
    ctx.fill(this.roundedPath(box, radius));
  }

  private clipRounded(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; w: number; h: number },
    radius: number,
  ): void {
    ctx.clip(this.roundedPath(box, radius));
  }

  private drawFrameBackground(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
  ): void {
    const bg = this.frameBackground;
    const cfg = bg?.cfg;

    if (!cfg || cfg.kind === "none") {
      ctx.fillStyle = "#1a1a1e";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    if (cfg.kind === "color") {
      ctx.fillStyle = cfg.color ?? "#1a1a1e";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const media = cfg.kind === "video" ? bg!.video : bg!.image;
    if (!isDrawable(media)) {
      ctx.fillStyle = cfg.color ?? "#1a1a1e";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const mw = media instanceof HTMLVideoElement ? media.videoWidth : media!.naturalWidth;
    const mh = media instanceof HTMLVideoElement ? media.videoHeight : media!.naturalHeight;
    const crop = coverCrop(mw, mh, W, H);
    ctx.drawImage(media!, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
  }

  /**
   * Builds the bubble's pixels on an offscreen canvas: mirror → background →
   * segmented person, or just the mirrored camera when there is no mask.
   */
  private drawCameraLayer(
    cam: HTMLVideoElement,
    rect: Rect,
    bubble: BubbleConfig,
  ): void {
    const { w, h, crop } = rect;
    if (this.layerCanvas.width !== w || this.layerCanvas.height !== h) {
      this.layerCanvas.width = w;
      this.layerCanvas.height = h;
    }
    const lctx = this.layerCtx;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, w, h);
    lctx.filter = "none";
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = "source-over";

    if (bubble.mirror) {
      lctx.translate(w, 0);
      lctx.scale(-1, 1);
    }

    const bgCfg = this.background?.cfg ?? { kind: "none" as const };
    const maskReady = !!this.maskCanvas && this.maskCanvas.width > 0;
    const wantsBackground = bgCfg.kind !== "none" && maskReady;

    const drawCamera = () =>
      lctx.drawImage(cam, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);

    if (!wantsBackground) {
      // No mask yet (or nothing requested) → plain camera. Never block.
      drawCamera();
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    // 1. background plate
    if (bgCfg.kind === "blur") {
      lctx.save();
      lctx.filter = `blur(${Math.max(4, Math.round(w / 50))}px)`;
      drawCamera();
      lctx.restore();
    } else if (bgCfg.kind === "color") {
      lctx.fillStyle = bgCfg.color ?? "#1a1a1e";
      lctx.fillRect(0, 0, w, h);
    } else {
      const media = bgCfg.kind === "video" ? this.background!.video : this.background!.image;
      if (isDrawable(media)) {
        const mw = media instanceof HTMLVideoElement ? media.videoWidth : media!.naturalWidth;
        const mh = media instanceof HTMLVideoElement ? media.videoHeight : media!.naturalHeight;
        const c = coverCrop(mw, mh, w, h);
        lctx.drawImage(media!, c.sx, c.sy, c.sw, c.sh, 0, 0, w, h);
      } else {
        lctx.fillStyle = "#1a1a1e";
        lctx.fillRect(0, 0, w, h);
      }
    }

    // 2. person on top: camera masked by the segmentation alpha
    const person = this.personCanvas(cam, rect);
    lctx.drawImage(person, 0, 0, w, h);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private personScratch: HTMLCanvasElement | null = null;

  private personCanvas(cam: HTMLVideoElement, rect: Rect): HTMLCanvasElement {
    if (!this.personScratch) this.personScratch = document.createElement("canvas");
    const c = this.personScratch;
    const { w, h, crop } = rect;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const pctx = c.getContext("2d")!;
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.globalCompositeOperation = "source-over";
    pctx.clearRect(0, 0, w, h);
    pctx.drawImage(cam, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    // The mask is authored in camera space, so it is cropped identically.
    pctx.globalCompositeOperation = "destination-in";
    const mask = this.maskCanvas!;
    const mScaleX = mask.width / (cam.videoWidth || 1);
    const mScaleY = mask.height / (cam.videoHeight || 1);
    pctx.drawImage(
      mask,
      crop.sx * mScaleX,
      crop.sy * mScaleY,
      crop.sw * mScaleX,
      crop.sh * mScaleY,
      0,
      0,
      w,
      h,
    );
    pctx.globalCompositeOperation = "source-over";
    return c;
  }
}
```

- [ ] Run `npm run lint` — expect PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Run `npx vitest run` — expect all existing suites PASS.
- [ ] Commit:

```bash
git add src/lib/recording/compositor.ts
git commit -m "feat(recording): compositor draw loop with framed capture and overlay dispatch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 10: Gradient presets in `public/backgrounds/` + the preset catalogue

Presets must be served from `public/` (same origin) so `canvas.toBlob()` for the thumbnail is never blocked by a tainted canvas. SVG keeps them a few hundred bytes each. **No preset video ships** — Tyler's requirement is covered by user upload plus the presets below as bubble/frame images.

**Files:** `scripts/make-backgrounds.mjs`, `public/backgrounds/*.svg`, `src/lib/recording/presets.ts`, `src/lib/recording/presets.test.ts`

- [ ] Create `scripts/make-backgrounds.mjs`:

```js
#!/usr/bin/env node
// Generates the gradient preset backgrounds. Run once; output is committed.
//   node scripts/make-backgrounds.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "backgrounds");

/** id → [from, via, to] stops, 135° linear gradient. */
const PRESETS = {
  sunset: ["#f5734c", "#e8465a", "#7a2a6b"],
  ocean: ["#1e3a8a", "#0ea5b7", "#67e8c3"],
  graphite: ["#2c2c32", "#1a1a1e", "#0c0c0f"],
  mint: ["#0f766e", "#34d399", "#d9f99d"],
};

const W = 1920;
const H = 1080;

function svg([from, via, to]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="55%" stop-color="${via}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>
`;
}

await mkdir(OUT_DIR, { recursive: true });
for (const [id, stops] of Object.entries(PRESETS)) {
  const file = path.join(OUT_DIR, `${id}.svg`);
  await writeFile(file, svg(stops), "utf8");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
```

- [ ] Run `node scripts/make-backgrounds.mjs` — expect four lines: `wrote public/backgrounds/sunset.svg` … `mint.svg`.
- [ ] Confirm with `ls public/backgrounds` that `sunset.svg`, `ocean.svg`, `graphite.svg`, `mint.svg` exist.

- [ ] Write the failing test `src/lib/recording/presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BACKGROUND_PRESETS, FRAME_PRESETS, findPreset } from "./presets";

describe("presets", () => {
  it("ships four gradient frame presets served from /backgrounds", () => {
    expect(FRAME_PRESETS).toHaveLength(4);
    for (const p of FRAME_PRESETS) {
      expect(p.src.startsWith("/backgrounds/")).toBe(true);
      expect(p.src.endsWith(".svg")).toBe(true);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("reuses the same gradients for camera bubble backgrounds", () => {
    expect(BACKGROUND_PRESETS.map((p) => p.id)).toEqual(FRAME_PRESETS.map((p) => p.id));
  });

  it("has unique ids", () => {
    const ids = BACKGROUND_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("findPreset looks presets up by id", () => {
    expect(findPreset("ocean")?.src).toBe("/backgrounds/ocean.svg");
    expect(findPreset("nope")).toBeUndefined();
    expect(findPreset(undefined)).toBeUndefined();
  });
});
```

- [ ] Run `npx vitest run src/lib/recording/presets.test.ts` — expect failure: `Failed to resolve import "./presets"`.

- [ ] Create `src/lib/recording/presets.ts`:

```ts
export interface BackgroundPreset {
  id: string;
  label: string;
  /** Same-origin path so canvases stay untainted. */
  src: string;
  /** CSS gradient used for the swatch in the picker. */
  swatch: string;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: "sunset",
    label: "Sunset",
    src: "/backgrounds/sunset.svg",
    swatch: "linear-gradient(135deg,#f5734c 0%,#e8465a 55%,#7a2a6b 100%)",
  },
  {
    id: "ocean",
    label: "Ocean",
    src: "/backgrounds/ocean.svg",
    swatch: "linear-gradient(135deg,#1e3a8a 0%,#0ea5b7 55%,#67e8c3 100%)",
  },
  {
    id: "graphite",
    label: "Graphite",
    src: "/backgrounds/graphite.svg",
    swatch: "linear-gradient(135deg,#2c2c32 0%,#1a1a1e 55%,#0c0c0f 100%)",
  },
  {
    id: "mint",
    label: "Mint",
    src: "/backgrounds/mint.svg",
    swatch: "linear-gradient(135deg,#0f766e 0%,#34d399 55%,#d9f99d 100%)",
  },
];

/** Framed capture reuses the same gradients. */
export const FRAME_PRESETS: BackgroundPreset[] = BACKGROUND_PRESETS;

/** Solid colours offered next to the gradients. */
export const COLOR_SWATCHES = [
  "#1a1a1e",
  "#232328",
  "#0f172a",
  "#134e4a",
  "#7c2d12",
  "#e85a4f",
  "#f0f0f2",
];

export function findPreset(id: string | undefined): BackgroundPreset | undefined {
  if (!id) return undefined;
  return BACKGROUND_PRESETS.find((p) => p.id === id);
}
```

- [ ] Run `npx vitest run src/lib/recording/presets.test.ts` — expect PASS (4 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add scripts/make-backgrounds.mjs public/backgrounds src/lib/recording/presets.ts src/lib/recording/presets.test.ts
git commit -m "feat(recording): gradient background presets and catalogue

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 11: MediaPipe segmentation + the asset copy script

`@mediapipe/tasks-vision@1.0.1` is pinned (`npm view @mediapipe/tasks-vision version` → `1.0.1`, verified 2026-09-01). The package ships the WASM but **not** the model, so the script downloads `selfie_segmenter.tflite` once and caches it. Both must be served from `public/` (same origin) or the thumbnail canvas becomes tainted and `toBlob()` throws.

Package contents confirmed via `npm pack @mediapipe/tasks-vision@1.0.1`:

```
package/wasm/vision_wasm_internal.js
package/wasm/vision_wasm_internal.wasm
package/wasm/vision_wasm_nosimd_internal.js
package/wasm/vision_wasm_nosimd_internal.wasm
package/wasm/vision_wasm_module_internal.js
package/wasm/vision_wasm_module_internal.wasm
package/vision_bundle.mjs
```

**Files:** `package.json`, `.gitignore`, `scripts/copy-mediapipe.mjs`, `src/lib/recording/segmentation.ts`

- [ ] Install the pinned dependency:

```bash
npm i -E @mediapipe/tasks-vision@1.0.1
```

- [ ] Create `scripts/copy-mediapipe.mjs`:

```js
#!/usr/bin/env node
/**
 * Copies the MediaPipe vision WASM out of node_modules and downloads the
 * selfie-segmentation model into public/, so both are served same-origin.
 * Same-origin matters: a cross-origin model or WASM taints nothing, but the
 * preset backgrounds and the thumbnail canvas must never be tainted, and
 * keeping every asset local also means the recorder works offline in Electron.
 *
 * Runs from `predev` and `prebuild`; it is a no-op when the files are current.
 */
import { createRequire } from "node:module";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function copyWasm() {
  const pkgJson = require.resolve("@mediapipe/tasks-vision/package.json");
  const srcDir = path.join(path.dirname(pkgJson), "wasm");
  const outDir = path.join(process.cwd(), "public", "mediapipe", "wasm");
  await mkdir(outDir, { recursive: true });

  for (const file of WASM_FILES) {
    const from = path.join(srcDir, file);
    const to = path.join(outDir, file);
    if (!(await exists(from))) {
      throw new Error(`Missing ${from} — did @mediapipe/tasks-vision change layout?`);
    }
    if (await exists(to)) continue;
    await cp(from, to);
    console.log(`copied ${file}`);
  }
}

async function fetchModel() {
  const outDir = path.join(process.cwd(), "public", "models");
  const out = path.join(outDir, "selfie_segmenter.tflite");
  await mkdir(outDir, { recursive: true });
  if (await exists(out)) return;

  console.log(`downloading ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(`Model download failed: ${res.status} ${res.statusText}`);
  }
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log("downloaded selfie_segmenter.tflite");
}

try {
  await copyWasm();
  await fetchModel();
} catch (err) {
  // Never break `npm run dev` / `npm run build` over an optional feature: the
  // recorder falls back to "no virtual backgrounds" when the model is absent.
  console.warn(`[copy-mediapipe] ${err instanceof Error ? err.message : err}`);
}
```

- [ ] Add the scripts to `package.json` (`scripts` block becomes):

```json
  "scripts": {
    "dev": "next dev",
    "predev": "node scripts/copy-mediapipe.mjs",
    "build": "next build",
    "prebuild": "node scripts/copy-mediapipe.mjs",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run"
  },
```

- [ ] Append to `.gitignore`:

```
# generated by scripts/copy-mediapipe.mjs
/public/mediapipe
/public/models
```

- [ ] Run `node scripts/copy-mediapipe.mjs` — expect four `copied …` lines then `downloaded selfie_segmenter.tflite`; confirm `ls -la public/models/selfie_segmenter.tflite` shows a non-zero size.

- [ ] Create `src/lib/recording/segmentation.ts`:

```ts
/**
 * Person segmentation for the camera-bubble virtual backgrounds.
 *
 * Runs its own `requestVideoFrameCallback` loop at 256 px wide and writes an
 * alpha mask into `mask`. The compositor samples that canvas whenever it
 * happens to be ready — segmentation never blocks the draw loop, and a
 * not-ready segmenter simply means "plain camera".
 */

type ImageSegmenterModule = typeof import("@mediapipe/tasks-vision");

const WASM_PATH = "/mediapipe/wasm";
const WASM_FALLBACK =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_PATH = "/models/selfie_segmenter.tflite";

export interface SegmenterOptions {
  /** Working width of the mask; height follows the camera aspect. */
  width?: number;
  fps?: number;
}

type Segmenter = Awaited<
  ReturnType<ImageSegmenterModule["ImageSegmenter"]["createFromOptions"]>
>;

export class PersonSegmenter {
  readonly mask: HTMLCanvasElement;
  ready = false;

  private segmenter: Segmenter | null = null;
  private maskCtx: CanvasRenderingContext2D;
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
  private video: HTMLVideoElement | null = null;
  private frameCallbackId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private inFlight = false;
  private imageData: ImageData | null = null;
  private delegate: "GPU" | "CPU" = "GPU";

  private constructor(segmenter: Segmenter, delegate: "GPU" | "CPU") {
    this.segmenter = segmenter;
    this.delegate = delegate;
    this.mask = document.createElement("canvas");
    this.maskCtx = this.mask.getContext("2d")!;
    this.scratch = document.createElement("canvas");
    this.scratchCtx = this.scratch.getContext("2d", { willReadFrequently: true })!;
    this.ready = true;
  }

  /** Resolves to null when the model or WASM is unavailable. */
  static async load(): Promise<PersonSegmenter | null> {
    try {
      const vision: ImageSegmenterModule = await import("@mediapipe/tasks-vision");
      let fileset;
      try {
        fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      } catch {
        fileset = await vision.FilesetResolver.forVisionTasks(WASM_FALLBACK);
      }

      const create = (delegate: "GPU" | "CPU") =>
        vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });

      try {
        return new PersonSegmenter(await create("GPU"), "GPU");
      } catch {
        return new PersonSegmenter(await create("CPU"), "CPU");
      }
    } catch (err) {
      console.warn("[Yoom] segmentation unavailable", err);
      return null;
    }
  }

  start(video: HTMLVideoElement, options: SegmenterOptions = {}): void {
    if (this.running) this.stop();
    this.video = video;
    this.running = true;

    const targetWidth = options.width ?? 256;
    // The CPU delegate cannot keep up at 30fps at this size.
    const fps = options.fps ?? (this.delegate === "GPU" ? 30 : 15);
    const minIntervalMs = 1000 / fps;
    let lastRun = 0;

    const step = (nowMs: number) => {
      if (!this.running || !this.video) return;
      if (!this.inFlight && nowMs - lastRun >= minIntervalMs) {
        lastRun = nowMs;
        this.segmentOnce(this.video, targetWidth);
      }
      this.schedule(step);
    };

    this.schedule(step);
  }

  private schedule(step: (nowMs: number) => void): void {
    const video = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    };
    if (video?.requestVideoFrameCallback) {
      this.frameCallbackId = video.requestVideoFrameCallback((now) => step(now));
    } else {
      // Firefox has no rVFC; a plain interval is close enough at 15-30fps.
      if (this.timer) clearTimeout(this.timer as unknown as number);
      this.timer = setTimeout(
        () => step(performance.now()),
        1000 / 30,
      ) as unknown as ReturnType<typeof setInterval>;
    }
  }

  private segmentOnce(video: HTMLVideoElement, targetWidth: number): void {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!this.segmenter || vw === 0 || vh === 0) return;

    const w = targetWidth;
    const h = Math.max(1, Math.round((targetWidth * vh) / vw));

    if (this.scratch.width !== w || this.scratch.height !== h) {
      this.scratch.width = w;
      this.scratch.height = h;
      this.mask.width = w;
      this.mask.height = h;
      this.imageData = this.maskCtx.createImageData(w, h);
      // Start fully opaque (person everywhere) so the first frames after a
      // background is enabled show the plain camera, then the temporal blend
      // converges on the real mask. A transparent start would make the
      // person vanish for a few frames.
      this.maskCtx.globalCompositeOperation = "source-over";
      this.maskCtx.fillStyle = "#fff";
      this.maskCtx.fillRect(0, 0, w, h);
    }

    this.inFlight = true;
    try {
      this.scratchCtx.drawImage(video, 0, 0, w, h);
      this.segmenter.segmentForVideo(this.scratch, performance.now(), (result) => {
        const confidence = result.confidenceMasks?.[0];
        if (!confidence || !this.imageData) {
          result.close?.();
          return;
        }
        const floats = confidence.getAsFloat32Array();
        const px = this.imageData.data;
        for (let i = 0, p = 0; i < floats.length; i += 1, p += 4) {
          const alpha = Math.round(floats[i] * 255);
          px[p] = 255;
          px[p + 1] = 255;
          px[p + 2] = 255;
          px[p + 3] = alpha;
        }
        // Temporal smoothing: 70% new over the previous mask kills flicker.
        this.maskCtx.save();
        this.maskCtx.globalAlpha = 0.7;
        this.maskCtx.globalCompositeOperation = "source-over";
        const tmp = this.scratchCtx;
        tmp.putImageData(this.imageData, 0, 0);
        // Feather the edge at low resolution — cheap because w is 256.
        this.maskCtx.filter = "blur(1px)";
        this.maskCtx.drawImage(this.scratch, 0, 0);
        this.maskCtx.restore();
        // Redraw the camera frame into the scratch next tick.
        result.close?.();
      });
    } catch (err) {
      console.warn("[Yoom] segmentation frame failed", err);
    } finally {
      this.inFlight = false;
    }
  }

  stop(): void {
    this.running = false;
    const video = this.video as
      | (HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void })
      | null;
    if (this.frameCallbackId && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(this.frameCallbackId);
    }
    this.frameCallbackId = 0;
    if (this.timer) clearTimeout(this.timer as unknown as number);
    this.timer = null;
    this.video = null;
  }

  dispose(): void {
    this.stop();
    try {
      this.segmenter?.close();
    } catch {
      // Already closed.
    }
    this.segmenter = null;
    this.ready = false;
  }
}
```

- [ ] Run `npm run lint` — expect PASS.
- [ ] Run `npm run build` — expect PASS (the `prebuild` script runs first and prints nothing new on a warm cache).
- [ ] Commit:

```bash
git add package.json package-lock.json .gitignore scripts/copy-mediapipe.mjs src/lib/recording/segmentation.ts
git commit -m "feat(recording): MediaPipe selfie segmentation with local WASM and model

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 12: `upload.ts` — the Phase 1 upload flow, extracted verbatim

Behaviour is unchanged: `POST /api/upload` → `uploadToDrive` → `POST /api/upload/complete` with `{driveFileId, durationMs, width, height, title}` → optional `POST /api/upload/thumbnail`. Extracting it makes the flow unit-testable and keeps `use-recorder.ts` readable. **`router.push('/library/'+id+'?new=1')` is Phase 3** — Phase 2 keeps returning the share URL for the existing "done" screen.

**Files:** `src/lib/recording/upload.ts`, `src/lib/recording/upload.test.ts`

- [ ] Write the failing test `src/lib/recording/upload.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadToDrive = vi.fn();
vi.mock("@/lib/upload-client", () => ({ uploadToDrive }));

import { defaultRecordingTitle, uploadRecording } from "./upload";

const blob = new Blob([new Uint8Array(16)], { type: "video/webm" });

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  uploadToDrive.mockReset();
  uploadToDrive.mockResolvedValue({ id: "drive-1" });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaultRecordingTitle", () => {
  it("is generated client-side so it reflects the local time zone", () => {
    const title = defaultRecordingTitle(new Date("2026-09-02T15:04:05Z"));
    expect(title.startsWith("Recording — ")).toBe(true);
    expect(title.length).toBeGreaterThan("Recording — ".length);
  });
});

describe("uploadRecording", () => {
  it("walks the three-step flow and returns the share URL", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionUri: "https://drive/session" }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "vid-1", slug: "abc12345", url: "https://jtylerray.com/v/abc12345" }),
      );

    const onProgress = vi.fn();
    const result = await uploadRecording({
      blob,
      durationMs: 12_345,
      width: 1920,
      height: 1080,
      thumbnail: null,
      onProgress,
    });

    expect(result).toEqual({
      id: "vid-1",
      slug: "abc12345",
      url: "https://jtylerray.com/v/abc12345",
    });

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe("/api/upload");
    expect(JSON.parse(firstInit.body)).toMatchObject({
      mimeType: "video/webm",
      sizeBytes: blob.size,
    });
    expect(JSON.parse(firstInit.body).filename).toMatch(/^yoom-.*\.webm$/);

    expect(uploadToDrive).toHaveBeenCalledWith(blob, "https://drive/session", onProgress);

    const [secondUrl, secondInit] = fetchMock.mock.calls[1];
    expect(secondUrl).toBe("/api/upload/complete");
    expect(JSON.parse(secondInit.body)).toMatchObject({
      driveFileId: "drive-1",
      durationMs: 12_345,
      width: 1920,
      height: 1080,
    });
    expect(JSON.parse(secondInit.body).title).toContain("Recording — ");
  });

  it("posts the thumbnail after completing and tolerates its failure", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionUri: "s" }))
      .mockResolvedValueOnce(jsonResponse({ id: "vid-1", slug: "s1", url: "u" }))
      .mockRejectedValueOnce(new Error("thumb down"));

    const thumbnail = new Blob([new Uint8Array(4)], { type: "image/jpeg" });
    const result = await uploadRecording({
      blob,
      durationMs: 1,
      width: 2,
      height: 3,
      thumbnail,
      onProgress: () => {},
    });

    expect(result.id).toBe("vid-1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/upload/thumbnail");
    expect(fetchMock.mock.calls[2][1].body).toBeInstanceOf(FormData);
  });

  it("skips the thumbnail request when there is no thumbnail", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionUri: "s" }))
      .mockResolvedValueOnce(jsonResponse({ id: "v", slug: "s", url: "u" }));

    await uploadRecording({
      blob,
      durationMs: 1,
      width: null,
      height: null,
      thumbnail: null,
      onProgress: () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a readable error when the session request fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false));
    await expect(
      uploadRecording({
        blob,
        durationMs: 1,
        width: null,
        height: null,
        thumbnail: null,
        onProgress: () => {},
      }),
    ).rejects.toThrow("Failed to start the upload");
  });

  it("throws a readable error when completing fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionUri: "s" }))
      .mockResolvedValueOnce(jsonResponse({}, false));
    await expect(
      uploadRecording({
        blob,
        durationMs: 1,
        width: null,
        height: null,
        thumbnail: null,
        onProgress: () => {},
      }),
    ).rejects.toThrow("Failed to save the recording");
  });

  it("rejects an empty recording before touching the network", async () => {
    await expect(
      uploadRecording({
        blob: new Blob([], { type: "video/webm" }),
        durationMs: 0,
        width: null,
        height: null,
        thumbnail: null,
        onProgress: () => {},
      }),
    ).rejects.toThrow("Recording captured no data");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] Run `npx vitest run src/lib/recording/upload.test.ts` — expect failure: `Failed to resolve import "./upload"`.

- [ ] Create `src/lib/recording/upload.ts`:

```ts
import { uploadToDrive } from "@/lib/upload-client";

export interface UploadRecordingInput {
  blob: Blob;
  durationMs: number;
  width: number | null;
  height: number | null;
  /** JPEG grabbed ~1s into the recording; a missing thumbnail is not fatal. */
  thumbnail: Blob | null;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}

export interface UploadRecordingResult {
  id: string;
  slug: string;
  url: string;
}

/**
 * Default title generated client-side so it reflects the recorder's local time
 * zone rather than the server's (UTC on Vercel).
 */
export function defaultRecordingTitle(now: Date = new Date()): string {
  return `Recording — ${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now)}`;
}

function filenameFor(now: Date, extension: string): string {
  return `yoom-${now.toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

function extensionFor(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

/**
 * The Phase 1 flow, unchanged: mint a resumable session, PUT the blob to Drive
 * in chunks, record the metadata, then attach the thumbnail.
 */
export async function uploadRecording(
  input: UploadRecordingInput,
): Promise<UploadRecordingResult> {
  const { blob, durationMs, width, height, thumbnail, onProgress, signal } = input;

  if (blob.size === 0) {
    throw new Error("Recording captured no data. Please try again.");
  }

  const now = new Date();
  const mimeType = blob.type || "video/webm";

  const sessionRes = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mimeType,
      sizeBytes: blob.size,
      filename: filenameFor(now, extensionFor(mimeType)),
    }),
    signal,
  });
  if (!sessionRes.ok) throw new Error("Failed to start the upload");

  const { sessionUri } = (await sessionRes.json()) as { sessionUri: string };

  const { id: driveFileId } = await uploadToDrive(blob, sessionUri, onProgress);

  const completeRes = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      driveFileId,
      durationMs,
      width,
      height,
      title: defaultRecordingTitle(now),
    }),
    signal,
  });
  if (!completeRes.ok) throw new Error("Failed to save the recording");

  const { id, slug, url } = (await completeRes.json()) as UploadRecordingResult;

  if (thumbnail) {
    const form = new FormData();
    form.set("videoId", id);
    form.set("file", thumbnail, "thumbnail.jpg");
    await fetch("/api/upload/thumbnail", { method: "POST", body: form }).catch(
      () => undefined,
    );
  }

  return { id, slug, url };
}
```

- [ ] Run `npx vitest run src/lib/recording/upload.test.ts` — expect PASS (7 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/lib/recording/upload.ts src/lib/recording/upload.test.ts
git commit -m "refactor(recording): extract the Drive upload flow into a testable module

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 13: `use-recorder.ts` — the single hook that wires everything

Browser-only orchestration; verified in the Task 22 matrix. Every pure part it leans on is already unit-tested.

**Files:** `src/lib/recording/use-recorder.ts`

- [ ] Create `src/lib/recording/use-recorder.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import fixWebmDuration from "fix-webm-duration";
import { AudioMixer } from "./audio-mixer";
import { Compositor } from "./compositor";
import { onDesktopShortcut } from "./desktop-bridge";
import { getProvider } from "./media-sources";
import { createFpsOverlay, createNoopOverlay, debugOverlaysEnabled } from "./overlays";
import {
  MAX_DURATION_MS,
  initialRecorderState,
  recorderReducer,
  type RecorderState,
} from "./recorder-machine";
import { PersonSegmenter } from "./segmentation";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";
import { uploadRecording } from "./upload";
import type {
  BackgroundConfig,
  BubbleConfig,
  Capabilities,
  FrameConfig,
  RecordingMode,
  SurfacePref,
} from "./types";

const CODECS = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp8",
  "video/webm",
  // Safari has no WebM MediaRecorder; Phase 1 stores the mime per video.
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "",
];

function pickMimeType(): string {
  return (
    CODECS.find(
      (c) => c === "" || (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)),
    ) ?? ""
  );
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export interface UseRecorderResult {
  state: RecorderState;
  capabilities: Capabilities;
  /** Canvas the compositor paints into (camera and screen+camera modes). */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** <video> element used to preview screen-only recordings. */
  screenVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Object URL for the recorded blob while on the review screen. */
  reviewUrl: string | null;
  /** Object URL for the captured thumbnail while on the review screen. */
  thumbnailUrl: string | null;
  getLevel: (id: "mic" | "system") => number;
  actions: {
    selectMode(mode: RecordingMode): void;
    setSurfacePref(pref: SurfacePref): void;
    setDevice(kind: "mic" | "camera", deviceId: string): void;
    acquire(): void;
    start(): void;
    skipCountdown(): void;
    pause(): void;
    resume(): void;
    stop(): void;
    restart(): void;
    discard(): void;
    upload(): void;
    reset(): void;
    toggleMic(on?: boolean): void;
    toggleSystem(on?: boolean): void;
    setBubble(patch: Partial<BubbleConfig>): void;
    setBackground(background: BackgroundConfig): void;
    setFrame(patch: Partial<FrameConfig>): void;
  };
}

export function useRecorder(): UseRecorderResult {
  const [state, dispatch] = useReducer(recorderReducer, DEFAULT_SETTINGS, initialRecorderState);
  const [capabilities, setCapabilities] = useState<Capabilities>({
    systemAudio: "none",
    nativePicker: false,
    surfaceHints: true,
  });
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mixerRef = useRef<AudioMixer | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const segmenterRef = useRef<PersonSegmenter | null>(null);
  const cameraElRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const thumbnailRef = useRef<Blob | null>(null);
  const thumbnailTimerRef = useRef<number | null>(null);
  const dimensionsRef = useRef<{ width: number | null; height: number | null }>({
    width: null,
    height: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---------- boot: settings + capabilities ----------

  useEffect(() => {
    const settings = loadSettings();
    dispatch({ type: "SELECT_MODE", mode: settings.mode });
    dispatch({ type: "SET_SURFACE_PREF", pref: settings.surfacePref });
    dispatch({ type: "SET_DEVICE", kind: "mic", deviceId: settings.micId });
    dispatch({ type: "SET_DEVICE", kind: "camera", deviceId: settings.cameraId });
    dispatch({ type: "TOGGLE_MIC", on: settings.micOn });
    dispatch({ type: "TOGGLE_SYSTEM", on: settings.systemOn });
    dispatch({ type: "SET_BUBBLE", patch: settings.bubble });
    dispatch({ type: "SET_BACKGROUND", background: settings.background });
    dispatch({ type: "SET_FRAME", patch: settings.frame });
    setCapabilities(getProvider().capabilities());
  }, []);

  // Persist preferences whenever they change.
  useEffect(() => {
    saveSettings({
      mode: state.mode,
      surfacePref: state.surfacePref,
      micId: state.micId,
      cameraId: state.cameraId,
      micOn: state.micOn,
      systemOn: state.systemOn,
      bubble: state.bubble,
      background: state.background,
      frame: state.frame,
    });
  }, [
    state.mode,
    state.surfacePref,
    state.micId,
    state.cameraId,
    state.micOn,
    state.systemOn,
    state.bubble,
    state.background,
    state.frame,
  ]);

  // ---------- teardown ----------

  const teardown = useCallback(() => {
    if (thumbnailTimerRef.current) {
      window.clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = null;
    }
    segmenterRef.current?.dispose();
    segmenterRef.current = null;
    compositorRef.current?.dispose();
    compositorRef.current = null;
    void mixerRef.current?.close();
    mixerRef.current = null;
    stopStream(screenStreamRef.current);
    stopStream(cameraStreamRef.current);
    stopStream(micStreamRef.current);
    screenStreamRef.current = null;
    cameraStreamRef.current = null;
    micStreamRef.current = null;
    if (cameraElRef.current) {
      cameraElRef.current.pause();
      cameraElRef.current.srcObject = null;
      cameraElRef.current = null;
    }
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  // ---------- acquisition ----------

  const acquire = useCallback(async () => {
    const current = stateRef.current;
    dispatch({ type: "ACQUIRE" });
    const provider = getProvider();

    try {
      let hasSystemAudio = false;
      let surface: SurfacePref | "unknown" = "unknown";

      if (current.mode !== "camera") {
        const display = await provider.getDisplay(current.surfacePref);
        screenStreamRef.current = display.stream;
        surface = display.surface;
        hasSystemAudio = display.hasSystemAudio;
        display.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          dispatch({ type: "STREAM_ENDED" });
        });
      }

      if (current.mode !== "screen") {
        cameraStreamRef.current = await provider.getCamera(current.cameraId || undefined);
      }

      // The mic is always its own stream so the mixer owns it independently.
      try {
        micStreamRef.current = await provider.getMic(current.micId || undefined);
      } catch {
        micStreamRef.current = null;
      }

      // AudioContext must be created inside the user gesture chain.
      const mixer = new AudioMixer();
      await mixer.resume();
      if (micStreamRef.current) {
        mixer.addSource("mic", micStreamRef.current, { enabled: current.micOn });
      }
      const systemStream = screenStreamRef.current;
      if (systemStream && systemStream.getAudioTracks().length > 0) {
        mixer.addSource("system", new MediaStream(systemStream.getAudioTracks()), {
          enabled: current.systemOn,
        });
      }
      mixerRef.current = mixer;

      // Compositor for camera and screen+camera; screen-only bypasses it.
      if (current.mode !== "screen" && canvasRef.current) {
        const compositor = new Compositor(
          canvasRef.current,
          current.mode === "camera" ? "camera" : "screen+camera",
        );
        compositor.setSources({
          screen: current.mode === "screen+camera" ? screenStreamRef.current : null,
          camera: cameraStreamRef.current,
        });
        compositor.setBubble(
          current.mode === "camera"
            ? { ...current.bubble, shape: "full", visible: true }
            : current.bubble,
        );
        compositor.setBackground(current.background);
        compositor.setFrame(current.frame);
        compositor.addOverlay(
          debugOverlaysEnabled() ? createFpsOverlay() : createNoopOverlay(),
        );
        compositorRef.current = compositor;
        await compositor.start();

        // Segmentation is optional: a null segmenter means "plain camera".
        if (current.background.kind !== "none" && cameraStreamRef.current) {
          void PersonSegmenter.load().then((segmenter) => {
            if (!segmenter) return;
            segmenterRef.current = segmenter;
            // Reuse the compositor's decoded camera element: one decoder,
            // not two, for the same camera stream.
            const el = compositorRef.current?.cameraElement() ?? null;
            if (!el) return;
            segmenter.start(el, { width: 256 });
            compositorRef.current?.setSources({ maskCanvas: segmenter.mask });
          });
        }
      } else if (screenVideoRef.current && screenStreamRef.current) {
        screenVideoRef.current.srcObject = screenStreamRef.current;
        void screenVideoRef.current.play().catch(() => {});
      }

      dispatch({
        type: "ACQUIRED",
        surface,
        hasSystemAudio,
        hasCamera: !!cameraStreamRef.current,
      });
    } catch (err) {
      teardown();
      const message =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Permission denied. Please allow screen and camera access."
          : "Could not start capture. Check your device permissions.";
      dispatch({ type: "ACQUIRE_FAILED", error: message });
    }
  }, [teardown]);

  // ---------- push config into the compositor ----------

  useEffect(() => {
    if (!compositorRef.current) return;
    compositorRef.current.setBubble(
      stateRef.current.mode === "camera"
        ? { ...state.bubble, shape: "full", visible: true }
        : state.bubble,
    );
  }, [state.bubble]);

  useEffect(() => {
    compositorRef.current?.setBackground(state.background);
    // Turning a background on for the first time lazily loads the segmenter.
    if (state.background.kind !== "none" && !segmenterRef.current && cameraStreamRef.current) {
      void PersonSegmenter.load().then((segmenter) => {
        if (!segmenter) return;
        segmenterRef.current = segmenter;
        // Reuse the compositor's decoded camera element (one decoder).
        const el = compositorRef.current?.cameraElement() ?? null;
        if (!el) return;
        segmenter.start(el, { width: 256 });
        compositorRef.current?.setSources({ maskCanvas: segmenter.mask });
      });
    }
  }, [state.background]);

  useEffect(() => {
    compositorRef.current?.setFrame(state.frame);
  }, [state.frame]);

  // ---------- audio toggles ----------

  useEffect(() => {
    mixerRef.current?.setEnabled("mic", state.micOn);
  }, [state.micOn]);

  useEffect(() => {
    mixerRef.current?.setEnabled("system", state.systemOn);
  }, [state.systemOn]);

  // ---------- countdown ----------

  useEffect(() => {
    if (state.status !== "countdown") return;
    const id = window.setInterval(() => dispatch({ type: "COUNTDOWN_TICK" }), 1000);
    return () => window.clearInterval(id);
  }, [state.status]);

  // ---------- MediaRecorder lifecycle ----------

  const beginRecording = useCallback(() => {
    const current = stateRef.current;
    const mixer = mixerRef.current;
    const compositor = compositorRef.current;

    let recordStream: MediaStream;
    if (current.mode === "screen") {
      const videoTrack = screenStreamRef.current?.getVideoTracks()[0];
      if (!videoTrack) return;
      const settings = videoTrack.getSettings();
      dimensionsRef.current = {
        width: settings.width ?? null,
        height: settings.height ?? null,
      };
      recordStream = new MediaStream(
        mixer ? [videoTrack, mixer.outputTrack] : [videoTrack],
      );
    } else {
      if (!compositor || !canvasRef.current) return;
      compositor.lockSize();
      dimensionsRef.current = {
        width: canvasRef.current.width,
        height: canvasRef.current.height,
      };
      const canvasStream = compositor.captureStream(60);
      if (mixer) canvasStream.addTrack(mixer.outputTrack);
      recordStream = canvasStream;
    }

    chunksRef.current = [];
    thumbnailRef.current = null;

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(recordStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: current.mode === "camera" ? 5_000_000 : 10_000_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = (e) => {
      console.error("[Yoom] MediaRecorder error", e);
    };
    recorder.onstop = () => {
      void finishRecording();
    };

    startedAtRef.current = performance.now();
    pausedAtRef.current = 0;
    pausedTotalRef.current = 0;
    recorder.start(250);
    recorderRef.current = recorder;

    thumbnailTimerRef.current = window.setTimeout(() => {
      void captureThumbnail().then((blob) => {
        thumbnailRef.current = blob;
      });
    }, 1000);
    // `finishRecording` and `captureThumbnail` are stable callbacks defined below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter `recording` for the first time → actually start the encoder.
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    const isRecording = state.status === "recording";
    if (isRecording && !wasRecordingRef.current && !recorderRef.current) {
      beginRecording();
    }
    wasRecordingRef.current = isRecording || state.status === "paused";
  }, [state.status, beginRecording]);

  // Elapsed timer: `performance.now()` deltas only, minus paused time.
  useEffect(() => {
    if (state.status !== "recording") return;
    const id = window.setInterval(() => {
      const elapsed = performance.now() - startedAtRef.current - pausedTotalRef.current;
      dispatch({ type: "TICK", elapsedMs: Math.max(0, elapsed) });
      if (elapsed >= MAX_DURATION_MS) dispatch({ type: "MAX_DURATION" });
    }, 250);
    return () => window.clearInterval(id);
  }, [state.status]);

  // Pause / resume / stop the encoder to match the machine.
  useEffect(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (state.status === "paused" && recorder.state === "recording") {
      pausedAtRef.current = performance.now();
      recorder.pause();
    } else if (state.status === "recording" && recorder.state === "paused") {
      if (pausedAtRef.current) {
        pausedTotalRef.current += performance.now() - pausedAtRef.current;
        pausedAtRef.current = 0;
      }
      recorder.resume();
    } else if (state.status === "stopping" && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, [state.status]);

  const captureThumbnail = useCallback(async (): Promise<Blob | null> => {
    const compositor = compositorRef.current;
    if (compositor) return compositor.snapshot();

    const track = screenStreamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return null;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    const ready = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 2000);
      video.onloadeddata = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
    });
    try {
      await video.play();
      if (!(await ready) || !video.videoWidth) return null;
      const scratch = document.createElement("canvas");
      scratch.width = video.videoWidth;
      scratch.height = video.videoHeight;
      scratch.getContext("2d")?.drawImage(video, 0, 0, scratch.width, scratch.height);
      return await new Promise((resolve) =>
        scratch.toBlob((blob) => resolve(blob), "image/jpeg", 0.8),
      );
    } catch {
      return null;
    } finally {
      video.pause();
      video.srcObject = null;
    }
  }, []);

  const finishRecording = useCallback(async () => {
    if (thumbnailTimerRef.current) {
      window.clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = null;
    }
    if (!thumbnailRef.current) thumbnailRef.current = await captureThumbnail();

    const durationMs = Math.max(
      0,
      Math.round(performance.now() - startedAtRef.current - pausedTotalRef.current),
    );
    const recorder = recorderRef.current;
    const type = recorder?.mimeType?.split(";")[0] || "video/webm";
    recorderRef.current = null;

    const rawBlob = new Blob(chunksRef.current, { type });
    chunksRef.current = [];

    let blob = rawBlob;
    if (type.includes("webm")) {
      // MediaRecorder omits the EBML duration; patch it so seeking works.
      try {
        blob = await fixWebmDuration(rawBlob, durationMs, { logger: false });
      } catch (err) {
        console.warn("[Yoom] could not patch WebM duration", err);
      }
    }

    const { width, height } = dimensionsRef.current;
    dispatch({ type: "BLOB_READY", blob, durationMs, width, height });
  }, [captureThumbnail]);

  // ---------- review object URLs ----------

  useEffect(() => {
    if (state.status !== "review" || !state.blob) {
      setReviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const url = URL.createObjectURL(state.blob);
    setReviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [state.status, state.blob]);

  useEffect(() => {
    if (state.status !== "review" || !thumbnailRef.current) return;
    const url = URL.createObjectURL(thumbnailRef.current);
    setThumbnailUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setThumbnailUrl(null);
    };
  }, [state.status]);

  // ---------- upload ----------

  const upload = useCallback(async () => {
    const current = stateRef.current;
    const blob = current.blob;
    if (!blob) return;
    dispatch({ type: "UPLOAD" });
    // Free the camera and screen while the bytes go up.
    teardown();
    try {
      const result = await uploadRecording({
        blob,
        durationMs: current.durationMs,
        width: current.width,
        height: current.height,
        thumbnail: thumbnailRef.current,
        onProgress: (percent) => dispatch({ type: "UPLOAD_PROGRESS", percent }),
      });
      // Phase 3 replaces this with router.push('/library/'+id+'?new=1').
      dispatch({ type: "UPLOAD_DONE", videoId: result.id, shareUrl: result.url });
    } catch (err) {
      dispatch({
        type: "UPLOAD_FAILED",
        error: err instanceof Error ? err.message : "Upload failed. Please try again.",
      });
    }
  }, [teardown]);

  // ---------- discard / reset ----------

  const discard = useCallback(() => {
    thumbnailRef.current = null;
    dispatch({ type: "DISCARD" });
  }, []);

  const reset = useCallback(() => {
    teardown();
    thumbnailRef.current = null;
    dispatch({ type: "RESET" });
  }, [teardown]);

  // Streams died (mode change, Stop sharing) → release everything.
  useEffect(() => {
    if (state.streamsAlive) return;
    if (state.status === "idle" || state.status === "error") teardown();
  }, [state.streamsAlive, state.status, teardown]);

  // ---------- hotkeys ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      const status = stateRef.current.status;
      if (key === "l") {
        e.preventDefault();
        if (status === "recording" || status === "paused") dispatch({ type: "STOP" });
        else if (status === "setup") dispatch({ type: "START" });
        else if (status === "idle") void acquire();
      } else if (key === "p") {
        e.preventDefault();
        if (status === "recording") dispatch({ type: "PAUSE" });
        else if (status === "paused") dispatch({ type: "RESUME" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [acquire]);

  // Desktop shell forwards the same shortcuts even when the tab is unfocused.
  useEffect(() => {
    return onDesktopShortcut((action) => {
      const status = stateRef.current.status;
      if (action === "toggle") {
        if (status === "recording" || status === "paused") dispatch({ type: "STOP" });
        else if (status === "setup") dispatch({ type: "START" });
        else if (status === "idle") void acquire();
      } else if (action === "pause") {
        if (status === "recording") dispatch({ type: "PAUSE" });
        else if (status === "paused") dispatch({ type: "RESUME" });
      }
    });
  }, [acquire]);

  const getLevel = useCallback(
    (id: "mic" | "system") => mixerRef.current?.getLevel(id) ?? 0,
    [],
  );

  const actions = useMemo(
    () => ({
      selectMode: (mode: RecordingMode) => dispatch({ type: "SELECT_MODE", mode }),
      setSurfacePref: (pref: SurfacePref) => dispatch({ type: "SET_SURFACE_PREF", pref }),
      setDevice: (kind: "mic" | "camera", deviceId: string) =>
        dispatch({ type: "SET_DEVICE", kind, deviceId }),
      acquire: () => void acquire(),
      start: () => dispatch({ type: "START" }),
      skipCountdown: () => dispatch({ type: "SKIP_COUNTDOWN" }),
      pause: () => dispatch({ type: "PAUSE" }),
      resume: () => dispatch({ type: "RESUME" }),
      stop: () => dispatch({ type: "STOP" }),
      restart: () => {
        chunksRef.current = [];
        thumbnailRef.current = null;
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.onstop = null;
          recorderRef.current.stop();
          recorderRef.current = null;
        }
        dispatch({ type: "RESTART" });
      },
      discard,
      upload: () => void upload(),
      reset,
      toggleMic: (on?: boolean) => dispatch({ type: "TOGGLE_MIC", on }),
      toggleSystem: (on?: boolean) => dispatch({ type: "TOGGLE_SYSTEM", on }),
      setBubble: (patch: Partial<BubbleConfig>) => dispatch({ type: "SET_BUBBLE", patch }),
      setBackground: (background: BackgroundConfig) =>
        dispatch({ type: "SET_BACKGROUND", background }),
      setFrame: (patch: Partial<FrameConfig>) => dispatch({ type: "SET_FRAME", patch }),
    }),
    [acquire, discard, reset, upload],
  );

  return {
    state,
    capabilities,
    canvasRef,
    screenVideoRef,
    reviewUrl,
    thumbnailUrl,
    getLevel,
    actions,
  };
}
```

- [ ] Run `npm run lint` — expect PASS.
- [ ] Run `npm run build` — expect PASS (the hook is not yet imported by any page).
- [ ] Run `npx vitest run` — expect every suite PASS.
- [ ] Commit:

```bash
git add src/lib/recording/use-recorder.ts
git commit -m "feat(recording): useRecorder hook wiring streams, mixer, compositor and upload

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 14: `mode-picker.tsx`

**Files:** `src/components/recorder/mode-picker.tsx`

- [ ] Create `src/components/recorder/mode-picker.tsx`:

```tsx
"use client";

import type { RecordingMode, SurfacePref } from "@/lib/recording/types";

const MODES: Array<{ value: RecordingMode; label: string; hint: string }> = [
  { value: "screen+camera", label: "Screen + Cam", hint: "Bubble over your screen" },
  { value: "screen", label: "Screen", hint: "Just the screen" },
  { value: "camera", label: "Camera", hint: "Talking head" },
];

const SURFACES: Array<{ value: SurfacePref; label: string }> = [
  { value: "monitor", label: "Entire screen" },
  { value: "window", label: "Window" },
  { value: "browser", label: "Tab" },
];

const SURFACE_LABEL: Record<SurfacePref | "unknown", string> = {
  monitor: "Entire screen",
  window: "Window",
  browser: "Browser tab",
  unknown: "Unknown source",
};

interface ModePickerProps {
  mode: RecordingMode;
  surfacePref: SurfacePref;
  /** The surface actually captured, once acquisition succeeded. */
  surface: SurfacePref | "unknown" | null;
  disabled: boolean;
  onModeChange: (mode: RecordingMode) => void;
  onSurfaceChange: (pref: SurfacePref) => void;
}

export function ModePicker({
  mode,
  surfacePref,
  surface,
  disabled,
  onModeChange,
  onSurfaceChange,
}: ModePickerProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-dim uppercase tracking-wider">
          Mode
        </label>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onModeChange(opt.value)}
                className={`rounded-lg border p-3 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  active
                    ? "border-accent/60 bg-accent/10 shadow-sm"
                    : "border-border bg-surface hover:bg-surface-raised"
                }`}
              >
                <span
                  className={`block text-sm font-semibold ${
                    active ? "text-foreground" : "text-muted"
                  }`}
                >
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-tight text-muted-dim">
                  {opt.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {mode !== "camera" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-dim uppercase tracking-wider">
            Capture
          </label>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1">
            {SURFACES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onSurfaceChange(opt.value)}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  surfacePref === opt.value
                    ? "bg-accent text-white shadow-sm"
                    : "text-muted hover:text-foreground hover:bg-surface-raised"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {surface && (
            <p className="text-[11px] text-muted-dim">
              Capturing:{" "}
              <span className="text-muted">{SURFACE_LABEL[surface]}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] Run `npm run lint` and `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/components/recorder/mode-picker.tsx
git commit -m "feat(recorder): mode and capture-surface picker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 15: `preview-stage.tsx` + `bubble-drag-overlay.tsx`

**Files:** `src/components/recorder/bubble-drag-overlay.tsx`, `src/components/recorder/preview-stage.tsx`

- [ ] Create `src/components/recorder/bubble-drag-overlay.tsx`:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import {
  computeBubbleRect,
  pointerToNormalized,
} from "@/lib/recording/geometry";
import type { BubbleConfig } from "@/lib/recording/types";

interface BubbleDragOverlayProps {
  bubble: BubbleConfig;
  /** Canvas dimensions, so the handle can be positioned in canvas space. */
  canvasWidth: number;
  canvasHeight: number;
  cameraWidth: number;
  cameraHeight: number;
  onMove: (pos: { x: number; y: number }) => void;
}

/**
 * Transparent layer over the preview. Drag writes a normalized centre straight
 * into the bubble config; the compositor picks it up on the next frame.
 */
export function BubbleDragOverlay({
  bubble,
  canvasWidth,
  canvasHeight,
  cameraWidth,
  cameraHeight,
  onMove,
}: BubbleDragOverlayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const rect =
    canvasWidth > 0 && canvasHeight > 0
      ? computeBubbleRect(canvasWidth, canvasHeight, cameraWidth, cameraHeight, bubble)
      : null;

  const handlePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const host = hostRef.current;
      if (!host) return;
      const bounds = host.getBoundingClientRect();
      onMove(pointerToNormalized(e.clientX, e.clientY, bounds));
    },
    [onMove],
  );

  if (!bubble.visible || !rect || bubble.shape === "full") return null;

  const pct = (n: number, total: number) => `${(n / total) * 100}%`;

  return (
    <div ref={hostRef} className="absolute inset-0">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Camera bubble position"
        aria-valuetext={`x ${Math.round(bubble.pos.x * 100)}%, y ${Math.round(
          bubble.pos.y * 100,
        )}%`}
        aria-valuenow={Math.round(bubble.pos.x * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          handlePointer(e);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          handlePointer(e);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          const { x, y } = bubble.pos;
          if (e.key === "ArrowLeft") onMove({ x: x - step, y });
          else if (e.key === "ArrowRight") onMove({ x: x + step, y });
          else if (e.key === "ArrowUp") onMove({ x, y: y - step });
          else if (e.key === "ArrowDown") onMove({ x, y: y + step });
          else return;
          e.preventDefault();
        }}
        style={{
          position: "absolute",
          left: pct(rect.x, canvasWidth),
          top: pct(rect.y, canvasHeight),
          width: pct(rect.w, canvasWidth),
          height: pct(rect.h, canvasHeight),
          borderRadius: bubble.shape === "circle" ? "50%" : "12px",
        }}
        className={`cursor-grab touch-none outline-none transition-shadow ${
          dragging
            ? "cursor-grabbing ring-2 ring-accent"
            : "ring-1 ring-white/20 hover:ring-accent/60 focus-visible:ring-2 focus-visible:ring-accent"
        }`}
      />
    </div>
  );
}
```

- [ ] Create `src/components/recorder/preview-stage.tsx`:

```tsx
"use client";

import type { RefObject } from "react";
import { BubbleDragOverlay } from "./bubble-drag-overlay";
import type { BubbleConfig, RecordingMode } from "@/lib/recording/types";

interface PreviewStageProps {
  mode: RecordingMode;
  status: string;
  elapsedMs: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  screenVideoRef: RefObject<HTMLVideoElement | null>;
  bubble: BubbleConfig;
  canvasWidth: number;
  canvasHeight: number;
  cameraWidth: number;
  cameraHeight: number;
  onBubbleMove: (pos: { x: number; y: number }) => void;
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function PreviewStage({
  mode,
  status,
  elapsedMs,
  canvasRef,
  screenVideoRef,
  bubble,
  canvasWidth,
  canvasHeight,
  cameraWidth,
  cameraHeight,
  onBubbleMove,
}: PreviewStageProps) {
  const live = status === "recording" || status === "paused";
  const showStage = status !== "idle" && status !== "acquiring";

  return (
    <div
      className={`relative w-full max-w-3xl aspect-video overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/30 ${
        showStage ? "" : "hidden"
      }`}
    >
      {/*
        The canvas is always mounted for camera modes so the compositor has a
        target before acquisition finishes; it is simply empty until then.
      */}
      <canvas
        ref={canvasRef}
        className={`h-full w-full object-contain ${mode === "screen" ? "hidden" : ""}`}
      />
      <video
        ref={screenVideoRef}
        muted
        playsInline
        autoPlay
        className={`h-full w-full object-contain ${mode === "screen" ? "" : "hidden"}`}
      />

      {mode !== "screen" && (
        <BubbleDragOverlay
          bubble={bubble}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          cameraWidth={cameraWidth}
          cameraHeight={cameraHeight}
          onMove={onBubbleMove}
        />
      )}

      {/*
        The REC chip lives in the DOM on purpose — it is never burned into the
        recorded frames. The overlay seam exists for cursor/annotation layers.
      */}
      {live && (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1.5 backdrop-blur">
          <span
            className={`h-2 w-2 rounded-full ${
              status === "paused" ? "bg-muted" : "bg-accent recording-dot"
            }`}
          />
          <span className="font-mono text-xs tabular-nums text-foreground">
            {status === "paused" ? "Paused" : "REC"} {formatElapsed(elapsedMs)}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] Run `npm run lint` and `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/components/recorder/preview-stage.tsx src/components/recorder/bubble-drag-overlay.tsx
git commit -m "feat(recorder): preview stage with draggable camera bubble overlay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 16: `camera-bubble-controls.tsx`

Includes Tyler's **bubble on/off toggle**: hiding the bubble stops it being drawn, but the camera track stays live so re-showing is instant.

**Files:** `src/components/recorder/camera-bubble-controls.tsx`

- [ ] Create `src/components/recorder/camera-bubble-controls.tsx`:

```tsx
"use client";

import type { BubbleConfig, BubbleShape, BubbleSize } from "@/lib/recording/types";

const SHAPES: Array<{ value: BubbleShape; label: string }> = [
  { value: "circle", label: "Circle" },
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
  { value: "portrait", label: "Portrait" },
  { value: "full", label: "Full" },
];

const SIZES: Array<{ value: BubbleSize; label: string }> = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
];

interface CameraBubbleControlsProps {
  bubble: BubbleConfig;
  /** Camera-only mode is always `full`, so shape/size are locked. */
  shapeLocked: boolean;
  onChange: (patch: Partial<BubbleConfig>) => void;
}

export function CameraBubbleControls({
  bubble,
  shapeLocked,
  onChange,
}: CameraBubbleControlsProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-dim">
          Camera bubble
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={bubble.visible}
          aria-label="Show camera bubble"
          onClick={() => onChange({ visible: !bubble.visible })}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            bubble.visible ? "bg-accent" : "bg-surface-raised border border-border"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              bubble.visible ? "left-4" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {bubble.visible && (
        <>
          {!shapeLocked && (
            <>
              <div className="grid grid-cols-5 gap-1 rounded-lg border border-border-subtle bg-background p-1">
                {SHAPES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => onChange({ shape: s.value })}
                    className={`rounded-md px-1.5 py-1 text-[11px] font-medium transition-all ${
                      bubble.shape === s.value
                        ? "bg-accent text-white"
                        : "text-muted hover:text-foreground hover:bg-surface-raised"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-dim">Size</span>
                <div className="flex gap-1 rounded-lg border border-border-subtle bg-background p-1">
                  {SIZES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      disabled={bubble.shape === "full"}
                      onClick={() => onChange({ size: s.value })}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-40 ${
                        bubble.size === s.value
                          ? "bg-accent text-white"
                          : "text-muted hover:text-foreground hover:bg-surface-raised"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={bubble.mirror}
              onChange={(e) => onChange({ mirror: e.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Mirror my camera
          </label>

          <p className="text-[11px] leading-tight text-muted-dim">
            Drag the bubble on the preview to reposition it — during setup or
            while recording.
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] Run `npm run lint` and `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/components/recorder/camera-bubble-controls.tsx
git commit -m "feat(recorder): camera bubble controls with a live on/off toggle

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 17: `background-picker.tsx` (incl. looping video backgrounds)

Tyler's requirement: a **looping video background** for the camera bubble, from a user-uploaded short clip, alongside the gradient presets. Uploaded files become `blob:` object URLs, which `settings.ts` deliberately does not persist.

**Files:** `src/components/recorder/background-picker.tsx`

- [ ] Create `src/components/recorder/background-picker.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { BACKGROUND_PRESETS, COLOR_SWATCHES } from "@/lib/recording/presets";
import type { BackgroundConfig, BackgroundKind } from "@/lib/recording/types";

const KINDS: Array<{ value: BackgroundKind; label: string }> = [
  { value: "none", label: "None" },
  { value: "blur", label: "Blur" },
  { value: "color", label: "Colour" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
];

interface BackgroundPickerProps {
  background: BackgroundConfig;
  onChange: (background: BackgroundConfig) => void;
}

export function BackgroundPicker({ background, onChange }: BackgroundPickerProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string>("");

  // Revoke the object URL when it is replaced or the picker unmounts.
  useEffect(() => {
    return () => {
      if (uploadedUrl) URL.revokeObjectURL(uploadedUrl);
    };
  }, [uploadedUrl]);

  function handleFile(file: File | undefined, kind: "image" | "video") {
    if (!file) return;
    if (uploadedUrl) URL.revokeObjectURL(uploadedUrl);
    const url = URL.createObjectURL(file);
    setUploadedUrl(url);
    setUploadedName(file.name);
    onChange({ kind, src: url });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-dim">
        Background
      </span>

      <div className="grid grid-cols-5 gap-1 rounded-lg border border-border-subtle bg-background p-1">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => {
              if (k.value === "none" || k.value === "blur") onChange({ kind: k.value });
              else if (k.value === "color")
                onChange({ kind: "color", color: background.color ?? COLOR_SWATCHES[0] });
              else if (k.value === "image") imageInputRef.current?.click();
              else videoInputRef.current?.click();
            }}
            className={`rounded-md px-1.5 py-1 text-[11px] font-medium transition-all ${
              background.kind === k.value
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground hover:bg-surface-raised"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {background.kind === "color" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Background colour ${color}`}
              onClick={() => onChange({ kind: "color", color })}
              style={{ background: color }}
              className={`h-6 w-6 rounded-md border transition-all ${
                background.color === color
                  ? "border-accent ring-2 ring-accent/40"
                  : "border-border"
              }`}
            />
          ))}
          <input
            type="color"
            aria-label="Custom background colour"
            value={background.color ?? "#1a1a1e"}
            onChange={(e) => onChange({ kind: "color", color: e.target.value })}
            className="h-6 w-8 cursor-pointer rounded-md border border-border bg-transparent"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-dim">Presets</span>
        <div className="grid grid-cols-4 gap-1.5">
          {BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.label}
              onClick={() =>
                onChange({ kind: "image", src: preset.src, presetId: preset.id })
              }
              style={{ background: preset.swatch }}
              className={`h-10 rounded-md border transition-all ${
                background.presetId === preset.id
                  ? "border-accent ring-2 ring-accent/40"
                  : "border-border hover:border-accent/50"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="rounded-md border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground"
        >
          Upload image
        </button>
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          className="rounded-md border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground"
        >
          Upload looping video
        </button>
      </div>
      {uploadedName && (
        <p className="truncate text-[11px] text-muted-dim">
          Using {uploadedName} — uploads are not remembered between sessions.
        </p>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0], "image");
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0], "video");
          e.target.value = "";
        }}
      />

      <p className="text-[11px] leading-tight text-muted-dim">
        Backgrounds need person segmentation; until the model loads you will see
        your plain camera.
      </p>
    </div>
  );
}
```

- [ ] Run `npm run lint` and `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/components/recorder/background-picker.tsx
git commit -m "feat(recorder): background picker with gradients, uploads and looping video

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 18: `frame-picker.tsx` — framed capture (for-later #1)

**Files:** `src/components/recorder/frame-picker.tsx`

- [ ] Create `src/components/recorder/frame-picker.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { COLOR_SWATCHES, FRAME_PRESETS } from "@/lib/recording/presets";
import type { FrameConfig } from "@/lib/recording/types";

interface FramePickerProps {
  frame: FrameConfig;
  /** Padding changes the canvas size, so it is locked once recording starts. */
  locked: boolean;
  onChange: (patch: Partial<FrameConfig>) => void;
}

export function FramePicker({ frame, locked, onChange }: FramePickerProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (uploadedUrl) URL.revokeObjectURL(uploadedUrl);
    };
  }, [uploadedUrl]);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-dim">
          Framed capture
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={frame.enabled}
          aria-label="Enable framed capture"
          disabled={locked}
          onClick={() => onChange({ enabled: !frame.enabled })}
          className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
            frame.enabled ? "bg-accent" : "border border-border bg-surface-raised"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              frame.enabled ? "left-4" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {frame.enabled && (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {FRAME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.label}
                disabled={locked}
                onClick={() =>
                  onChange({
                    background: { kind: "image", src: preset.src, presetId: preset.id },
                  })
                }
                style={{ background: preset.swatch }}
                className={`h-10 rounded-md border transition-all disabled:opacity-50 ${
                  frame.background.presetId === preset.id
                    ? "border-accent ring-2 ring-accent/40"
                    : "border-border hover:border-accent/50"
                }`}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {COLOR_SWATCHES.slice(0, 5).map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Frame colour ${color}`}
                disabled={locked}
                onClick={() => onChange({ background: { kind: "color", color } })}
                style={{ background: color }}
                className={`h-6 w-6 rounded-md border transition-all disabled:opacity-50 ${
                  frame.background.kind === "color" && frame.background.color === color
                    ? "border-accent ring-2 ring-accent/40"
                    : "border-border"
                }`}
              />
            ))}
            <button
              type="button"
              disabled={locked}
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
            >
              Upload
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (uploadedUrl) URL.revokeObjectURL(uploadedUrl);
                const url = URL.createObjectURL(file);
                setUploadedUrl(url);
                onChange({ background: { kind: "image", src: url } });
              }}
            />
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-muted-dim">
              Padding {Math.round(frame.padding * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={0.2}
              step={0.005}
              value={frame.padding}
              disabled={locked}
              onChange={(e) => onChange({ padding: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)] disabled:opacity-50"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] text-muted-dim">
              Corner radius {Math.round(frame.radius * 1000) / 10}%
            </span>
            <input
              type="range"
              min={0}
              max={0.05}
              step={0.002}
              value={frame.radius}
              disabled={locked}
              onChange={(e) => onChange({ radius: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)] disabled:opacity-50"
            />
          </label>

          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={frame.shadow}
              disabled={locked}
              onChange={(e) => onChange({ shadow: e.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Drop shadow
          </label>

          {locked && (
            <p className="text-[11px] leading-tight text-muted-dim">
              Frame settings are locked while recording — the canvas size is
              fixed once the encoder starts.
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] Run `npm run lint` and `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/components/recorder/frame-picker.tsx
git commit -m "feat(recorder): framed capture picker with gradient presets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 19: `audio-controls.tsx` + `level-meter.tsx`

**Files:** `src/components/recorder/level-meter.tsx`, `src/components/recorder/audio-controls.tsx`

- [ ] Create `src/components/recorder/level-meter.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

const SEGMENTS = 8;

interface LevelMeterProps {
  /** Reads the current 0..1 level. Polled, never a React dependency. */
  getLevel: () => number;
  active: boolean;
  label: string;
}

export function LevelMeter({ getLevel, active, label }: LevelMeterProps) {
  const [lit, setLit] = useState(0);

  useEffect(() => {
    if (!active) {
      setLit(0);
      return;
    }
    const id = window.setInterval(() => {
      setLit(Math.round(getLevel() * SEGMENTS));
    }, 100);
    return () => window.clearInterval(id);
  }, [active, getLevel]);

  return (
    <div className="flex items-center gap-[3px]" aria-label={`${label} level`} role="meter" aria-valuenow={lit} aria-valuemin={0} aria-valuemax={SEGMENTS}>
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const on = i < lit;
        const hot = i >= SEGMENTS - 2;
        return (
          <span
            key={i}
            className={`h-3 w-1 rounded-sm transition-colors ${
              on ? (hot ? "bg-accent" : "bg-emerald-400") : "bg-surface-raised"
            }`}
          />
        );
      })}
    </div>
  );
}
```

- [ ] Create `src/components/recorder/audio-controls.tsx`:

```tsx
"use client";

import { DeviceSelector } from "@/components/device-selector";
import { LevelMeter } from "./level-meter";
import type { Capabilities } from "@/lib/recording/types";

interface AudioControlsProps {
  micOn: boolean;
  systemOn: boolean;
  micId: string;
  hasSystemAudio: boolean;
  /** True once capture is live, so device pickers must not change mid-stream. */
  live: boolean;
  capabilities: Capabilities;
  getLevel: (id: "mic" | "system") => number;
  onToggleMic: () => void;
  onToggleSystem: () => void;
  onMicChange: (deviceId: string) => void;
}

function Toggle({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "border border-border bg-surface-raised"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
          on ? "left-4" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function AudioControls({
  micOn,
  systemOn,
  micId,
  hasSystemAudio,
  live,
  capabilities,
  getLevel,
  onToggleMic,
  onToggleSystem,
  onMicChange,
}: AudioControlsProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-dim">
        Audio
      </span>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground">Microphone</span>
        <div className="flex items-center gap-3">
          <LevelMeter getLevel={() => getLevel("mic")} active={micOn} label="Microphone" />
          <Toggle on={micOn} label="Microphone" onClick={onToggleMic} />
        </div>
      </div>

      {!live && (
        <DeviceSelector
          kind="audioinput"
          label="Microphone device"
          value={micId}
          onChange={onMicChange}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground">System audio</span>
        <div className="flex items-center gap-3">
          <LevelMeter
            getLevel={() => getLevel("system")}
            active={systemOn && hasSystemAudio}
            label="System audio"
          />
          <Toggle on={systemOn} label="System audio" onClick={onToggleSystem} />
        </div>
      </div>

      {live && !hasSystemAudio && (
        <p className="text-[11px] leading-tight text-muted-dim">
          {capabilities.systemAudio === "tab-only"
            ? "System audio is available for tab recordings, or use the desktop app."
            : "This browser cannot capture system audio. Use the desktop app."}
        </p>
      )}

      <p className="text-[11px] leading-tight text-muted-dim">
        Both sources are mixed into one track before recording starts, so you can
        toggle either one mid-recording.
      </p>
    </div>
  );
}
```

- [ ] Run `npm run lint` and `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/components/recorder/audio-controls.tsx src/components/recorder/level-meter.tsx
git commit -m "feat(recorder): independent mic and system audio toggles with level meters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 20: `countdown.tsx` + `review.tsx`

**Files:** `src/components/recorder/countdown.tsx`, `src/components/recorder/review.tsx`

- [ ] Create `src/components/recorder/countdown.tsx`:

```tsx
"use client";

interface CountdownProps {
  value: number;
  onSkip: () => void;
}

export function Countdown({ value, onSkip }: CountdownProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background/90 backdrop-blur">
      <span
        key={value}
        aria-live="assertive"
        className="text-8xl font-bold tabular-nums text-foreground"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={onSkip}
        className="rounded-lg border border-border bg-surface px-5 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        Skip
      </button>
    </div>
  );
}
```

- [ ] Create `src/components/recorder/review.tsx`:

```tsx
"use client";

import { formatElapsed } from "./preview-stage";

interface ReviewProps {
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationMs: number;
  error: string;
  onUpload: () => void;
  onDiscard: () => void;
}

export function Review({
  videoUrl,
  thumbnailUrl,
  durationMs,
  error,
  onUpload,
  onDiscard,
}: ReviewProps) {
  return (
    <div className="w-full max-w-3xl space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/30">
        {videoUrl && (
          <video
            src={videoUrl}
            poster={thumbnailUrl ?? undefined}
            controls
            playsInline
            className="aspect-video w-full bg-black"
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt="Thumbnail preview"
              className="h-10 w-16 rounded-md border border-border object-cover"
            />
          )}
          <span className="font-mono text-sm tabular-nums text-muted">
            {formatElapsed(durationMs)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="rounded-lg bg-accent px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover"
          >
            Upload
          </button>
        </div>
      </div>

      {error && <p className="text-center text-sm text-red-400/90">{error}</p>}
    </div>
  );
}
```

- [ ] Run `npm run lint` and `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/components/recorder/countdown.tsx src/components/recorder/review.tsx
git commit -m "feat(recorder): countdown and review screens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 21: `recorder.tsx` becomes a thin shell; delete the dead preview

The drag overlay needs the live canvas and camera dimensions, so this task first adds a `dimensions` field to `UseRecorderResult`, then rewrites the shell.

**Files:** `src/lib/recording/use-recorder.ts` (modified), `src/components/recorder.tsx` (rewritten), `src/components/recording-preview.tsx` (deleted)

- [ ] In `src/lib/recording/use-recorder.ts`, add the field to the result interface, right after `thumbnailUrl`:

```ts
  /** Live canvas and camera dimensions, polled for the drag overlay. */
  dimensions: {
    canvasWidth: number;
    canvasHeight: number;
    cameraWidth: number;
    cameraHeight: number;
  };
```

- [ ] In the same file, add the polling state next to the other `useState` calls:

```ts
  const [dimensions, setDimensions] = useState({
    canvasWidth: 0,
    canvasHeight: 0,
    cameraWidth: 0,
    cameraHeight: 0,
  });
```

- [ ] And add the poll effect immediately before the `getLevel` callback:

```ts
  // Polled rather than pushed so the draw loop stays free of React.
  useEffect(() => {
    const active =
      state.status === "setup" ||
      state.status === "countdown" ||
      state.status === "recording" ||
      state.status === "paused";
    if (!active) return;
    const id = window.setInterval(() => {
      const canvas = canvasRef.current;
      const camTrack = cameraStreamRef.current?.getVideoTracks()[0];
      const camSettings = camTrack?.getSettings();
      setDimensions((prev) => {
        const next = {
          canvasWidth: canvas?.width ?? 0,
          canvasHeight: canvas?.height ?? 0,
          cameraWidth: camSettings?.width ?? 0,
          cameraHeight: camSettings?.height ?? 0,
        };
        return prev.canvasWidth === next.canvasWidth &&
          prev.canvasHeight === next.canvasHeight &&
          prev.cameraWidth === next.cameraWidth &&
          prev.cameraHeight === next.cameraHeight
          ? prev
          : next;
      });
    }, 400);
    return () => window.clearInterval(id);
  }, [state.status]);
```

- [ ] And return it from the hook (add `dimensions,` to the returned object).

- [ ] Rewrite `src/components/recorder.tsx` completely:

```tsx
"use client";

import { useState } from "react";
import { YoomLogo } from "./logo";
import { DeviceSelector } from "./device-selector";
import { AudioControls } from "./recorder/audio-controls";
import { BackgroundPicker } from "./recorder/background-picker";
import { CameraBubbleControls } from "./recorder/camera-bubble-controls";
import { Countdown } from "./recorder/countdown";
import { FramePicker } from "./recorder/frame-picker";
import { ModePicker } from "./recorder/mode-picker";
import { PreviewStage } from "./recorder/preview-stage";
import { Review } from "./recorder/review";
import { useRecorder } from "@/lib/recording/use-recorder";

export function Recorder() {
  const {
    state,
    capabilities,
    canvasRef,
    screenVideoRef,
    reviewUrl,
    thumbnailUrl,
    dimensions,
    getLevel,
    actions,
  } = useRecorder();
  const [copied, setCopied] = useState(false);

  const live = state.status === "recording" || state.status === "paused";
  const configuring = state.status === "idle" || state.status === "setup";
  const showsCamera = state.mode !== "screen";

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(state.shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Insecure context — the input is selectable as a fallback.
    }
  }

  if (state.status === "done") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8.5L6.5 12L13 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Recording uploaded</h2>
            <p className="text-sm text-muted">Share the link below</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2.5">
            <input
              readOnly
              value={state.shareUrl}
              className="flex-1 truncate bg-transparent text-sm text-muted outline-none"
            />
            <button
              type="button"
              onClick={copyShareUrl}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-accent-hover"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={actions.reset}
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            Record another
          </button>
        </div>
      </main>
    );
  }

  if (state.status === "uploading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-5 text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-dim">
            Uploading
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="progress-bar h-1.5 rounded-full bg-accent transition-all duration-500 ease-out"
              style={{ width: `${state.uploadProgress}%` }}
            />
          </div>
          <p className="font-mono text-sm tabular-nums text-muted">
            {state.uploadProgress}%
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      {state.status === "countdown" && (
        <Countdown value={state.countdown} onSkip={actions.skipCountdown} />
      )}

      <PreviewStage
        mode={state.mode}
        status={state.status}
        elapsedMs={state.elapsedMs}
        canvasRef={canvasRef}
        screenVideoRef={screenVideoRef}
        bubble={state.bubble}
        canvasWidth={dimensions.canvasWidth}
        canvasHeight={dimensions.canvasHeight}
        cameraWidth={dimensions.cameraWidth}
        cameraHeight={dimensions.cameraHeight}
        onBubbleMove={(pos) => actions.setBubble({ pos })}
      />

      {state.status === "review" ? (
        <Review
          videoUrl={reviewUrl}
          thumbnailUrl={thumbnailUrl}
          durationMs={state.durationMs}
          error={state.error}
          onUpload={actions.upload}
          onDiscard={actions.discard}
        />
      ) : (
        <div className="w-full max-w-md space-y-4">
          {state.status === "idle" && (
            <div className="flex justify-center">
              <YoomLogo size="sm" />
            </div>
          )}

          {configuring && (
            <ModePicker
              mode={state.mode}
              surfacePref={state.surfacePref}
              surface={state.surface}
              disabled={state.status !== "idle"}
              onModeChange={actions.selectMode}
              onSurfaceChange={actions.setSurfacePref}
            />
          )}

          {state.status === "idle" && showsCamera && (
            <DeviceSelector
              kind="videoinput"
              label="Camera"
              value={state.cameraId}
              onChange={(id) => actions.setDevice("camera", id)}
            />
          )}

          {(state.status === "setup" || live) && (
            <AudioControls
              micOn={state.micOn}
              systemOn={state.systemOn}
              micId={state.micId}
              hasSystemAudio={state.hasSystemAudio}
              live={live}
              capabilities={capabilities}
              getLevel={getLevel}
              onToggleMic={() => actions.toggleMic()}
              onToggleSystem={() => actions.toggleSystem()}
              onMicChange={(id) => actions.setDevice("mic", id)}
            />
          )}

          {(state.status === "setup" || live) && showsCamera && (
            <>
              <CameraBubbleControls
                bubble={state.bubble}
                shapeLocked={state.mode === "camera"}
                onChange={actions.setBubble}
              />
              <BackgroundPicker
                background={state.background}
                onChange={actions.setBackground}
              />
            </>
          )}

          {(state.status === "setup" || live) && state.mode === "screen+camera" && (
            <FramePicker frame={state.frame} locked={live} onChange={actions.setFrame} />
          )}

          {state.error && (
            <p className="text-center text-sm text-red-400/90">{state.error}</p>
          )}
          {state.notice && (
            <p className="text-center text-sm text-muted">{state.notice}</p>
          )}

          <div className="flex items-center justify-center gap-3">
            {(state.status === "idle" || state.status === "error") && (
              <button
                type="button"
                onClick={actions.acquire}
                className="rounded-lg bg-accent px-8 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-accent/30"
              >
                Set up recording
              </button>
            )}

            {state.status === "acquiring" && (
              <span className="text-sm text-muted">Waiting for permission…</span>
            )}

            {state.status === "setup" && (
              <>
                <button
                  type="button"
                  onClick={actions.start}
                  className="rounded-lg bg-accent px-8 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover"
                >
                  Start recording
                </button>
                <button
                  type="button"
                  onClick={actions.reset}
                  className="rounded-lg border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </>
            )}

            {live && (
              <>
                <button
                  type="button"
                  onClick={state.status === "paused" ? actions.resume : actions.pause}
                  className="rounded-lg border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:brightness-110"
                >
                  {state.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={actions.restart}
                  className="rounded-lg border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Restart
                </button>
                <button
                  type="button"
                  onClick={actions.stop}
                  className="rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-hover"
                >
                  Stop
                </button>
              </>
            )}
          </div>

          {(state.status === "setup" || live) && (
            <p className="text-center text-[11px] text-muted-dim">
              ⌘⇧L start / stop · ⌘⇧P pause
            </p>
          )}
        </div>
      )}
    </main>
  );
}
```

- [ ] Delete the replaced component:

```bash
git rm src/components/recording-preview.tsx
```

- [ ] Confirm nothing still references it: `grep -rn "recording-preview" src` — expect no output.
- [ ] Run `npm run lint` — expect PASS.
- [ ] Run `npx vitest run` — expect every suite PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:

```bash
git add src/components/recorder.tsx src/lib/recording/use-recorder.ts
git commit -m "refactor(recorder): reduce recorder.tsx to a shell over useRecorder

Replaces the 470-line monolith with the src/lib/recording modules and the
src/components/recorder/* pieces, and deletes the superseded preview.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Task 22: Manual verification matrix

Browser-only behaviour (MediaRecorder, the canvas draw loop, MediaPipe, permissions) has no meaningful unit test; this is the Phase 2 verification list from the spec plus Tyler's additions. Chrome first.

**Files:** `docs/for-later.md` (updated at the end)

- [ ] Run `npm run dev` and log in at `/`.

**Modes × surfaces**

- [ ] `screen` × Entire screen: badge reads "Entire screen"; preview shows the `<video>` path (no canvas).
- [ ] `screen` × Window, `screen` × Tab: badge matches the chosen surface, not just the requested one.
- [ ] `screen+camera` × each of the three surfaces: canvas composites screen + bubble.
- [ ] `camera` only: canvas fills with the camera, no screen prompt, bubble controls show only the mirror toggle.
- [ ] Browser "Stop sharing" during setup → returns to idle, all tracks `ended`.
- [ ] Browser "Stop sharing" mid-recording → stops cleanly and lands on review with a playable blob.
- [ ] Switch tabs / surfaces mid-recording (surfaceSwitching) → the encoder keeps running; the new surface is letterboxed into the locked canvas size.

**Audio (the Phase 1 bug fix)**

- [ ] Tab capture with audio, mic ON + system ON → `ffprobe` the downloaded blob (or play it): both voices audible.
- [ ] Toggle mic OFF mid-recording, speak, toggle back ON → the muted stretch is silent, no click at either edge.
- [ ] Toggle system OFF/ON mid-recording → same, and the mic is unaffected.
- [ ] Both meters move independently and go dark when their source is off.
- [ ] macOS + Entire screen → the notice "System audio is available for tab recordings, or use the desktop app" appears.
- [ ] Deny microphone permission → recording still starts with system audio only.

**Camera bubble**

- [ ] Every shape × every size during setup; the handle tracks the drawn bubble.
- [ ] Same again while recording.
- [ ] Drag in setup and while recording; the bubble is clamped inside the canvas at every edge.
- [ ] Reload the page → the shape, size and position are restored from `localStorage`.
- [ ] Mirror flips only the camera pixels, never the screen.
- [ ] `full` shape hides the screen entirely.
- [ ] **Bubble toggle off mid-recording** → the bubble disappears from the recorded frames; the camera indicator light stays on; toggling back on re-appears within one frame (no re-acquisition).

**Backgrounds**

- [ ] none / blur / colour / preset gradient / uploaded image / uploaded looping mp4, in both `camera` and `screen+camera`.
- [ ] The uploaded video loops seamlessly and is muted.
- [ ] Before the model finishes loading, the plain camera shows — never a black bubble.
- [ ] DevTools FPS meter stays ≈60 while segmenting (drop to 30 with the CPU delegate is acceptable).
- [ ] Reload → a preset background is restored; an uploaded image/video is not (by design).

**Framed capture**

- [ ] Enable the frame in `screen+camera`: the canvas grows, the screen is inset, rounded and shadowed.
- [ ] Each of the four gradient presets, plus a solid colour and an uploaded image.
- [ ] Padding and radius sliders change the preview live before recording; both are locked once recording starts.
- [ ] Record with the frame on → the uploaded video has the padded dimensions and matches the preview.
- [ ] Reload → the frame settings and the chosen preset persist; the feature is off in a fresh profile.

**Overlay seam**

- [ ] `NEXT_PUBLIC_YOOM_DEBUG_FPS=1 npm run dev` → the FPS readout draws on the canvas and **is** burned into a test recording (expected: it is a debug flag).
- [ ] Without the flag → nothing extra is drawn, and the REC chip is visible in the UI but absent from the recorded file.

**Flow**

- [ ] Countdown counts 3-2-1; Skip jumps straight in.
- [ ] Pause freezes the timer and the encoder; Resume continues; the final duration excludes the paused span (compare against a stopwatch).
- [ ] Restart mid-recording discards chunks and re-runs the countdown without re-prompting for permissions.
- [ ] ⌘⇧L in idle → setup, in setup → start, while recording → stop. ⌘⇧P pauses and resumes.
- [ ] Review → Discard returns to setup with the streams still live.
- [ ] Review → Upload → Drive file appears in the Yoom folder, a `videos` row exists, a thumbnail is attached, and the "done" screen shows `https://jtylerray.com/v/<slug>`.
- [ ] The share link plays on the watch page with a working seek bar (the WebM duration patch still runs).
- [ ] Force an upload failure (offline) → the review screen returns with the error and the blob intact; retrying online succeeds.

**Cleanup**

- [ ] After upload: `document.querySelectorAll('video')` sources released, every track `readyState === "ended"`, the camera indicator light is off.
- [ ] In DevTools Performance, no `requestAnimationFrame` work after stopping.
- [ ] `AudioContext` closed (no lingering "audio playing" tab indicator).

**Cross-browser spot checks**

- [ ] Safari: recording produces `video/mp4`; `ctx.filter` blur works on Safari 18+, and on older Safari the bubble still renders (unfeathered).
- [ ] Firefox: no system audio (notice shown); segmentation runs off the interval fallback rather than `requestVideoFrameCallback`.

**Build gates**

- [ ] `npm run lint` — PASS.
- [ ] `npx vitest run` — every suite PASS.
- [ ] `npm run build` — PASS.
- [ ] `grep -rn "recording-preview" src` — empty.

- [ ] Update `docs/for-later.md`: under "Recording polish", mark item 1 as **shipped in Phase 2** with a pointer to `compositor.ts#computeFrameLayout`, and add a line under items 2–4 noting that the overlay seam (`OverlayLayer` / `compositor.addOverlay`) now exists, so Phase 5 only has to register layers.
- [ ] Commit:

```bash
git add docs/for-later.md
git commit -m "docs: record Phase 2 verification results and tick off framed capture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr"
```

---

## Self-review

**Spec coverage.** Every Phase 2 bullet maps to a task. Known defects: the mic-replaces-system-audio bug at `recorder.tsx:222-229` is fixed by the always-present `mixer.outputTrack` (Task 6, wired in Task 13, exercised in Task 22's audio matrix); `device-selector.tsx`'s direct `navigator.mediaDevices` call goes through the provider in Task 3. Modules: `desktop-bridge` (Task 1), `media-sources` (Task 2), `audio-mixer` (Task 6), `segmentation` (Task 11), `compositor` (Tasks 7 + 9, geometry split out so it is node-testable), `recorder-machine` (Task 5), `settings` (Task 4), `use-recorder` (Task 13 + the `dimensions` addition in Task 21). Components: `mode-picker` (14), `preview-stage` + `bubble-drag-overlay` (15), `camera-bubble-controls` (16), `background-picker` (17), `audio-controls` + `level-meter` (19), `countdown` + `review` (20), `frame-picker` (18); `recorder.tsx` shrinks to a shell and `recording-preview.tsx` is deleted in Task 21. Tyler's additions: bubble on/off mid-recording (`BubbleConfig.visible`, Tasks 1/4/5/9/16/22); mic and system toggles (6/19); looping video background (types in 1, compositor playback in 9, uploader in 17); framed capture with `{padding, radius, shadow, background}`, four gradient presets, persisted, off by default (1/4/7/9/10/18); overlay seam `OverlayLayer` + `compositor.addOverlay` with a no-op and a flagged debug FPS layer (1/8/9). for-later #1 ships; #2–#4 stay out of scope but inherit the seam. The Phase 1 upload flow is preserved verbatim in Task 12 and called from Task 13; the "done" screen with the share link is retained, and `router.push('/library/'+id+'?new=1')` is explicitly deferred to Phase 3.

**Testing strategy.** Node-environment Vitest covers every pure module: `desktop-bridge` version gating; `media-sources` constraint objects, surface read-back, UA-derived capabilities and provider merging with `window.__yoomDesktop`; `settings` load/save/merge/validation against a stubbed `localStorage`, including the blob-URL strip; `recorder-machine` across all 27 events including illegal-event no-ops (asserted by reference equality); `audio-mixer` graph wiring, gain ramps, deferred disconnect and level maths against a stubbed `AudioContext`; `geometry` rect/crop/clamp/frame maths with `bubblePath` driven through a `vi.stubGlobal("Path2D", …)` stub (plus a no-`roundRect` fallback case); `overlays` FPS smoothing against a fake 2D context; `presets` catalogue invariants; `upload` flow order, payload shapes, non-fatal thumbnail failure and error text with a stubbed `fetch`. Browser-only code — `Compositor`'s rAF loop, `PersonSegmenter`, `MediaRecorder`, permissions — is verified by Task 22's matrix, which mirrors the spec's Phase 2 list. The draw loop touches no React: `Compositor` receives config through imperative setters and reads only its own fields; React polls (levels at 100 ms, dimensions at 400 ms) instead of the loop pushing state.

**Placeholder scan.** No "TBD", "similar to Task N", "add error handling" or elided bodies: every file is given in full, including the two Node scripts, the four SVG presets (generated by `scripts/make-backgrounds.mjs`), and every test. `@mediapipe/tasks-vision` is pinned to **1.0.1**, verified with `npm view @mediapipe/tasks-vision version`; the WASM paths (`wasm/vision_wasm_internal.{js,wasm}`, `wasm/vision_wasm_nosimd_internal.{js,wasm}`) were confirmed by unpacking `npm pack @mediapipe/tasks-vision@1.0.1`; the model is **not** in the package, so `scripts/copy-mediapipe.mjs` downloads `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite` once into `public/models/` and caches it, with a jsDelivr fallback for the WASM only. Both live under `public/` so the thumbnail canvas is never tainted, and the script never fails the build.

**Type consistency.** All shared types live in `src/lib/recording/types.ts` and are re-exported from `compositor.ts` for spec fidelity, so there is exactly one definition of `BubbleConfig`, `BackgroundConfig`, `FrameConfig`, `Rect`, `FrameInfo`, `OverlayLayer`, `Capabilities` and `MediaSourceProvider`. Cross-task signatures line up: `computeBubbleRect(W,H,camW,camH,cfg) → Rect` is used identically by `compositor.ts` and `bubble-drag-overlay.tsx`; `AudioMixer.getLevel(id)` feeds `useRecorder#getLevel`, which feeds `LevelMeter`; `uploadRecording(input) → {id, slug, url}` matches what `UPLOAD_DONE` consumes; `RecorderSettings` is the exact intersection of what `initialRecorderState` reads and what the persistence effect writes. The one deliberate late addition — `UseRecorderResult.dimensions` — is spelled out with its exact insertion points in Task 21 rather than left implicit. Ordering keeps the tree green: Tasks 1–13 add unreferenced modules, Tasks 14–20 add unreferenced components, and only Task 21 swaps the shell, so `npm run build` passes after every commit.

