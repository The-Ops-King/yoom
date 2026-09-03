import { Notification, ipcMain, type Session } from "electron";
import { IPC, type HudStatus, type ShareMode, type SurfacePref } from "../shared/ipc";
import { setCaptureKind } from "./bubble";
import { displayIdFromSourceId } from "./cursor-track";
import { hasScreenAccess, openPrivacyPane } from "./permissions";
import { listSources, openPicker, rememberLastSource, resolveLastSource } from "./picker";
import { autoShareSource } from "./share";
import { sendToRecorder } from "./windows";

/**
 * The page announces a surface preference right before it calls
 * `getDisplayMedia`, so the picker knows which tab to open on. Kept as a plain
 * module variable with no expiry: the announcement and the request are two IPC
 * hops apart, and a stale preference only affects which tab is preselected.
 */
let surfacePref: SurfacePref = "monitor";

/**
 * The display id behind the chosen capture source, or null when the capture is
 * a window (or nothing is being captured). Written the moment the picker
 * resolves, read by `cursor.ts` to decide which display's bounds the cursor
 * samples normalize against — window captures produce no cursor track at all.
 */
let currentCaptureDisplayId: number | null = null;

export function captureDisplayId(): number | null {
  return currentCaptureDisplayId;
}

/**
 * How the next display-media request is answered. `"auto"` is the default so a
 * shell whose page never sends `setShareMode` — an older build of the web app —
 * still gets the Loom-like behaviour, and so the very first request after
 * launch is already ready. See `share.ts`.
 */
let shareMode: ShareMode = "auto";

/**
 * The one-shot behind `IPC.changeShare`. Consumed only once a source has
 * actually been resolved, so a cancelled "Change" still opens the picker on
 * the next attempt instead of silently re-sharing the old source.
 */
let forcePick = false;

/** The source announced to the page on `IPC.shareSource`, so `null` is sent once. */
let announced: { id: string; name: string; kind: "screen" | "window" } | null = null;

/** Kept next to `setCaptureKind` so the two never drift apart. */
function setCaptureSource(
  source: { id: string; name: string; kind: "screen" | "window" } | null,
): void {
  setCaptureKind(source?.kind ?? "screen");
  currentCaptureDisplayId =
    source && source.kind === "screen" ? displayIdFromSourceId(source.id) : null;

  // Tell the page what it is sharing, so it can name the source and offer a
  // "Change" button — with auto-share there is no picker to have shown it.
  if (!source && !announced) return;
  announced = source && { id: source.id, name: source.name, kind: source.kind };
  sendToRecorder(IPC.shareSource, announced);
}

/** Statuses during which a capture is live; anything else has ended the take. */
const CAPTURING: ReadonlySet<HudStatus> = new Set([
  "countdown",
  "recording",
  "paused",
  "stopping",
]);

/**
 * Called from `hud.ts` on every state push, next to the cursor and input
 * trackers: the HUD push is the shell's only view of the recorder's state
 * machine, and the end of a take is when the page drops its display track.
 * Clears the announced source so the page's "Sharing…" line does not outlive
 * the stream it describes.
 */
export function updateShareStatus(status: HudStatus): void {
  if (CAPTURING.has(status)) return;
  if (announced) setCaptureSource(null);
}

export function installCaptureIpc(): void {
  ipcMain.on(IPC.setSurfacePref, (_e, pref: SurfacePref) => {
    if (pref === "monitor" || pref === "window" || pref === "browser") surfacePref = pref;
  });
  ipcMain.on(IPC.setShareMode, (_e, mode: unknown) => {
    if (mode === "auto" || mode === "pick") shareMode = mode;
  });
  ipcMain.on(IPC.changeShare, () => {
    forcePick = true;
  });
}

/** The shape of the callback Electron hands `setDisplayMediaRequestHandler`. */
type StreamsCallback = (streams: Electron.Streams) => void;

/**
 * Deny a display-media request without throwing.
 *
 * Electron's native `DisplayMediaDeviceChosen`
 * (shell/browser/electron_browser_context.cc) branches on the first argument:
 * a null/undefined/absent one fails the request quietly with
 * `INVALID_DISPLAY_CAPTURE_CONSTRAINTS`, which is the documented "deny". An
 * empty object gets past that check and falls through to
 * `video_requested && !has_video`, which calls
 * `ThrowTypeError("Video was requested, but no video stream was provided")` —
 * the `UnhandledPromiseRejectionWarning` this handler used to log on every
 * cancelled picker.
 *
 * The published callback type is `(streams: Streams) => void` with no way to
 * express "no streams", hence the cast; the runtime contract is the one above.
 * Either way the page sees an `AbortError`, which `isCaptureCancellation` in
 * the web app treats as "the user backed out" — including for the permission
 * branch below, where the macOS notification is the real message.
 */
function deny(callback: StreamsCallback): void {
  (callback as unknown as (streams: Electron.Streams | null) => void)(null);
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
        deny(callback);
        return;
      }

      let sources;
      try {
        sources = await listSources();
      } catch (err) {
        console.error("[yoom] desktopCapturer.getSources failed", err);
        setCaptureSource(null);
        deny(callback);
        return;
      }

      if (sources.length === 0) {
        setCaptureSource(null);
        deny(callback);
        return;
      }

      // Ready to record the moment the app opens: in `"auto"` mode the source
      // recorded last time answers the request outright and no picker is ever
      // shown. Falls through to the picker in `"pick"` mode, for the one-shot
      // "Change" button, and when nothing is remembered or the remembered
      // source is gone (unplugged monitor, closed window).
      const last = resolveLastSource(sources);
      let source = autoShareSource({ mode: shareMode, forcePick, last });

      if (!source) {
        const chosenId = await openPicker({
          sources,
          tab: surfacePref === "monitor" ? "screen" : "window",
          audioRequested: request.audioRequested,
          // The picker preselects this if it is in the tab that opens; the
          // page's surface preference still decides which tab that is.
          lastSourceId: last?.id ?? null,
        });
        source = sources.find((s) => s.id === chosenId) ?? null;
      }

      if (!source) {
        // Cancelled: `deny` surfaces as AbortError in the page, which the
        // recorder handles as "user dismissed the picker" and returns to idle.
        // Reset so a stale `window` kind from a previous pick never survives
        // a cancelled reselect and mis-hides the bubble. `forcePick` is left
        // armed so the next attempt opens the picker again rather than
        // auto-sharing the source the user was trying to change away from.
        setCaptureSource(null);
        deny(callback);
        return;
      }

      // The "Change" one-shot has now produced a source; back to auto.
      forcePick = false;

      // Amendment 1: self-occlusion only works for display captures, where the
      // composited bubble covers the same pixels the capture picked up of the
      // live window. Tell the bubble which kind of source won so it can hide
      // itself for `window` captures while the encoder runs. The same call
      // records the display id for `cursor.ts`.
      setCaptureSource(source);
      // Remembered only once the pick has survived every guard above, so a
      // cancelled or denied attempt never becomes next take's default.
      rememberLastSource({ id: source.id, name: source.name, kind: source.kind });

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
