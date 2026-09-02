import { join } from "node:path";
import { BrowserWindow, ipcMain, screen } from "electron";
import {
  IPC,
  type BubbleAppearance,
  type BubbleShape,
  type BubbleSize,
} from "../shared/ipc";
import { bubbleCentreToNormalized, bubbleWindowSize, cycleShape } from "./mapping";
import {
  registerShellWebContents,
  sendToRecorder,
  unregisterShellWebContents,
  yoomSession,
} from "./windows";

const HIDE_WHILE_RECORDING = process.env.YOOM_BUBBLE_HIDE_WHILE_RECORDING === "1";

let bubbleWindow: BrowserWindow | null = null;
let cameraDeviceId: string | null = null;
/** The user's own bubble toggle, mirrored from the web app's BubbleConfig. */
let appearance: BubbleAppearance = {
  shape: "circle",
  size: "medium",
  mirror: true,
  visible: true,
  framed: false,
};
/** Status-driven: true while the recorder is in setup/countdown/recording/paused. */
let shellVisible = false;
/** True while the encoder is running (status `recording` or `paused`). */
let recordingActive = false;
/**
 * Amendment 1: the kind of source the picker resolved to. Self-occlusion only
 * works for `screen` captures, where the composited bubble covers the same
 * pixels the capture picked up of the live window. For `window` captures the
 * live window is either absent from the frame or lands somewhere unrelated, so
 * it is hidden for the duration of the recording.
 */
let captureKind: "screen" | "window" = "screen";
/** Suppresses the move→IPC echo while WE are the ones moving the window. */
let applyingBounds = false;
/** True once the current bubble window has painted its first frame. */
let bubbleLoaded = false;
/** Coalesces `moved` bursts into at most one `reportPosition` IPC per frame. */
let reportPositionTimer: ReturnType<typeof setTimeout> | null = null;

function alive(): BrowserWindow | null {
  return bubbleWindow && !bubbleWindow.isDestroyed() ? bubbleWindow : null;
}

function rendererEntry(): { url?: string; file?: string } {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) return { url: `${devUrl}/bubble/index.html` };
  return { file: join(__dirname, "../renderer/bubble/index.html") };
}

/** The display the bubble currently sits on (or the primary one). */
function currentDisplay() {
  const win = alive();
  if (!win) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(win.getBounds());
}

function reportPosition(): void {
  const win = alive();
  if (!win || applyingBounds) return;
  const display = currentDisplay();
  // Both getBounds() and display.bounds are in device-independent pixels, so
  // the display's scaleFactor cancels and the normalized result is
  // DPR-invariant. See mapping.ts.
  const pos = bubbleCentreToNormalized(win.getBounds(), display.bounds);
  sendToRecorder(IPC.bubbleMoved, pos);
}

/**
 * `moved` fires far more often than once per frame while the user drags the
 * bubble — coalesce those bursts into at most one `reportPosition` IPC per
 * ~16ms so the renderer isn't flooded with redundant position updates.
 */
function scheduleReportPosition(): void {
  if (reportPositionTimer) return;
  reportPositionTimer = setTimeout(() => {
    reportPositionTimer = null;
    reportPosition();
  }, 16);
}

function applySize(): void {
  const win = alive();
  if (!win) return;
  const display = currentDisplay();
  const { width, height } = bubbleWindowSize(
    appearance.shape,
    appearance.size,
    display.bounds.width,
    appearance.cameraAspect,
  );
  const bounds = win.getBounds();
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  applyingBounds = true;
  win.setBounds({
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
    width,
    height,
  });
  // macOS emits `moved`/`resized` asynchronously after setBounds, so clearing
  // the flag synchronously would let our own resize echo back as a user drag.
  setTimeout(() => {
    applyingBounds = false;
  }, 0);
  // The centre is unchanged by a resize, but the clamped normalized value can
  // move when the window grows past a display edge, so resync.
  reportPosition();
}

function createBubbleWindow(): BrowserWindow {
  const existing = alive();
  if (existing) return existing;

  const display = screen.getPrimaryDisplay();
  const { width, height } = bubbleWindowSize(
    appearance.shape,
    appearance.size,
    display.bounds.width,
    appearance.cameraAspect,
  );
  // Default position: bottom-right of the primary display with a 48px inset.
  const x = display.bounds.x + display.bounds.width - width - 48;
  const y = display.bounds.y + display.bounds.height - height - 48;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
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
    // `focusable: false` would kill the drag region, so the window stays
    // focusable and simply never takes keyboard input.
    acceptFirstMouse: true,
    webPreferences: {
      // Same session the permission handlers are installed on, otherwise the
      // shell-origin branch of installPermissionHandlers never runs and this
      // window's getUserMedia is only allowed by default-session accident.
      session: yoomSession(),
      preload: join(__dirname, "../preload/bubble.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Amendment 3: the permission handler recognises this renderer so its
  // getUserMedia is allowed even though it is not the app origin.
  const wcId = win.webContents.id;
  registerShellWebContents(wcId);
  // The bubble never legitimately opens a new window; deny anything that tries.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // 'floating' keeps the bubble above ordinary windows without fighting menus
  // and panels the way 'screen-saver' does.
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // macOS: sets NSWindowSharingNone. electron.d.ts @ 44.1.1 warns that newer
  // ScreenCaptureKit-based capturers — Chromium's included — capture the window
  // anyway. Applied regardless (it does exclude us from other tools), but the
  // real defence is that the composited bubble is drawn over the same rect.
  win.setContentProtection(true);

  win.on("moved", scheduleReportPosition);
  win.on("resized", reportPosition);
  win.on("closed", () => {
    unregisterShellWebContents(wcId);
    bubbleWindow = null;
  });

  bubbleLoaded = false;
  const onLoaded = (): void => {
    if (bubbleLoaded) return;
    bubbleLoaded = true;
    if (shouldShow()) alive()?.showInactive();
  };
  win.once("ready-to-show", () => {
    win.webContents.send(IPC.bubbleApply, appearance);
    win.webContents.send(IPC.bubbleCamera, cameraDeviceId);
    onLoaded();
  });
  win.webContents.once("did-finish-load", onLoaded);

  const entry = rendererEntry();
  void (entry.url ? win.loadURL(entry.url) : win.loadFile(entry.file!));

  bubbleWindow = win;
  return win;
}

function shouldShow(): boolean {
  if (!shellVisible) return false;
  if (!appearance.visible) return false;
  // `full` is camera-only mode: the whole canvas is the camera, so a floating
  // desktop overlay makes no sense.
  if (appearance.shape === "full") return false;
  // Amendment 1: hide while the encoder runs when self-occlusion cannot work —
  // either because the operator forced it, or because a window capture cannot
  // be occluded by a bubble composited at display-normalized coordinates.
  // Framed capture enlarges the canvas and insets the screen inside it, so the
  // composited bubble lands somewhere the live window is not — same failure
  // mode as a window capture.
  if (
    recordingActive &&
    (HIDE_WHILE_RECORDING || captureKind === "window" || appearance.framed)
  ) {
    return false;
  }
  return true;
}

function sync(): void {
  if (!shouldShow()) {
    alive()?.hide();
    return;
  }
  const win = createBubbleWindow();
  win.webContents.send(IPC.bubbleApply, appearance);
  win.webContents.send(IPC.bubbleCamera, cameraDeviceId);
  applySize();
  // showInactive keeps focus in the recorder window when the bubble appears.
  // Showing before the renderer has painted flashes an unstyled/transparent
  // frame, so a not-yet-loaded window is left hidden here — `onLoaded` shows
  // it itself once `did-finish-load`/`ready-to-show` fires.
  if (bubbleLoaded) win.showInactive();
  reportPosition();
}

export function setBubbleAppearance(next: BubbleAppearance): void {
  appearance = next;
  if (!shouldShow()) {
    alive()?.hide();
    return;
  }
  // `sync()` already calls `applySize()`, so shape/size changes need no
  // second pass here.
  sync();
}

export function setBubbleVisible(visible: boolean): void {
  shellVisible = visible;
  sync();
}

/**
 * The escape hatch for the double-bubble artefact: with
 * YOOM_BUBBLE_HIDE_WHILE_RECORDING=1 the live window disappears once the
 * encoder starts and only the composited bubble remains. Amendment 1 makes the
 * same thing happen unconditionally for `window` captures, where the two
 * rectangles cannot coincide — `shouldShow()` is the single place that decides.
 */
export function setRecordingActive(active: boolean): void {
  if (recordingActive === active) return;
  recordingActive = active;
  sync();
}

/**
 * Called by `capture.ts` the moment the picker resolves, before the page's
 * stream starts. See `shouldShow()`.
 */
export function setCaptureKind(kind: "screen" | "window"): void {
  if (captureKind === kind) return;
  captureKind = kind;
  sync();
}

export function setCameraDevice(deviceId: string | null): void {
  cameraDeviceId = deviceId;
  alive()?.webContents.send(IPC.bubbleCamera, cameraDeviceId);
}

export function destroyBubble(): void {
  const win = alive();
  win?.destroy();
  bubbleWindow = null;
}

const SHAPES: readonly BubbleShape[] = ["circle", "rounded", "square", "portrait", "full"];
const SIZES: readonly BubbleSize[] = ["small", "medium", "large"];

/**
 * IPC payloads come from a renderer, so they are untrusted input. An unknown
 * shape or size would index the mapping tables to `undefined` and produce NaN
 * window bounds; a malformed message is dropped instead.
 */
function parseAppearance(value: unknown): BubbleAppearance | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const shape = raw.shape as BubbleShape;
  const size = raw.size as BubbleSize;
  if (!SHAPES.includes(shape)) return null;
  if (!SIZES.includes(size)) return null;
  const cameraAspect =
    typeof raw.cameraAspect === "number" && Number.isFinite(raw.cameraAspect) && raw.cameraAspect > 0
      ? raw.cameraAspect
      : undefined;
  return {
    shape,
    size,
    mirror: !!raw.mirror,
    visible: !!raw.visible,
    framed: !!raw.framed,
    ...(cameraAspect !== undefined ? { cameraAspect } : {}),
  };
}

export function installBubbleIpc(): void {
  ipcMain.on(IPC.setBubbleAppearance, (_e, next: unknown) => {
    const parsed = parseAppearance(next);
    if (!parsed) return;
    setBubbleAppearance(parsed);
  });
  ipcMain.on(IPC.setBubbleVisible, (_e, visible: boolean) => {
    setBubbleVisible(!!visible);
  });
  ipcMain.on(IPC.setRecordingActive, (_e, active: boolean) => {
    setRecordingActive(!!active);
  });
  ipcMain.on(IPC.setCameraDevice, (_e, deviceId: string | null) => {
    setCameraDevice(typeof deviceId === "string" && deviceId ? deviceId : null);
  });

  // The bubble's own control strip talks back. Both actions are mirrored into
  // the web app by echoing a new appearance, which the web app then persists.
  ipcMain.on(IPC.bubbleRequestHide, () => {
    setBubbleAppearance({ ...appearance, visible: false });
    sendToRecorder(IPC.setBubbleAppearance, { ...appearance, visible: false });
  });
  ipcMain.on(IPC.bubbleCycleShape, () => {
    const shape: BubbleShape = cycleShape(appearance.shape);
    const next = { ...appearance, shape };
    setBubbleAppearance(next);
    sendToRecorder(IPC.setBubbleAppearance, next);
  });
}
