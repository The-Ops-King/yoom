import { Menu, app, powerMonitor } from "electron";
import { installDesktopAuthHeader } from "./auth";
import { installCaptureIpc, installDisplayMediaHandler } from "./capture";
import { destroyBubble, installBubbleIpc } from "./bubble";
import { destroyHud, installHudIpc, onHudStatusChange } from "./hud";
import { warmPermissionsAtLaunch } from "./permissions";
import { installPickerIpc } from "./picker";
import { registerShortcuts, unregisterShortcuts } from "./shortcuts";
import { createTray, destroyTray, refreshTrayMenu } from "./tray";
import { quitRequestAction } from "./mapping";
import {
  createRecorderWindow,
  getRecorderWindow,
  hideRecorderWindow,
  isDeliberateQuit,
  isShutdownPending,
  markSystemShutdown,
  requestQuit,
  setQuitting,
  yoomSession,
} from "./windows";

/**
 * Escape hatch for the macOS 14.2+ CoreAudio Tap path. From the desktopCapturer
 * docs, §Caveats → "macOS versions 14.2 or higher": setting this feature flag
 * forces Chromium back onto the older "Screen & System Audio Recording"
 * permissions system. The exact name is `MacCatapLoopbackAudioForScreenShare`.
 * Only used when YOOM_LEGACY_AUDIO=1, because there is no fallback in the other
 * direction — if a tap fails, the audio track is silently dead.
 */
if (process.env.YOOM_LEGACY_AUDIO === "1") {
  app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}

// A second launch should surface the existing window, never start a second app
// holding the same tray icon and the same global shortcuts.
if (!app.requestSingleInstanceLock()) {
  // Deliberate: the losing instance must actually exit, not turn into a hide.
  requestQuit();
} else {
  app.on("second-instance", () => {
    createRecorderWindow();
  });

  app.whenReady().then(() => {
    // Lives in the menu bar AND the Dock: the tray is the fast path, but a
    // Dock icon is what makes the app findable and ⌘-Tab-able. Closing the
    // window keeps the app alive; a Dock click reopens it via `activate`.

    // installBubbleIpc() owns IPC.setBubbleVisible, IPC.setRecordingActive,
    // IPC.setBubbleAppearance and IPC.setCameraDevice; capture.ts calls
    // bubble.setCaptureKind() as soon as the picker resolves, so the live
    // bubble auto-hides for window captures (plan Amendment 1).
    installCaptureIpc();
    installPickerIpc();
    installBubbleIpc();
    installDisplayMediaHandler(yoomSession());
    // Before the first navigation: the shell signs itself in with a shared
    // secret, so the Mac app never shows the password gate.
    installDesktopAuthHeader(yoomSession());
    installHudIpc();
    // The tray menu mirrors the HUD's transport controls, so it has to
    // re-render whenever the take's status moves.
    onHudStatusChange(() => refreshTrayMenu());

    // Electron's default menu wires ⌘Q straight to a native quit, which
    // `before-quit` cannot tell apart from a third party's Apple Event. Own
    // the menu so ⌘Q goes through `requestQuit` like the tray does. The rest
    // mirrors the default menu the recorder page relies on (Edit for
    // copy/paste, View for DevTools, Window for minimise/zoom).
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { label: "Quit Yoom", accelerator: "Command+Q", click: () => requestQuit() },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );

    // Logout and shutdown arrive as the same Apple Event a third party would
    // send; this notification lands first and is what lets them through.
    powerMonitor.on("shutdown", () => markSystemShutdown());

    createTray();
    createRecorderWindow();
    registerShortcuts();
    refreshTrayMenu();

    // Fire-and-forget: the prompts are modal to the user, not to the app, and
    // nothing below depends on the answer. Camera and microphone are asked for
    // here so the web app's device pickers are not empty on first launch.
    void warmPermissionsAtLaunch();
  });

  // Dock click (and the tray's "Open recorder") reopen the recorder window.
  app.on("activate", () => {
    if (!getRecorderWindow()) createRecorderWindow();
  });

  // Closing the recorder window must NOT quit: the shell lives in the menu bar.
  app.on("window-all-closed", () => {
    destroyBubble();
    destroyHud();
    refreshTrayMenu();
  });

  // `before-quit` runs while the windows still exist; `will-quit` can run after
  // they are already gone. Destroying the camera-holding windows here is what
  // makes the macOS camera indicator go out at quit rather than at process exit.
  app.on("before-quit", (event) => {
    // A quit nobody asked for — a third party's `aevt/quit` (Vorssaint's Auto
    // Quit fires a few seconds into every take, once the recorder window is
    // hidden) — becomes a hide. The take, the HUD and the bubble all live on.
    if (quitRequestAction(isDeliberateQuit(), isShutdownPending()) === "hide") {
      event.preventDefault();
      hideRecorderWindow();
      return;
    }
    // Must come first: it is what lets the recorder window's
    // `will-prevent-unload` handler override the page's `beforeunload` guard.
    // Without it a quit requested while a take is live (or a staged blob is
    // still in memory) is silently cancelled by the renderer and the app never
    // exits — tray → "Quit Yoom" and ⌘Q both looked like dead menu items.
    setQuitting(true);
    destroyBubble();
    destroyHud();
  });

  app.on("will-quit", () => {
    unregisterShortcuts();
    destroyBubble();
    destroyHud();
    destroyTray();
  });
}
