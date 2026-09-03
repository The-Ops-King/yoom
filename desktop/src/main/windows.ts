import { join } from "node:path";
import { BrowserWindow, dialog, session, shell, type Session } from "electron";

/**
 * The web app the shell wraps. `YOOM_APP_URL` overrides for staging;
 * `YOOM_DEV=1` points at the local Next dev server.
 */
export function appUrl(): string {
  const override = process.env.YOOM_APP_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  if (process.env.YOOM_DEV === "1") return "http://localhost:3000";
  return "https://yoom.jtylerray.com";
}

export function appOrigin(): string {
  return new URL(appUrl()).origin;
}

/**
 * The origin our OWN renderers (picker, bubble) load from: `file://` for a
 * packaged build, the electron-vite dev server under `npm run dev`.
 * `new URL("file:///…").origin` is the string "null", so match on the scheme.
 */
function shellOrigins(): string[] {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  return devUrl ? [new URL(devUrl).origin] : [];
}

/**
 * True for a URL loaded by the picker or bubble window. Amendment 3: without
 * this the bubble's `getUserMedia` is denied by the handler below.
 */
export function isShellUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith("file://")) return true;
  try {
    return shellOrigins().includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Belt-and-braces companion to `isShellUrl`: the picker and bubble register
 * their `webContents.id` so the permission handler can recognise them even
 * before their document URL has settled.
 */
const shellWebContentsIds = new Set<number>();

export function registerShellWebContents(id: number): void {
  shellWebContentsIds.add(id);
}

export function unregisterShellWebContents(id: number): void {
  shellWebContentsIds.delete(id);
}

/**
 * `persist:` makes the partition survive a relaunch, which is the whole point:
 * the 30-day `yoom_session` cookie set by /api/auth lives here.
 * (Electron session docs, §`session.fromPartition(partition[, options])`.)
 */
export function yoomSession(): Session {
  return session.fromPartition("persist:yoom");
}

let recorderWindow: BrowserWindow | null = null;

/**
 * True once `app.quit()` is under way. See the `will-prevent-unload` handler in
 * `createRecorderWindow`: the recorder page arms a `beforeunload` guard while a
 * take (or a staged blob) is alive, and that guard has to be honoured for an
 * ordinary window close but ignored for a deliberate Quit.
 */
let quitting = false;

export function setQuitting(value: boolean): void {
  quitting = value;
}

export function getRecorderWindow(): BrowserWindow | null {
  return recorderWindow && !recorderWindow.isDestroyed() ? recorderWindow : null;
}

/** Send a message to the recorder renderer if it exists. */
export function sendToRecorder(channel: string, payload?: unknown): void {
  getRecorderWindow()?.webContents.send(channel, payload);
}

function installNavigationGuard(win: BrowserWindow): void {
  const origin = appOrigin();

  win.webContents.on("will-navigate", (event, url) => {
    let navOrigin: string;
    try {
      navOrigin = new URL(url).origin;
    } catch {
      // Malformed/unparseable URL — never let it through to the recorder.
      event.preventDefault();
      return;
    }
    if (navOrigin !== origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Anything that would open a new window — target=_blank, window.open — goes
  // to the user's browser instead of an unguarded Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

/**
 * Media and screen capture are granted ONLY to the app origin and to our own
 * picker/bubble renderers. Everything else (geolocation, notifications, USB, …)
 * is denied outright.
 * (Electron session docs, §`ses.setPermissionRequestHandler(handler)`.)
 */
export function installPermissionHandlers(ses: Session): void {
  const origin = appOrigin();

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const requesting = details.requestingUrl ?? "";
    let requestingOrigin = "";
    try {
      requestingOrigin = requesting ? new URL(requesting).origin : "";
    } catch {
      requestingOrigin = "";
    }

    const isApp = requestingOrigin === origin;
    // Amendment 3: the bubble renderer needs `media` for its own camera
    // preview, and it loads from file:// (prod) or the dev server (dev).
    const isShell =
      isShellUrl(requesting) ||
      isShellUrl(wc?.getURL()) ||
      (wc ? shellWebContentsIds.has(wc.id) : false);

    const allowed =
      (isApp && (permission === "media" || permission === "display-capture")) ||
      (isShell && permission === "media");
    callback(allowed);
  });

  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (requestingOrigin === origin) {
      return permission === "media" || permission === "display-capture";
    }
    const isShell =
      isShellUrl(wc?.getURL()) || (wc ? shellWebContentsIds.has(wc.id) : false);
    return isShell && permission === "media";
  });
}

export function createRecorderWindow(): BrowserWindow {
  const existing = getRecorderWindow();
  if (existing) {
    existing.show();
    existing.focus();
    return existing;
  }

  const ses = yoomSession();
  installPermissionHandlers(ses);

  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: "Yoom",
    backgroundColor: "#171717",
    // A real title bar: the web page defines no `-webkit-app-region: drag`
    // strip, so a hidden title bar left the window impossible to move.
    titleBarStyle: "default",
    webPreferences: {
      session: ses,
      preload: join(__dirname, "../preload/app.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // The recorder paints a 4K canvas at 60fps; leaving background
      // throttling on stalls the compositor the moment the window loses focus.
      backgroundThrottling: false,
    },
  });

  installNavigationGuard(win);

  /**
   * `use-recorder.ts` arms a `beforeunload` guard for every status that owns
   * unsaved bytes — recording, paused, stopping, rendering, uploading, and
   * `staging` with a blob. In Electron a prevented unload silently CANCELS the
   * window close, and a cancelled close aborts `app.quit()`: that is why tray →
   * "Quit Yoom" and ⌘Q did nothing while a take sat in staging.
   *
   * Per the webContents docs, calling `event.preventDefault()` here "will
   * ignore the `beforeunload` event handler and allow the page to be unloaded".
   *
   * A quit takes that path unconditionally — `before-quit` sets the flag, and
   * the tray's Quit is already a deliberate "I am done" gesture.
   *
   * A plain window close does NOT. Electron shows nothing of its own for a
   * prevented unload, so the traffic-light × just silently did nothing while a
   * take or a staged blob was alive, which read as a broken button. Ask
   * instead. `showMessageBoxSync` because this handler is synchronous: the
   * answer has to be known before it returns.
   *
   * Closing is a real close for this window — there is no `close` handler
   * turning it into a hide, and `window-all-closed` deliberately does not quit
   * (the shell lives in the menu bar, and the tray reopens the recorder). So
   * "Discard take" lets the window be destroyed, exactly as it would be with
   * no guard armed.
   */
  win.webContents.on("will-prevent-unload", (event) => {
    if (quitting) {
      event.preventDefault();
      return;
    }
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Discard take", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: "Discard the current take?",
      detail: "The recording and any staging edits will be lost.",
    });
    if (choice === 0) event.preventDefault();
  });

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    recorderWindow = null;
  });

  void win.loadURL(appUrl());
  recorderWindow = win;
  return win;
}

/** Tray "Open recorder" and the ⌘⇧L fallback both use this. */
export function toggleRecorderWindow(): void {
  const win = getRecorderWindow();
  if (!win) {
    createRecorderWindow();
    return;
  }
  if (win.isVisible() && win.isFocused()) win.hide();
  else {
    win.show();
    win.focus();
  }
}

/**
 * Loom-style "the app disappears". The window is HIDDEN, never closed: the
 * MediaRecorder, the compositor's RAF loop and the `beforeunload` guard all
 * live in that renderer, and closing it would throw the take away. The window
 * already sets `backgroundThrottling: false`, which is what keeps a hidden
 * window compositing at full rate.
 */
export function hideRecorderWindow(): void {
  const win = getRecorderWindow();
  if (win?.isVisible()) win.hide();
}

/** Bring the recorder window back at the end of a take. */
export function showRecorderWindow(): void {
  const win = getRecorderWindow();
  if (!win) return;
  win.show();
  win.focus();
}
