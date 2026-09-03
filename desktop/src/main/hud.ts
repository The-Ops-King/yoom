import { join } from "node:path";
import { BrowserWindow, ipcMain, screen } from "electron";
import {
  IPC,
  type DesktopShortcut,
  type HudState,
  type HudStatus,
} from "../shared/ipc";
import { onRecorderStatus, stopCursorTracking } from "./cursor";
import { hudDefaultBounds, recorderWindowVisibility } from "./mapping";
import {
  hideRecorderWindow,
  registerShellWebContents,
  sendToRecorder,
  showRecorderWindow,
  unregisterShellWebContents,
  yoomSession,
} from "./windows";

/**
 * Escape hatch for the fact that macOS ≥ 14 captures the HUD despite
 * `setContentProtection(true)`: hide the pill 1 s after the last interaction,
 * and bring it back on any action, hotkey or status change. Loom's control bar
 * has the same problem and the same answer — get it out of the frame.
 */
const AUTO_HIDE = process.env.YOOM_HUD_HIDE_WHILE_RECORDING === "1";
const AUTO_HIDE_DELAY_MS = 1000;
/** How long the pill stays up after being woken by a hotkey or status change. */
const AUTO_HIDE_WAKE_MS = 2000;

const STATUSES: readonly HudStatus[] = [
  "idle",
  "countdown",
  "recording",
  "paused",
  "stopping",
  "staging",
  "rendering",
  "error",
  "other",
];

/** Statuses during which the pill belongs on screen. */
const VISIBLE_DURING: ReadonlySet<HudStatus> = new Set([
  "countdown",
  "recording",
  "paused",
  // `stopping` is included so the pill does not blink out for the ~200 ms
  // between the stop click and the blob landing.
  "stopping",
]);

const INITIAL: HudState = {
  status: "idle",
  elapsedMs: 0,
  countdown: 0,
  markers: 0,
};

let hudWindow: BrowserWindow | null = null;
let state: HudState = INITIAL;
let hudLoaded = false;
let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
/** Called after every status change so the tray can re-render. */
let onStatusChange: (() => void) | null = null;

function alive(): BrowserWindow | null {
  return hudWindow && !hudWindow.isDestroyed() ? hudWindow : null;
}

/** The HUD's status, for the tray menu. */
export function hudStatus(): HudStatus {
  return state.status;
}

export function onHudStatusChange(cb: () => void): void {
  onStatusChange = cb;
}

function rendererEntry(): { url?: string; file?: string } {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) return { url: `${devUrl}/hud/index.html` };
  return { file: join(__dirname, "../renderer/hud/index.html") };
}

function createHudWindow(): BrowserWindow {
  const existing = alive();
  if (existing) return existing;

  const bounds = hudDefaultBounds(screen.getPrimaryDisplay().workArea);

  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    acceptFirstMouse: true,
    webPreferences: {
      // Same session the permission handlers are installed on, like every
      // other window in the shell.
      session: yoomSession(),
      preload: join(__dirname, "../preload/hud.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const wcId = win.webContents.id;
  registerShellWebContents(wcId);
  // The HUD never legitimately opens a new window; deny anything that tries.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  win.setAlwaysOnTop(true, "floating");
  // A take can outlive a Space switch; so must the controls that stop it.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Best effort only. electron.d.ts @ 44.1.1 warns that ScreenCaptureKit-based
  // capturers — Chromium's included — capture the window regardless, and the
  // HUD has no composited twin drawn over it the way the bubble does. See
  // AUTO_HIDE above and README.md § "The recording HUD".
  win.setContentProtection(true);

  // A `-webkit-app-region: drag` gesture is handled by macOS, not by the page:
  // once the drag starts the renderer stops receiving `pointermove`, so the
  // idle timer that `hud.ts` feeds would fire mid-drag and hide the pill out
  // from under the cursor. The window's own move events are the interaction.
  win.on("move", () => noteHudInteraction());
  win.on("moved", () => noteHudInteraction());

  win.on("closed", () => {
    unregisterShellWebContents(wcId);
    hudWindow = null;
    hudLoaded = false;
  });

  hudLoaded = false;
  const onLoaded = (): void => {
    if (hudLoaded) return;
    hudLoaded = true;
    alive()?.webContents.send(IPC.hudApply, state);
    if (VISIBLE_DURING.has(state.status)) alive()?.showInactive();
  };
  win.once("ready-to-show", onLoaded);
  win.webContents.once("did-finish-load", onLoaded);

  const entry = rendererEntry();
  void (entry.url ? win.loadURL(entry.url) : win.loadFile(entry.file!));

  hudWindow = win;
  return win;
}

function clearAutoHide(): void {
  if (!autoHideTimer) return;
  clearTimeout(autoHideTimer);
  autoHideTimer = null;
}

/**
 * True while the pill has been deliberately hidden (idle auto-hide or the tray
 * toggle). `sync()` runs on every 4 Hz state push from the page and must not
 * undo that hide; only an interaction, a hotkey wake, the tray toggle, or a
 * status change clears it.
 */
let suppressed = false;

function armAutoHide(delayMs: number): void {
  clearAutoHide();
  if (!AUTO_HIDE) return;
  if (!VISIBLE_DURING.has(state.status)) return;
  autoHideTimer = setTimeout(() => {
    autoHideTimer = null;
    suppressed = true;
    alive()?.hide();
  }, delayMs);
}

/** Any interaction (hover, click) restarts the idle countdown. */
export function noteHudInteraction(): void {
  if (!AUTO_HIDE) return;
  if (!VISIBLE_DURING.has(state.status)) return;
  suppressed = false;
  const win = alive();
  if (win && !win.isVisible()) win.showInactive();
  armAutoHide(AUTO_HIDE_DELAY_MS);
}

/** A hotkey fired or the status moved: flash the pill back up briefly. */
export function wakeHud(): void {
  if (!AUTO_HIDE) return;
  if (!VISIBLE_DURING.has(state.status)) return;
  suppressed = false;
  alive()?.showInactive();
  armAutoHide(AUTO_HIDE_WAKE_MS);
}

/** Tray "Show controls" / "Hide controls". */
export function toggleHud(): void {
  const win = alive();
  if (!win) {
    if (VISIBLE_DURING.has(state.status)) sync();
    return;
  }
  if (win.isVisible()) {
    clearAutoHide();
    suppressed = true;
    win.hide();
  } else {
    suppressed = false;
    win.showInactive();
    armAutoHide(AUTO_HIDE_WAKE_MS);
  }
}

function sync(): void {
  if (!VISIBLE_DURING.has(state.status)) {
    clearAutoHide();
    suppressed = false;
    alive()?.hide();
    return;
  }
  const win = createHudWindow();
  win.webContents.send(IPC.hudApply, state);
  // Showing before the renderer has painted flashes an unstyled transparent
  // frame; `onLoaded` shows it itself once the first paint lands. A deliberate
  // hide (auto-hide / tray toggle) is respected until something wakes it.
  if (hudLoaded && !suppressed && !win.isVisible()) win.showInactive();
}

/**
 * Untrusted input: the payload comes from a renderer. A bad status would put
 * the pill in a state no branch handles, and a NaN elapsed would render "NaN".
 */
function parseHudState(value: unknown): HudState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const status = raw.status as HudStatus;
  if (!STATUSES.includes(status)) return null;
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  return {
    status,
    // 30 min cap mirrors the recorder's MAX_DURATION; countdown is 0–10.
    elapsedMs: Math.min(num(raw.elapsedMs), 30 * 60 * 1000),
    countdown: Math.min(num(raw.countdown), 10),
    markers: Math.round(num(raw.markers)),
  };
}

export function setHudState(next: HudState): void {
  const prev = state.status;
  const statusChanged = prev !== next.status;
  state = next;

  // The HUD push is the shell's only view of the recorder's state machine, so
  // it also drives the cursor sampler (no-ops unless the status moved).
  onRecorderStatus(next.status);

  if (statusChanged) {
    // A status change always un-suppresses the pill (wakeHud below re-arms).
    suppressed = false;
    // Loom-style disappearing act, decided by a pure function so it is
    // testable: see mapping.ts#recorderWindowVisibility.
    const action = recorderWindowVisibility(prev, next.status);
    if (action === "hide") hideRecorderWindow();
    else if (action === "show") showRecorderWindow();
  }

  sync();

  if (statusChanged) {
    wakeHud();
    onStatusChange?.();
  }
}

export function destroyHud(): void {
  stopCursorTracking();
  clearAutoHide();
  alive()?.destroy();
  hudWindow = null;
  hudLoaded = false;
  state = INITIAL;
}

const ACTIONS: readonly DesktopShortcut[] = [
  "toggle",
  "pause",
  "mark",
  "restart",
  "cancel",
];

export function installHudIpc(): void {
  ipcMain.on(IPC.setHudState, (_e, next: unknown) => {
    const parsed = parseHudState(next);
    if (!parsed) return;
    setHudState(parsed);
  });

  ipcMain.on(IPC.hudAction, (_e, action: unknown) => {
    if (!ACTIONS.includes(action as DesktopShortcut)) return;
    // Straight down the existing shortcut channel: the HUD's buttons and the
    // global hotkeys are the same remote-control actions, and the web app
    // already owns every status guard for them.
    sendToRecorder(IPC.shortcut, action as DesktopShortcut);
    noteHudInteraction();
  });

  ipcMain.on(IPC.hudInteract, () => noteHudInteraction());
}
