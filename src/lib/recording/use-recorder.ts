"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import fixWebmDuration from "fix-webm-duration";
import { AudioMixer } from "./audio-mixer";
import { Compositor } from "./compositor";
import {
  isDesktop,
  onDesktopBubbleAppearance,
  onDesktopBubbleMove,
  onDesktopShortcut,
  setDesktopBubbleAppearance,
  setDesktopBubbleVisible,
  setDesktopCameraDevice,
  setDesktopHudState,
  setDesktopRecordingActive,
} from "./desktop-bridge";
import { computeFrameLayout, displayPosToCanvasPos } from "./geometry";
import { getProvider } from "./media-sources";
import { createFpsOverlay, createNoopOverlay, debugOverlaysEnabled } from "./overlays";
import {
  MAX_DURATION_MS,
  initialRecorderState,
  recorderReducer,
  type RecorderState,
} from "./recorder-machine";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";
import { uploadRecording } from "./upload";
import type {
  BubbleConfig,
  Capabilities,
  FrameConfig,
  HudStatus,
  RecordingMode,
  SurfacePref,
} from "./types";

const CODECS = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp8",
  "video/webm",
  // Safari has no WebM MediaRecorder; Phase 1 stores the mime per video.
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "",
];

function pickMimeType(): string {
  return (
    CODECS.find(
      (c) => c === "" || (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)),
    ) ?? ""
  );
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Object URLs come from the frame picker; only it creates `blob:` srcs. */
function revokeBlob(src: string | undefined): void {
  if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
}

export interface UseRecorderResult {
  state: RecorderState;
  capabilities: Capabilities;
  /** True when running inside the Electron shell (Phase 4). */
  desktop: boolean;
  /** Canvas the compositor paints into (camera and screen+camera modes). */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** <video> element used to preview screen-only recordings. */
  screenVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Object URL for the recorded blob while on the review screen. */
  reviewUrl: string | null;
  /** Object URL for the captured thumbnail while on the review screen. */
  thumbnailUrl: string | null;
  /** Live canvas and camera dimensions, polled for the drag overlay. */
  dimensions: {
    canvasWidth: number;
    canvasHeight: number;
    cameraWidth: number;
    cameraHeight: number;
  };
  getLevel: (id: "mic" | "system") => number;
  actions: {
    selectMode(mode: RecordingMode): void;
    /**
     * Mode switch that works from `setup` too: tears the live capture down and
     * re-acquires with the new mode, so the user lands straight back in setup.
     */
    switchMode(mode: RecordingMode): void;
    setSurfacePref(pref: SurfacePref): void;
    setDevice(kind: "mic" | "camera", deviceId: string): void;
    acquire(): void;
    start(): void;
    skipCountdown(): void;
    pause(): void;
    resume(): void;
    stop(): void;
    /** Restart with the 3-2-1 countdown (kept for completeness). */
    restart(): void;
    /** Restart immediately — no countdown. Bound to the Restart button / ⌘⇧K. */
    restartNow(): void;
    /** Throw the take away and go back to setup. Trash button / ⌘⇧X. */
    cancel(): void;
    /** Drop a timestamp marker at the current elapsed time. Mark button / ⌘⇧M. */
    mark(): void;
    discard(): void;
    upload(): void;
    reset(): void;
    toggleMic(on?: boolean): void;
    toggleSystem(on?: boolean): void;
    /**
     * `immediate` skips the compositor's 300 ms tween — the drag overlay uses
     * it so the bubble tracks the pointer instead of chasing it.
     */
    setBubble(patch: Partial<BubbleConfig>, opts?: { immediate?: boolean }): void;
    setFrame(patch: Partial<FrameConfig>): void;
  };
}

/**
 * The recorder hook.
 *
 * **Hard contract for the preview component:** `canvasRef` MUST be mounted
 * whenever `state.status` is `idle`, `acquiring` or `setup`. Camera and
 * screen+camera modes composite into that canvas, and `acquire()` fails loudly
 * (`ACQUIRE_FAILED`) rather than silently recording nothing if it is missing.
 */
export function useRecorder(): UseRecorderResult {
  const [state, dispatch] = useReducer(recorderReducer, DEFAULT_SETTINGS, initialRecorderState);
  const [capabilities, setCapabilities] = useState<Capabilities>({
    systemAudio: "none",
    nativePicker: false,
    surfaceHints: true,
  });
  // `window.__yoomDesktop` does not exist during SSR, so this has to be set
  // from the boot effect rather than a lazy initializer.
  const [desktop, setDesktop] = useState(false);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  // Bumped by `restartNow`: a recording → recording restart does not change
  // `state.status`, so the "start the encoder" effect needs its own trigger.
  const [restartToken, setRestartToken] = useState(0);
  const [dimensions, setDimensions] = useState({
    canvasWidth: 0,
    canvasHeight: 0,
    cameraWidth: 0,
    cameraHeight: 0,
  });
  // The live camera track's width/height, forwarded to the desktop shell so
  // its floating bubble window can match a `rounded` bubble's real aspect
  // ratio instead of assuming 16:9. Set once per acquire, after `getCamera`.
  const [cameraAspect, setCameraAspect] = useState<number | undefined>(undefined);

  const router = useRouter();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  // Set inside `onSlug` (see `upload` below): whether the share link actually
  // made it onto the clipboard, which decides the `?new=1` toast.
  const copiedRef = useRef(false);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mixerRef = useRef<AudioMixer | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const thumbnailRef = useRef<Blob | null>(null);
  const thumbnailTimerRef = useRef<number | null>(null);
  const dimensionsRef = useRef<{ width: number | null; height: number | null }>({
    width: null,
    height: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  // Settings are only persisted once the stored settings have been read back,
  // so the first render never writes DEFAULT_SETTINGS over the saved ones.
  const hydratedRef = useRef(false);
  // Object URLs the frame picker created; revoked when replaced.
  const prevFrameSrcRef = useRef<string | undefined>(undefined);

  // ---------- boot: settings + capabilities ----------

  useEffect(() => {
    const settings = loadSettings();
    dispatch({ type: "SELECT_MODE", mode: settings.mode });
    dispatch({ type: "SET_SURFACE_PREF", pref: settings.surfacePref });
    dispatch({ type: "SET_DEVICE", kind: "mic", deviceId: settings.micId });
    dispatch({ type: "SET_DEVICE", kind: "camera", deviceId: settings.cameraId });
    dispatch({ type: "TOGGLE_MIC", on: settings.micOn });
    dispatch({ type: "TOGGLE_SYSTEM", on: settings.systemOn });
    dispatch({ type: "SET_BUBBLE", patch: settings.bubble });
    dispatch({ type: "SET_FRAME", patch: settings.frame });
    setCapabilities(getProvider().capabilities());
    setDesktop(isDesktop());
    prevFrameSrcRef.current = settings.frame.background.src;
    hydratedRef.current = true;
  }, []);

  // Persist preferences whenever they change.
  //
  // React runs both mount effects in the same commit, in declaration order, so
  // the boot effect above has already set `hydratedRef` by the time this runs
  // on the first commit — that is intentional: the first pass is skipped only
  // if hydration somehow has not happened, and the dispatches from the boot
  // effect re-run this effect with the loaded values anyway.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveSettings({
      mode: state.mode,
      surfacePref: state.surfacePref,
      micId: state.micId,
      cameraId: state.cameraId,
      micOn: state.micOn,
      systemOn: state.systemOn,
      bubble: state.bubble,
      frame: state.frame,
    });
  }, [
    state.mode,
    state.surfacePref,
    state.micId,
    state.cameraId,
    state.micOn,
    state.systemOn,
    state.bubble,
    state.frame,
  ]);

  // ---------- teardown ----------

  const teardown = useCallback(() => {
    if (thumbnailTimerRef.current) {
      window.clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = null;
    }
    compositorRef.current?.dispose();
    compositorRef.current = null;
    void mixerRef.current?.close();
    mixerRef.current = null;
    stopStream(screenStreamRef.current);
    stopStream(cameraStreamRef.current);
    stopStream(micStreamRef.current);
    screenStreamRef.current = null;
    cameraStreamRef.current = null;
    micStreamRef.current = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    recorderRef.current = null;
  }, []);

  // Unmount: tear the pipeline down and release the picker's object URLs.
  // `teardown` deliberately does NOT revoke them — it also runs on upload,
  // where the user keeps the background as a setting.
  useEffect(
    () => () => {
      teardown();
      revokeBlob(prevFrameSrcRef.current);
      prevFrameSrcRef.current = undefined;
    },
    [teardown],
  );

  // ---------- acquisition ----------

  const acquire = useCallback(async () => {
    const current = stateRef.current;
    // Only `idle` and `error` may acquire — the reducer would ignore ACQUIRE
    // from anywhere else, and re-running the side effects (a second picker
    // prompt, a second camera stream) would leak streams behind it.
    if (current.status !== "idle" && current.status !== "error") return;
    dispatch({ type: "ACQUIRE" });
    const provider = getProvider();

    try {
      let hasSystemAudio = false;
      let surface: SurfacePref | "unknown" = "unknown";

      if (current.mode !== "camera") {
        const display = await provider.getDisplay(current.surfacePref);
        screenStreamRef.current = display.stream;
        surface = display.surface;
        hasSystemAudio = display.hasSystemAudio;
        display.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          dispatch({ type: "STREAM_ENDED" });
        });
      }

      if (current.mode !== "screen") {
        // Camera and screen+camera composite into the canvas. A missing canvas
        // means the preview is not mounted and we would silently record
        // nothing — fail loudly instead (see the hook's contract above).
        if (!canvasRef.current) throw new Error("Recorder canvas is not mounted");
        const camera = await provider.getCamera(current.cameraId || undefined);
        cameraStreamRef.current = camera;
        const camSettings = camera.getVideoTracks()[0]?.getSettings();
        setCameraAspect(
          camSettings?.width && camSettings?.height && camSettings.width > 0 && camSettings.height > 0
            ? camSettings.width / camSettings.height
            : undefined,
        );
        camera.getVideoTracks()[0]?.addEventListener("ended", () => {
          dispatch({ type: "STREAM_ENDED" });
        });
      }

      // The mic is always its own stream so the mixer owns it independently.
      try {
        micStreamRef.current = await provider.getMic(current.micId || undefined);
      } catch {
        micStreamRef.current = null;
      }

      // AudioContext must be created inside the user gesture chain.
      const mixer = new AudioMixer();
      await mixer.resume();
      if (micStreamRef.current) {
        mixer.addSource("mic", micStreamRef.current, { enabled: current.micOn });
      }
      const systemStream = screenStreamRef.current;
      if (systemStream && systemStream.getAudioTracks().length > 0) {
        mixer.addSource("system", new MediaStream(systemStream.getAudioTracks()), {
          enabled: current.systemOn,
        });
      }
      mixerRef.current = mixer;

      // Compositor for camera and screen+camera; screen-only bypasses it.
      if (current.mode !== "screen" && canvasRef.current) {
        const compositor = new Compositor(
          canvasRef.current,
          current.mode === "camera" ? "camera" : "screen+camera",
        );
        compositor.setSources({
          screen: current.mode === "screen+camera" ? screenStreamRef.current : null,
          camera: cameraStreamRef.current,
        });
        compositor.setBubble(
          current.mode === "camera"
            ? { ...current.bubble, shape: "full", visible: true }
            : current.bubble,
        );
        compositor.setFrame(current.frame);
        compositor.addOverlay(
          debugOverlaysEnabled() ? createFpsOverlay() : createNoopOverlay(),
        );
        compositorRef.current = compositor;
        await compositor.start();
      } else if (screenVideoRef.current && screenStreamRef.current) {
        screenVideoRef.current.srcObject = screenStreamRef.current;
        void screenVideoRef.current.play().catch(() => {});
      }

      dispatch({
        type: "ACQUIRED",
        surface,
        hasSystemAudio,
        hasCamera: !!cameraStreamRef.current,
      });
    } catch (err) {
      teardown();
      const message =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Permission denied. Please allow screen and camera access."
          : err instanceof Error && err.message === "Recorder canvas is not mounted"
            ? "The recorder is not ready yet. Please try again."
            : "Could not start capture. Check your device permissions.";
      dispatch({ type: "ACQUIRE_FAILED", error: message });
    }
  }, [teardown]);

  /**
   * Change a capture preference while already in `setup`. The acquired streams
   * belong to the old choice, so they are torn down first; the reducer sees
   * `STREAM_ENDED` (→ idle), takes the new preference, and `acquire()` runs on
   * the next tick with the updated state already committed.
   */
  const reacquireWith = useCallback(
    (apply: () => void) => {
      const current = stateRef.current;
      if (current.status !== "setup") {
        apply();
        return;
      }
      teardown();
      dispatch({ type: "STREAM_ENDED" });
      apply();
      // The dispatches above are still queued; `acquire` reads `stateRef`, so
      // it must run after React has committed them — a macrotask, not a
      // microtask, since React's own re-render is scheduled as a microtask.
      window.setTimeout(() => void acquire(), 0);
    },
    [acquire, teardown],
  );

  // ---------- push config into the compositor ----------

  useEffect(() => {
    if (!compositorRef.current) return;
    // Depends on `state.mode` so switching to/from camera mode re-pushes the
    // `shape: "full"` override even when the bubble config itself is unchanged.
    compositorRef.current.setBubble(
      state.mode === "camera"
        ? { ...state.bubble, shape: "full", visible: true }
        : state.bubble,
    );
  }, [state.bubble, state.mode]);

  useEffect(() => {
    const prev = prevFrameSrcRef.current;
    if (prev !== state.frame.background.src) {
      revokeBlob(prev);
      prevFrameSrcRef.current = state.frame.background.src;
    }
    compositorRef.current?.setFrame(state.frame);
  }, [state.frame]);

  // ---------- audio toggles ----------

  useEffect(() => {
    mixerRef.current?.setEnabled("mic", state.micOn);
  }, [state.micOn]);

  useEffect(() => {
    mixerRef.current?.setEnabled("system", state.systemOn);
  }, [state.systemOn]);

  // ---------- countdown ----------

  useEffect(() => {
    if (state.status !== "countdown") return;
    const id = window.setInterval(() => dispatch({ type: "COUNTDOWN_TICK" }), 1000);
    return () => window.clearInterval(id);
  }, [state.status]);

  // ---------- MediaRecorder lifecycle ----------

  const beginRecording = useCallback(() => {
    const current = stateRef.current;
    const mixer = mixerRef.current;
    const compositor = compositorRef.current;

    let recordStream: MediaStream;
    if (current.mode === "screen") {
      const videoTrack = screenStreamRef.current?.getVideoTracks()[0];
      if (!videoTrack) {
        dispatch({ type: "RECORD_FAILED", error: "Could not start the encoder." });
        return;
      }
      const settings = videoTrack.getSettings();
      dimensionsRef.current = {
        width: settings.width ?? null,
        height: settings.height ?? null,
      };
      recordStream = new MediaStream(
        mixer ? [videoTrack, mixer.outputTrack] : [videoTrack],
      );
    } else {
      if (!compositor || !canvasRef.current) {
        dispatch({ type: "RECORD_FAILED", error: "Could not start the encoder." });
        return;
      }
      compositor.lockSize();
      dimensionsRef.current = {
        width: canvasRef.current.width,
        height: canvasRef.current.height,
      };
      const canvasStream = compositor.captureStream(60);
      if (mixer) canvasStream.addTrack(mixer.outputTrack);
      recordStream = canvasStream;
    }

    chunksRef.current = [];
    thumbnailRef.current = null;

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(recordStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: current.mode === "camera" ? 5_000_000 : 10_000_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = (e) => {
      console.error("[Yoom] MediaRecorder error", e);
      dispatch({ type: "RECORD_FAILED", error: "Recording failed. Please try again." });
    };
    recorder.onstop = () => {
      void finishRecording();
    };

    startedAtRef.current = performance.now();
    pausedAtRef.current = 0;
    pausedTotalRef.current = 0;
    recorder.start(250);
    recorderRef.current = recorder;

    thumbnailTimerRef.current = window.setTimeout(() => {
      void captureThumbnail().then((blob) => {
        thumbnailRef.current = blob;
      });
    }, 1000);
    // `finishRecording` and `captureThumbnail` are stable callbacks defined below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter `recording` with no encoder behind it → start one. `recorderRef` is
  // the guard: it is non-null for the whole take (including while paused) and
  // is nulled by `restartNow` / `cancel` / `finishRecording`, so this fires on
  // the first entry and again after an immediate restart, but never on resume.
  useEffect(() => {
    if (state.status === "recording" && !recorderRef.current) beginRecording();
  }, [state.status, restartToken, beginRecording]);

  // Elapsed timer: `performance.now()` deltas only, minus paused time.
  useEffect(() => {
    if (state.status !== "recording") return;
    const id = window.setInterval(() => {
      const elapsed = performance.now() - startedAtRef.current - pausedTotalRef.current;
      dispatch({ type: "TICK", elapsedMs: Math.max(0, elapsed) });
      if (elapsed >= MAX_DURATION_MS) dispatch({ type: "MAX_DURATION" });
    }, 250);
    return () => window.clearInterval(id);
  }, [state.status]);

  // Pause / resume / stop the encoder to match the machine.
  useEffect(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (state.status === "paused" && recorder.state === "recording") {
      pausedAtRef.current = performance.now();
      recorder.pause();
    } else if (state.status === "recording" && recorder.state === "paused") {
      if (pausedAtRef.current) {
        pausedTotalRef.current += performance.now() - pausedAtRef.current;
        pausedAtRef.current = 0;
      }
      recorder.resume();
    } else if (state.status === "stopping" && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, [state.status]);

  // Watchdog: `stopping` waits on MediaRecorder's `onstop`. If the encoder
  // never fires it (a dead track, a browser bug) the UI would hang forever on
  // "Finishing…", so give up after 10s and surface a retryable error.
  useEffect(() => {
    if (state.status !== "stopping") return;
    const id = window.setTimeout(() => {
      if (stateRef.current.status !== "stopping") return;
      dispatch({
        type: "RECORD_FAILED",
        error: "Recording did not finalize. Please try again.",
      });
    }, 10_000);
    return () => window.clearTimeout(id);
  }, [state.status]);

  const captureThumbnail = useCallback(async (): Promise<Blob | null> => {
    const compositor = compositorRef.current;
    if (compositor) return compositor.snapshot();

    const track = screenStreamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return null;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    const ready = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 2000);
      video.onloadeddata = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
    });
    try {
      await video.play();
      if (!(await ready) || !video.videoWidth) return null;
      const scratch = document.createElement("canvas");
      scratch.width = video.videoWidth;
      scratch.height = video.videoHeight;
      scratch.getContext("2d")?.drawImage(video, 0, 0, scratch.width, scratch.height);
      return await new Promise((resolve) =>
        scratch.toBlob((blob) => resolve(blob), "image/jpeg", 0.8),
      );
    } catch {
      return null;
    } finally {
      video.pause();
      video.srcObject = null;
    }
  }, []);

  const finishRecording = useCallback(async () => {
    if (thumbnailTimerRef.current) {
      window.clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = null;
    }
    if (!thumbnailRef.current) thumbnailRef.current = await captureThumbnail();

    if (chunksRef.current.length === 0) {
      recorderRef.current = null;
      dispatch({
        type: "RECORD_FAILED",
        error: "Recording captured no data. Please try again.",
      });
      return;
    }

    const durationMs = Math.max(
      0,
      Math.round(performance.now() - startedAtRef.current - pausedTotalRef.current),
    );
    const recorder = recorderRef.current;
    const type = recorder?.mimeType?.split(";")[0] || "video/webm";
    recorderRef.current = null;

    const rawBlob = new Blob(chunksRef.current, { type });
    chunksRef.current = [];

    let blob = rawBlob;
    if (type.includes("webm")) {
      // MediaRecorder omits the EBML duration; patch it so seeking works.
      try {
        blob = await fixWebmDuration(rawBlob, durationMs, { logger: false });
      } catch (err) {
        console.warn("[Yoom] could not patch WebM duration", err);
      }
    }

    const { width, height } = dimensionsRef.current;
    dispatch({ type: "BLOB_READY", blob, durationMs, width, height });
  }, [captureThumbnail]);

  // ---------- review object URLs ----------

  useEffect(() => {
    if (state.status !== "review" || !state.blob) {
      setReviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const url = URL.createObjectURL(state.blob);
    setReviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [state.status, state.blob]);

  useEffect(() => {
    if (state.status !== "review" || !thumbnailRef.current) return;
    const url = URL.createObjectURL(thumbnailRef.current);
    setThumbnailUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setThumbnailUrl(null);
    };
  }, [state.status]);

  // ---------- upload ----------

  const upload = useCallback(async () => {
    const current = stateRef.current;
    const blob = current.blob;
    if (!blob) return;
    dispatch({ type: "UPLOAD" });
    // Free the camera and screen while the bytes go up. The streams are gone,
    // so the machine must know it: otherwise an UPLOAD_FAILED drops back to
    // `review` still believing `streamsAlive`, and Discard lands in a `setup`
    // screen with no capture behind it.
    teardown();
    dispatch({ type: "STREAM_ENDED" });
    copiedRef.current = false;
    let reservedSlug = "";
    try {
      const result = await uploadRecording({
        blob,
        durationMs: current.durationMs,
        width: current.width,
        height: current.height,
        thumbnail: thumbnailRef.current,
        markers: current.markers,
        onProgress: (percent) => dispatch({ type: "UPLOAD_PROGRESS", percent }),
        // Loom behaviour: the link must be on the clipboard before the page
        // changes. `navigator.clipboard.writeText` only works inside the
        // click's transient activation (~5 s), and a real upload takes far
        // longer than that — so the server reserves the slug up front and we
        // copy here, one round-trip after the click.
        onSlug: (url) => {
          reservedSlug = url.slice(url.lastIndexOf("/") + 1);
          navigator.clipboard
            .writeText(url)
            .then(() => {
              copiedRef.current = true;
            })
            .catch(() => {
              // Insecure context or denied permission; the detail page still
              // shows the link.
            });
        },
      });
      if (reservedSlug && result.slug !== reservedSlug) {
        // A slug collision made the server mint a different one, so whatever
        // is on the clipboard points at the wrong video.
        console.warn(
          `Reserved slug ${reservedSlug} was taken; saved as ${result.slug}. The copied link is stale.`,
        );
        copiedRef.current = false;
      }
      dispatch({ type: "UPLOAD_DONE", videoId: result.id, shareUrl: result.url });
      router.push(`/library/${result.id}${copiedRef.current ? "?new=1" : ""}`);
    } catch (err) {
      dispatch({
        type: "UPLOAD_FAILED",
        error: err instanceof Error ? err.message : "Upload failed. Please try again.",
      });
    }
  }, [router, teardown]);

  // ---------- discard / reset ----------

  /**
   * Stop the current encoder and throw its bytes away. `onstop` is detached
   * first so `finishRecording` never runs for a take the user abandoned.
   */
  const discardRecorder = useCallback(() => {
    if (thumbnailTimerRef.current) {
      window.clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = null;
    }
    chunksRef.current = [];
    thumbnailRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.stop();
    }
  }, []);

  const discard = useCallback(() => {
    thumbnailRef.current = null;
    dispatch({ type: "DISCARD" });
  }, []);

  const reset = useCallback(() => {
    teardown();
    thumbnailRef.current = null;
    dispatch({ type: "RESET" });
  }, [teardown]);

  // Streams died (mode change, Stop sharing) → release everything.
  useEffect(() => {
    if (state.streamsAlive) return;
    if (state.status === "idle" || state.status === "error") teardown();
  }, [state.streamsAlive, state.status, teardown]);

  // ---------- leave-page guard ----------

  // Navigating away mid-capture throws the recording away, so warn first.
  useEffect(() => {
    const risky =
      state.status === "recording" ||
      state.status === "paused" ||
      state.status === "stopping" ||
      state.status === "uploading" ||
      (state.status === "review" && !!state.blob);
    if (!risky) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state.status, state.blob]);

  // ---------- hotkeys ----------

  // Cmd/Ctrl+Shift+L starts and stops (Loom's default). Cmd/Ctrl+Shift+P
  // pauses and resumes, M drops a marker, K restarts immediately, X cancels. `R` is deliberately
  // avoided: it is Chrome's hard reload, and a missed chord there destroys the
  // recording in progress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || !e.shiftKey) return;
      // Holding a chord must not restart/cancel repeatedly.
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      const status = stateRef.current.status;
      if (key === "l") {
        e.preventDefault();
        if (status === "recording" || status === "paused") dispatch({ type: "STOP" });
        else if (status === "setup") dispatch({ type: "START" });
        else if (status === "idle") void acquire();
      } else if (key === "p") {
        e.preventDefault();
        if (status === "recording") dispatch({ type: "PAUSE" });
        else if (status === "paused") dispatch({ type: "RESUME" });
      } else if (key === "m") {
        if (stateRef.current.status !== "recording") return;
        e.preventDefault();
        dispatch({ type: "MARK" });
      } else if (key === "k") {
        if (status !== "countdown" && status !== "recording" && status !== "paused") return;
        e.preventDefault();
        discardRecorder();
        dispatch({ type: "RESTART_NOW" });
        setRestartToken((n) => n + 1);
      } else if (key === "x") {
        if (
          status !== "countdown" &&
          status !== "recording" &&
          status !== "paused" &&
          status !== "stopping"
        ) {
          return;
        }
        e.preventDefault();
        discardRecorder();
        dispatch({ type: "CANCEL" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [acquire, discardRecorder]);

  // Desktop shell forwards the same shortcuts even when the tab is unfocused.
  // The five actions mirror the in-page chords exactly (⌘⇧L/P/M/K/X); the
  // status guards are duplicated rather than shared because the in-page
  // listener also has to call `preventDefault` on the raw event.
  useEffect(() => {
    return onDesktopShortcut((action) => {
      const status = stateRef.current.status;
      if (action === "toggle") {
        if (status === "recording" || status === "paused") dispatch({ type: "STOP" });
        else if (status === "setup") dispatch({ type: "START" });
        else if (status === "idle") void acquire();
      } else if (action === "pause") {
        if (status === "recording") dispatch({ type: "PAUSE" });
        else if (status === "paused") dispatch({ type: "RESUME" });
      } else if (action === "mark") {
        if (status === "recording") dispatch({ type: "MARK" });
      } else if (action === "restart") {
        if (status !== "countdown" && status !== "recording" && status !== "paused") return;
        discardRecorder();
        dispatch({ type: "RESTART_NOW" });
        setRestartToken((n) => n + 1);
      } else if (action === "cancel") {
        if (
          status !== "countdown" &&
          status !== "recording" &&
          status !== "paused" &&
          status !== "stopping"
        ) {
          return;
        }
        discardRecorder();
        dispatch({ type: "CANCEL" });
      } else if (action === "bubbleToggle") {
        // The HUD's camera button. Mirrors the bubble's own hide control, but
        // toggles rather than only hiding, so the HUD can bring it back.
        const visible = !stateRef.current.bubble.visible;
        dispatch({ type: "SET_BUBBLE", patch: { visible } });
      }
    });
  }, [acquire, discardRecorder]);

  // ---------- floating desktop bubble ----------

  // The shell's bubble window only makes sense over a screen capture with a
  // camera. Camera-only mode fills the canvas, and screen-only has no camera.
  const desktopBubbleActive =
    state.mode === "screen+camera" &&
    (state.status === "setup" ||
      state.status === "countdown" ||
      state.status === "recording" ||
      state.status === "paused");

  useEffect(() => {
    setDesktopBubbleVisible(desktopBubbleActive);
    return () => setDesktopBubbleVisible(false);
  }, [desktopBubbleActive]);

  // The shell hides the live bubble window while the encoder runs whenever
  // self-occlusion cannot work (window captures, framed capture, or the
  // YOOM_BUBBLE_HIDE_WHILE_RECORDING escape hatch).
  useEffect(() => {
    setDesktopRecordingActive(state.status === "recording" || state.status === "paused");
  }, [state.status]);

  useEffect(() => {
    setDesktopBubbleAppearance({
      shape: state.bubble.shape,
      size: state.bubble.size,
      mirror: state.bubble.mirror,
      visible: state.bubble.visible,
      framed: state.frame.enabled,
      ...(cameraAspect !== undefined ? { cameraAspect } : {}),
    });
  }, [
    state.bubble.shape,
    state.bubble.size,
    state.bubble.mirror,
    state.bubble.visible,
    state.frame.enabled,
    cameraAspect,
  ]);

  useEffect(() => {
    setDesktopCameraDevice(state.cameraId || null);
  }, [state.cameraId]);

  // The bubble's own hover strip can hide it and cycle its shape; the shell
  // echoes the new appearance back so the web state stays authoritative and
  // the change is persisted with the rest of the bubble config.
  useEffect(() => {
    return onDesktopBubbleAppearance(({ shape, size, mirror, visible }) => {
      dispatch({ type: "SET_BUBBLE", patch: { shape, size, mirror, visible } });
    });
  }, []);

  // The shell reports a centre normalized to the captured DISPLAY. With framed
  // capture on, the canvas is bigger than the screen and the screen sits inset,
  // so the position has to be re-based before it reaches the bubble config.
  // `immediate: true` skips the compositor's 300 ms tween: the burned-in bubble
  // must not lag the window the user is physically dragging, or the live
  // window's captured pixels peek out from behind it.
  useEffect(() => {
    return onDesktopBubbleMove((pos) => {
      const track = screenStreamRef.current?.getVideoTracks()[0];
      const settings = track?.getSettings();
      const srcW = settings?.width ?? 0;
      const srcH = settings?.height ?? 0;
      const mapped =
        srcW > 0 && srcH > 0
          ? displayPosToCanvasPos(
              pos,
              computeFrameLayout(srcW, srcH, stateRef.current.frame),
            )
          : pos;

      if (compositorRef.current) {
        compositorRef.current.setBubble(
          { ...stateRef.current.bubble, pos: mapped },
          { immediate: true },
        );
      }
      dispatch({ type: "SET_BUBBLE", patch: { pos: mapped } });
    });
  }, []);

  // ---------- recording HUD ----------

  /**
   * The shell's HUD is a dumb view of the state below. It is pushed on every
   * status change and, while a take is live, on a ~4 Hz timer — fast enough
   * that the pill's seconds field never looks stuck, slow enough that we are
   * not crossing the contextBridge on every 100 ms TICK.
   */
  const hudStatus: HudStatus =
    state.status === "countdown" ||
    state.status === "recording" ||
    state.status === "paused" ||
    state.status === "stopping" ||
    state.status === "review" ||
    state.status === "error" ||
    state.status === "idle"
      ? state.status
      : "other";

  useEffect(() => {
    const push = () => {
      const current = stateRef.current;
      setDesktopHudState({
        status:
          current.status === "countdown" ||
          current.status === "recording" ||
          current.status === "paused" ||
          current.status === "stopping" ||
          current.status === "review" ||
          current.status === "error" ||
          current.status === "idle"
            ? current.status
            : "other",
        elapsedMs: current.elapsedMs,
        countdown: current.countdown,
        markers: current.markers.length,
        bubbleVisible: current.bubble.visible,
      });
    };

    // Push immediately so a transition is never a frame late, then keep the
    // timer alive only while there is a moving number to render.
    push();
    if (hudStatus !== "countdown" && hudStatus !== "recording") return;
    const id = window.setInterval(push, 250);
    return () => window.clearInterval(id);
  }, [hudStatus, state.markers.length, state.bubble.visible]);

  // Polled rather than pushed so the draw loop stays free of React.
  useEffect(() => {
    const active =
      state.status === "setup" ||
      state.status === "countdown" ||
      state.status === "recording" ||
      state.status === "paused";
    if (!active) return;
    const id = window.setInterval(() => {
      const canvas = canvasRef.current;
      const camTrack = cameraStreamRef.current?.getVideoTracks()[0];
      const camSettings = camTrack?.getSettings();
      setDimensions((prev) => {
        const next = {
          canvasWidth: canvas?.width ?? 0,
          canvasHeight: canvas?.height ?? 0,
          cameraWidth: camSettings?.width ?? 0,
          cameraHeight: camSettings?.height ?? 0,
        };
        return prev.canvasWidth === next.canvasWidth &&
          prev.canvasHeight === next.canvasHeight &&
          prev.cameraWidth === next.cameraWidth &&
          prev.cameraHeight === next.cameraHeight
          ? prev
          : next;
      });
    }, 400);
    return () => window.clearInterval(id);
  }, [state.status]);

  const getLevel = useCallback(
    (id: "mic" | "system") => mixerRef.current?.getLevel(id) ?? 0,
    [],
  );

  const actions = useMemo(
    () => ({
      selectMode: (mode: RecordingMode) => dispatch({ type: "SELECT_MODE", mode }),
      switchMode: (mode: RecordingMode) =>
        reacquireWith(() => dispatch({ type: "SELECT_MODE", mode })),
      setSurfacePref: (pref: SurfacePref) =>
        reacquireWith(() => dispatch({ type: "SET_SURFACE_PREF", pref })),
      setDevice: (kind: "mic" | "camera", deviceId: string) =>
        dispatch({ type: "SET_DEVICE", kind, deviceId }),
      acquire: () => void acquire(),
      start: () => dispatch({ type: "START" }),
      skipCountdown: () => dispatch({ type: "SKIP_COUNTDOWN" }),
      pause: () => dispatch({ type: "PAUSE" }),
      resume: () => dispatch({ type: "RESUME" }),
      stop: () => dispatch({ type: "STOP" }),
      restart: () => {
        discardRecorder();
        dispatch({ type: "RESTART" });
      },
      restartNow: () => {
        discardRecorder();
        dispatch({ type: "RESTART_NOW" });
        // `recording → recording` leaves the status untouched, so nudge the
        // encoder effect explicitly.
        setRestartToken((n) => n + 1);
      },
      cancel: () => {
        discardRecorder();
        dispatch({ type: "CANCEL" });
      },
      mark: () => dispatch({ type: "MARK" }),
      discard,
      upload: () => void upload(),
      reset,
      toggleMic: (on?: boolean) => dispatch({ type: "TOGGLE_MIC", on }),
      toggleSystem: (on?: boolean) => dispatch({ type: "TOGGLE_SYSTEM", on }),
      setBubble: (patch: Partial<BubbleConfig>, opts?: { immediate?: boolean }) => {
        // `immediate` never reaches the reducer: it describes how to render the
        // change, not what the change is. Push it straight at the compositor
        // (which is React-free) and let the dispatch update state as usual.
        if (opts?.immediate && compositorRef.current) {
          const current = stateRef.current;
          const next = { ...current.bubble, ...patch };
          compositorRef.current.setBubble(
            current.mode === "camera" ? { ...next, shape: "full", visible: true } : next,
            { immediate: true },
          );
        }
        dispatch({ type: "SET_BUBBLE", patch });
      },
      setFrame: (patch: Partial<FrameConfig>) => dispatch({ type: "SET_FRAME", patch }),
    }),
    [acquire, discard, discardRecorder, reacquireWith, reset, upload],
  );

  return {
    state,
    capabilities,
    desktop,
    canvasRef,
    screenVideoRef,
    reviewUrl,
    thumbnailUrl,
    dimensions,
    getLevel,
    actions,
  };
}
