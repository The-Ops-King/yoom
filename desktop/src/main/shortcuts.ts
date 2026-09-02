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
