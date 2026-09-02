import { Notification, ipcMain, type Session } from "electron";
import { IPC, type SurfacePref } from "../shared/ipc";
import { setCaptureKind } from "./bubble";
import { hasScreenAccess, openPrivacyPane } from "./permissions";
import { listSources, openPicker } from "./picker";

/**
 * The page announces a surface preference right before it calls
 * `getDisplayMedia`, so the picker knows which tab to open on. Kept as a plain
 * module variable with no expiry: the announcement and the request are two IPC
 * hops apart, and a stale preference only affects which tab is preselected.
 */
let surfacePref: SurfacePref = "monitor";

export function installCaptureIpc(): void {
  ipcMain.on(IPC.setSurfacePref, (_e, pref: SurfacePref) => {
    if (pref === "monitor" || pref === "window" || pref === "browser") surfacePref = pref;
  });
}

/**
 * `ses.setDisplayMediaRequestHandler` replaces Chrome's picker sheet with ours
 * and — the point of the whole shell — lets us hand back `audio: 'loopback'`.
 * (Electron session docs, §`ses.setDisplayMediaRequestHandler(handler[, opts])`.)
 *
 * `useSystemPicker` is deliberately left OFF: when the system picker is
 * available, "the handler will not be invoked" (same doc section), which would
 * take the loopback audio decision out of our hands entirely.
 */
export function installDisplayMediaHandler(ses: Session): void {
  ses.setDisplayMediaRequestHandler((request, callback) => {
    void (async () => {
      // macOS raises the Screen Recording prompt on the first real capture and
      // requires a relaunch afterwards, so guard rather than fail opaquely.
      if (!hasScreenAccess()) {
        new Notification({
          title: "Yoom needs Screen Recording access",
          body: "Grant it in System Settings → Privacy & Security, then relaunch Yoom.",
        }).show();
        openPrivacyPane("screen");
        callback({});
        return;
      }

      let sources;
      try {
        sources = await listSources();
      } catch (err) {
        console.error("[yoom] desktopCapturer.getSources failed", err);
        setCaptureKind("screen");
        callback({});
        return;
      }

      if (sources.length === 0) {
        setCaptureKind("screen");
        callback({});
        return;
      }

      const chosenId = await openPicker({
        sources,
        tab: surfacePref === "monitor" ? "screen" : "window",
        audioRequested: request.audioRequested,
      });

      const source = sources.find((s) => s.id === chosenId);
      if (!source) {
        // Cancelled: an empty callback surfaces as NotAllowedError in the page,
        // which the recorder already handles as "user dismissed the picker".
        // Reset so a stale `window` kind from a previous pick never survives
        // a cancelled reselect and mis-hides the bubble.
        setCaptureKind("screen");
        callback({});
        return;
      }

      // Amendment 1: self-occlusion only works for display captures, where the
      // composited bubble covers the same pixels the capture picked up of the
      // live window. Tell the bubble which kind of source won so it can hide
      // itself for `window` captures while the encoder runs.
      setCaptureKind(source.kind);

      callback({
        video: { id: source.id, name: source.name },
        // 'loopback' captures system audio. The session doc's one-line summary
        // still says Windows-only; the desktopCapturer Caveats section is
        // current and documents macOS 14.2+ support through Chromium's
        // CoreAudio Tap API (default since Electron v39.0.0-beta.4), gated on
        // the NSAudioCaptureUsageDescription Info.plist key.
        audio: request.audioRequested ? "loopback" : undefined,
      });
    })();
  });
}
