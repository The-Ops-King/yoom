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

  setRecordingActive(active: boolean): void {
    ipcRenderer.send(IPC.setRecordingActive, active);
  },

  setCameraDevice(deviceId: string | null): void {
    ipcRenderer.send(IPC.setCameraDevice, deviceId);
  },
};

contextBridge.exposeInMainWorld("__yoomDesktop", bridge);
