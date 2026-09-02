import { getDesktopBridge } from "./desktop-bridge";
import type {
  Capabilities,
  DisplayCapture,
  MediaSourceProvider,
  SurfacePref,
} from "./types";

/**
 * `getDisplayMedia` constraints. Pure so it can be asserted in a node test.
 * Chrome only treats `displaySurface` as a hint that pre-selects a tab in the
 * picker; the user can still pick anything, which is why the caller reads the
 * real surface back off the track.
 */
export function displayConstraints(pref: SurfacePref): DisplayMediaStreamOptions &
  Record<string, unknown> {
  return {
    video: {
      displaySurface: pref,
      frameRate: { ideal: 60 },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    systemAudio: "include",
    surfaceSwitching: "include",
    // For tab capture the user may legitimately want to share the recorder's
    // own tab (e.g. a slide deck open next to it); for screens/windows we hide
    // it to avoid the infinity-mirror.
    selfBrowserSurface: pref === "browser" ? "include" : "exclude",
    preferCurrentTab: false,
  };
}

export function cameraConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    frameRate: { ideal: 60, min: 30 },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

export function micConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

export function readSurface(
  settings: Pick<MediaTrackSettings, "displaySurface"> | Record<string, unknown>,
): SurfacePref | "unknown" {
  const s = (settings as { displaySurface?: string }).displaySurface;
  if (s === "monitor" || s === "window" || s === "browser") return s;
  return "unknown";
}

/**
 * What the *browser* can do. macOS Chrome only delivers system audio for tab
 * captures (an OS restriction); Windows Chrome delivers it for screens and
 * windows too; Safari and Firefox deliver none.
 */
export function browserCapabilities(userAgent: string): Capabilities {
  const ua = userAgent;
  const isFirefox = /Firefox\//.test(ua);
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua);
  const isMac = /Macintosh|Mac OS X/.test(ua);

  let systemAudio: Capabilities["systemAudio"] = "full";
  if (isFirefox || isSafari) systemAudio = "none";
  else if (isMac) systemAudio = "tab-only";

  return {
    systemAudio,
    nativePicker: false,
    surfaceHints: !isFirefox && !isSafari,
  };
}

function mediaDevices(): MediaDevices {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    throw new Error("This browser cannot capture media.");
  }
  return navigator.mediaDevices;
}

export const browserProvider: MediaSourceProvider = {
  async getDisplay(pref: SurfacePref): Promise<DisplayCapture> {
    const stream = await mediaDevices().getDisplayMedia(
      displayConstraints(pref) as DisplayMediaStreamOptions,
    );
    const track = stream.getVideoTracks()[0];
    return {
      stream,
      surface: track ? readSurface(track.getSettings()) : "unknown",
      hasSystemAudio: stream.getAudioTracks().length > 0,
    };
  },

  getCamera(deviceId?: string): Promise<MediaStream> {
    // Never ask for audio here — the mic is always its own stream so the mixer
    // owns it and a camera restart cannot drop the microphone.
    return mediaDevices().getUserMedia({
      video: cameraConstraints(deviceId),
      audio: false,
    });
  },

  getMic(deviceId?: string): Promise<MediaStream> {
    return mediaDevices().getUserMedia({ audio: micConstraints(deviceId), video: false });
  },

  async warmPermissions(kind: "audioinput" | "videoinput"): Promise<void> {
    try {
      const stream = await mediaDevices().getUserMedia(
        kind === "audioinput" ? { audio: true } : { video: true },
      );
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Denied — device labels stay blank, which the picker handles.
    }
  },

  async enumerateDevices(kind: "audioinput" | "videoinput"): Promise<MediaDeviceInfo[]> {
    const all = await mediaDevices().enumerateDevices();
    return all.filter((d) => d.kind === kind);
  },

  capabilities(): Capabilities {
    const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
    return browserCapabilities(ua);
  },
};

/**
 * The provider the whole app uses. Electron's preload supplies overrides for
 * `getDisplay` (native picker + CoreAudio loopback) and `capabilities`.
 */
export function getProvider(): MediaSourceProvider {
  const bridge = getDesktopBridge();
  if (!bridge) return browserProvider;

  // A partial bridge shouldn't clobber a working browser method with `undefined`.
  const bridgeOverrides = Object.fromEntries(
    Object.entries(bridge.mediaSources ?? {}).filter(([, v]) => v !== undefined),
  );
  const merged: MediaSourceProvider = { ...browserProvider, ...bridgeOverrides };

  // `contextBridge` cannot carry a `MediaStream` across worlds, so the shell
  // never implements `getDisplay` itself. It only needs to know which tab the
  // native picker should open on, which this announcement provides. The page
  // still creates the stream; Electron's `setDisplayMediaRequestHandler`
  // intercepts it in the main process.
  if (bridge.setSurfacePref && !bridgeOverrides.getDisplay) {
    const announce = bridge.setSurfacePref.bind(bridge);
    const inner = merged.getDisplay;
    merged.getDisplay = (pref: SurfacePref) => {
      try {
        announce(pref);
      } catch {
        // A dead IPC channel must never block the capture.
      }
      return inner(pref);
    };
  }

  if (bridge.capabilities) {
    const overrides = bridge.capabilities;
    const base =
      bridge.mediaSources?.capabilities?.bind(bridge.mediaSources) ??
      browserProvider.capabilities;
    merged.capabilities = () => ({ ...base(), ...overrides });
  }

  return merged;
}
