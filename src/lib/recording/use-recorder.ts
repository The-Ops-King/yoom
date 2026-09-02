"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import fixWebmDuration from "fix-webm-duration";
import { AudioMixer } from "./audio-mixer";
import { Compositor } from "./compositor";
import { onDesktopShortcut } from "./desktop-bridge";
import { getProvider } from "./media-sources";
import { createFpsOverlay, createNoopOverlay, debugOverlaysEnabled } from "./overlays";
import {
  MAX_DURATION_MS,
  initialRecorderState,
  recorderReducer,
  type RecorderState,
} from "./recorder-machine";
import { PersonSegmenter } from "./segmentation";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";
import { uploadRecording } from "./upload";
import type {
  BackgroundConfig,
  BubbleConfig,
  Capabilities,
  FrameConfig,
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

export interface UseRecorderResult {
  state: RecorderState;
  capabilities: Capabilities;
  /** Canvas the compositor paints into (camera and screen+camera modes). */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** <video> element used to preview screen-only recordings. */
  screenVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Object URL for the recorded blob while on the review screen. */
  reviewUrl: string | null;
  /** Object URL for the captured thumbnail while on the review screen. */
  thumbnailUrl: string | null;
  getLevel: (id: "mic" | "system") => number;
  actions: {
    selectMode(mode: RecordingMode): void;
    setSurfacePref(pref: SurfacePref): void;
    setDevice(kind: "mic" | "camera", deviceId: string): void;
    acquire(): void;
    start(): void;
    skipCountdown(): void;
    pause(): void;
    resume(): void;
    stop(): void;
    restart(): void;
    discard(): void;
    upload(): void;
    reset(): void;
    toggleMic(on?: boolean): void;
    toggleSystem(on?: boolean): void;
    setBubble(patch: Partial<BubbleConfig>): void;
    setBackground(background: BackgroundConfig): void;
    setFrame(patch: Partial<FrameConfig>): void;
  };
}

export function useRecorder(): UseRecorderResult {
  const [state, dispatch] = useReducer(recorderReducer, DEFAULT_SETTINGS, initialRecorderState);
  const [capabilities, setCapabilities] = useState<Capabilities>({
    systemAudio: "none",
    nativePicker: false,
    surfaceHints: true,
  });
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mixerRef = useRef<AudioMixer | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const segmenterRef = useRef<PersonSegmenter | null>(null);
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
    dispatch({ type: "SET_BACKGROUND", background: settings.background });
    dispatch({ type: "SET_FRAME", patch: settings.frame });
    setCapabilities(getProvider().capabilities());
  }, []);

  // Persist preferences whenever they change.
  useEffect(() => {
    saveSettings({
      mode: state.mode,
      surfacePref: state.surfacePref,
      micId: state.micId,
      cameraId: state.cameraId,
      micOn: state.micOn,
      systemOn: state.systemOn,
      bubble: state.bubble,
      background: state.background,
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
    state.background,
    state.frame,
  ]);

  // ---------- teardown ----------

  const teardown = useCallback(() => {
    if (thumbnailTimerRef.current) {
      window.clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = null;
    }
    segmenterRef.current?.dispose();
    segmenterRef.current = null;
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

  useEffect(() => teardown, [teardown]);

  // ---------- acquisition ----------

  const acquire = useCallback(async () => {
    const current = stateRef.current;
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
        cameraStreamRef.current = await provider.getCamera(current.cameraId || undefined);
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
        compositor.setBackground(current.background);
        compositor.setFrame(current.frame);
        compositor.addOverlay(
          debugOverlaysEnabled() ? createFpsOverlay() : createNoopOverlay(),
        );
        compositorRef.current = compositor;
        await compositor.start();

        // Segmentation is optional: a null segmenter means "plain camera".
        if (current.background.kind !== "none" && cameraStreamRef.current) {
          void PersonSegmenter.load().then((segmenter) => {
            if (!segmenter) return;
            segmenterRef.current = segmenter;
            // Reuse the compositor's decoded camera element: one decoder,
            // not two, for the same camera stream.
            const el = compositorRef.current?.cameraElement() ?? null;
            if (!el) return;
            segmenter.start(el, { width: 256 });
            compositorRef.current?.setSources({ maskCanvas: segmenter.mask });
          });
        }
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
          : "Could not start capture. Check your device permissions.";
      dispatch({ type: "ACQUIRE_FAILED", error: message });
    }
  }, [teardown]);

  // ---------- push config into the compositor ----------

  useEffect(() => {
    if (!compositorRef.current) return;
    compositorRef.current.setBubble(
      stateRef.current.mode === "camera"
        ? { ...state.bubble, shape: "full", visible: true }
        : state.bubble,
    );
  }, [state.bubble]);

  useEffect(() => {
    compositorRef.current?.setBackground(state.background);
    // Turning a background on for the first time lazily loads the segmenter.
    if (state.background.kind !== "none" && !segmenterRef.current && cameraStreamRef.current) {
      void PersonSegmenter.load().then((segmenter) => {
        if (!segmenter) return;
        segmenterRef.current = segmenter;
        // Reuse the compositor's decoded camera element (one decoder).
        const el = compositorRef.current?.cameraElement() ?? null;
        if (!el) return;
        segmenter.start(el, { width: 256 });
        compositorRef.current?.setSources({ maskCanvas: segmenter.mask });
      });
    }
  }, [state.background]);

  useEffect(() => {
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
      if (!videoTrack) return;
      const settings = videoTrack.getSettings();
      dimensionsRef.current = {
        width: settings.width ?? null,
        height: settings.height ?? null,
      };
      recordStream = new MediaStream(
        mixer ? [videoTrack, mixer.outputTrack] : [videoTrack],
      );
    } else {
      if (!compositor || !canvasRef.current) return;
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

  // Enter `recording` for the first time → actually start the encoder.
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    const isRecording = state.status === "recording";
    if (isRecording && !wasRecordingRef.current && !recorderRef.current) {
      beginRecording();
    }
    wasRecordingRef.current = isRecording || state.status === "paused";
  }, [state.status, beginRecording]);

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
    // Free the camera and screen while the bytes go up.
    teardown();
    try {
      const result = await uploadRecording({
        blob,
        durationMs: current.durationMs,
        width: current.width,
        height: current.height,
        thumbnail: thumbnailRef.current,
        onProgress: (percent) => dispatch({ type: "UPLOAD_PROGRESS", percent }),
      });
      // Phase 3 replaces this with router.push('/library/'+id+'?new=1').
      dispatch({ type: "UPLOAD_DONE", videoId: result.id, shareUrl: result.url });
    } catch (err) {
      dispatch({
        type: "UPLOAD_FAILED",
        error: err instanceof Error ? err.message : "Upload failed. Please try again.",
      });
    }
  }, [teardown]);

  // ---------- discard / reset ----------

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

  // ---------- hotkeys ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      const status = stateRef.current.status;
      if (key === "r") {
        e.preventDefault();
        if (status === "recording" || status === "paused") dispatch({ type: "STOP" });
        else if (status === "setup") dispatch({ type: "START" });
        else if (status === "idle") void acquire();
      } else if (key === "p") {
        e.preventDefault();
        if (status === "recording") dispatch({ type: "PAUSE" });
        else if (status === "paused") dispatch({ type: "RESUME" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [acquire]);

  // Desktop shell forwards the same shortcuts even when the tab is unfocused.
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
      }
    });
  }, [acquire]);

  const getLevel = useCallback(
    (id: "mic" | "system") => mixerRef.current?.getLevel(id) ?? 0,
    [],
  );

  const actions = useMemo(
    () => ({
      selectMode: (mode: RecordingMode) => dispatch({ type: "SELECT_MODE", mode }),
      setSurfacePref: (pref: SurfacePref) => dispatch({ type: "SET_SURFACE_PREF", pref }),
      setDevice: (kind: "mic" | "camera", deviceId: string) =>
        dispatch({ type: "SET_DEVICE", kind, deviceId }),
      acquire: () => void acquire(),
      start: () => dispatch({ type: "START" }),
      skipCountdown: () => dispatch({ type: "SKIP_COUNTDOWN" }),
      pause: () => dispatch({ type: "PAUSE" }),
      resume: () => dispatch({ type: "RESUME" }),
      stop: () => dispatch({ type: "STOP" }),
      restart: () => {
        chunksRef.current = [];
        thumbnailRef.current = null;
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.onstop = null;
          recorderRef.current.stop();
          recorderRef.current = null;
        }
        dispatch({ type: "RESTART" });
      },
      discard,
      upload: () => void upload(),
      reset,
      toggleMic: (on?: boolean) => dispatch({ type: "TOGGLE_MIC", on }),
      toggleSystem: (on?: boolean) => dispatch({ type: "TOGGLE_SYSTEM", on }),
      setBubble: (patch: Partial<BubbleConfig>) => dispatch({ type: "SET_BUBBLE", patch }),
      setBackground: (background: BackgroundConfig) =>
        dispatch({ type: "SET_BACKGROUND", background }),
      setFrame: (patch: Partial<FrameConfig>) => dispatch({ type: "SET_FRAME", patch }),
    }),
    [acquire, discard, reset, upload],
  );

  return {
    state,
    capabilities,
    canvasRef,
    screenVideoRef,
    reviewUrl,
    thumbnailUrl,
    getLevel,
    actions,
  };
}
