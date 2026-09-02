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

/**
 * Subscribe to appearance changes the desktop bubble makes on its own — its
 * hover strip can hide the bubble and cycle its shape, and main echoes the new
 * appearance back so the web state stays authoritative.
 */
export function onDesktopBubbleAppearance(
  cb: (appearance: BubbleAppearance) => void,
): () => void {
  const bridge = getDesktopBridge();
  if (!bridge?.onBubbleAppearance) return () => {};
  return bridge.onBubbleAppearance(cb);
}

/** Show/hide the floating bubble window. No-op in the browser. */
export function setDesktopBubbleVisible(visible: boolean): void {
  getDesktopBridge()?.setBubbleVisible?.(visible);
}

/** Push shape/size/mirror/visibility to the floating bubble. No-op in the browser. */
export function setDesktopBubbleAppearance(appearance: BubbleAppearance): void {
  getDesktopBridge()?.setBubbleAppearance?.(appearance);
}

/**
 * Tell the shell whether the encoder is running. It uses this to hide the live
 * bubble window for the captures where self-occlusion cannot work (window
 * captures, framed capture, or the YOOM_BUBBLE_HIDE_WHILE_RECORDING escape
 * hatch). No-op in the browser.
 */
export function setDesktopRecordingActive(active: boolean): void {
  getDesktopBridge()?.setRecordingActive?.(active);
}

/** Tell the floating bubble which camera to open. No-op in the browser. */
export function setDesktopCameraDevice(deviceId: string | null): void {
  getDesktopBridge()?.setCameraDevice?.(deviceId);
}
