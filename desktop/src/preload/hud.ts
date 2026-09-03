import { contextBridge, ipcRenderer } from "electron";
import type { DesktopShortcut, HudDragPoint, HudState } from "../shared/ipc";
import { IPC } from "./hud.channels";

contextBridge.exposeInMainWorld("__yoomHud", {
  onApply(cb: (state: HudState) => void): void {
    ipcRenderer.on(IPC.hudApply, (_e, state: HudState) => cb(state));
  },
  action(action: DesktopShortcut): void {
    ipcRenderer.send(IPC.hudAction, action);
  },
  interact(): void {
    ipcRenderer.send(IPC.hudInteract);
  },
  dragStart(point: HudDragPoint): void {
    ipcRenderer.send(IPC.hudDragStart, point);
  },
  dragMove(point: HudDragPoint): void {
    ipcRenderer.send(IPC.hudDragMove, point);
  },
  dragEnd(): void {
    ipcRenderer.send(IPC.hudDragEnd);
  },
});
