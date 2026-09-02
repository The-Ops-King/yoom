import { contextBridge, ipcRenderer } from "electron";
import type { DesktopShortcut, HudState } from "../shared/ipc";
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
});
