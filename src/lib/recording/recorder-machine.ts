import { DEFAULT_SETTINGS } from "./settings";
import type {
  BackgroundConfig,
  BubbleConfig,
  FrameConfig,
  RecorderSettings,
  RecordingMode,
  SurfacePref,
} from "./types";

export const COUNTDOWN_SECONDS = 3;
export const MAX_DURATION_MS = 30 * 60 * 1000;

export type RecorderStatus =
  | "idle"
  | "acquiring"
  | "setup"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "review"
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
  background: BackgroundConfig;
  frame: FrameConfig;

  // live capture facts
  streamsAlive: boolean;
  surface: SurfacePref | "unknown" | null;
  hasSystemAudio: boolean;
  hasCamera: boolean;

  // timing
  countdown: number;
  elapsedMs: number;

  // result
  blob: Blob | null;
  durationMs: number;
  width: number | null;
  height: number | null;

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
  | { type: "RECORD_FAILED"; error: string }
  | { type: "START" }
  | { type: "COUNTDOWN_TICK" }
  | { type: "SKIP_COUNTDOWN" }
  | { type: "TICK"; elapsedMs: number }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "STOP" }
  | { type: "RESTART" }
  | { type: "MAX_DURATION" }
  | { type: "STREAM_ENDED" }
  | {
      type: "BLOB_READY";
      blob: Blob;
      durationMs: number;
      width: number | null;
      height: number | null;
    }
  | { type: "DISCARD" }
  | { type: "UPLOAD" }
  | { type: "UPLOAD_PROGRESS"; percent: number }
  | { type: "UPLOAD_DONE"; videoId: string; shareUrl: string }
  | { type: "UPLOAD_FAILED"; error: string }
  | { type: "RESET" }
  | { type: "TOGGLE_MIC"; on?: boolean }
  | { type: "TOGGLE_SYSTEM"; on?: boolean }
  | { type: "SET_BUBBLE"; patch: Partial<BubbleConfig> }
  | { type: "SET_BACKGROUND"; background: BackgroundConfig }
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
    background: settings.background,
    frame: settings.frame,
    streamsAlive: false,
    surface: null,
    hasSystemAudio: false,
    hasCamera: false,
    countdown: COUNTDOWN_SECONDS,
    elapsedMs: 0,
    blob: null,
    durationMs: 0,
    width: null,
    height: null,
    uploadProgress: 0,
    videoId: "",
    shareUrl: "",
    error: "",
    notice: "",
  };
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
        streamsAlive: false,
      };

    case "START":
      if (state.status !== "setup") return state;
      return {
        ...state,
        status: "countdown",
        countdown: COUNTDOWN_SECONDS,
        elapsedMs: 0,
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

    case "RESTART":
      if (!LIVE.includes(state.status)) return state;
      return {
        ...state,
        status: "countdown",
        countdown: COUNTDOWN_SECONDS,
        elapsedMs: 0,
        blob: null,
        error: "",
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
        status: "review",
        blob: event.blob,
        durationMs: event.durationMs,
        width: event.width,
        height: event.height,
      };

    case "DISCARD":
      if (state.status !== "review") return state;
      return {
        ...state,
        status: state.streamsAlive ? "setup" : "idle",
        blob: null,
        durationMs: 0,
        elapsedMs: 0,
        error: "",
        notice: "",
      };

    case "UPLOAD":
      if (state.status !== "review") return state;
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
        uploadProgress: 100,
        videoId: event.videoId,
        shareUrl: event.shareUrl,
      };

    case "UPLOAD_FAILED":
      if (state.status !== "uploading") return state;
      // Stay on review so the user can retry without losing the recording.
      return { ...state, status: "review", error: event.error };

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
          background: state.background,
          frame: state.frame,
        }),
      };

    case "TOGGLE_MIC":
      return { ...state, micOn: event.on ?? !state.micOn };

    case "TOGGLE_SYSTEM":
      return { ...state, systemOn: event.on ?? !state.systemOn };

    case "SET_BUBBLE":
      return { ...state, bubble: { ...state.bubble, ...event.patch } };

    case "SET_BACKGROUND":
      return { ...state, background: event.background };

    case "SET_FRAME":
      return { ...state, frame: { ...state.frame, ...event.patch } };

    default:
      return state;
  }
}
