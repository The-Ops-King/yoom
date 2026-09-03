import type { Marker } from "@/lib/edits";
import { DEFAULT_SETTINGS } from "./settings";
import type {
  BubbleConfig,
  FrameConfig,
  RecorderSettings,
  RecordingMode,
  SurfacePref,
} from "./types";

/** The countdown a fresh take gets: "3 · Ready? · Go!". */
export const COUNTDOWN_SECONDS = 3;
/**
 * The countdown a restart gets: "Ready? · Go!". Short on purpose — the user is
 * already set up and mid-flow, they just want to take it again.
 */
export const RESTART_COUNTDOWN_SECONDS = 2;
export const MAX_DURATION_MS = 30 * 60 * 1000;

export type RecorderStatus =
  | "idle"
  | "acquiring"
  | "setup"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "staging"
  | "rendering"
  | "uploading"
  | "done"
  | "error";

export interface RecorderState {
  status: RecorderStatus;

  // preferences (mirrored into settings.ts by the hook)
  mode: RecordingMode;
  surfacePref: SurfacePref;
  micId: string;
  cameraId: string;
  micOn: boolean;
  systemOn: boolean;
  bubble: BubbleConfig;
  frame: FrameConfig;

  // live capture facts
  streamsAlive: boolean;
  surface: SurfacePref | "unknown" | null;
  hasSystemAudio: boolean;
  hasCamera: boolean;

  // timing
  countdown: number;
  elapsedMs: number;

  /**
   * Timestamps the user dropped mid-take (⌘⇧M / the Mark button), in seconds
   * from the start of the recording. They survive `stopping` and `staging` so
   * the upload can persist them into `videos.edits.markers`; every transition
   * that throws the take away clears them.
   */
  markers: Marker[];

  // result
  blob: Blob | null;
  cameraBlob: Blob | null;
  cameraOffsetMs: number;
  durationMs: number;
  width: number | null;
  height: number | null;

  // render
  renderProgress: number;

  // upload
  uploadProgress: number;
  videoId: string;
  shareUrl: string;

  // messaging
  error: string;
  notice: string;
}

export type RecorderEvent =
  | { type: "SELECT_MODE"; mode: RecordingMode }
  | { type: "SET_SURFACE_PREF"; pref: SurfacePref }
  | { type: "SET_DEVICE"; kind: "mic" | "camera"; deviceId: string }
  | { type: "ACQUIRE" }
  | {
      type: "ACQUIRED";
      surface: SurfacePref | "unknown";
      hasSystemAudio: boolean;
      hasCamera: boolean;
    }
  | { type: "ACQUIRE_FAILED"; error: string }
  /**
   * The user dismissed the screen picker. NOT a failure: it is the ordinary way
   * to back out of starting a recording, so it lands back on `idle` with no
   * error text — see `isCaptureCancellation` in `media-sources.ts`.
   */
  | { type: "ACQUIRE_CANCELLED" }
  | { type: "RECORD_FAILED"; error: string }
  /** `seconds` defaults to `COUNTDOWN_SECONDS`. */
  | { type: "START"; seconds?: number }
  | { type: "COUNTDOWN_TICK" }
  | { type: "SKIP_COUNTDOWN" }
  | { type: "TICK"; elapsedMs: number }
  | { type: "MARK" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "STOP" }
  /**
   * Throw the current take away and count in a new one. `seconds` defaults to
   * `COUNTDOWN_SECONDS`; the Restart button and ⌘⇧K pass
   * `RESTART_COUNTDOWN_SECONDS`.
   */
  | { type: "RESTART"; seconds?: number }
  | { type: "CANCEL" }
  | { type: "MAX_DURATION" }
  | { type: "STREAM_ENDED" }
  | {
      type: "BLOB_READY";
      blob: Blob;
      cameraBlob: Blob | null;
      cameraOffsetMs: number;
      durationMs: number;
      width: number | null;
      height: number | null;
    }
  | { type: "DISCARD" }
  | { type: "RENDER" }
  | { type: "RENDER_PROGRESS"; percent: number }
  | { type: "RENDER_DONE" }
  | { type: "RENDER_FAILED"; error: string }
  | { type: "UPLOAD_PROGRESS"; percent: number }
  | { type: "UPLOAD_DONE"; videoId: string; shareUrl: string }
  | { type: "UPLOAD_FAILED"; error: string }
  | { type: "RESET" }
  | { type: "TOGGLE_MIC"; on?: boolean }
  | { type: "TOGGLE_SYSTEM"; on?: boolean }
  | { type: "SET_BUBBLE"; patch: Partial<BubbleConfig> }
  | { type: "SET_FRAME"; patch: Partial<FrameConfig> };

export function initialRecorderState(
  settings: RecorderSettings = DEFAULT_SETTINGS,
): RecorderState {
  return {
    status: "idle",
    mode: settings.mode,
    surfacePref: settings.surfacePref,
    micId: settings.micId,
    cameraId: settings.cameraId,
    micOn: settings.micOn,
    systemOn: settings.systemOn,
    bubble: settings.bubble,
    frame: settings.frame,
    streamsAlive: false,
    surface: null,
    hasSystemAudio: false,
    hasCamera: false,
    countdown: COUNTDOWN_SECONDS,
    elapsedMs: 0,
    markers: [],
    blob: null,
    cameraBlob: null,
    cameraOffsetMs: 0,
    durationMs: 0,
    width: null,
    height: null,
    renderProgress: 0,
    uploadProgress: 0,
    videoId: "",
    shareUrl: "",
    error: "",
    notice: "",
  };
}

/**
 * The countdown an event asked for, or the default. Clamped to a whole number
 * of seconds ≥ 1: a countdown of 0 would leave `status: "countdown"` with
 * nothing to tick down to, so the encoder would never start.
 */
function countdownFor(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds)) return COUNTDOWN_SECONDS;
  return Math.max(1, Math.floor(seconds));
}

const CONFIGURABLE: RecorderStatus[] = ["idle", "setup"];
const LIVE: RecorderStatus[] = ["countdown", "recording", "paused"];

/**
 * Pure. No timers, no media, no React. The hook owns every side effect and
 * feeds facts back in as events.
 */
export function recorderReducer(
  state: RecorderState,
  event: RecorderEvent,
): RecorderState {
  switch (event.type) {
    case "SELECT_MODE":
      if (!CONFIGURABLE.includes(state.status)) return state;
      if (state.mode === event.mode) return state;
      // Changing mode invalidates any acquired stream; the hook tears them down
      // when it sees `streamsAlive` flip to false.
      return {
        ...state,
        mode: event.mode,
        status: "idle",
        streamsAlive: false,
        surface: null,
        hasSystemAudio: false,
        hasCamera: false,
        error: "",
      };

    case "SET_SURFACE_PREF":
      if (!CONFIGURABLE.includes(state.status)) return state;
      return { ...state, surfacePref: event.pref };

    case "SET_DEVICE":
      return event.kind === "mic"
        ? { ...state, micId: event.deviceId }
        : { ...state, cameraId: event.deviceId };

    case "ACQUIRE":
      if (state.status !== "idle" && state.status !== "error") return state;
      return { ...state, status: "acquiring", error: "", notice: "" };

    case "ACQUIRED":
      if (state.status !== "acquiring") return state;
      return {
        ...state,
        status: "setup",
        streamsAlive: true,
        surface: event.surface,
        hasSystemAudio: event.hasSystemAudio,
        hasCamera: event.hasCamera,
        error: "",
      };

    case "ACQUIRE_FAILED":
      if (state.status !== "acquiring") return state;
      return {
        ...state,
        status: "error",
        streamsAlive: false,
        surface: null,
        error: event.error,
      };

    case "ACQUIRE_CANCELLED":
      if (state.status !== "acquiring") return state;
      // Straight back to where ACQUIRE started, with nothing to show for it:
      // the picker never handed us a stream, so there is nothing to report.
      return {
        ...state,
        status: "idle",
        streamsAlive: false,
        surface: null,
        hasSystemAudio: false,
        hasCamera: false,
        error: "",
        notice: "",
      };

    case "RECORD_FAILED":
      if (
        state.status !== "countdown" &&
        state.status !== "recording" &&
        state.status !== "paused" &&
        state.status !== "stopping"
      ) {
        return state;
      }
      return {
        ...state,
        status: "error",
        error: event.error,
        blob: null,
        cameraBlob: null,
        streamsAlive: false,
      };

    case "START":
      if (state.status !== "setup") return state;
      return {
        ...state,
        status: "countdown",
        countdown: countdownFor(event.seconds),
        elapsedMs: 0,
        markers: [],
        notice: "",
      };

    case "COUNTDOWN_TICK": {
      if (state.status !== "countdown") return state;
      const next = state.countdown - 1;
      if (next > 0) return { ...state, countdown: next };
      return { ...state, status: "recording", countdown: 0, elapsedMs: 0 };
    }

    case "SKIP_COUNTDOWN":
      if (state.status !== "countdown") return state;
      return { ...state, status: "recording", countdown: 0, elapsedMs: 0 };

    case "TICK":
      if (state.status !== "recording") return state;
      return { ...state, elapsedMs: event.elapsedMs };

    case "MARK":
      if (state.status !== "recording") return state;
      return { ...state, markers: [...state.markers, { t: state.elapsedMs / 1000 }] };

    case "PAUSE":
      if (state.status !== "recording") return state;
      return { ...state, status: "paused" };

    case "RESUME":
      if (state.status !== "paused") return state;
      return { ...state, status: "recording" };

    case "STOP":
      if (state.status !== "recording" && state.status !== "paused") return state;
      return { ...state, status: "stopping" };

    case "MAX_DURATION":
      if (state.status !== "recording" && state.status !== "paused") return state;
      return {
        ...state,
        status: "stopping",
        notice: "Reached the 30 minute limit — wrapping up.",
      };

    // Throw the take away and count a new one in. The streams stay live, so
    // this is a countdown → recording round trip and the hook's "no encoder in
    // `recording`" effect starts the fresh encoder on the way back through.
    case "RESTART":
      if (!LIVE.includes(state.status)) return state;
      return {
        ...state,
        status: "countdown",
        countdown: countdownFor(event.seconds),
        elapsedMs: 0,
        markers: [],
        blob: null,
        error: "",
      };

    // Throw the take away and go back to setup with the capture still live.
    case "CANCEL":
      if (!LIVE.includes(state.status) && state.status !== "stopping") return state;
      return {
        ...state,
        status: "setup",
        countdown: COUNTDOWN_SECONDS,
        elapsedMs: 0,
        markers: [],
        blob: null,
        cameraBlob: null,
        cameraOffsetMs: 0,
        durationMs: 0,
        error: "",
        notice: "",
      };

    case "STREAM_ENDED": {
      if (state.status === "recording" || state.status === "paused") {
        return { ...state, status: "stopping", streamsAlive: false };
      }
      if (state.status === "setup" || state.status === "countdown") {
        return { ...state, status: "idle", streamsAlive: false, surface: null };
      }
      if (!state.streamsAlive) return state;
      return { ...state, streamsAlive: false };
    }

    case "BLOB_READY":
      if (state.status !== "stopping") return state;
      return {
        ...state,
        status: "staging",
        blob: event.blob,
        cameraBlob: event.cameraBlob,
        cameraOffsetMs: event.cameraOffsetMs,
        durationMs: event.durationMs,
        width: event.width,
        height: event.height,
        renderProgress: 0,
        error: "",
      };

    case "DISCARD":
      if (state.status !== "staging") return state;
      return {
        ...state,
        status: state.streamsAlive ? "setup" : "idle",
        blob: null,
        cameraBlob: null,
        cameraOffsetMs: 0,
        renderProgress: 0,
        durationMs: 0,
        elapsedMs: 0,
        markers: [],
        error: "",
        notice: "",
      };

    case "RENDER":
      if (state.status !== "staging") return state;
      return { ...state, status: "rendering", renderProgress: 0, error: "" };

    case "RENDER_PROGRESS":
      if (state.status !== "rendering") return state;
      return { ...state, renderProgress: event.percent };

    case "RENDER_FAILED":
      if (state.status !== "rendering") return state;
      return { ...state, status: "staging", error: event.error };

    case "RENDER_DONE":
      if (state.status !== "rendering") return state;
      return { ...state, status: "uploading", uploadProgress: 0, error: "" };

    case "UPLOAD_PROGRESS":
      if (state.status !== "uploading") return state;
      return { ...state, uploadProgress: event.percent };

    case "UPLOAD_DONE":
      if (state.status !== "uploading") return state;
      return {
        ...state,
        status: "done",
        blob: null,
        cameraBlob: null,
        uploadProgress: 100,
        videoId: event.videoId,
        shareUrl: event.shareUrl,
      };

    case "UPLOAD_FAILED":
      if (state.status !== "uploading") return state;
      // Stay on staging so the user can retry without losing the recording.
      return { ...state, status: "staging", error: event.error };

    case "RESET":
      return {
        ...initialRecorderState({
          mode: state.mode,
          surfacePref: state.surfacePref,
          micId: state.micId,
          cameraId: state.cameraId,
          micOn: state.micOn,
          systemOn: state.systemOn,
          bubble: state.bubble,
          frame: state.frame,
        }),
      };

    case "TOGGLE_MIC":
      return { ...state, micOn: event.on ?? !state.micOn };

    case "TOGGLE_SYSTEM":
      return { ...state, systemOn: event.on ?? !state.systemOn };

    case "SET_BUBBLE":
      return { ...state, bubble: { ...state.bubble, ...event.patch } };

    case "SET_FRAME":
      return { ...state, frame: { ...state.frame, ...event.patch } };

    default:
      return state;
  }
}
