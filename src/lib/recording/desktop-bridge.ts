import type {
  CursorSample,
  DesktopBridge,
  DesktopShortcut,
  HudState,
  InputSample,
  ShareMode,
  ShareSource,
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

/**
 * Choose how the shell answers `getDisplayMedia`: `"auto"` re-shares the last
 * source with no picker at all, `"pick"` always shows it. Sticky — send it
 * once, not per request.
 *
 * No-op in the browser and against a shell that predates auto-share, where
 * every request opens the picker as before.
 */
export function setDesktopShareMode(mode: ShareMode): void {
  getDesktopBridge()?.setShareMode?.(mode);
}

/**
 * "Change": open the native picker for the NEXT `getDisplayMedia` only,
 * without leaving `"auto"` behind. Call it, then re-acquire the stream.
 *
 * Returns whether the shell accepted it, so a page whose shell predates the
 * feature can fall back to its own source UI instead of re-acquiring the same
 * source and looking broken.
 */
export function changeDesktopShare(): boolean {
  const bridge = getDesktopBridge();
  if (!bridge?.changeShare) return false;
  bridge.changeShare();
  return true;
}

/**
 * Subscribe to which source the shell is sharing — auto-shared or picked —
 * with `null` when the take ends or the request was denied. Returns a no-op
 * unsubscribe in the browser and against a shell that predates the feature, so
 * the caller can wire it unconditionally; in those cases nothing ever arrives
 * and the page simply never names a source.
 */
export function onDesktopShareSource(
  cb: (source: ShareSource | null) => void,
): () => void {
  const bridge = getDesktopBridge();
  if (!bridge?.onShareSource) return () => {};
  return bridge.onShareSource(cb);
}
