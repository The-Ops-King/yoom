import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, dialog, shell, systemPreferences } from "electron";

/**
 * macOS privacy panes. `x-apple.systempreferences:` URLs open System Settings
 * directly at the pane; the anchors below are stable across Ventura → Sequoia.
 */
const PANE = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  microphone:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  // macOS 14.2+ splits system-audio capture into its own entry.
  audio:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture",
  // The native input hook (`main/input.ts`). `Privacy_ListenEvent` is the
  // Input Monitoring pane; libuiohook's CGEventTap needs it, and on older
  // macOS it is Accessibility (`Privacy_Accessibility`) instead — the dialog
  // below names both because the pane that matters varies by version.
  input: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
} as const;

export type PaneKey = keyof typeof PANE;

export function openPrivacyPane(pane: PaneKey): void {
  void shell.openExternal(PANE[pane]);
}

/**
 * `systemPreferences.getMediaAccessStatus` accepts only
 * 'microphone' | 'camera' | 'screen' (electron.d.ts @ 44.1.1). There is no
 * queryable status for the macOS 14.2+ "System Audio Recording" entry, so the
 * only signal that it is missing is a silent, dead audio track — which is why
 * Task 21 checks the recording with `volumedetect` rather than trusting an API.
 */
export function screenAccess(): ReturnType<
  typeof systemPreferences.getMediaAccessStatus
> {
  if (process.platform !== "darwin") return "granted";
  return systemPreferences.getMediaAccessStatus("screen");
}

export function hasScreenAccess(): boolean {
  return screenAccess() === "granted";
}

/**
 * Camera and microphone CAN be prompted from code. Screen Recording cannot:
 * macOS raises its own prompt the first time `desktopCapturer.getSources`
 * actually captures, and after granting, the app must be relaunched.
 */
export async function requestMediaAccess(): Promise<{
  camera: boolean;
  microphone: boolean;
}> {
  if (process.platform !== "darwin") return { camera: true, microphone: true };
  const camera = await systemPreferences.askForMediaAccess("camera");
  const microphone = await systemPreferences.askForMediaAccess("microphone");
  return { camera, microphone };
}

export interface PermissionStatuses {
  screen: string;
  camera: string;
  microphone: string;
}

/** Everything the tray dialog and the launch check both need. */
export function permissionStatuses(): PermissionStatuses {
  if (process.platform !== "darwin") {
    return { screen: "granted", camera: "granted", microphone: "granted" };
  }
  return {
    screen: systemPreferences.getMediaAccessStatus("screen"),
    camera: systemPreferences.getMediaAccessStatus("camera"),
    microphone: systemPreferences.getMediaAccessStatus("microphone"),
  };
}

/**
 * Run once at launch. `askForMediaAccess` raises the macOS prompt the FIRST
 * time it is called for a given binary and resolves immediately with the
 * remembered answer afterwards, so this is cheap on every subsequent launch.
 *
 * Doing it here rather than lazily is the whole point: the web app's device
 * pickers enumerate on mount, and before a grant `enumerateDevices` returns
 * nothing usable — which is exactly the empty microphone list from the first
 * launch. `DeviceSelector` re-enumerates on the `devicechange` that a grant
 * fires, so the two halves meet.
 *
 * Screen Recording CANNOT be prompted from code — macOS raises it on the first
 * real capture and requires a relaunch — so it is only reported, with a deep
 * link into the right pane.
 */
export async function warmPermissionsAtLaunch(): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    await requestMediaAccess();
  } catch (err) {
    // A denial is a resolved `false`, not a throw; this is for the genuinely
    // unexpected, and must never take the launch down with it.
    console.warn("[yoom] askForMediaAccess failed", err);
  }

  if (hasScreenAccess()) return;

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Yoom needs Screen Recording access",
    message: "Screen Recording is not granted yet",
    detail: [
      "macOS cannot be asked for Screen Recording from inside an app. Grant",
      "Yoom under Privacy & Security → Screen Recording, then quit and",
      "relaunch Yoom — the grant does not take effect until you do.",
      "",
      "Camera and Microphone have been requested already; answer their prompts",
      "if they are still on screen.",
    ].join("\n"),
    buttons: ["Open System Settings", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) openPrivacyPane("screen");
}

/**
 * Shown from the tray's "Permissions…" item and from the capture handler when
 * Screen Recording is missing. Returns true when the user chose to open
 * System Settings.
 */
export async function showPermissionsDialog(): Promise<boolean> {
  const { screen, camera, microphone } = permissionStatuses();

  const detail = [
    `Screen Recording: ${screen}`,
    `Camera: ${camera}`,
    `Microphone: ${microphone}`,
    "",
    "System Audio Recording (macOS 14.2+) has no status API. If a recording",
    "has a silent audio track, grant Yoom under Privacy & Security → System",
    "Audio Recording and relaunch.",
    "",
    "macOS remembers these per app binary. An unsigned build gets a new",
    "identity every time it is rebuilt, so every rebuild re-prompts.",
  ].join("\n");

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Yoom permissions",
    message: "macOS privacy status",
    detail,
    buttons: ["Open Screen Recording", "Open System Audio", "Request Camera & Mic", "Close"],
    defaultId: 0,
    cancelId: 3,
  });

  if (response === 0) {
    openPrivacyPane("screen");
    return true;
  }
  if (response === 1) {
    openPrivacyPane("audio");
    return true;
  }
  if (response === 2) {
    await requestMediaAccess();
    return true;
  }
  return false;
}

// ---------- Input Monitoring (the global input hook) ----------

/**
 * Where "Not now" is remembered. `app.getPath('userData')` survives rebuilds,
 * which matters: an unsigned build gets a new TCC identity every time, so the
 * hook fails on every fresh build and without this the dialog would greet the
 * user at the top of every take.
 */
function inputHookPrefsPath(): string {
  return join(app.getPath("userData"), "input-hook.json");
}

/** One week. The permission is genuinely useful, so ask again — but rarely. */
const ASK_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

interface InputHookPrefs {
  /** Epoch ms of the last "Not now". */
  declinedAt?: number;
}

function readInputHookPrefs(): InputHookPrefs {
  try {
    const raw: unknown = JSON.parse(readFileSync(inputHookPrefsPath(), "utf8"));
    if (!raw || typeof raw !== "object") return {};
    const declinedAt = (raw as InputHookPrefs).declinedAt;
    return typeof declinedAt === "number" && Number.isFinite(declinedAt)
      ? { declinedAt }
      : {};
  } catch {
    // Missing (the common case, first run) or corrupt. Either way: never asked.
    return {};
  }
}

function writeInputHookPrefs(prefs: InputHookPrefs): void {
  try {
    writeFileSync(inputHookPrefsPath(), JSON.stringify(prefs), "utf8");
  } catch (err) {
    // A read-only userData directory must not take a take down. The only cost
    // is being asked again next time.
    console.warn("[yoom] could not remember the input-hook choice", err);
  }
}

/**
 * True when macOS considers this process trusted for Accessibility.
 *
 * `isTrustedAccessibilityClient(false)` CHECKS without prompting (passing true
 * raises the system prompt — electron.d.ts @ 44.1.1). It is a proxy, not the
 * answer: libuiohook's listen-only event tap is gated on Input Monitoring on
 * modern macOS and on Accessibility on older ones, and the two are separate
 * TCC entries. So this is only ever used to explain a hook that ALREADY
 * failed — the authoritative signal is `uIOhook.start()` throwing
 * `UIOHOOK_ERROR_AXAPI_DISABLED`.
 */
export function isTrustedForInput(): boolean {
  if (process.platform !== "darwin") return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

/**
 * Explain the input hook once (at most once a week if declined) and deep-link
 * the pane. Returns true when the user chose to open System Settings.
 *
 * Called only after the hook has actually failed to start, so the user never
 * sees this unless the feature is really unavailable. Everything degrades to
 * cursor-only either way — the click and key tracks simply do not exist, and
 * the staging editor hides the lanes that depend on them.
 */
export async function explainInputMonitoring(): Promise<boolean> {
  if (process.platform !== "darwin") return false;

  const { declinedAt } = readInputHookPrefs();
  if (declinedAt && Date.now() - declinedAt < ASK_AGAIN_AFTER_MS) return false;

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Yoom can track clicks and keystrokes",
    message: "Input Monitoring is not granted yet",
    detail: [
      "With it, Yoom marks where you clicked and which keys you pressed while",
      "recording, so the editor can add click ripples and keystroke badges",
      "(⌘ ⇧ K) to your video. Both are opt-in per range in the editor.",
      "",
      "The track stays on this Mac: it is held in memory for the take, never",
      "uploaded, and only ever leaves as pixels inside the rendered video.",
      "Yoom records key NAMES, never the text a key produced — so it cannot",
      "know, and cannot capture, what you type into a password field.",
      "",
      "Grant Yoom under Privacy & Security → Input Monitoring (Accessibility",
      "on older macOS), then start a new recording.",
      "",
      "Without it, recording still works — you just get the mouse-follow zoom",
      "and no click or key tracks.",
    ].join("\n"),
    buttons: ["Open System Settings", "Not now"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    openPrivacyPane("input");
    // Deliberately NOT remembered: they went to grant it, so the next failure
    // is worth explaining again (they may have granted the wrong pane).
    return true;
  }

  writeInputHookPrefs({ declinedAt: Date.now() });
  return false;
}
