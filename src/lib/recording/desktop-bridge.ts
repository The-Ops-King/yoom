import type {
  CursorSample,
  DesktopBridge,
  DesktopShortcut,
  HudState,
  InputSample,
} from "./types";

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

/**
 * Subscribe to batched cursor samples from the desktop shell (mouse-follow
 * zoom). Returns a no-op unsubscribe in the browser and against a shell that
 * predates the feature, so the caller can wire it unconditionally; in those
 * cases no batch ever arrives and the recorder simply has no cursor track.
 */
export function onDesktopCursor(cb: (samples: CursorSample[]) => void): () => void {
  const bridge = getDesktopBridge();
  if (!bridge?.onCursor) return () => {};
  return bridge.onCursor(cb);
}

/**
 * Subscribe to batched global clicks and key presses from the desktop shell.
 * Returns a no-op unsubscribe in the browser and against a shell that predates
 * the input tracks, so the caller can wire it unconditionally.
 *
 * Silence is normal and carries no error: the shell degrades to cursor-only
 * whenever macOS Input Monitoring is missing or the native hook could not
 * load, and clicks additionally require a display capture. An empty track is
 * the signal to hide the Clicks lane and the `keys` overlay.
 */
export function onDesktopInput(cb: (samples: InputSample[]) => void): () => void {
  const bridge = getDesktopBridge();
  if (!bridge?.onInput) return () => {};
  return bridge.onInput(cb);
}

/**
 * Push the HUD's view of the current take. No-op in the browser, and no-op
 * against a Phase-4 shell that predates the HUD — the optional call is the
 * whole forward-compatibility story.
 */
export function setDesktopHudState(state: HudState): void {
  getDesktopBridge()?.setHudState?.(state);
}
