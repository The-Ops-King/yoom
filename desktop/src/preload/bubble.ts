import { contextBridge, ipcRenderer } from "electron";
import type { BubbleAppearance } from "../shared/ipc";
import { IPC } from "./bubble.channels";

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
