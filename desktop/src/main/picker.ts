import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, app, desktopCapturer, ipcMain } from "electron";
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

/**
 * The last source the user actually recorded, remembered across launches.
 *
 * macOS still wants a deliberate choice for every capture, so the picker is
 * never skipped — but re-picking the same monitor from scratch every take is
 * the kind of friction Loom does not have. Remembering the pick makes Enter (or
 * one click) enough.
 */
interface LastSource {
  id: string;
  name: string;
  kind: "screen" | "window";
}

/** `undefined` = not read from disk yet; `null` = read, nothing stored. */
let lastSource: LastSource | null | undefined;

function lastSourcePath(): string {
  // Lazily, never at module scope: `getPath` needs the app to be ready.
  return join(app.getPath("userData"), "last-source.json");
}

function readLastSource(): LastSource | null {
  if (lastSource !== undefined) return lastSource;
  lastSource = null;
  try {
    const raw: unknown = JSON.parse(readFileSync(lastSourcePath(), "utf8"));
    if (raw && typeof raw === "object") {
      const { id, name, kind } = raw as Record<string, unknown>;
      if (typeof id === "string" && id && typeof name === "string") {
        if (kind === "screen" || kind === "window") lastSource = { id, name, kind };
      }
    }
  } catch {
    // No file yet, or a truncated one from a crash mid-write. Either way the
    // picker just opens with nothing preselected; this is a convenience.
  }
  return lastSource;
}

/** Called once the pick has actually produced a stream. */
export function rememberLastSource(source: LastSource): void {
  const next = { id: source.id, name: source.name, kind: source.kind };
  lastSource = next;
  try {
    writeFileSync(lastSourcePath(), JSON.stringify(next), "utf8");
  } catch (err) {
    console.error("[yoom] could not remember the last capture source", err);
  }
}

/**
 * The id of the remembered source in TODAY's list, or null.
 *
 * Matched by id first. Window ids (`window:<handle>:0`) are handles, so they do
 * not survive the app being relaunched — for those, fall back to the same kind
 * with the same title, which is what "Slack" or "Chrome — Yoom" means to the
 * person looking at the grid. Screen ids are stable and hit the first branch.
 */
export function resolveLastSourceId(sources: SourceInfo[]): string | null {
  const last = readLastSource();
  if (!last) return null;
  const exact = sources.find((s) => s.id === last.id);
  if (exact) return exact.id;
  const byName = sources.find((s) => s.kind === last.kind && s.name === last.name);
  return byName?.id ?? null;
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
