import { dialog, shell, systemPreferences } from "electron";

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

/**
 * Shown from the tray's "Permissions…" item and from the capture handler when
 * Screen Recording is missing. Returns true when the user chose to open
 * System Settings.
 */
export async function showPermissionsDialog(): Promise<boolean> {
  const screen = screenAccess();
  const camera =
    process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("camera")
      : "granted";
  const microphone =
    process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("microphone")
      : "granted";

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
