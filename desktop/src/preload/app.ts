import { contextBridge, ipcRenderer } from "electron";
// Types only — a *value* import of `../shared/ipc` would make Rollup emit a
// shared chunk that a sandboxed preload cannot require. See `app.channels.ts`.
import type {
  BubbleAppearance,
  CursorSample,
  DesktopShortcut,
  HudState,
  InputSample,
  ShareMode,
  ShareSource,
  SurfacePref,
} from "../shared/ipc";
import { IPC } from "./app.channels";

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
export const bridge = {
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

  /**
   * `"auto"` (the default in main) answers `getDisplayMedia` with the source
   * recorded last time and never shows the picker; `"pick"` always shows it.
   * Sticky — send it once, not per request.
   */
  setShareMode(mode: ShareMode): void {
    ipcRenderer.send(IPC.setShareMode, mode);
  },

  /**
   * "Change" in the page: open the picker for the NEXT request only, leaving
   * the sticky mode alone. Call it, then re-run `getDisplayMedia`.
   */
  changeShare(): void {
    ipcRenderer.send(IPC.changeShare);
  },

  /**
   * Which source is actually being shared — auto-shared or picked — so the
   * page can name it. `null` when the take ends or the request was denied.
   */
  onShareSource(cb: (source: ShareSource | null) => void): () => void {
    const handler = (_e: unknown, source: ShareSource | null) => cb(source);
    ipcRenderer.on(IPC.shareSource, handler);
    return () => ipcRenderer.removeListener(IPC.shareSource, handler);
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

  /**
   * The bubble's own control strip (hide, cycle shape) changes the appearance
   * from the desktop side; main echoes the new appearance back on the same
   * channel the web app writes to, so the web state stays authoritative.
   */
  onBubbleAppearance(cb: (appearance: BubbleAppearance) => void): () => void {
    const handler = (_e: unknown, appearance: BubbleAppearance) => cb(appearance);
    ipcRenderer.on(IPC.setBubbleAppearance, handler);
    return () => ipcRenderer.removeListener(IPC.setBubbleAppearance, handler);
  },

  setBubbleAppearance(appearance: BubbleAppearance): void {
    ipcRenderer.send(IPC.setBubbleAppearance, appearance);
  },

  setBubbleVisible(visible: boolean): void {
    ipcRenderer.send(IPC.setBubbleVisible, visible);
  },

  setRecordingActive(active: boolean): void {
    ipcRenderer.send(IPC.setRecordingActive, active);
  },

  setCameraDevice(deviceId: string | null): void {
    ipcRenderer.send(IPC.setCameraDevice, deviceId);
  },

  setHudState(state: HudState): void {
    ipcRenderer.send(IPC.setHudState, state);
  },

  /**
   * Batched cursor samples for the staging editor's mouse-follow zoom. Only
   * display captures produce them, so a page that never sees a batch simply
   * has no cursor track and hides the "Follow mouse" toggle.
   */
  onCursor(cb: (samples: CursorSample[]) => void): () => void {
    const handler = (_e: unknown, samples: CursorSample[]) => cb(samples);
    ipcRenderer.on(IPC.cursor, handler);
    return () => ipcRenderer.removeListener(IPC.cursor, handler);
  },

  /**
   * Batched global clicks and key presses, for the staging editor's Clicks lane
   * and `keys` overlay. Silent when macOS Input Monitoring is not granted, when
   * the native hook could not load, and — for clicks specifically — for window
   * captures, which have no display rectangle to normalize against. A page that
   * never sees a batch simply has no input track.
   */
  onInput(cb: (samples: InputSample[]) => void): () => void {
    const handler = (_e: unknown, samples: InputSample[]) => cb(samples);
    ipcRenderer.on(IPC.input, handler);
    return () => ipcRenderer.removeListener(IPC.input, handler);
  },
};

contextBridge.exposeInMainWorld("__yoomDesktop", bridge);
