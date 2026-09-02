import { app } from "electron";
import { installCaptureIpc, installDisplayMediaHandler } from "./capture";
import { destroyBubble, installBubbleIpc } from "./bubble";
import { installPickerIpc } from "./picker";
import { registerShortcuts, unregisterShortcuts } from "./shortcuts";
import { createTray, destroyTray, refreshTrayMenu } from "./tray";
import { createRecorderWindow, getRecorderWindow, yoomSession } from "./windows";

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
  app.quit();
} else {
  app.on("second-instance", () => {
    createRecorderWindow();
  });

  app.whenReady().then(() => {
    // Menu-bar only. Pairs with LSUIElement: true in electron-builder.yml so
    // the packaged app has no dock icon and no app switcher entry either.
    app.dock?.hide();

    // installBubbleIpc() owns IPC.setBubbleVisible, IPC.setRecordingActive,
    // IPC.setBubbleAppearance and IPC.setCameraDevice; capture.ts calls
    // bubble.setCaptureKind() as soon as the picker resolves, so the live
    // bubble auto-hides for window captures (plan Amendment 1).
    installCaptureIpc();
    installPickerIpc();
    installBubbleIpc();
    installDisplayMediaHandler(yoomSession());

    createTray();
    createRecorderWindow();
    registerShortcuts();
    refreshTrayMenu();
  });

  // With no dock icon there is no dock click to reopen from, but the tray's
  // "Open recorder" goes through the same path.
  app.on("activate", () => {
    if (!getRecorderWindow()) createRecorderWindow();
  });

  // Closing the recorder window must NOT quit: the shell lives in the menu bar.
  app.on("window-all-closed", () => {
    destroyBubble();
    refreshTrayMenu();
  });

  // `before-quit` runs while the windows still exist; `will-quit` can run after
  // they are already gone. Destroying the camera-holding windows here is what
  // makes the macOS camera indicator go out at quit rather than at process exit.
  app.on("before-quit", () => {
    destroyBubble();
  });

  app.on("will-quit", () => {
    unregisterShortcuts();
    destroyBubble();
    destroyTray();
  });
}
