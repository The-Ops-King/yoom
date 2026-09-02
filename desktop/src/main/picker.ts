import { join } from "node:path";
import { BrowserWindow, desktopCapturer, ipcMain } from "electron";
import { IPC, type PickerPayload, type SourceInfo } from "../shared/ipc";
import {
  getRecorderWindow,
  registerShellWebContents,
  unregisterShellWebContents,
  yoomSession,
} from "./windows";

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
        // Must be the same session the permission handlers are installed on —
        // on defaultSession the shell-origin branch of installPermissionHandlers
        // never runs.
        session: yoomSession(),
        preload: join(__dirname, "../preload/picker.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    pickerWindow = win;
    const wcId = win.webContents.id;
    registerShellWebContents(wcId);
    // The picker never legitimately opens a new window; deny anything that tries.
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    win.once("ready-to-show", () => {
      win.show();
      win.focus();
      win.webContents.send(IPC.pickerSources, payload);
    });
    // Clicking away is a cancel — the web app already handles NotAllowedError.
    // Armed only after the window has actually been focused once: a `blur`
    // that arrives before first focus (which macOS does emit while the window
    // is still coming up) would cancel the picker the moment it opened.
    let everFocused = false;
    win.on("focus", () => {
      everFocused = true;
    });
    win.on("blur", () => {
      if (everFocused) settle(null);
    });
    win.on("closed", () => {
      unregisterShellWebContents(wcId);
      settle(null);
    });

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
