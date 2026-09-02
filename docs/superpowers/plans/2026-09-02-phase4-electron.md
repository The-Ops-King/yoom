# Phase 4: Electron desktop shell — Implementation Plan

> **For agentic workers:** This plan is written for a fresh session with no prior context. Work the tasks in order, top to bottom. Each task is self-contained: read the files it names, make exactly the changes it specifies, run the commands shown, and confirm the expected output before moving on. Do not skip the test-first steps, do not batch commits, and do not substitute your own versions for the pinned ones. Every symbol referenced here is defined here — if something looks missing, re-read the task, do not invent it.

**Status:** MERGED to `main` 2026-09-03 (Tasks 1–21 built, reviewed, fixed; root 333 / desktop 26 tests; unsigned arm64 dmg+zip built in `desktop/dist/`). Task 22 sections B–I (everything needing a running app and macOS permission prompts) pending Tyler — see `docs/overnight-2026-09-02.md`.

## Goal

Ship `desktop/` — a macOS menu-bar Electron shell that wraps the already-deployed Yoom web recorder and adds the three things a browser cannot do on macOS:

1. **Full system audio** for screen and window captures (Chrome on macOS only gives system audio for *tab* captures). Electron's `setDisplayMediaRequestHandler` returns `audio: 'loopback'`, which Chromium services with Apple's CoreAudio Tap API on macOS 14.2+.
2. **Global hotkeys** that fire when the recorder window is not focused (⌘⇧L / ⌘⇧P / ⌘⇧K / ⌘⇧X / ⌘⇧M).
3. **A floating always-on-top camera bubble over the desktop** while recording — draggable, Loom-style — whose desktop position drives the bubble position burned into the recording. (This is the "Phase 4 requirements from Phase 2 testing" item in `docs/for-later.md`. Items #2–#4 in that file — cursor smoothing, click ripples, cursor sidecar — remain out of scope.)

Plus a native source picker (screens + windows with thumbnails), a tray menu, a persistent login (`persist:yoom` partition, the existing 30-day `yoom_session` cookie), and an unsigned `dmg`/`zip` build.

**Non-goals for v1:** code signing, notarization, auto-update, Windows/Linux packaging, cursor effects, capturing the bubble as a separate video track.

## Architecture

```
┌─ desktop/ (separate npm package, never deployed to Vercel) ──────────────────┐
│                                                                             │
│  main process                                                               │
│    index.ts       app lifecycle, single instance, dock hide, feature flags   │
│    windows.ts     recorder BrowserWindow on session.fromPartition('persist:yoom')
│    bubble.ts      floating camera-bubble BrowserWindow + move→normalized map │
│    capture.ts     setDisplayMediaRequestHandler → picker → {video, 'loopback'}│
│    picker.ts      picker BrowserWindow + desktopCapturer.getSources          │
│    permissions.ts systemPreferences media access + System Settings deep links│
│    tray.ts        menu-bar icon and menu                                     │
│    shortcuts.ts   globalShortcut registration, scoped to the recorder window │
│    mapping.ts     PURE maths (unit-tested): bounds → normalized, shape → CSS │
│                                                                             │
│  preload/app.ts     contextBridge → window.__yoomDesktop  (version 1)        │
│  preload/picker.ts  contextBridge → window.__yoomPicker                      │
│  preload/bubble.ts  contextBridge → window.__yoomBubble                      │
│                                                                             │
│  renderer/picker/   plain HTML+TS+CSS source list                            │
│  renderer/bubble/   plain HTML+TS+CSS live camera in a shaped, draggable box │
└─────────────────────────────────────────────────────────────────────────────┘
             │ loads https://yoom.jtylerray.com (or localhost:3000 in dev)
             ▼
┌─ root repo (Next.js app, unchanged deployment) ─────────────────────────────┐
│  src/lib/recording/desktop-bridge.ts   + onBubbleMove / setBubbleAppearance  │
│                                          / setBubbleVisible / setCameraDevice│
│                                          / setSurfacePref, widened shortcuts │
│  src/lib/recording/types.ts            + DesktopShortcut, BubbleAppearance   │
│  src/lib/recording/media-sources.ts    getProvider() wraps getDisplay to     │
│                                          announce the surface pref first     │
│  src/lib/recording/geometry.ts         + displayPosToCanvasPos               │
│  src/lib/recording/use-recorder.ts     bridge wiring (visibility, device,    │
│                                          appearance, incoming position)      │
│  src/components/recorder.tsx           "System audio: on" badge              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The bubble loop.** The desktop bubble window is a *live camera preview positioned over the desktop*; it is not the pixels that end up in the recording. When the user drags it, main computes its centre normalized to the display it sits on and pushes `{x, y}` to the web renderer, which calls `actions.setBubble({ pos }, { immediate: true })`. The web compositor then draws the burned-in bubble at the same place, at the same size, on the next frame. Because both rectangles coincide, the composited bubble occludes whatever the screen capture picked up of the live window — see Task 15 for the three-layer answer to the double-bubble problem.

**Why the bridge cannot own `getDisplay`.** `contextBridge` clones/proxies values across worlds and cannot pass a `MediaStream`. So the preload never calls `getDisplayMedia`; the web app's own `browserProvider.getDisplay` still runs in the main world and Electron intercepts it in the main process via `setDisplayMediaRequestHandler`. The bridge only *announces* the surface preference beforehand so the native picker can preselect the right tab.

## Tech Stack

Pinned, verified with `npm view <pkg> version` on 2026-09-02:

| Package | Version | Why |
|---|---|---|
| `electron` | **44.1.1** (`latest`) | ≥ 39 required: Chromium made the CoreAudio Tap API the default for desktop audio capture as of `v39.0.0-beta.4`. |
| `electron-vite` | **5.0.0** | main/preload/renderer bundling; peer range `vite ^5 \|\| ^6 \|\| ^7`. |
| `vite` | **7.1.14** | Highest version inside `electron-vite`'s peer range (npm `latest` is 8.2.2 — **do not use it**, it is out of range). |
| `electron-builder` | **26.15.3** (`latest`) | dmg + zip, `identity: null`. |
| `typescript` | **5.9.3** | Matches the root repo's `^5`. npm `latest` is 7.0.2 (the native port) — **do not use it** in this package. |
| `vitest` | **4.1.11** | Same version the root repo already uses. |
| `@types/node` | **26.4.1** | Node typings for the main process. |

Doc sources cited throughout (all read on 2026-09-02):
- `https://www.electronjs.org/docs/latest/api/desktop-capturer` — §*Caveats → macOS versions 14.2 or higher* (the `NSAudioCaptureUsageDescription`/CoreAudio Tap requirement and the feature-flag escape hatch), §`desktopCapturer.getSources(options)`.
- `https://www.electronjs.org/docs/latest/api/session` — §`ses.setDisplayMediaRequestHandler(handler[, opts])`, §`ses.setPermissionRequestHandler(handler)`, §`session.fromPartition(partition[, options])`.
- `node_modules/electron/electron.d.ts` @ electron 44.1.1 — `BrowserWindow.setContentProtection`, `BrowserWindow.setAlwaysOnTop`, `Streams.audio`, `DisplayMediaRequestHandlerHandlerRequest`, `systemPreferences.getMediaAccessStatus`, `screen.getDisplayMatching`.

**Two documented facts you must not "fix":**

1. The `session` docs' one-liner for `Streams.audio` still reads *"Specifying a loopback device will capture system audio, and is currently only supported on Windows."* The `desktopCapturer` **Caveats** section contradicts it and is the current truth for macOS 14.2+: Chromium routes desktop audio capture through the CoreAudio Tap API by default since Electron `v39.0.0-beta.4`, gated on the `NSAudioCaptureUsageDescription` Info.plist key. The stale line is a doc bug. Task 21's `volumedetect` check is the arbiter.
2. The exact feature name for the escape hatch is **`MacCatapLoopbackAudioForScreenShare`** — verbatim from the desktopCapturer Caveats code block. (The Phase 4 spec guessed `MacCatapSystemAudioLoopbackCapture`; that name does not exist.)

---

## File Structure

### New — `desktop/`

| File | Responsibility |
|---|---|
| `desktop/package.json` | Its own npm package: pinned deps and the `dev` / `build` / `start` / `test` / `typecheck` scripts. |
| `desktop/tsconfig.json` | Strict TS for main + preload (Node/Electron libs). |
| `desktop/tsconfig.renderer.json` | Strict TS for the picker/bubble renderers (DOM libs). |
| `desktop/electron.vite.config.ts` | `main` / `preload` / `renderer` build entries for electron-vite. |
| `desktop/vitest.config.ts` | Runs only `src/main/*.test.ts` in a node environment. |
| `desktop/.gitignore` | Ignores `node_modules`, `out`, `dist`. |
| `desktop/electron-builder.yml` | `appId com.jtylerray.yoom`, mac `dmg`+`zip`, `identity: null`, the four TCC plist strings, `LSUIElement`. |
| `desktop/build/entitlements.mac.plist` | Camera / microphone / audio-input entitlements, used only if the app is ever signed. |
| `desktop/build/make-tray-icons.mjs` | Generates the two template PNGs deterministically (no binary blobs in git history). |
| `desktop/build/trayTemplate.png` | 16×16 macOS template tray icon (generated). |
| `desktop/build/trayTemplate@2x.png` | 32×32 retina tray icon (generated). |
| `desktop/src/shared/ipc.ts` | Every channel name and payload type, shared by main, preloads and renderers. |
| `desktop/src/main/mapping.ts` | **Pure**: bubble bounds → normalized centre, appearance → window size + CSS, shape tables. |
| `desktop/src/main/mapping.test.ts` | Unit tests for `mapping.ts`. |
| `desktop/src/main/index.ts` | App entry: feature flags, single instance, `app.dock.hide()`, wiring of every other module. |
| `desktop/src/main/windows.ts` | The recorder `BrowserWindow` (persistent partition, nav guard, external-link handler). |
| `desktop/src/main/permissions.ts` | `systemPreferences` reads/prompts and System Settings deep links. |
| `desktop/src/main/tray.ts` | Menu-bar icon and menu. |
| `desktop/src/main/shortcuts.ts` | `globalShortcut` register/unregister, forwarding to the recorder renderer. |
| `desktop/src/main/picker.ts` | The source-picker window and `desktopCapturer.getSources` plumbing. |
| `desktop/src/main/capture.ts` | `setDisplayMediaRequestHandler`, screen-permission guard, loopback audio decision. |
| `desktop/src/main/bubble.ts` | The floating camera-bubble window: create/show/hide/resize, move reporting. |
| `desktop/src/preload/app.ts` | Exposes `window.__yoomDesktop` (the Phase 2 bridge contract). |
| `desktop/src/preload/picker.ts` | Exposes `window.__yoomPicker`. |
| `desktop/src/preload/bubble.ts` | Exposes `window.__yoomBubble`. |
| `desktop/src/renderer/picker/index.html` | Picker markup. |
| `desktop/src/renderer/picker/picker.css` | Picker styles (vibrancy-friendly, dark). |
| `desktop/src/renderer/picker/picker.ts` | Picker behaviour: tabs, thumbnails, keyboard. |
| `desktop/src/renderer/bubble/index.html` | Bubble markup: drag wrapper + `<video>` + control strip. |
| `desktop/src/renderer/bubble/bubble.css` | Transparent window, shape clipping, drag regions. |
| `desktop/src/renderer/bubble/bubble.ts` | Bubble behaviour: `getUserMedia`, appearance application, controls. |
| `desktop/README.md` | Permissions, first run, dev loop, build, known limits. |

### New — root

| File | Responsibility |
|---|---|
| `.vercelignore` | Keeps `desktop/` out of Vercel deployments. |
| `vitest.config.ts` | Root test config that excludes `desktop/**` so `npm test` stays a web-only run. |

### Modified — root

| File | Change |
|---|---|
| `src/lib/recording/types.ts` | `DesktopShortcut`, `BubbleAppearance`, five new optional `DesktopBridge` members. |
| `src/lib/recording/desktop-bridge.ts` | `onDesktopShortcut` widened; `onDesktopBubbleMove`, `setDesktopBubbleVisible`, `setDesktopBubbleAppearance`, `setDesktopCameraDevice` helpers. |
| `src/lib/recording/desktop-bridge.test.ts` | Tests for the new helpers. |
| `src/lib/recording/media-sources.ts` | `getProvider()` wraps `getDisplay` to call `bridge.setSurfacePref` first. |
| `src/lib/recording/media-sources.test.ts` | Test for that wrapper. |
| `src/lib/recording/geometry.ts` | `displayPosToCanvasPos`. |
| `src/lib/recording/geometry.test.ts` | Tests for it. |
| `src/lib/recording/use-recorder.ts` | Bridge wiring: shortcuts, bubble visibility, camera device, appearance sync, incoming position. |
| `src/components/recorder.tsx` | "System audio: on" desktop badge. |
| `tsconfig.json` | `exclude: ["node_modules", "desktop"]`. |
| `eslint.config.mjs` | Ignore `desktop/**`. |
| `package.json` | `test` keeps working via the new root vitest config (no script change needed, listed for completeness). |
| `README.md` | New "Desktop app" section. |
| `docs/for-later.md` | Mark the floating-bubble item shipped. |

---

## Task 1

Widen the desktop bridge contract. Pure types plus tiny helpers — no Electron in sight, fully testable in the root vitest run.

**Files:** `src/lib/recording/types.ts`, `src/lib/recording/desktop-bridge.ts`, `src/lib/recording/desktop-bridge.test.ts`

- [ ] Read `src/lib/recording/types.ts` and `src/lib/recording/desktop-bridge.ts` so you know the exact current shape before editing.

- [ ] In `src/lib/recording/types.ts`, replace the whole `// ---------- desktop bridge ----------` block with:

```ts
// ---------- desktop bridge ----------

/**
 * Every hotkey the desktop shell forwards. The web app binds the same chords
 * itself (`use-recorder.ts`), but those only fire while the page has focus;
 * the shell registers them globally and replays them through this union.
 */
export type DesktopShortcut = "toggle" | "pause" | "mark" | "restart" | "cancel";

/**
 * What the floating desktop camera bubble should look like. `visible` is the
 * user's own bubble toggle; the shell ALSO gates the window on
 * `setBubbleVisible`, which follows the recorder's status. The window is shown
 * only when both are true.
 */
export interface BubbleAppearance {
  shape: BubbleShape;
  size: BubbleSize;
  mirror: boolean;
  visible: boolean;
}

export interface DesktopBridge {
  version: 1;
  isDesktop?: boolean;
  mediaSources?: Partial<MediaSourceProvider>;
  capabilities?: Partial<Capabilities>;
  onShortcut?(cb: (action: DesktopShortcut) => void): () => void;
  /**
   * Announce the surface preference before `getDisplayMedia` runs so the native
   * picker opens on the right tab. Fire-and-forget: the stream itself is still
   * created by the page, because `contextBridge` cannot carry a `MediaStream`
   * across worlds.
   */
  setSurfacePref?(pref: SurfacePref): void;
  /** The user dragged the floating bubble; `pos` is normalized to the captured display. */
  onBubbleMove?(cb: (pos: { x: number; y: number }) => void): () => void;
  /** Shape / size / mirror / user-visibility of the floating bubble. */
  setBubbleAppearance?(appearance: BubbleAppearance): void;
  /** Status-driven show/hide of the floating bubble window. */
  setBubbleVisible?(visible: boolean): void;
  /** Which camera the floating bubble should open (`null` = default device). */
  setCameraDevice?(deviceId: string | null): void;
}
```

- [ ] In `src/lib/recording/desktop-bridge.ts`, replace `onDesktopShortcut` and append the new helpers. The file becomes:

```ts
import type { BubbleAppearance, DesktopBridge, DesktopShortcut } from "./types";

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
export function onDesktopShortcut(cb: (action: DesktopShortcut) => void): () => void {
  const bridge = getDesktopBridge();
  if (!bridge?.onShortcut) return () => {};
  return bridge.onShortcut(cb);
}

/** Subscribe to drags of the floating desktop camera bubble. */
export function onDesktopBubbleMove(
  cb: (pos: { x: number; y: number }) => void,
): () => void {
  const bridge = getDesktopBridge();
  if (!bridge?.onBubbleMove) return () => {};
  return bridge.onBubbleMove(cb);
}

/** Show/hide the floating bubble window. No-op in the browser. */
export function setDesktopBubbleVisible(visible: boolean): void {
  getDesktopBridge()?.setBubbleVisible?.(visible);
}

/** Push shape/size/mirror/visibility to the floating bubble. No-op in the browser. */
export function setDesktopBubbleAppearance(appearance: BubbleAppearance): void {
  getDesktopBridge()?.setBubbleAppearance?.(appearance);
}

/** Tell the floating bubble which camera to open. No-op in the browser. */
export function setDesktopCameraDevice(deviceId: string | null): void {
  getDesktopBridge()?.setCameraDevice?.(deviceId);
}
```

- [ ] Append to `src/lib/recording/desktop-bridge.test.ts`, inside the existing `describe("desktop-bridge", ...)` block (keep the existing four tests untouched):

```ts
  it("forwards every shortcut action the shell can send", () => {
    const seen: string[] = [];
    let emit: ((a: "toggle" | "pause" | "mark" | "restart" | "cancel") => void) | null =
      null;
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        onShortcut: (cb: (a: "toggle" | "pause" | "mark" | "restart" | "cancel") => void) => {
          emit = cb;
          return () => seen.push("unsub");
        },
      },
    });

    const unsub = onDesktopShortcut((a) => seen.push(a));
    emit!("toggle");
    emit!("mark");
    emit!("cancel");
    unsub();
    expect(seen).toEqual(["toggle", "mark", "cancel", "unsub"]);
  });

  it("returns a no-op unsubscribe when the shell has no shortcut support", () => {
    vi.stubGlobal("window", { __yoomDesktop: { version: 1 } });
    expect(() => onDesktopShortcut(() => {})()).not.toThrow();
    expect(() => onDesktopBubbleMove(() => {})()).not.toThrow();
  });

  it("forwards bubble moves", () => {
    const seen: { x: number; y: number }[] = [];
    let emit: ((p: { x: number; y: number }) => void) | null = null;
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        onBubbleMove: (cb: (p: { x: number; y: number }) => void) => {
          emit = cb;
          return () => {};
        },
      },
    });
    onDesktopBubbleMove((p) => seen.push(p));
    emit!({ x: 0.8, y: 0.9 });
    expect(seen).toEqual([{ x: 0.8, y: 0.9 }]);
  });

  it("bubble setters are silent no-ops without a bridge", () => {
    vi.stubGlobal("window", {});
    expect(() => setDesktopBubbleVisible(true)).not.toThrow();
    expect(() =>
      setDesktopBubbleAppearance({
        shape: "circle",
        size: "medium",
        mirror: true,
        visible: true,
      }),
    ).not.toThrow();
    expect(() => setDesktopCameraDevice(null)).not.toThrow();
  });

  it("bubble setters reach a version-1 bridge", () => {
    const calls: unknown[] = [];
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        setBubbleVisible: (v: boolean) => calls.push(["visible", v]),
        setBubbleAppearance: (a: unknown) => calls.push(["appearance", a]),
        setCameraDevice: (id: string | null) => calls.push(["camera", id]),
      },
    });
    setDesktopBubbleVisible(false);
    setDesktopBubbleAppearance({
      shape: "rounded",
      size: "large",
      mirror: false,
      visible: true,
    });
    setDesktopCameraDevice("cam-1");
    expect(calls).toEqual([
      ["visible", false],
      [
        "appearance",
        { shape: "rounded", size: "large", mirror: false, visible: true },
      ],
      ["camera", "cam-1"],
    ]);
  });
```

- [ ] Update the import at the top of `desktop-bridge.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopBridge,
  isDesktop,
  onDesktopBubbleMove,
  onDesktopShortcut,
  setDesktopBubbleAppearance,
  setDesktopBubbleVisible,
  setDesktopCameraDevice,
} from "./desktop-bridge";
```

- [ ] Run: `npm test -- src/lib/recording/desktop-bridge.test.ts`
      Expected: `Test Files  1 passed`, `Tests  9 passed`.

- [ ] Run: `npx tsc --noEmit`
      Expected: no output (exit 0).

---

## Task 2

Route the surface preference through the bridge so the native picker can preselect Screens vs Windows, without ever moving `getDisplayMedia` out of the page.

**Files:** `src/lib/recording/media-sources.ts`, `src/lib/recording/media-sources.test.ts`

- [ ] Add this test to `src/lib/recording/media-sources.test.ts` (append inside the existing top-level `describe` for `getProvider`, or add a new `describe("getProvider surface pref", ...)` block at the end of the file):

```ts
describe("getProvider surface pref", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("announces the surface pref to the shell before delegating to the page", async () => {
    const order: string[] = [];
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: "monitor" }) }],
      getAudioTracks: () => [{}],
    };
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/140",
      mediaDevices: {
        getDisplayMedia: async () => {
          order.push("getDisplayMedia");
          return stream;
        },
      },
    });
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        isDesktop: true,
        setSurfacePref: (pref: string) => order.push(`pref:${pref}`),
        capabilities: { systemAudio: "full", nativePicker: true, surfaceHints: false },
      },
    });

    const provider = getProvider();
    const result = await provider.getDisplay("window");

    expect(order).toEqual(["pref:window", "getDisplayMedia"]);
    expect(result.surface).toBe("monitor");
    expect(result.hasSystemAudio).toBe(true);
    expect(provider.capabilities()).toMatchObject({
      systemAudio: "full",
      nativePicker: true,
      surfaceHints: false,
    });
  });

  it("leaves getDisplay untouched when the shell has no setSurfacePref", async () => {
    vi.stubGlobal("window", { __yoomDesktop: { version: 1, isDesktop: true } });
    expect(getProvider().getDisplay).toBe(browserProvider.getDisplay);
  });
});
```

- [ ] Make sure the test file imports what it needs (add missing names to the existing import lines):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserProvider, getProvider } from "./media-sources";
```

- [ ] Run: `npm test -- src/lib/recording/media-sources.test.ts`
      Expected: the two new tests **fail** (`expected [ 'getDisplayMedia' ] to deeply equal [ 'pref:window', 'getDisplayMedia' ]`). That is the red step.

- [ ] In `src/lib/recording/media-sources.ts`, inside `getProvider()`, insert the wrapper **after** the `merged` object is built and **before** the `if (bridge.capabilities)` block:

```ts
  // `contextBridge` cannot carry a `MediaStream` across worlds, so the shell
  // never implements `getDisplay` itself. It only needs to know which tab the
  // native picker should open on, which this announcement provides. The page
  // still creates the stream; Electron's `setDisplayMediaRequestHandler`
  // intercepts it in the main process.
  if (bridge.setSurfacePref && !bridgeOverrides.getDisplay) {
    const announce = bridge.setSurfacePref.bind(bridge);
    const inner = merged.getDisplay;
    merged.getDisplay = (pref: SurfacePref) => {
      try {
        announce(pref);
      } catch {
        // A dead IPC channel must never block the capture.
      }
      return inner(pref);
    };
  }
```

- [ ] Run: `npm test -- src/lib/recording/media-sources.test.ts`
      Expected: all tests pass.

---

## Task 3

The frame-aware mapping helper. When framed capture is on, the canvas is larger than the screen, so a position normalized to the *display* is not a position normalized to the *canvas*.

**Files:** `src/lib/recording/geometry.ts`, `src/lib/recording/geometry.test.ts`

- [ ] Append to `src/lib/recording/geometry.test.ts`:

```ts
describe("displayPosToCanvasPos", () => {
  const noFrame: FrameConfig = {
    enabled: false,
    padding: 0,
    radius: 0,
    shadow: false,
    background: { kind: "none" },
  };
  const framed: FrameConfig = { ...noFrame, enabled: true, padding: 0.1 };

  it("is the identity when the screen fills the canvas", () => {
    const layout = computeFrameLayout(1920, 1080, noFrame);
    expect(displayPosToCanvasPos({ x: 0.25, y: 0.75 }, layout)).toEqual({
      x: 0.25,
      y: 0.75,
    });
  });

  it("maps into the inset screen rect when framing is on", () => {
    // pad = round(1920 * 0.1) = 192 → canvas 2304×1464, dest at (192, 192).
    const layout = computeFrameLayout(1920, 1080, framed);
    expect(layout.canvasW).toBe(2304);
    expect(layout.canvasH).toBe(1464);
    expect(displayPosToCanvasPos({ x: 0.5, y: 0.5 }, layout)).toEqual({
      x: 0.5,
      y: 0.5,
    });
    const topLeft = displayPosToCanvasPos({ x: 0, y: 0 }, layout);
    expect(topLeft.x).toBeCloseTo(192 / 2304, 6);
    expect(topLeft.y).toBeCloseTo(192 / 1464, 6);
    const bottomRight = displayPosToCanvasPos({ x: 1, y: 1 }, layout);
    expect(bottomRight.x).toBeCloseTo((192 + 1920) / 2304, 6);
    expect(bottomRight.y).toBeCloseTo((192 + 1080) / 1464, 6);
  });

  it("clamps out-of-range and non-finite input", () => {
    const layout = computeFrameLayout(1920, 1080, noFrame);
    expect(displayPosToCanvasPos({ x: -3, y: 4 }, layout)).toEqual({ x: 0, y: 1 });
    expect(displayPosToCanvasPos({ x: NaN, y: NaN }, layout)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("falls back to the centre for a degenerate layout", () => {
    expect(
      displayPosToCanvasPos(
        { x: 0.2, y: 0.2 },
        { canvasW: 0, canvasH: 0, dest: { x: 0, y: 0, w: 0, h: 0 }, radius: 0 },
      ),
    ).toEqual({ x: 0.5, y: 0.5 });
  });
});
```

- [ ] Ensure `geometry.test.ts` imports `computeFrameLayout`, `displayPosToCanvasPos` and the `FrameConfig` type (add to the existing import lines).

- [ ] Run: `npm test -- src/lib/recording/geometry.test.ts`
      Expected: the new block fails with `displayPosToCanvasPos is not a function`.

- [ ] Append to `src/lib/recording/geometry.ts` (after `computeFrameLayout`):

```ts
/**
 * Phase 4: the floating desktop bubble reports a centre normalized to the
 * *captured display*, but `computeBubbleRect` works in *canvas* space. With
 * framed capture on, the canvas is larger than the screen and the screen sits
 * inset at `layout.dest`, so the two spaces differ. Pure so the mapping can be
 * asserted without a canvas or an Electron runtime.
 */
export function displayPosToCanvasPos(
  pos: { x: number; y: number },
  layout: FrameLayout,
): { x: number; y: number } {
  if (layout.canvasW <= 0 || layout.canvasH <= 0) return { x: 0.5, y: 0.5 };
  if (layout.dest.w <= 0 || layout.dest.h <= 0) return { x: 0.5, y: 0.5 };
  const x = clampNormalized(pos.x);
  const y = clampNormalized(pos.y);
  return {
    x: clampNormalized((layout.dest.x + x * layout.dest.w) / layout.canvasW),
    y: clampNormalized((layout.dest.y + y * layout.dest.h) / layout.canvasH),
  };
}
```

- [ ] Run: `npm test`
      Expected: every root test file passes.

- [ ] Run: `npx tsc --noEmit && npm run lint`
      Expected: no errors.

- [ ] Commit:

```
git add src/lib/recording
git commit -m "$(cat <<'EOF'
feat(recording): widen the desktop bridge for Phase 4

Adds the contract the Electron shell needs before the shell exists:
DesktopShortcut (five actions, not two), BubbleAppearance, and the
onBubbleMove / setBubbleAppearance / setBubbleVisible / setCameraDevice /
setSurfacePref members. getProvider() now announces the surface preference
to the shell before delegating getDisplay back to the page, because
contextBridge cannot carry a MediaStream across worlds. geometry gains
displayPosToCanvasPos so a display-normalized bubble centre lands correctly
inside a framed capture.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Task 4

Scaffold `desktop/` as a separate npm package and keep it out of every root pipeline.

**Files:** `desktop/package.json`, `desktop/tsconfig.json`, `desktop/tsconfig.renderer.json`, `desktop/electron.vite.config.ts`, `desktop/vitest.config.ts`, `desktop/.gitignore`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `.vercelignore`

- [ ] Create `desktop/package.json`:

```json
{
  "name": "yoom-desktop",
  "version": "0.1.0",
  "private": true,
  "description": "Yoom desktop shell (macOS)",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "YOOM_DEV=1 electron-vite dev",
    "start": "electron-vite preview",
    "build": "npm run typecheck && electron-vite build && electron-builder --mac dmg zip --publish never",
    "build:renderer": "electron-vite build",
    "icons": "node build/make-tray-icons.mjs",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.renderer.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "26.4.1",
    "electron": "44.1.1",
    "electron-builder": "26.15.3",
    "electron-vite": "5.0.0",
    "typescript": "5.9.3",
    "vite": "7.1.14",
    "vitest": "4.1.11"
  }
}
```

- [ ] Create `desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src/main/**/*.ts", "src/preload/**/*.ts", "src/shared/**/*.ts", "electron.vite.config.ts", "vitest.config.ts"]
}
```

- [ ] Create `desktop/tsconfig.renderer.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": [],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src/renderer/**/*.ts", "src/shared/**/*.ts"]
}
```

- [ ] Create `desktop/electron.vite.config.ts`:

```ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          app: resolve(__dirname, "src/preload/app.ts"),
          picker: resolve(__dirname, "src/preload/picker.ts"),
          bubble: resolve(__dirname, "src/preload/bubble.ts"),
        },
        // A sandboxed preload cannot load an ES module; CommonJS output only.
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: {
          picker: resolve(__dirname, "src/renderer/picker/index.html"),
          bubble: resolve(__dirname, "src/renderer/bubble/index.html"),
        },
      },
    },
  },
});
```

- [ ] Create `desktop/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only the pure main-process maths is unit-tested. Everything that touches
    // Electron, media or TCC lives in the manual verification matrix.
    include: ["src/main/**/*.test.ts"],
  },
});
```

- [ ] Create `desktop/.gitignore`:

```
node_modules
out
dist
*.tsbuildinfo
```

- [ ] Edit the root `tsconfig.json`: change the last line to

```json
  "exclude": ["node_modules", "desktop"]
```

- [ ] Edit the root `eslint.config.mjs`: add `"desktop/**"` to the `globalIgnores([...])` array, right after `"next-env.d.ts"`.

- [ ] Create the root `vitest.config.ts` (the root `npm test` must not try to load Electron):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `desktop/` is a separate npm package with its own vitest config and its
    // own (Electron) dependency tree. Run it with `npm --prefix desktop test`.
    exclude: ["**/node_modules/**", "desktop/**", "**/.next/**"],
  },
});
```

- [ ] Create the root `.vercelignore`:

```
desktop
```

- [ ] Run: `cd desktop && npm install`
      Expected: `added N packages`, and `node_modules/electron/dist/Electron.app` exists (Electron's postinstall downloads the binary). Verify with `ls desktop/node_modules/electron/dist`.

- [ ] Run: `npm --prefix desktop exec -- electron --version`
      Expected: `v44.1.1`.

- [ ] Run from the repo root: `npm test && npx tsc --noEmit && npm run lint`
      Expected: root tests pass, no TS errors, no lint errors — and no mention of `desktop/` in any of the three.

- [ ] Commit:

```
git add desktop/package.json desktop/tsconfig.json desktop/tsconfig.renderer.json desktop/electron.vite.config.ts desktop/vitest.config.ts desktop/.gitignore tsconfig.json eslint.config.mjs vitest.config.ts .vercelignore
git commit -m "$(cat <<'EOF'
chore(desktop): scaffold the Electron package

desktop/ is its own npm package (electron 44.1.1, electron-vite 5.0.0,
electron-builder 26.15.3, vite 7.1.14 to stay inside electron-vite's peer
range, typescript 5.9.3 to match the root). The root tsconfig, ESLint, vitest
and Vercel deploys all skip it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Task 5

The IPC contract. One file, imported by main, all three preloads and both renderers, so a channel can never be misspelled in only one place.

**Files:** `desktop/src/shared/ipc.ts`

- [ ] Create `desktop/src/shared/ipc.ts`:

```ts
/**
 * Every IPC channel in the shell, plus the payload types that travel on them.
 * `invoke` channels are request/response; `send` channels are one-way and the
 * comment states the direction.
 *
 * The web-app-facing types here MUST stay identical to
 * `src/lib/recording/types.ts` in the root repo. They are duplicated rather
 * than imported because `desktop/` is a separate package with no path mapping
 * into the Next.js app.
 */

export type SurfacePref = "monitor" | "window" | "browser";
export type BubbleShape = "circle" | "rounded" | "square" | "portrait" | "full";
export type BubbleSize = "small" | "medium" | "large";
export type DesktopShortcut = "toggle" | "pause" | "mark" | "restart" | "cancel";

export interface BubbleAppearance {
  shape: BubbleShape;
  size: BubbleSize;
  mirror: boolean;
  visible: boolean;
}

export interface SourceInfo {
  id: string;
  name: string;
  kind: "screen" | "window";
  /** PNG data URL, 320×180. */
  thumb: string;
  /** PNG data URL of the app icon, windows only. */
  icon?: string;
}

export const IPC = {
  /** app renderer → main. Fire-and-forget surface preference for the picker. */
  setSurfacePref: "yoom:set-surface-pref",
  /** main → app renderer. A global hotkey fired. Payload: DesktopShortcut. */
  shortcut: "yoom:shortcut",
  /** main → app renderer. Bubble was dragged. Payload: { x, y } normalized. */
  bubbleMoved: "yoom:bubble-moved",
  /** app renderer → main. Payload: BubbleAppearance. */
  setBubbleAppearance: "yoom:bubble-appearance",
  /** app renderer → main. Payload: boolean. */
  setBubbleVisible: "yoom:bubble-visible",
  /** app renderer → main. Payload: string | null. */
  setCameraDevice: "yoom:bubble-camera",

  /** main → bubble renderer. Payload: BubbleAppearance. */
  bubbleApply: "yoom:bubble:apply",
  /** main → bubble renderer. Payload: string | null (deviceId). */
  bubbleCamera: "yoom:bubble:camera",
  /** bubble renderer → main. The user clicked "hide" in the control strip. */
  bubbleRequestHide: "yoom:bubble:request-hide",
  /** bubble renderer → main. The user clicked the shape button. */
  bubbleCycleShape: "yoom:bubble:cycle-shape",

  /** main → picker renderer. Payload: PickerPayload. */
  pickerSources: "yoom:picker:sources",
  /** picker renderer → main. Payload: { id: string }. */
  pickerChoose: "yoom:picker:choose",
  /** picker renderer → main. No payload. */
  pickerCancel: "yoom:picker:cancel",
} as const;

export interface PickerPayload {
  sources: SourceInfo[];
  /** Which tab to open on, derived from the last `setSurfacePref`. */
  tab: "screen" | "window";
  /** True when the page asked for audio, so the picker can say so. */
  audioRequested: boolean;
}

export interface BubbleApi {
  onApply(cb: (appearance: BubbleAppearance) => void): void;
  onCamera(cb: (deviceId: string | null) => void): void;
  requestHide(): void;
  cycleShape(): void;
}

export interface PickerApi {
  onSources(cb: (payload: PickerPayload) => void): void;
  choose(id: string): void;
  cancel(): void;
}

declare global {
  interface Window {
    __yoomBubble?: BubbleApi;
    __yoomPicker?: PickerApi;
  }
}
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: no output (exit 0).

---

## Task 6

The pure main-process maths, tests first. This is the only part of the shell that is unit-tested; everything else is manual.

**Files:** `desktop/src/main/mapping.test.ts`, `desktop/src/main/mapping.ts`

- [ ] Create `desktop/src/main/mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BUBBLE_ASPECT,
  SIZE_FRACTION,
  bubbleCentreToNormalized,
  bubbleWindowSize,
  clamp01,
  cycleShape,
  shapeToCss,
} from "./mapping";

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe("clamp01", () => {
  it("clamps and defaults non-finite input to the centre", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(NaN)).toBe(0.5);
  });
});

describe("bubbleCentreToNormalized", () => {
  it("maps a window's centre into 0..1 of the display", () => {
    // Centre of a 240×240 window at (840, 420) is (960, 540) = dead centre.
    expect(
      bubbleCentreToNormalized({ x: 840, y: 420, width: 240, height: 240 }, display),
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it("respects a display whose origin is not (0, 0)", () => {
    const second = { x: 1920, y: -200, width: 1440, height: 900 };
    const centred = { x: 1920 + 720 - 100, y: -200 + 450 - 100, width: 200, height: 200 };
    expect(bubbleCentreToNormalized(centred, second)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps a window dragged partly off the display", () => {
    expect(
      bubbleCentreToNormalized({ x: -400, y: -400, width: 240, height: 240 }, display),
    ).toEqual({ x: 0, y: 0 });
    expect(
      bubbleCentreToNormalized({ x: 3000, y: 2000, width: 240, height: 240 }, display),
    ).toEqual({ x: 1, y: 1 });
  });

  it("returns the centre for a degenerate display", () => {
    expect(
      bubbleCentreToNormalized(
        { x: 0, y: 0, width: 240, height: 240 },
        { x: 0, y: 0, width: 0, height: 0 },
      ),
    ).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("bubbleWindowSize", () => {
  it("matches the web compositor's size fractions", () => {
    // These MUST equal SIZE_FRACTION in src/lib/recording/geometry.ts.
    expect(SIZE_FRACTION).toEqual({ small: 0.15, medium: 0.22, large: 0.3 });
  });

  it("sizes a circle as a square at the size fraction of the display width", () => {
    expect(bubbleWindowSize("circle", "medium", 1920)).toEqual({
      width: 422,
      height: 422,
    });
  });

  it("applies the shape aspect ratio", () => {
    // rounded = 16/9 → 288 wide, 162 tall at small on a 1920-wide display.
    expect(bubbleWindowSize("rounded", "small", 1920)).toEqual({
      width: 288,
      height: 162,
    });
    // portrait = 9/16 → 576 wide, 1024 tall at large.
    expect(bubbleWindowSize("portrait", "large", 1920)).toEqual({
      width: 576,
      height: 1024,
    });
  });

  it("never returns a window smaller than the minimum usable size", () => {
    const { width, height } = bubbleWindowSize("circle", "small", 200);
    expect(width).toBeGreaterThanOrEqual(120);
    expect(height).toBeGreaterThanOrEqual(120);
  });

  it("knows every shape's aspect ratio", () => {
    expect(BUBBLE_ASPECT.circle).toBe(1);
    expect(BUBBLE_ASPECT.square).toBe(1);
    expect(BUBBLE_ASPECT.rounded).toBeCloseTo(16 / 9, 6);
    expect(BUBBLE_ASPECT.portrait).toBeCloseTo(9 / 16, 6);
    expect(BUBBLE_ASPECT.full).toBeCloseTo(16 / 9, 6);
  });
});

describe("shapeToCss", () => {
  it("rounds a circle to a pill of half its short side", () => {
    expect(shapeToCss("circle", false)).toEqual({
      borderRadius: "50%",
      transform: "none",
    });
  });

  it("squares off a square", () => {
    expect(shapeToCss("square", false)).toEqual({
      borderRadius: "0px",
      transform: "none",
    });
  });

  it("uses the shared 14% corner fraction for rounded and portrait", () => {
    expect(shapeToCss("rounded", false).borderRadius).toBe("14%");
    expect(shapeToCss("portrait", false).borderRadius).toBe("14%");
  });

  it("mirrors with a scale transform, never by flipping the layout", () => {
    expect(shapeToCss("circle", true).transform).toBe("scaleX(-1)");
  });
});

describe("cycleShape", () => {
  it("walks circle → rounded → square → portrait → circle", () => {
    expect(cycleShape("circle")).toBe("rounded");
    expect(cycleShape("rounded")).toBe("square");
    expect(cycleShape("square")).toBe("portrait");
    expect(cycleShape("portrait")).toBe("circle");
  });

  it("treats `full` as circle (the floating bubble has no full-screen shape)", () => {
    expect(cycleShape("full")).toBe("circle");
  });
});
```

- [ ] Run: `npm --prefix desktop test`
      Expected: failure — `Failed to resolve import "./mapping"`. Red step.

- [ ] Create `desktop/src/main/mapping.ts`:

```ts
import type { BubbleShape, BubbleSize } from "../shared/ipc";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bubble width as a fraction of the display width.
 *
 * DUPLICATED from `SIZE_FRACTION` in the web app's
 * `src/lib/recording/geometry.ts`. The two MUST agree: the floating window and
 * the composited bubble have to occupy the same rectangle, otherwise the
 * composited bubble stops occluding the captured pixels of the live window.
 * `mapping.test.ts` asserts the literal values so a drift in either package
 * shows up as a failing test rather than a visual artefact.
 */
export const SIZE_FRACTION: Record<BubbleSize, number> = {
  small: 0.15,
  medium: 0.22,
  large: 0.3,
};

/**
 * width / height for each shape, matching `computeBubbleRect`:
 * circle and square are 1:1, portrait is 9:16, rounded follows the camera
 * (16:9 for every webcam Yoom supports). `full` never gets a floating window —
 * it is camera-only mode, which has no desktop overlay — but it needs an entry
 * so the table is total.
 */
export const BUBBLE_ASPECT: Record<BubbleShape, number> = {
  circle: 1,
  square: 1,
  rounded: 16 / 9,
  portrait: 9 / 16,
  full: 16 / 9,
};

/** Corner radius of a rounded/portrait bubble, as a fraction of its short side. */
export const BUBBLE_RADIUS_FRACTION = 0.14;

/** Smallest window we will ever create, so the bubble stays draggable. */
export const MIN_BUBBLE_PX = 120;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/**
 * The bubble window's centre, normalized to the display it sits on.
 *
 * Both `bubble` (from `BrowserWindow.getBounds()`) and `display`
 * (`Display.bounds`) are in **device-independent pixels**, so the display's
 * `scaleFactor` cancels out and must NOT be applied here. The captured frame is
 * a uniformly scaled copy of the same rectangle, which makes a normalized
 * coordinate DPR-invariant — that is exactly why the wire format is normalized.
 */
export function bubbleCentreToNormalized(
  bubble: Bounds,
  display: Bounds,
): { x: number; y: number } {
  if (display.width <= 0 || display.height <= 0) return { x: 0.5, y: 0.5 };
  const cx = bubble.x + bubble.width / 2;
  const cy = bubble.y + bubble.height / 2;
  return {
    x: clamp01((cx - display.x) / display.width),
    y: clamp01((cy - display.y) / display.height),
  };
}

/**
 * The window size that makes the live bubble line up with the composited one.
 * `displayWidthDip` is `Display.bounds.width` for the display the bubble is on.
 */
export function bubbleWindowSize(
  shape: BubbleShape,
  size: BubbleSize,
  displayWidthDip: number,
): { width: number; height: number } {
  const fraction = SIZE_FRACTION[size];
  const aspect = BUBBLE_ASPECT[shape];
  const rawW = Math.round(displayWidthDip * fraction);
  const width = Math.max(MIN_BUBBLE_PX, rawW);
  const height = Math.max(MIN_BUBBLE_PX, Math.round(width / aspect));
  return { width, height };
}

/** CSS the bubble renderer applies to its shaped container. */
export function shapeToCss(
  shape: BubbleShape,
  mirror: boolean,
): { borderRadius: string; transform: string } {
  const borderRadius =
    shape === "circle"
      ? "50%"
      : shape === "square"
        ? "0px"
        : `${Math.round(BUBBLE_RADIUS_FRACTION * 100)}%`;
  return { borderRadius, transform: mirror ? "scaleX(-1)" : "none" };
}

/** The order the bubble's own shape button walks through. */
export function cycleShape(shape: BubbleShape): BubbleShape {
  switch (shape) {
    case "circle":
      return "rounded";
    case "rounded":
      return "square";
    case "square":
      return "portrait";
    default:
      // `portrait` and the unreachable `full` both wrap to the start.
      return "circle";
  }
}
```

- [ ] Run: `npm --prefix desktop test`
      Expected: `Test Files  1 passed`, `Tests  14 passed`.

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

- [ ] Commit:

```
git add desktop/src/shared/ipc.ts desktop/src/main/mapping.ts desktop/src/main/mapping.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): IPC contract and the pure bubble mapping maths

mapping.ts converts a bubble window's screen bounds into a display-normalized
centre (DIP in, DIP out — the display scaleFactor cancels) and derives the
window size that makes the live bubble coincide with the composited one. The
size fractions are deliberately duplicated from the web geometry module and the
test pins the literal values so drift fails loudly.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Task 7

The macOS permission module: read TCC status, prompt for camera/mic, and deep-link into System Settings for the two that cannot be prompted from code.

**Files:** `desktop/src/main/permissions.ts`

- [ ] Create `desktop/src/main/permissions.ts`:

```ts
import { dialog, shell, systemPreferences } from "electron";

/**
 * macOS privacy panes. `x-apple.systempreferences:` URLs open System Settings
 * directly at the pane; the anchors below are stable across Ventura → Sequoia.
 */
const PANE = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  microphone:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  // macOS 14.2+ splits system-audio capture into its own entry.
  audio:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture",
} as const;

export type PaneKey = keyof typeof PANE;

export function openPrivacyPane(pane: PaneKey): void {
  void shell.openExternal(PANE[pane]);
}

/**
 * `systemPreferences.getMediaAccessStatus` accepts only
 * 'microphone' | 'camera' | 'screen' (electron.d.ts @ 44.1.1). There is no
 * queryable status for the macOS 14.2+ "System Audio Recording" entry, so the
 * only signal that it is missing is a silent, dead audio track — which is why
 * Task 21 checks the recording with `volumedetect` rather than trusting an API.
 */
export function screenAccess(): ReturnType<
  typeof systemPreferences.getMediaAccessStatus
> {
  if (process.platform !== "darwin") return "granted";
  return systemPreferences.getMediaAccessStatus("screen");
}

export function hasScreenAccess(): boolean {
  return screenAccess() === "granted";
}

/**
 * Camera and microphone CAN be prompted from code. Screen Recording cannot:
 * macOS raises its own prompt the first time `desktopCapturer.getSources`
 * actually captures, and after granting, the app must be relaunched.
 */
export async function requestMediaAccess(): Promise<{
  camera: boolean;
  microphone: boolean;
}> {
  if (process.platform !== "darwin") return { camera: true, microphone: true };
  const camera = await systemPreferences.askForMediaAccess("camera");
  const microphone = await systemPreferences.askForMediaAccess("microphone");
  return { camera, microphone };
}

/**
 * Shown from the tray's "Permissions…" item and from the capture handler when
 * Screen Recording is missing. Returns true when the user chose to open
 * System Settings.
 */
export async function showPermissionsDialog(): Promise<boolean> {
  const screen = screenAccess();
  const camera =
    process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("camera")
      : "granted";
  const microphone =
    process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("microphone")
      : "granted";

  const detail = [
    `Screen Recording: ${screen}`,
    `Camera: ${camera}`,
    `Microphone: ${microphone}`,
    "",
    "System Audio Recording (macOS 14.2+) has no status API. If a recording",
    "has a silent audio track, grant Yoom under Privacy & Security → System",
    "Audio Recording and relaunch.",
    "",
    "macOS remembers these per app binary. An unsigned build gets a new",
    "identity every time it is rebuilt, so every rebuild re-prompts.",
  ].join("\n");

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Yoom permissions",
    message: "macOS privacy status",
    detail,
    buttons: ["Open Screen Recording", "Open System Audio", "Request Camera & Mic", "Close"],
    defaultId: 0,
    cancelId: 3,
  });

  if (response === 0) {
    openPrivacyPane("screen");
    return true;
  }
  if (response === 1) {
    openPrivacyPane("audio");
    return true;
  }
  if (response === 2) {
    await requestMediaAccess();
    return true;
  }
  return false;
}
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

---

## Task 8

The recorder window: persistent session so the `yoom_session` cookie survives a relaunch, hard navigation lock to the app origin, and a permission handler that only ever says yes to that origin.

**Files:** `desktop/src/main/windows.ts`

- [ ] Create `desktop/src/main/windows.ts`:

```ts
import { join } from "node:path";
import { BrowserWindow, session, shell, type Session } from "electron";

/**
 * The web app the shell wraps. `YOOM_APP_URL` overrides for staging;
 * `YOOM_DEV=1` points at the local Next dev server.
 */
export function appUrl(): string {
  const override = process.env.YOOM_APP_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  if (process.env.YOOM_DEV === "1") return "http://localhost:3000";
  return "https://yoom.jtylerray.com";
}

export function appOrigin(): string {
  return new URL(appUrl()).origin;
}

/**
 * `persist:` makes the partition survive a relaunch, which is the whole point:
 * the 30-day `yoom_session` cookie set by /api/auth lives here.
 * (Electron session docs, §`session.fromPartition(partition[, options])`.)
 */
export function yoomSession(): Session {
  return session.fromPartition("persist:yoom");
}

let recorderWindow: BrowserWindow | null = null;

export function getRecorderWindow(): BrowserWindow | null {
  return recorderWindow && !recorderWindow.isDestroyed() ? recorderWindow : null;
}

/** Send a message to the recorder renderer if it exists. */
export function sendToRecorder(channel: string, payload?: unknown): void {
  getRecorderWindow()?.webContents.send(channel, payload);
}

function installNavigationGuard(win: BrowserWindow): void {
  const origin = appOrigin();

  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Anything that would open a new window — target=_blank, window.open — goes
  // to the user's browser instead of an unguarded Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

/**
 * Media and screen capture are granted ONLY to the app origin. Everything else
 * (geolocation, notifications, USB, …) is denied outright.
 * (Electron session docs, §`ses.setPermissionRequestHandler(handler)`.)
 */
export function installPermissionHandlers(ses: Session): void {
  const origin = appOrigin();

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const requesting = details.requestingUrl ? new URL(details.requestingUrl).origin : "";
    const allowed =
      requesting === origin && (permission === "media" || permission === "display-capture");
    callback(allowed);
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return (
      requestingOrigin === origin &&
      (permission === "media" || permission === "display-capture")
    );
  });
}

export function createRecorderWindow(): BrowserWindow {
  const existing = getRecorderWindow();
  if (existing) {
    existing.show();
    existing.focus();
    return existing;
  }

  const ses = yoomSession();
  installPermissionHandlers(ses);

  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: "Yoom",
    backgroundColor: "#171717",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      session: ses,
      preload: join(__dirname, "../preload/app.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // The recorder paints a 4K canvas at 60fps; leaving background
      // throttling on stalls the compositor the moment the window loses focus.
      backgroundThrottling: false,
    },
  });

  installNavigationGuard(win);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    recorderWindow = null;
  });

  void win.loadURL(appUrl());
  recorderWindow = win;
  return win;
}

/** Tray "Open recorder" and the ⌘⇧L fallback both use this. */
export function toggleRecorderWindow(): void {
  const win = getRecorderWindow();
  if (!win) {
    createRecorderWindow();
    return;
  }
  if (win.isVisible() && win.isFocused()) win.hide();
  else {
    win.show();
    win.focus();
  }
}
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

---

## Task 9

Global shortcuts. Registered only while the recorder window exists, so the chords go back to the OS when Yoom has nothing to do with them.

**Files:** `desktop/src/main/shortcuts.ts`

- [ ] Create `desktop/src/main/shortcuts.ts`:

```ts
import { globalShortcut } from "electron";
import { IPC, type DesktopShortcut } from "../shared/ipc";
import { getRecorderWindow, sendToRecorder, toggleRecorderWindow } from "./windows";

/**
 * The same chords `use-recorder.ts` binds in the page. Registering them
 * globally is the point of the shell: a page-level keydown listener only fires
 * while the tab has focus, and during a screen recording it never does.
 */
const BINDINGS: { accelerator: string; action: DesktopShortcut }[] = [
  { accelerator: "CommandOrControl+Shift+L", action: "toggle" },
  { accelerator: "CommandOrControl+Shift+P", action: "pause" },
  { accelerator: "CommandOrControl+Shift+K", action: "restart" },
  { accelerator: "CommandOrControl+Shift+X", action: "cancel" },
  { accelerator: "CommandOrControl+Shift+M", action: "mark" },
];

let registered = false;

export function registerShortcuts(): void {
  if (registered) return;
  for (const { accelerator, action } of BINDINGS) {
    const ok = globalShortcut.register(accelerator, () => {
      if (!getRecorderWindow()) {
        // Nothing to drive: ⌘⇧L still opens the recorder, the rest are no-ops.
        if (action === "toggle") toggleRecorderWindow();
        return;
      }
      sendToRecorder(IPC.shortcut, action);
    });
    if (!ok) {
      // Another app owns the chord. Not fatal — the in-page binding still works
      // while the recorder window is focused.
      console.warn(`[yoom] could not register ${accelerator}`);
    }
  }
  registered = true;
}

export function unregisterShortcuts(): void {
  if (!registered) return;
  for (const { accelerator } of BINDINGS) globalShortcut.unregister(accelerator);
  registered = false;
}
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

---

## Task 10

The tray. This is the app's only persistent UI — there is no dock icon.

**Files:** `desktop/build/make-tray-icons.mjs`, `desktop/build/trayTemplate.png`, `desktop/build/trayTemplate@2x.png`, `desktop/src/main/tray.ts`

- [ ] Create `desktop/build/make-tray-icons.mjs` (generated, not committed as an opaque blob, so the icon can be regenerated or tweaked):

```js
// Emits the two macOS template tray icons: a filled black disc with an
// antialiased edge. Template images must be black + alpha only; macOS recolours
// them for light/dark menu bars.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function disc(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  const radius = size * 0.42;
  const centre = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - centre, y - centre);
      const alpha = d <= radius - 1 ? 255 : d >= radius ? 0 : Math.round((radius - d) * 255);
      const p = rowStart + 1 + x * 4;
      raw[p] = 0;
      raw[p + 1] = 0;
      raw[p + 2] = 0;
      raw[p + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(here, "trayTemplate.png"), disc(16));
writeFileSync(join(here, "trayTemplate@2x.png"), disc(32));
console.log("wrote build/trayTemplate.png and build/trayTemplate@2x.png");
```

- [ ] Run: `npm --prefix desktop run icons`
      Expected: `wrote build/trayTemplate.png and build/trayTemplate@2x.png`.

- [ ] Run: `file desktop/build/trayTemplate.png desktop/build/trayTemplate@2x.png`
      Expected: `PNG image data, 16 x 16, 8-bit/color RGBA, non-interlaced` and `32 x 32`.

- [ ] Create `desktop/src/main/tray.ts`:

```ts
import { join } from "node:path";
import { Menu, Tray, app, nativeImage } from "electron";
import { showPermissionsDialog } from "./permissions";
import { createRecorderWindow, sendToRecorder, toggleRecorderWindow } from "./windows";
import { IPC } from "../shared/ipc";
import { getRecorderWindow } from "./windows";

let tray: Tray | null = null;

function iconPath(): string {
  // electron-vite emits main to out/main; the build/ folder ships as an
  // extraResource in packaged builds and sits two levels up in dev.
  const packaged = join(process.resourcesPath ?? "", "build", "trayTemplate.png");
  const dev = join(__dirname, "../../build/trayTemplate.png");
  return app.isPackaged ? packaged : dev;
}

export function createTray(): Tray {
  if (tray) return tray;

  const image = nativeImage.createFromPath(iconPath());
  // A template image is recoloured by macOS for light and dark menu bars.
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Yoom");
  refreshTrayMenu();
  return tray;
}

export function refreshTrayMenu(): void {
  if (!tray) return;
  const hasWindow = !!getRecorderWindow();

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open recorder",
        click: () => {
          createRecorderWindow();
        },
      },
      {
        label: "Toggle recording",
        accelerator: "CommandOrControl+Shift+L",
        enabled: hasWindow,
        click: () => {
          if (getRecorderWindow()) sendToRecorder(IPC.shortcut, "toggle");
          else toggleRecorderWindow();
        },
      },
      { type: "separator" },
      { label: "Permissions…", click: () => void showPermissionsDialog() },
      { type: "separator" },
      { label: "Quit Yoom", accelerator: "Command+Q", click: () => app.quit() },
    ]),
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

---

## Task 11

The app preload — the exact `window.__yoomDesktop` shape the web app already checks for.

**Files:** `desktop/src/preload/app.ts`

- [ ] Create `desktop/src/preload/app.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type BubbleAppearance,
  type DesktopShortcut,
  type SurfacePref,
} from "../shared/ipc";

/**
 * MUST match `DesktopBridge` in the web app's `src/lib/recording/types.ts`.
 * `version: 1` is the compatibility gate — `getDesktopBridge()` ignores
 * anything else and the app silently falls back to browser behaviour.
 *
 * Note what is NOT here: `mediaSources.getDisplay`. `contextBridge` cannot
 * carry a `MediaStream` across worlds, so the page keeps calling
 * `navigator.mediaDevices.getDisplayMedia` itself and the main process
 * intercepts it with `setDisplayMediaRequestHandler`. All the bridge does is
 * announce the surface preference first, so the native picker opens on the
 * right tab.
 */
const bridge = {
  version: 1 as const,
  isDesktop: true,

  capabilities: {
    // macOS loopback via the CoreAudio Tap API — the reason this shell exists.
    systemAudio: "full" as const,
    nativePicker: true,
    // The native picker ignores `displaySurface`; the preference only chooses
    // which tab it opens on.
    surfaceHints: false,
  },

  setSurfacePref(pref: SurfacePref): void {
    ipcRenderer.send(IPC.setSurfacePref, pref);
  },

  onShortcut(cb: (action: DesktopShortcut) => void): () => void {
    const handler = (_e: unknown, action: DesktopShortcut) => cb(action);
    ipcRenderer.on(IPC.shortcut, handler);
    return () => ipcRenderer.removeListener(IPC.shortcut, handler);
  },

  onBubbleMove(cb: (pos: { x: number; y: number }) => void): () => void {
    const handler = (_e: unknown, pos: { x: number; y: number }) => cb(pos);
    ipcRenderer.on(IPC.bubbleMoved, handler);
    return () => ipcRenderer.removeListener(IPC.bubbleMoved, handler);
  },

  setBubbleAppearance(appearance: BubbleAppearance): void {
    ipcRenderer.send(IPC.setBubbleAppearance, appearance);
  },

  setBubbleVisible(visible: boolean): void {
    ipcRenderer.send(IPC.setBubbleVisible, visible);
  },

  setCameraDevice(deviceId: string | null): void {
    ipcRenderer.send(IPC.setCameraDevice, deviceId);
  },
};

contextBridge.exposeInMainWorld("__yoomDesktop", bridge);
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

---

## Task 12

The source picker window and its `desktopCapturer` plumbing.

**Files:** `desktop/src/main/picker.ts`

- [ ] Create `desktop/src/main/picker.ts`:

```ts
import { join } from "node:path";
import { BrowserWindow, desktopCapturer, ipcMain } from "electron";
import { IPC, type PickerPayload, type SourceInfo } from "../shared/ipc";
import { getRecorderWindow } from "./windows";

let pickerWindow: BrowserWindow | null = null;
let pending: ((id: string | null) => void) | null = null;

/**
 * `desktopCapturer.getSources` returns screens and windows with rendered
 * thumbnails. (desktopCapturer docs, §`desktopCapturer.getSources(options)`.)
 * On macOS the first call is what triggers the Screen Recording TCC prompt.
 */
export async function listSources(): Promise<SourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });

  return sources
    .filter((s) => !s.thumbnail.isEmpty() || s.id.startsWith("screen:"))
    .map((s) => ({
      id: s.id,
      name: s.name || (s.id.startsWith("screen:") ? "Screen" : "Window"),
      kind: s.id.startsWith("screen:") ? ("screen" as const) : ("window" as const),
      thumb: s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
    }));
}

function rendererEntry(): { url?: string; file?: string } {
  // electron-vite sets ELECTRON_RENDERER_URL in dev; packaged builds load the
  // emitted HTML from out/renderer.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) return { url: `${devUrl}/picker/index.html` };
  return { file: join(__dirname, "../renderer/picker/index.html") };
}

function closePicker(): void {
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.destroy();
  pickerWindow = null;
}

/** Resolves with the chosen source id, or null when cancelled. */
export function openPicker(payload: PickerPayload): Promise<string | null> {
  // Only one picker at a time: a second request cancels the first.
  if (pending) {
    pending(null);
    pending = null;
  }
  closePicker();

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const settle = (id: string | null) => {
      if (settled) return;
      settled = true;
      pending = null;
      closePicker();
      resolve(id);
    };
    pending = settle;

    const win = new BrowserWindow({
      width: 520,
      height: 460,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      show: false,
      vibrancy: "popover",
      backgroundColor: "#00000000",
      parent: getRecorderWindow() ?? undefined,
      modal: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: join(__dirname, "../preload/picker.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    pickerWindow = win;

    win.once("ready-to-show", () => {
      win.show();
      win.focus();
      win.webContents.send(IPC.pickerSources, payload);
    });
    // Clicking away is a cancel — the web app already handles NotAllowedError.
    win.on("blur", () => settle(null));
    win.on("closed", () => settle(null));

    const entry = rendererEntry();
    void (entry.url ? win.loadURL(entry.url) : win.loadFile(entry.file!));
  });
}

export function installPickerIpc(): void {
  ipcMain.on(IPC.pickerChoose, (_e, arg: { id: string }) => {
    pending?.(arg?.id ?? null);
  });
  ipcMain.on(IPC.pickerCancel, () => {
    pending?.(null);
  });
}
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

---

## Task 13

The capture handler — the module that actually buys full system audio.

**Files:** `desktop/src/main/capture.ts`

- [ ] Create `desktop/src/main/capture.ts`:

```ts
import { Notification, ipcMain, type Session } from "electron";
import { IPC, type SurfacePref } from "../shared/ipc";
import { hasScreenAccess, openPrivacyPane } from "./permissions";
import { listSources, openPicker } from "./picker";

/**
 * The page announces a surface preference right before it calls
 * `getDisplayMedia`, so the picker knows which tab to open on. Kept as a plain
 * module variable with no expiry: the announcement and the request are two IPC
 * hops apart, and a stale preference only affects which tab is preselected.
 */
let surfacePref: SurfacePref = "monitor";

export function installCaptureIpc(): void {
  ipcMain.on(IPC.setSurfacePref, (_e, pref: SurfacePref) => {
    if (pref === "monitor" || pref === "window" || pref === "browser") surfacePref = pref;
  });
}

/**
 * `ses.setDisplayMediaRequestHandler` replaces Chrome's picker sheet with ours
 * and — the point of the whole shell — lets us hand back `audio: 'loopback'`.
 * (Electron session docs, §`ses.setDisplayMediaRequestHandler(handler[, opts])`.)
 *
 * `useSystemPicker` is deliberately left OFF: when the system picker is
 * available, "the handler will not be invoked" (same doc section), which would
 * take the loopback audio decision out of our hands entirely.
 */
export function installDisplayMediaHandler(ses: Session): void {
  ses.setDisplayMediaRequestHandler((request, callback) => {
    void (async () => {
      // macOS raises the Screen Recording prompt on the first real capture and
      // requires a relaunch afterwards, so guard rather than fail opaquely.
      if (!hasScreenAccess()) {
        new Notification({
          title: "Yoom needs Screen Recording access",
          body: "Grant it in System Settings → Privacy & Security, then relaunch Yoom.",
        }).show();
        openPrivacyPane("screen");
        callback({});
        return;
      }

      let sources;
      try {
        sources = await listSources();
      } catch (err) {
        console.error("[yoom] desktopCapturer.getSources failed", err);
        callback({});
        return;
      }

      if (sources.length === 0) {
        callback({});
        return;
      }

      const chosenId = await openPicker({
        sources,
        tab: surfacePref === "monitor" ? "screen" : "window",
        audioRequested: request.audioRequested,
      });

      const source = sources.find((s) => s.id === chosenId);
      if (!source) {
        // Cancelled: an empty callback surfaces as NotAllowedError in the page,
        // which the recorder already handles as "user dismissed the picker".
        callback({});
        return;
      }

      callback({
        video: { id: source.id, name: source.name },
        // 'loopback' captures system audio. The session doc's one-line summary
        // still says Windows-only; the desktopCapturer Caveats section is
        // current and documents macOS 14.2+ support through Chromium's
        // CoreAudio Tap API (default since Electron v39.0.0-beta.4), gated on
        // the NSAudioCaptureUsageDescription Info.plist key.
        audio: request.audioRequested ? "loopback" : undefined,
      });
    })();
  });
}
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

---

## Task 14

The picker UI — plain DOM, no framework.

**Files:** `desktop/src/preload/picker.ts`, `desktop/src/renderer/picker/index.html`, `desktop/src/renderer/picker/picker.css`, `desktop/src/renderer/picker/picker.ts`

- [ ] Create `desktop/src/preload/picker.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type PickerPayload } from "../shared/ipc";

contextBridge.exposeInMainWorld("__yoomPicker", {
  onSources(cb: (payload: PickerPayload) => void): void {
    ipcRenderer.on(IPC.pickerSources, (_e, payload: PickerPayload) => cb(payload));
  },
  choose(id: string): void {
    ipcRenderer.send(IPC.pickerChoose, { id });
  },
  cancel(): void {
    ipcRenderer.send(IPC.pickerCancel);
  },
});
```

- [ ] Create `desktop/src/renderer/picker/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="content-security-policy"
      content="default-src 'none'; img-src data:; style-src 'self'; script-src 'self'"
    />
    <title>Choose what to share</title>
    <link rel="stylesheet" href="./picker.css" />
  </head>
  <body>
    <header>
      <h1>Choose what to share</h1>
      <p id="audio-note" hidden>System audio will be included</p>
    </header>
    <nav role="tablist">
      <button id="tab-screen" role="tab" type="button" aria-selected="true">Screens</button>
      <button id="tab-window" role="tab" type="button" aria-selected="false">Windows</button>
    </nav>
    <ul id="grid" role="listbox" aria-label="Capture sources"></ul>
    <footer>
      <span class="hint">↑↓ move · Enter share · Esc cancel</span>
      <button id="cancel" type="button">Cancel</button>
    </footer>
    <script type="module" src="./picker.ts"></script>
  </body>
</html>
```

- [ ] Create `desktop/src/renderer/picker/picker.css`:

```css
:root {
  color-scheme: dark;
  --border: #2e2e2e;
  --fg: #f5f5f5;
  --muted: #9a9a9a;
  --accent: #4f7cff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif;
  color: var(--fg);
  background: transparent;
  user-select: none;
  -webkit-app-region: drag;
}

header {
  padding: 14px 16px 6px;
}

h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

#audio-note {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--muted);
}

nav {
  display: flex;
  gap: 6px;
  padding: 6px 16px 10px;
  -webkit-app-region: no-drag;
}

nav button {
  -webkit-app-region: no-drag;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  border-radius: 7px;
  padding: 4px 12px;
  font: inherit;
  cursor: default;
}

nav button[aria-selected="true"] {
  color: var(--fg);
  border-color: var(--accent);
  background: rgba(79, 124, 255, 0.16);
}

#grid {
  -webkit-app-region: no-drag;
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 0 16px 8px;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  align-content: start;
}

#grid li {
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
  cursor: default;
  background: rgba(255, 255, 255, 0.03);
}

#grid li[aria-selected="true"] {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

#grid img.thumb {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  background: #0d0d0d;
}

#grid .label {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  font-size: 11px;
}

#grid .label img {
  width: 14px;
  height: 14px;
}

#grid .label span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  grid-column: 1 / -1;
  color: var(--muted);
  padding: 24px 0;
  text-align: center;
}

footer {
  -webkit-app-region: no-drag;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px 14px;
  border-top: 1px solid var(--border);
}

.hint {
  font-size: 11px;
  color: var(--muted);
}

footer button {
  -webkit-app-region: no-drag;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
  border-radius: 7px;
  padding: 4px 12px;
  font: inherit;
  cursor: default;
}
```

- [ ] Create `desktop/src/renderer/picker/picker.ts`:

```ts
import type { PickerPayload, SourceInfo } from "../../shared/ipc";

const api = window.__yoomPicker;

const grid = document.getElementById("grid") as HTMLUListElement;
const tabScreen = document.getElementById("tab-screen") as HTMLButtonElement;
const tabWindow = document.getElementById("tab-window") as HTMLButtonElement;
const cancelButton = document.getElementById("cancel") as HTMLButtonElement;
const audioNote = document.getElementById("audio-note") as HTMLParagraphElement;

let all: SourceInfo[] = [];
let tab: "screen" | "window" = "screen";
let selected = 0;

function visible(): SourceInfo[] {
  return all.filter((s) => s.kind === tab);
}

function render(): void {
  const items = visible();
  tabScreen.setAttribute("aria-selected", String(tab === "screen"));
  tabWindow.setAttribute("aria-selected", String(tab === "window"));
  grid.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = tab === "screen" ? "No screens found" : "No windows found";
    grid.append(empty);
    return;
  }

  selected = Math.min(selected, items.length - 1);

  items.forEach((source, index) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(index === selected));

    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.src = source.thumb;
    thumb.alt = "";
    li.append(thumb);

    const label = document.createElement("div");
    label.className = "label";
    if (source.icon) {
      const icon = document.createElement("img");
      icon.src = source.icon;
      icon.alt = "";
      label.append(icon);
    }
    const name = document.createElement("span");
    name.textContent = source.name;
    label.append(name);
    li.append(label);

    li.addEventListener("click", () => {
      selected = index;
      choose();
    });
    li.addEventListener("mouseenter", () => {
      selected = index;
      render();
    });

    grid.append(li);
  });

  grid.children[selected]?.scrollIntoView({ block: "nearest" });
}

function choose(): void {
  const source = visible()[selected];
  if (source) api?.choose(source.id);
}

tabScreen.addEventListener("click", () => {
  tab = "screen";
  selected = 0;
  render();
});
tabWindow.addEventListener("click", () => {
  tab = "window";
  selected = 0;
  render();
});
cancelButton.addEventListener("click", () => api?.cancel());

window.addEventListener("keydown", (event) => {
  const items = visible();
  if (event.key === "Escape") {
    event.preventDefault();
    api?.cancel();
  } else if (event.key === "Enter") {
    event.preventDefault();
    choose();
  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    selected = Math.min(items.length - 1, selected + (event.key === "ArrowDown" ? 2 : 1));
    render();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    selected = Math.max(0, selected - (event.key === "ArrowUp" ? 2 : 1));
    render();
  } else if (event.key === "Tab") {
    event.preventDefault();
    tab = tab === "screen" ? "window" : "screen";
    selected = 0;
    render();
  }
});

api?.onSources((payload: PickerPayload) => {
  all = payload.sources;
  tab = payload.tab;
  selected = 0;
  audioNote.hidden = !payload.audioRequested;
  render();
});
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

- [ ] Commit:

```
git add desktop/src desktop/build
git commit -m "$(cat <<'EOF'
feat(desktop): main process, preloads and the native source picker

Recorder window on persist:yoom (login survives relaunch), navigation and
permissions locked to the app origin, tray menu, five global shortcuts, macOS
permission helpers with System Settings deep links, and a
setDisplayMediaRequestHandler that returns audio: 'loopback' for full system
audio. useSystemPicker stays off — when the system picker takes over, the
handler is never invoked and the loopback decision is lost.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Task 15

The floating camera bubble window — the main-process half.

**Files:** `desktop/src/main/bubble.ts`

Read the three-layer answer to the double-bubble problem before writing this file; it is encoded in the comments and you must not simplify it away:

1. **`setContentProtection(true)`.** On macOS this sets `NSWindowSharingNone`. `electron.d.ts` @ 44.1.1 warns verbatim: *"due to an intentional change in macOS, newer Mac applications that use ScreenCaptureKit will capture your window despite `win.setContentProtection(true)`."* Chromium's capturer is one of those apps, so this alone is **not** sufficient. It is still applied because it does exclude the bubble from other capture tools.
2. **Self-occlusion (the real mechanism).** The live window and the composited bubble occupy the same rectangle on the same display — that is what `bubbleWindowSize` and the normalized-centre wire format are for. The compositor draws the burned-in bubble *after* the screen frame, so the captured pixels of the live window are painted over. Positions are pushed with `{ immediate: true }` so there is no 300 ms tween to lag behind the window and expose an edge.
3. **Escape hatch.** `YOOM_BUBBLE_HIDE_WHILE_RECORDING=1` hides the window entirely for `recording`/`paused` and falls back to the composited bubble only. Documented in `desktop/README.md`.

- [ ] Create `desktop/src/main/bubble.ts`:

```ts
import { join } from "node:path";
import { BrowserWindow, ipcMain, screen } from "electron";
import {
  IPC,
  type BubbleAppearance,
  type BubbleShape,
} from "../shared/ipc";
import { bubbleCentreToNormalized, bubbleWindowSize, cycleShape } from "./mapping";
import { sendToRecorder } from "./windows";

const HIDE_WHILE_RECORDING = process.env.YOOM_BUBBLE_HIDE_WHILE_RECORDING === "1";

let bubbleWindow: BrowserWindow | null = null;
let cameraDeviceId: string | null = null;
/** The user's own bubble toggle, mirrored from the web app's BubbleConfig. */
let appearance: BubbleAppearance = {
  shape: "circle",
  size: "medium",
  mirror: true,
  visible: true,
};
/** Status-driven: true while the recorder is in setup/countdown/recording/paused. */
let shellVisible = false;
/** Suppresses the move→IPC echo while WE are the ones moving the window. */
let applyingBounds = false;

function alive(): BrowserWindow | null {
  return bubbleWindow && !bubbleWindow.isDestroyed() ? bubbleWindow : null;
}

function rendererEntry(): { url?: string; file?: string } {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) return { url: `${devUrl}/bubble/index.html` };
  return { file: join(__dirname, "../renderer/bubble/index.html") };
}

/** The display the bubble currently sits on (or the primary one). */
function currentDisplay() {
  const win = alive();
  if (!win) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(win.getBounds());
}

function reportPosition(): void {
  const win = alive();
  if (!win || applyingBounds) return;
  const display = currentDisplay();
  // Both getBounds() and display.bounds are in device-independent pixels, so
  // the display's scaleFactor cancels and the normalized result is
  // DPR-invariant. See mapping.ts.
  const pos = bubbleCentreToNormalized(win.getBounds(), display.bounds);
  sendToRecorder(IPC.bubbleMoved, pos);
}

function applySize(): void {
  const win = alive();
  if (!win) return;
  const display = currentDisplay();
  const { width, height } = bubbleWindowSize(
    appearance.shape,
    appearance.size,
    display.bounds.width,
  );
  const bounds = win.getBounds();
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  applyingBounds = true;
  win.setBounds({
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
    width,
    height,
  });
  applyingBounds = false;
  // The centre is unchanged by a resize, but the clamped normalized value can
  // move when the window grows past a display edge, so resync.
  reportPosition();
}

function createBubbleWindow(): BrowserWindow {
  const existing = alive();
  if (existing) return existing;

  const display = screen.getPrimaryDisplay();
  const { width, height } = bubbleWindowSize(
    appearance.shape,
    appearance.size,
    display.bounds.width,
  );
  // Default position: bottom-right of the primary display with a 48px inset.
  const x = display.bounds.x + display.bounds.width - width - 48;
  const y = display.bounds.y + display.bounds.height - height - 48;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // `focusable: false` would kill the drag region, so the window stays
    // focusable and simply never takes keyboard input.
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, "../preload/bubble.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // 'floating' keeps the bubble above ordinary windows without fighting menus
  // and panels the way 'screen-saver' does.
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // macOS: sets NSWindowSharingNone. electron.d.ts @ 44.1.1 warns that newer
  // ScreenCaptureKit-based capturers — Chromium's included — capture the window
  // anyway. Applied regardless (it does exclude us from other tools), but the
  // real defence is that the composited bubble is drawn over the same rect.
  win.setContentProtection(true);

  win.on("moved", reportPosition);
  win.on("resized", reportPosition);
  win.on("closed", () => {
    bubbleWindow = null;
  });

  win.once("ready-to-show", () => {
    win.webContents.send(IPC.bubbleApply, appearance);
    win.webContents.send(IPC.bubbleCamera, cameraDeviceId);
  });

  const entry = rendererEntry();
  void (entry.url ? win.loadURL(entry.url) : win.loadFile(entry.file!));

  bubbleWindow = win;
  return win;
}

function shouldShow(): boolean {
  if (!shellVisible) return false;
  if (!appearance.visible) return false;
  // `full` is camera-only mode: the whole canvas is the camera, so a floating
  // desktop overlay makes no sense.
  if (appearance.shape === "full") return false;
  return true;
}

function sync(): void {
  if (!shouldShow()) {
    alive()?.hide();
    return;
  }
  const win = createBubbleWindow();
  win.webContents.send(IPC.bubbleApply, appearance);
  win.webContents.send(IPC.bubbleCamera, cameraDeviceId);
  applySize();
  // showInactive keeps focus in the recorder window when the bubble appears.
  win.showInactive();
  reportPosition();
}

export function setBubbleAppearance(next: BubbleAppearance): void {
  const shapeOrSizeChanged =
    next.shape !== appearance.shape || next.size !== appearance.size;
  appearance = next;
  if (!shouldShow()) {
    alive()?.hide();
    return;
  }
  sync();
  if (shapeOrSizeChanged) applySize();
}

export function setBubbleVisible(visible: boolean): void {
  shellVisible = visible;
  sync();
}

/**
 * The escape hatch for the double-bubble artefact: with
 * YOOM_BUBBLE_HIDE_WHILE_RECORDING=1 the live window disappears once the
 * encoder starts and only the composited bubble remains.
 */
export function setRecordingActive(active: boolean): void {
  if (!HIDE_WHILE_RECORDING) return;
  if (active) alive()?.hide();
  else sync();
}

export function setCameraDevice(deviceId: string | null): void {
  cameraDeviceId = deviceId;
  alive()?.webContents.send(IPC.bubbleCamera, cameraDeviceId);
}

export function destroyBubble(): void {
  const win = alive();
  win?.destroy();
  bubbleWindow = null;
}

export function installBubbleIpc(): void {
  ipcMain.on(IPC.setBubbleAppearance, (_e, next: BubbleAppearance) => {
    if (!next || typeof next !== "object") return;
    setBubbleAppearance(next);
  });
  ipcMain.on(IPC.setBubbleVisible, (_e, visible: boolean) => {
    setBubbleVisible(!!visible);
  });
  ipcMain.on(IPC.setCameraDevice, (_e, deviceId: string | null) => {
    setCameraDevice(typeof deviceId === "string" && deviceId ? deviceId : null);
  });

  // The bubble's own control strip talks back. Both actions are mirrored into
  // the web app by echoing a new appearance, which the web app then persists.
  ipcMain.on(IPC.bubbleRequestHide, () => {
    setBubbleAppearance({ ...appearance, visible: false });
    sendToRecorder(IPC.setBubbleAppearance, { ...appearance, visible: false });
  });
  ipcMain.on(IPC.bubbleCycleShape, () => {
    const shape: BubbleShape = cycleShape(appearance.shape);
    const next = { ...appearance, shape };
    setBubbleAppearance(next);
    sendToRecorder(IPC.setBubbleAppearance, next);
  });
}
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

---

## Task 16

The bubble renderer: live camera in a shaped, draggable, transparent window.

**Files:** `desktop/src/preload/bubble.ts`, `desktop/src/renderer/bubble/index.html`, `desktop/src/renderer/bubble/bubble.css`, `desktop/src/renderer/bubble/bubble.ts`

- [ ] Create `desktop/src/preload/bubble.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type BubbleAppearance } from "../shared/ipc";

contextBridge.exposeInMainWorld("__yoomBubble", {
  onApply(cb: (appearance: BubbleAppearance) => void): void {
    ipcRenderer.on(IPC.bubbleApply, (_e, appearance: BubbleAppearance) => cb(appearance));
  },
  onCamera(cb: (deviceId: string | null) => void): void {
    ipcRenderer.on(IPC.bubbleCamera, (_e, deviceId: string | null) => cb(deviceId));
  },
  requestHide(): void {
    ipcRenderer.send(IPC.bubbleRequestHide);
  },
  cycleShape(): void {
    ipcRenderer.send(IPC.bubbleCycleShape);
  },
});
```

- [ ] Create `desktop/src/renderer/bubble/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="content-security-policy"
      content="default-src 'none'; media-src blob: mediastream:; style-src 'self'; script-src 'self'"
    />
    <title>Yoom camera</title>
    <link rel="stylesheet" href="./bubble.css" />
  </head>
  <body>
    <!-- The whole body is the drag region; only the control strip opts out. -->
    <div id="shell">
      <div id="shape">
        <video id="cam" autoplay muted playsinline></video>
        <p id="fallback">No camera</p>
      </div>
      <div id="controls">
        <button id="cycle" type="button" title="Change shape" aria-label="Change shape">
          ◑
        </button>
        <button id="hide" type="button" title="Hide bubble" aria-label="Hide bubble">
          ✕
        </button>
      </div>
    </div>
    <script type="module" src="./bubble.ts"></script>
  </body>
</html>
```

- [ ] Create `desktop/src/renderer/bubble/bubble.css`:

```css
:root {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  background: transparent;
  overflow: hidden;
  user-select: none;
  font: 12px/1 -apple-system, BlinkMacSystemFont, sans-serif;
  color: #f5f5f5;
}

/* The entire bubble is grabbable — matching Loom, where you drag the bubble
   itself rather than a handle. The control strip opts out below. */
#shell {
  -webkit-app-region: drag;
  position: relative;
  width: 100%;
  height: 100%;
  cursor: grab;
}

#shape {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #0d0d0d;
  /* border-radius and transform are set from JS via shapeToCss(). */
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  border: 2px solid rgba(255, 255, 255, 0.22);
}

#cam {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

#fallback {
  position: absolute;
  inset: 0;
  margin: 0;
  display: none;
  align-items: center;
  justify-content: center;
  color: #9a9a9a;
}

body.no-camera #cam {
  display: none;
}

body.no-camera #fallback {
  display: flex;
}

#controls {
  -webkit-app-region: no-drag;
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 120ms ease;
}

#shell:hover #controls {
  opacity: 1;
}

#controls button {
  -webkit-app-region: no-drag;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.65);
  color: #f5f5f5;
  font: inherit;
  line-height: 1;
  cursor: default;
}

#controls button:hover {
  background: rgba(0, 0, 0, 0.85);
}
```

- [ ] Create `desktop/src/renderer/bubble/bubble.ts`:

```ts
import type { BubbleAppearance, BubbleShape } from "../../shared/ipc";

// Duplicated from desktop/src/main/mapping.ts: the renderer is bundled for the
// DOM and must not pull the main-process module (and its electron import) in.
// The values are asserted in mapping.test.ts.
const BUBBLE_RADIUS_PERCENT = 14;

function shapeToCss(
  shape: BubbleShape,
  mirror: boolean,
): { borderRadius: string; transform: string } {
  const borderRadius =
    shape === "circle"
      ? "50%"
      : shape === "square"
        ? "0px"
        : `${BUBBLE_RADIUS_PERCENT}%`;
  return { borderRadius, transform: mirror ? "scaleX(-1)" : "none" };
}

const api = window.__yoomBubble;
const video = document.getElementById("cam") as HTMLVideoElement;
const shape = document.getElementById("shape") as HTMLDivElement;
const cycleButton = document.getElementById("cycle") as HTMLButtonElement;
const hideButton = document.getElementById("hide") as HTMLButtonElement;

let stream: MediaStream | null = null;
let openingFor: string | null | undefined;

function stopStream(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function openCamera(deviceId: string | null): Promise<void> {
  if (openingFor === deviceId && stream) return;
  openingFor = deviceId;
  stopStream();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    document.body.classList.remove("no-camera");
    await video.play().catch(() => {});
  } catch {
    // The recorder itself already owns the camera on some macOS setups, or the
    // device is gone. Show the placeholder rather than an empty transparent hole.
    document.body.classList.add("no-camera");
  }
}

function apply(appearance: BubbleAppearance): void {
  const css = shapeToCss(appearance.shape, appearance.mirror);
  shape.style.borderRadius = css.borderRadius;
  // Mirror the pixels only — the control strip lives outside #shape so it never
  // ends up reversed.
  video.style.transform = css.transform;
}

cycleButton.addEventListener("click", () => api?.cycleShape());
hideButton.addEventListener("click", () => api?.requestHide());
window.addEventListener("pagehide", stopStream);

api?.onApply(apply);
api?.onCamera((deviceId) => void openCamera(deviceId));
```

- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.

---

## Task 17

The main entry that wires everything together.

**Files:** `desktop/src/main/index.ts`

- [ ] Create `desktop/src/main/index.ts`:

```ts
import { app } from "electron";
import { installCaptureIpc, installDisplayMediaHandler } from "./capture";
import { destroyBubble, installBubbleIpc } from "./bubble";
import { installPickerIpc } from "./picker";
import { registerShortcuts, unregisterShortcuts } from "./shortcuts";
import { createTray, destroyTray, refreshTrayMenu } from "./tray";
import { createRecorderWindow, getRecorderWindow, yoomSession } from "./windows";

/**
 * Escape hatch for the macOS 14.2+ CoreAudio Tap path. From the desktopCapturer
 * docs, §Caveats → "macOS versions 14.2 or higher": setting this feature flag
 * forces Chromium back onto the older "Screen & System Audio Recording"
 * permissions system. The exact name is `MacCatapLoopbackAudioForScreenShare`.
 * Only used when YOOM_LEGACY_AUDIO=1, because there is no fallback in the other
 * direction — if a tap fails, the audio track is silently dead.
 */
if (process.env.YOOM_LEGACY_AUDIO === "1") {
  app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}

// A second launch should surface the existing window, never start a second app
// holding the same tray icon and the same global shortcuts.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    createRecorderWindow();
  });

  app.whenReady().then(() => {
    // Menu-bar only. Pairs with LSUIElement: true in electron-builder.yml so
    // the packaged app has no dock icon and no app switcher entry either.
    app.dock?.hide();

    installCaptureIpc();
    installPickerIpc();
    installBubbleIpc();
    installDisplayMediaHandler(yoomSession());

    createTray();
    createRecorderWindow();
    registerShortcuts();
    refreshTrayMenu();
  });

  // With no dock icon there is no dock click to reopen from, but the tray's
  // "Open recorder" goes through the same path.
  app.on("activate", () => {
    if (!getRecorderWindow()) createRecorderWindow();
  });

  // Closing the recorder window must NOT quit: the shell lives in the menu bar.
  app.on("window-all-closed", () => {
    destroyBubble();
    refreshTrayMenu();
  });

  app.on("will-quit", () => {
    unregisterShortcuts();
    destroyBubble();
    destroyTray();
  });
}
```

- [ ] Run: `npm --prefix desktop run typecheck && npm --prefix desktop run build:renderer`
      Expected: typecheck silent; the build prints `build the electron main process successfully`, `build the electron preload files successfully`, `build the electron renderer process successfully`, and `desktop/out/` contains `main/index.js`, `preload/{app,picker,bubble}.js` and `renderer/{picker,bubble}/index.html`.

- [ ] Run: `ls desktop/out/main desktop/out/preload desktop/out/renderer`
      Expected: exactly those files.

- [ ] Commit:

```
git add desktop/src
git commit -m "$(cat <<'EOF'
feat(desktop): floating camera bubble window

An always-on-top, transparent, frameless, shadowless window that renders the
live camera and is dragged by its whole body. Its centre is reported to the web
recorder normalized to the display it sits on, so the burned-in bubble follows
it. bubbleWindowSize() makes the live window and the composited bubble occupy
the same rect, which is what keeps the captured live pixels occluded —
setContentProtection is applied too but ScreenCaptureKit-based capturers ignore
it on modern macOS. YOOM_BUBBLE_HIDE_WHILE_RECORDING=1 is the escape hatch.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Task 18

Wire the web recorder to the bridge. Browser behaviour must be byte-for-byte unchanged when the bridge is absent — every new call is a no-op helper from Task 1.

**Files:** `src/lib/recording/use-recorder.ts`

- [ ] Read `src/lib/recording/use-recorder.ts` around the hotkeys section (~line 760 onward) so the edits land in the right places.

- [ ] Update the imports at the top of the file:

```ts
import {
  isDesktop,
  onDesktopBubbleMove,
  onDesktopShortcut,
  setDesktopBubbleAppearance,
  setDesktopBubbleVisible,
  setDesktopCameraDevice,
} from "./desktop-bridge";
import { computeFrameLayout, displayPosToCanvasPos } from "./geometry";
```

- [ ] Replace the existing "Desktop shell forwards the same shortcuts" effect with one that handles all five actions:

```ts
  // Desktop shell forwards the same shortcuts even when the tab is unfocused.
  // The five actions mirror the in-page chords exactly (⌘⇧L/P/M/K/X); the
  // status guards are duplicated rather than shared because the in-page
  // listener also has to call `preventDefault` on the raw event.
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
      } else if (action === "mark") {
        if (status === "recording") dispatch({ type: "MARK" });
      } else if (action === "restart") {
        if (status !== "countdown" && status !== "recording" && status !== "paused") return;
        discardRecorder();
        dispatch({ type: "RESTART_NOW" });
        setRestartToken((n) => n + 1);
      } else if (action === "cancel") {
        if (
          status !== "countdown" &&
          status !== "recording" &&
          status !== "paused" &&
          status !== "stopping"
        ) {
          return;
        }
        discardRecorder();
        dispatch({ type: "CANCEL" });
      }
    });
  }, [acquire, discardRecorder]);
```

- [ ] Add the desktop-bubble effects immediately after that effect:

```ts
  // ---------- floating desktop bubble ----------

  // The shell's bubble window only makes sense over a screen capture with a
  // camera. Camera-only mode fills the canvas, and screen-only has no camera.
  const desktopBubbleActive =
    state.mode === "screen+camera" &&
    (state.status === "setup" ||
      state.status === "countdown" ||
      state.status === "recording" ||
      state.status === "paused");

  useEffect(() => {
    setDesktopBubbleVisible(desktopBubbleActive);
    return () => setDesktopBubbleVisible(false);
  }, [desktopBubbleActive]);

  useEffect(() => {
    setDesktopBubbleAppearance({
      shape: state.bubble.shape,
      size: state.bubble.size,
      mirror: state.bubble.mirror,
      visible: state.bubble.visible,
    });
  }, [state.bubble.shape, state.bubble.size, state.bubble.mirror, state.bubble.visible]);

  useEffect(() => {
    setDesktopCameraDevice(state.cameraId || null);
  }, [state.cameraId]);

  // The shell reports a centre normalized to the captured DISPLAY. With framed
  // capture on, the canvas is bigger than the screen and the screen sits inset,
  // so the position has to be re-based before it reaches the bubble config.
  // `immediate: true` skips the compositor's 300 ms tween: the burned-in bubble
  // must not lag the window the user is physically dragging, or the live
  // window's captured pixels peek out from behind it.
  useEffect(() => {
    return onDesktopBubbleMove((pos) => {
      const track = screenStreamRef.current?.getVideoTracks()[0];
      const settings = track?.getSettings();
      const srcW = settings?.width ?? 0;
      const srcH = settings?.height ?? 0;
      const mapped =
        srcW > 0 && srcH > 0
          ? displayPosToCanvasPos(
              pos,
              computeFrameLayout(srcW, srcH, stateRef.current.frame),
            )
          : pos;

      if (compositorRef.current) {
        compositorRef.current.setBubble(
          { ...stateRef.current.bubble, pos: mapped },
          { immediate: true },
        );
      }
      dispatch({ type: "SET_BUBBLE", patch: { pos: mapped } });
    });
  }, []);
```

- [ ] Verify the two refs used above (`screenStreamRef`, `compositorRef`) are declared earlier in the hook — they are; do not re-declare them.

- [ ] In the boot effect that sets capabilities (`setCapabilities(getProvider().capabilities())`, ~line 183), no change is needed: the preload's `capabilities` override already flows through `getProvider()`. Confirm by reading the block.

- [ ] Add `isDesktop` to the hook's return value so the shell badge in Task 19 can read it. Extend the `UseRecorderResult` interface:

```ts
export interface UseRecorderResult {
  state: RecorderState;
  capabilities: Capabilities;
  /** True when running inside the Electron shell (Phase 4). */
  desktop: boolean;
  /** Canvas the compositor paints into (camera and screen+camera modes). */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
```

- [ ] Add the matching state near the `capabilities` state declaration and set it in the boot effect (window globals are not available during SSR, so it must be an effect, not an initializer):

```ts
  const [desktop, setDesktop] = useState(false);
```

  and inside the existing boot effect, next to `setCapabilities(getProvider().capabilities());`:

```ts
    setDesktop(isDesktop());
```

- [ ] Add `desktop,` to the object returned at the end of the hook, right after `capabilities,`.

- [ ] Run: `npx tsc --noEmit && npm test && npm run lint`
      Expected: all green.

---

## Task 19

The one visible web change: say so when system audio is guaranteed.

**Files:** `src/components/recorder.tsx`

- [ ] In `src/components/recorder.tsx`, destructure `desktop` from `useRecorder()`:

```tsx
  const {
    state,
    capabilities,
    desktop,
    canvasRef,
    screenVideoRef,
    reviewUrl,
    thumbnailUrl,
    dimensions,
    getLevel,
    actions,
  } = useRecorder();
```

- [ ] Add the badge directly above the `<ModePicker …>` block, inside the `{configuring && (…)}` region — replace:

```tsx
          {configuring && (
            <ModePicker
```

  with:

```tsx
          {configuring && desktop && capabilities.systemAudio === "full" && (
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Desktop app · System audio: on
            </p>
          )}

          {configuring && (
            <ModePicker
```

- [ ] Note (no code change): the "System audio is available for tab recordings…" notice in `src/components/recorder/audio-controls.tsx` is already gated on `capabilities.systemAudio !== "full"`, so the preload's `systemAudio: "full"` override removes it automatically. Verify by reading lines 100–107 of that file.

- [ ] Note (no code change): the in-page `BubbleDragOverlay` stays mounted in the desktop app. **Decision: keep both handles.** They stay in sync because both write the same normalized `pos` through `actions.setBubble`, and dragging the in-page handle is the only way to place the bubble when the preview is the thing you are looking at. The floating window is not repositioned from the web side in v1, so an in-page drag moves only the burned-in bubble until the next window move re-syncs them — documented in `desktop/README.md` under Known limits.

- [ ] Run: `npx tsc --noEmit && npm run lint && npm run build`
      Expected: `next build` completes with no type or lint errors.

- [ ] Commit:

```
git add src/lib/recording/use-recorder.ts src/components/recorder.tsx
git commit -m "$(cat <<'EOF'
feat(recorder): wire the web app to the Electron shell

All five global shortcuts are handled (was: toggle and pause only). The
floating desktop bubble is shown for screen+camera in setup through paused,
its appearance and camera device are pushed to the shell, and its drags come
back as a display-normalized centre that is re-based through the frame layout
before reaching the bubble config — applied with immediate:true so the
burned-in bubble never lags the window. Adds a "System audio: on" badge.
Everything degrades to a no-op without the bridge.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Task 20

Packaging: the plist keys that make TCC work, and an unsigned, ad-hoc `dmg` + `zip`.

**Files:** `desktop/electron-builder.yml`, `desktop/build/entitlements.mac.plist`

- [ ] Create `desktop/electron-builder.yml`:

```yaml
appId: com.jtylerray.yoom
productName: Yoom
copyright: © J. Tyler Ray

directories:
  output: dist
  buildResources: build

files:
  - out/**/*
  - package.json

extraResources:
  # The tray template icons are loaded from process.resourcesPath at runtime.
  - from: build
    to: build
    filter:
      - trayTemplate.png
      - trayTemplate@2x.png

mac:
  category: public.app-category.productivity
  target:
    - target: dmg
      arch: [arm64]
    - target: zip
      arch: [arm64]
  # v1 is unsigned and ad-hoc signed by electron-builder. Consequence: macOS
  # keys TCC grants on the binary's cdhash, which changes on every rebuild, so
  # every rebuild re-prompts for Screen Recording, Camera, Microphone and
  # System Audio Recording. Documented in desktop/README.md.
  identity: null
  hardenedRuntime: false
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    NSCameraUsageDescription: Yoom records your camera into your screen recordings.
    NSMicrophoneUsageDescription: Yoom records your microphone into your screen recordings.
    # REQUIRED on macOS 14.2+ for Chromium's CoreAudio Tap API. Without it the
    # loopback audio track is created but silent, with no warning or error.
    # (Electron desktopCapturer docs, §Caveats → macOS versions 14.2 or higher.)
    NSAudioCaptureUsageDescription: Yoom records the audio playing on your Mac.
    NSScreenCaptureUsageDescription: Yoom records your screen.
    # Menu-bar app: no dock icon, no app-switcher entry. Pairs with app.dock.hide().
    LSUIElement: true

dmg:
  title: Yoom
  contents:
    - x: 140
      y: 190
      type: file
    - x: 400
      y: 190
      type: link
      path: /Applications

publish: null
```

- [ ] Create `desktop/build/entitlements.mac.plist` (inert while `identity: null`, but present so a future signed build needs no new file):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
    <key>com.apple.security.device.microphone</key>
    <true/>
  </dict>
</plist>
```

- [ ] Run: `npm --prefix desktop run build`
      Expected: electron-builder finishes with `building        target=DMG` and `building        target=macOS zip`, and `desktop/dist/` contains `Yoom-0.1.0-arm64.dmg` and `Yoom-0.1.0-arm64-mac.zip`.

- [ ] Run: `plutil -p "desktop/dist/mac-arm64/Yoom.app/Contents/Info.plist" | grep -E "NSAudioCaptureUsageDescription|NSScreenCaptureUsageDescription|NSCameraUsageDescription|NSMicrophoneUsageDescription|LSUIElement"`
      Expected: all five keys present, `LSUIElement => 1`.

- [ ] Commit:

```
git add desktop/electron-builder.yml desktop/build/entitlements.mac.plist
git commit -m "$(cat <<'EOF'
build(desktop): unsigned macOS dmg + zip

appId com.jtylerray.yoom, arm64 dmg and zip, identity: null (ad-hoc). The four
TCC usage strings and LSUIElement ship in extendInfo —
NSAudioCaptureUsageDescription is load-bearing: without it macOS 14.2+ hands
Chromium's CoreAudio tap a silent audio track and reports no error.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Task 21

Documentation.

**Files:** `desktop/README.md`, `README.md`, `docs/for-later.md`

- [ ] Create `desktop/README.md`:

```markdown
# Yoom desktop (macOS)

An Electron shell around the deployed Yoom web recorder. It exists for three
things a browser on macOS cannot do:

1. **System audio for screens and windows.** Chrome on macOS only gives system
   audio for *tab* captures. The shell answers `getDisplayMedia` in the main
   process and returns `audio: 'loopback'`, which Chromium services with
   Apple's CoreAudio Tap API on macOS 14.2+.
2. **Global hotkeys.** ⌘⇧L start/stop, ⌘⇧P pause, ⌘⇧M mark, ⌘⇧K restart,
   ⌘⇧X cancel — they fire while another app is focused, which is exactly when
   you need them during a screen recording.
3. **A floating camera bubble** over the desktop, draggable, whose position
   drives the bubble burned into the recording.

There is no dock icon; the app lives in the menu bar.

## Requirements

macOS 14.2 or newer (Apple silicon), Node 20+, and a running Yoom web app —
either the deployment or `npm run dev` in the repo root.

## Dev

```sh
cd desktop
npm install
npm run icons     # once, generates the tray template PNGs
npm run dev       # YOOM_DEV=1 → loads http://localhost:3000
```

Point it somewhere else with `YOOM_APP_URL=https://staging.example.com npm run dev`.
With neither variable set the app loads `https://yoom.jtylerray.com`.

## Build

```sh
npm run build     # → dist/Yoom-0.1.0-arm64.dmg and …-mac.zip
```

The build is **unsigned** (`identity: null`, ad-hoc). Gatekeeper will refuse a
double-click on first launch: right-click the app → Open → Open.

## Permissions (TCC)

| Permission | When it is asked | Notes |
|---|---|---|
| Screen Recording | First real capture (`desktopCapturer.getSources`) | Cannot be prompted from code. Grant it in System Settings → Privacy & Security → Screen Recording, then **relaunch**. |
| Camera | `systemPreferences.askForMediaAccess('camera')`, from the tray's Permissions… item, or on first camera use | |
| Microphone | Same | |
| System Audio Recording | macOS 14.2+ only, on first loopback capture | **No status API exists.** The only symptom of a missing grant is a silent audio track with no error. |

Two things that will waste your afternoon if you do not know them:

- **Unsigned builds re-prompt on every rebuild.** macOS keys TCC grants to the
  binary's cdhash, and an ad-hoc signature produces a new one each build. Every
  `npm run build` is a fresh app as far as privacy is concerned.
- **`npm run dev` is not the packaged app.** In dev, the running binary is
  `node_modules/electron/dist/Electron.app`, whose Info.plist has none of our
  usage strings, so system audio can be dead in dev and fine in the packaged
  build. Verify loopback audio against a packaged build.

If Chromium's CoreAudio tap misbehaves, `YOOM_LEGACY_AUDIO=1` forces the older
"Screen & System Audio Recording" permission path via the
`MacCatapLoopbackAudioForScreenShare` feature flag.

## The floating bubble

The bubble window is a **live camera preview positioned over the desktop**, not
the pixels that end up in the recording. Dragging it sends its centre —
normalized to the display it sits on — to the web app, which repositions the
burned-in bubble to match.

The live window and the composited bubble are deliberately the same size and in
the same place. That matters: `setContentProtection(true)` is applied, but on
modern macOS ScreenCaptureKit-based capturers (Chromium's included) capture the
window anyway, so the real defence against seeing the bubble twice is that the
composited bubble is drawn *over* the captured pixels of the live one. If you
still see doubling, run with `YOOM_BUBBLE_HIDE_WHILE_RECORDING=1`, which hides
the live window once recording starts.

The bubble's own hover strip has two controls: cycle shape and hide. Both echo
back into the web app so the setting persists.

## Known limits (v1)

- **Window captures.** `desktopCapturer` gives no bounds for foreign windows, so
  the bubble position is always normalized to the *display*, never to the
  captured window. When you capture a single window, the burned-in bubble
  tracks the bubble's position on the screen, which only lines up with the
  recording if that window fills the display. Capture a whole screen for exact
  alignment.
- **The in-page drag handle and the floating window are independent.** Both
  write the same bubble position, so they agree after either one moves, but
  dragging the in-page handle does not move the floating window.
- No code signing, no notarization, no auto-update, arm64 only.
- macOS only. The main process is written to be portable, but nothing here has
  been run on Windows or Linux.
```

- [ ] Append a "Desktop app" section to the root `README.md`, immediately before the existing `## Known limits` heading:

```markdown
## Desktop app

`desktop/` is a separate npm package: an Electron menu-bar shell that wraps this
web app and adds full macOS system audio (screens and windows, not just tabs),
global hotkeys that work while another app is focused, and a floating camera
bubble over the desktop whose position drives the bubble in the recording.

```sh
cd desktop && npm install && npm run icons
npm run dev      # loads http://localhost:3000
npm run build    # unsigned dmg + zip in desktop/dist
```

It is excluded from the root `tsconfig.json`, ESLint, `npm test` and Vercel
deploys (`.vercelignore`), so it never affects the web build. See
[`desktop/README.md`](desktop/README.md) for permissions and known limits.

The web app detects the shell through `window.__yoomDesktop`
(`src/lib/recording/desktop-bridge.ts`). Without it, every desktop call is a
no-op and the browser behaviour is unchanged.
```

- [ ] In `docs/for-later.md`, replace the "Phase 4 requirements from Phase 2 testing" bullet with:

```markdown
## Phase 4 requirements from Phase 2 testing

- ~~Floating always-on-top camera bubble window over the desktop while recording
  (Loom-style), draggable; the recording's bubble position follows it.~~
  **Shipped in Phase 4** as `desktop/src/main/bubble.ts` +
  `desktop/src/renderer/bubble/`, with the mapping in
  `desktop/src/main/mapping.ts` (`bubbleCentreToNormalized`, `bubbleWindowSize`)
  and `displayPosToCanvasPos` in `src/lib/recording/geometry.ts`. Known limit:
  window captures map against the display, not the captured window.
```

- [ ] Run: `npm run lint`
      Expected: clean (markdown is not linted; this only confirms nothing else broke).

- [ ] Commit:

```
git add desktop/README.md README.md docs/for-later.md
git commit -m "$(cat <<'EOF'
docs: desktop app setup, permissions and known limits

Documents the TCC matrix, the two traps (unsigned rebuilds re-prompt; dev runs
against node_modules' Electron.app whose plist lacks our usage strings), the
double-bubble mechanism and its escape hatch, and the window-capture mapping
limit.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Task 22

The manual verification matrix. Everything that touches media, TCC or window management lives here — none of it is automatable. Work top to bottom and record the result of each line.

**Files:** none (verification only)

### A. Automated gates first

- [ ] Run from the root: `npm test`
      Expected: all files pass, and the summary mentions no file under `desktop/`.
- [ ] Run: `npm --prefix desktop test`
      Expected: `Test Files  1 passed`, `Tests  14 passed`.
- [ ] Run: `npx tsc --noEmit && npm run lint && npm run build`
      Expected: three clean exits.
- [ ] Run: `npm --prefix desktop run typecheck`
      Expected: exit 0.
- [ ] Run: `git status --porcelain`
      Expected: empty (everything committed).

### B. Dev shell

- [ ] Start the web app: `npm run dev` (root). Then `npm --prefix desktop run dev`.
- [ ] A tray icon appears in the menu bar; **no dock icon** appears.
- [ ] Tray menu shows: Open recorder · Toggle recording · Permissions… · Quit Yoom.
- [ ] The recorder window opens at `http://localhost:3000`.
- [ ] In the window's DevTools console: `window.__yoomDesktop.version` → `1`,
      `.isDesktop` → `true`, `.capabilities` → `{systemAudio: 'full', nativePicker: true, surfaceHints: false}`.
- [ ] The recorder shows the green "Desktop app · System audio: on" badge, and the
      audio panel shows **no** "System audio is available for tab recordings…" notice.

### C. Login persistence

- [ ] Sign in with the shared password. Quit Yoom entirely (tray → Quit).
- [ ] Relaunch `npm --prefix desktop run dev`. Expected: still signed in — the
      `yoom_session` cookie survived in the `persist:yoom` partition.

### D. Shortcuts

- [ ] Focus a different app (e.g. Finder). Press ⌘⇧L. Expected: the recorder acquires / starts.
- [ ] While recording and with another app focused: ⌘⇧P pauses, ⌘⇧P resumes,
      ⌘⇧M drops a marker (the REC chip flashes), ⌘⇧K restarts, ⌘⇧X cancels.
- [ ] Close the recorder window, then press ⌘⇧L. Expected: the window reopens.

### E. Picker

- [ ] Choose Screen + Camera, Entire screen, Set up recording.
- [ ] The native picker appears (not Chrome's sheet), with a Screens tab preselected.
- [ ] Tab switches to Windows; window thumbnails and app icons render.
- [ ] ↑↓←→ moves the selection, Enter shares, Esc cancels (the page shows its
      existing "permission denied" handling, not a crash).
- [ ] With Screen+Camera and the Window surface preference, the picker opens on
      the **Windows** tab (this proves `setSurfacePref` reached main).
- [ ] The "System audio will be included" line shows when the page requested audio.

### F. System audio (the reason this shell exists)

Do this against the **packaged** build, not `npm run dev` — see `desktop/README.md`.

- [ ] `npm --prefix desktop run build`, then open `desktop/dist/mac-arm64/Yoom.app`
      with right-click → Open → Open (Gatekeeper).
- [ ] Grant Screen Recording when prompted, relaunch, and grant System Audio
      Recording if macOS asks.
- [ ] Play music. Record 10 seconds of the entire screen with mic **off**, system **on**.
- [ ] Download the recording, then:
      `ffprobe -hide_banner out.webm`
      Expected: one video stream **and** one audio (Opus) stream.
- [ ] `ffmpeg -hide_banner -i out.webm -af volumedetect -f null - 2>&1 | grep mean_volume`
      Expected: `mean_volume: -XX.X dB` with a value **greater than −60 dB**.
      A value at or near −91 dB means a silent track: check
      `NSAudioCaptureUsageDescription` in the packaged Info.plist and the System
      Audio Recording grant.
- [ ] Repeat with mic **on**: both sources audible in the same track (the Phase 2
      mixer pre-mixes them, so there is still exactly one audio stream).
- [ ] Toggle system audio off mid-recording: the music drops out, the recording
      continues, and the encoder does not restart.

### G. Floating bubble

- [ ] Screen + Camera → Set up recording. Expected: the floating bubble window
      appears near the bottom-right of the primary display, showing live camera.
- [ ] Drag it by its body anywhere on screen. Expected: the burned-in bubble in
      the recorder preview follows in real time, with no visible tween lag.
- [ ] Hover it: the control strip appears. Click the shape button — both the
      floating window and the preview change shape together, and the window
      resizes. Click hide — both disappear; re-show from the in-page bubble
      controls.
- [ ] Change size in the in-page camera controls. Expected: the floating window
      resizes around its own centre.
- [ ] Toggle mirror. Expected: the floating video flips; the control strip does not.
- [ ] Record 5 seconds while the bubble sits over the desktop, then watch the
      result. Expected: **exactly one** bubble in the frame. If a faint second
      edge is visible behind the composited one, relaunch with
      `YOOM_BUBBLE_HIDE_WHILE_RECORDING=1` and confirm the artefact is gone.
- [ ] Stop recording. Expected: the floating bubble disappears at `review`.
- [ ] Switch to Screen only. Expected: no floating bubble at any status.
- [ ] Switch to Camera only. Expected: no floating bubble (shape is `full`).
- [ ] Enable framed capture with padding, then drag the bubble to the far
      bottom-right of the display. Expected: the burned-in bubble lands in the
      bottom-right of the **inset screen**, not out on the frame background.
- [ ] Multi-display (if available): drag the bubble to the second display.
      Expected: it stays visible, resizes to that display's width fraction, and
      the reported position is relative to that display.

### H. Regression — browser behaviour is untouched

- [ ] Open `http://localhost:3000` in Chrome (no shell). Expected:
      no "Desktop app" badge; the "System audio is available for tab
      recordings…" notice is back; Chrome's own picker sheet appears;
      the in-page bubble drag handle works exactly as before;
      `window.__yoomDesktop` is `undefined`.

### I. Build artefacts and deployment isolation

- [ ] `ls desktop/dist` → `Yoom-0.1.0-arm64.dmg`, `Yoom-0.1.0-arm64-mac.zip`.
- [ ] Mount the dmg, drag to Applications, launch from there, and repeat C, D, E, F, G.
- [ ] `npm run build` at the root → succeeds, and the Next build output mentions
      nothing under `desktop/`.
- [ ] `cat .vercelignore` → contains `desktop`.
- [ ] `git check-ignore -v desktop/node_modules desktop/out desktop/dist`
      Expected: three lines, all matched by `desktop/.gitignore`.

- [ ] Final commit (only if the matrix produced fixes; otherwise skip):

```
git add -A
git commit -m "$(cat <<'EOF'
fix(desktop): manual verification matrix follow-ups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Self-review

**Spec and for-later coverage → tasks.** Every element of the Phase 4 spec section maps to a task: the `desktop/` package layout and root exclusions → Task 4 and Task 20 (`electron-builder.yml` with `appId com.jtylerray.yoom`, mac `dmg`+`zip`, `identity: null`, all four usage strings plus `LSUIElement: true`); main-process responsibilities → Tasks 7–10 and 17 (`app.dock.hide()`, `persist:yoom`, `contextIsolation`/`sandbox`/no `nodeIntegration`, navigation restricted to the app origin with `setWindowOpenHandler` sending everything else to `shell.openExternal`, `setPermissionRequestHandler` + `setPermissionCheckHandler` allowing only `media`/`display-capture` for that origin); `setDisplayMediaRequestHandler` with the native picker and the Screen Recording guard → Tasks 12–14; the IPC contract → Task 5 (extended past the spec's five channels because the bubble needs six more, all named and typed in one file); macOS permissions → Task 7 and the `desktop/README.md` TCC table. The `docs/for-later.md` item that is **in** scope — floating always-on-top draggable camera bubble whose position the recording follows — is Tasks 6, 15, 16 and 18, verified in matrix section G. Items #2–#4 of that file (cursor smoothing, click ripples, cursor sidecar) appear nowhere in this plan, as required; the compositor's `OverlayLayer` seam that Phase 5 will need already exists and is untouched here. The spec's ordering constraint is honoured: pure maths and bridge types (Tasks 1–3, 6) come before the scaffold (4), which comes before main (7–11), capture and picker (12–14), bubble (15–17), web wiring (18–19), build and docs (20–21), manual matrix (22). Twenty-two tasks, inside the requested 16–24.

**Placeholder scan.** There are no `TODO`, `FIXME`, `…`, `<your-…>` or "implement this" markers anywhere in the plan. Every file listed in the File Structure table is created by a named task with its complete contents, including the two binary tray PNGs, which are produced deterministically by `desktop/build/make-tray-icons.mjs` (a self-contained PNG encoder using only `node:zlib`) rather than being hand-waved. Every command has a stated expected output, and the three red-then-green steps (Tasks 2, 3, 6) name the exact failure message to expect.

**Type consistency.** `DesktopShortcut` and `BubbleAppearance` are defined once in `src/lib/recording/types.ts` (Task 1) and mirrored verbatim in `desktop/src/shared/ipc.ts` (Task 5), with the duplication called out in a comment because the two packages share no path mapping. `onDesktopShortcut` widens from `"toggle" | "pause"` to the five-member union in the same task that widens the bridge type and the `use-recorder.ts` handler, so no call site is left narrower than its callee. `BubbleAppearance` has exactly the four fields `{shape, size, mirror, visible}` in the type, the preload, the IPC payload, `bubble.ts`, `bubble.ts` (renderer) and the `use-recorder.ts` effect. The two `visible` sources are disambiguated by construction: `BubbleAppearance.visible` is the user's toggle, `setBubbleVisible` is the status gate, and `shouldShow()` in `desktop/src/main/bubble.ts` is the single place that ANDs them (plus the `shape === "full"` exclusion). `SIZE_FRACTION` and the 14% corner fraction are duplicated in three places (root `geometry.ts`, `desktop/src/main/mapping.ts`, `desktop/src/renderer/bubble/bubble.ts`) and `mapping.test.ts` pins the literals so drift fails a test rather than producing a silent visual artefact. `bubbleCentreToNormalized(bubble: Bounds, display: Bounds)` and `displayPosToCanvasPos(pos, layout: FrameLayout)` are each defined once, tested, and called with exactly those signatures.

**Ambiguities resolved, and why.** (1) The spec's `mediaSources.getDisplay(pref)` override in the preload is impossible — `contextBridge` cannot carry a `MediaStream` across worlds — so the bridge instead exposes `setSurfacePref(pref)` and `getProvider()` wraps `browserProvider.getDisplay` to announce it first; the stream is still created by the page, exactly as the spec's own "the actual call still happens in the renderer" note requires. (2) The spec's feature-flag name `MacCatapSystemAudioLoopbackCapture` does not exist; the verbatim name from the desktopCapturer Caveats code block is `MacCatapLoopbackAudioForScreenShare`, used in Task 17 behind `YOOM_LEGACY_AUDIO=1`. (3) The `session` docs still describe `audio: 'loopback'` as Windows-only while the `desktopCapturer` Caveats section documents the macOS 14.2+ CoreAudio Tap path as the default since Electron `v39.0.0-beta.4` — the plan follows the Caveats section and makes `volumedetect` in matrix F the arbiter. (4) `setContentProtection(true)` is **not** sufficient on modern macOS (`electron.d.ts` @ 44.1.1 says ScreenCaptureKit-based capturers ignore it, and Chromium is one); the plan therefore relies on self-occlusion — identical rects, composited last, `immediate: true` so there is no tween lag — with `YOOM_BUBBLE_HIDE_WHILE_RECORDING=1` as the escape hatch. (5) The spec asked for DPR handling via `display.scaleFactor`; both `BrowserWindow.getBounds()` and `Display.bounds` are in device-independent pixels, so the scale factor cancels and applying it would be a bug — documented in `mapping.ts` and asserted by the second-display test. (6) The window-capture v1 rule: `desktopCapturer` exposes no bounds for foreign windows, so the position is always normalized to the display; the floating bubble stays visible and functional, and the misalignment for non-fullscreen window captures is documented under Known limits rather than papered over. (7) Framed capture would otherwise misplace the bubble, since the canvas is larger than the screen — solved with `displayPosToCanvasPos` (Task 3) rather than by disabling the desktop bubble when framing is on. (8) Per the brief, the in-page drag handle is **kept** alongside the floating window; they share one normalized `pos` so they agree after either moves, with the one-way sync noted in `desktop/README.md`.

**Pinned versions and citations.** `electron@44.1.1`, `electron-vite@5.0.0`, `electron-builder@26.15.3`, `typescript@5.9.3`, `vite@7.1.14`, `vitest@4.1.11`, `@types/node@26.4.1` — all exact, no carets, checked with `npm view` on 2026-09-02. Two are deliberately *not* npm's `latest`: `vite` (latest 8.2.2 is outside `electron-vite`'s `^5 || ^6 || ^7` peer range) and `typescript` (latest 7.0.2 is the native port; 5.9.3 matches the root repo's `^5`). Non-obvious APIs are cited at their call sites: `session.fromPartition` and `setPermissionRequestHandler` in `windows.ts` (Electron session docs, those two sections); `setDisplayMediaRequestHandler` and the `useSystemPicker`-bypasses-the-handler warning in `capture.ts` (same doc, `ses.setDisplayMediaRequestHandler(handler[, opts])`); `desktopCapturer.getSources` options in `picker.ts` (desktopCapturer docs, that method's section); `NSAudioCaptureUsageDescription`, the silent-dead-track warning, the CoreAudio Tap default since `v39.0.0-beta.4` and the `MacCatapLoopbackAudioForScreenShare` flag in `electron-builder.yml` and `index.ts` (desktopCapturer docs, §Caveats → macOS versions 14.2 or higher); `setContentProtection`'s ScreenCaptureKit caveat and `setAlwaysOnTop`'s level enum in `bubble.ts` (`node_modules/electron/electron.d.ts` @ 44.1.1); `systemPreferences.getMediaAccessStatus`'s three-value `mediaType` union in `permissions.ts` (same file).

## Amendment (Fable review, 2026-09-02, before implementation)

1. **Auto-hide the live bubble for window/tab captures.** Self-occlusion only works when the composited bubble and the live window cover the same pixels, which is only true for *display* captures. For sources whose id starts with `window:` (and any `browser` surface), main must treat `YOOM_BUBBLE_HIDE_WHILE_RECORDING` as ON automatically: `capture.ts` records the chosen source kind (`screen` | `window`) after the picker resolves; `bubble.ts` exposes `setCaptureKind(kind)`; `shouldShow()` returns false while `recordingActive && (HIDE_WHILE_RECORDING || captureKind === "window")`. The recorder still shows the bubble in-page and burns it in at the last known position. Add a mapping test-free note in `desktop/README.md` "Known limits".
2. **One source of truth for bubble sizing.** `desktop/src/main/mapping.ts#bubbleWindowSize` must use the same `SIZE_FRACTION` values and per-shape aspect rules as `src/lib/recording/geometry.ts#computeBubbleRect` (small/medium/large fractions of the *display width*; circle/square 1:1, portrait 9:16, rounded = camera aspect 16:9 assumed for the window). Copy the constants with a comment pointing at `geometry.ts`, and add a unit test in `desktop/src/main/mapping.test.ts` that asserts the three fractions equal the web values (hard-code the expected numbers from `geometry.ts` so drift fails the test).
3. **Bubble renderer camera permission.** `windows.ts`'s `setPermissionRequestHandler` must also allow `media` for the bubble and picker windows' own origin (`file://` in prod, `http://localhost:<port>` under electron-vite dev), otherwise the bubble's `getUserMedia` is denied. Check by origin of `webContents.getURL()` or by `webContents.id` membership.
4. **Do not launch the app during the overnight build.** `npm run dev`/opening the built `.app` triggers macOS TCC prompts (Screen Recording, Camera, Microphone, System Audio) that only Tyler can answer. The overnight gate is: root tests green, `desktop` typecheck + unit tests green, `electron-vite build` succeeds, `electron-builder --mac dmg zip --publish never` produces artefacts in `desktop/dist/`. Everything in Task 22 that needs a running app goes on the blocked list.
