"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import fixWebmDuration from "fix-webm-duration";
import type { VideoEdits } from "@/lib/edits";
import { editedDuration } from "@/lib/editor/cuts";
import { renderToBlob, type RenderSources } from "@/lib/editor/export";
import { AudioMixer } from "./audio-mixer";
import { isDesktop, onDesktopShortcut, setDesktopHudState } from "./desktop-bridge";
import { getProvider, isCaptureCancellation } from "./media-sources";
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

/** Cuts shorten the take, so the uploaded duration is the edited one. */
const editedDurationMs = (edits: VideoEdits, durationMs: number) =>
  editedDuration(edits, durationMs / 1000) * 1000;

/** Everything staging collected before the user pressed Save. */
export interface FinishInput {
  edits: VideoEdits;
  title: string;
  description: string;
  slug: string;
  /** Edited-timeline second to grab the thumbnail from. */
  thumbnailAt: number;
}

export interface UseRecorderResult {
  state: RecorderState;
  capabilities: Capabilities;
  /** True when running inside the Electron shell (Phase 4). */
  desktop: boolean;
  /** Raw screen preview while configuring (screen and screen+camera). */
  screenVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Raw camera preview while configuring (camera and screen+camera). */
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Object URLs for the two raw files while staging; null outside staging. */
  staging: { screenUrl: string | null; cameraUrl: string | null } | null;
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
    /** Render the edit list to one file, then upload it with the details. */
    finish(input: FinishInput): void;
    cancelRender(): void;
    reset(): void;
    toggleMic(on?: boolean): void;
    toggleSystem(on?: boolean): void;
    setBubble(patch: Partial<BubbleConfig>): void;
    setFrame(patch: Partial<FrameConfig>): void;
  };
}

/**
 * The recorder hook.
 *
 * Capture is raw: `screen` records the display track, `camera` records the
 * camera track, and `screen+camera` runs TWO `MediaRecorder`s — one per source
 * — started in the same tick so their `onstart` stamps differ only by encoder
 * start-up skew. Nothing is composited live; the edit list and the renderer
 * (`@/lib/editor`) decide what the finished file looks like.
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
  // Bumped by `restartNow`: a recording → recording restart does not change
  // `state.status`, so the "start the encoder" effect needs its own trigger.
  const [restartToken, setRestartToken] = useState(0);
  const [staging, setStaging] = useState<{
    screenUrl: string | null;
    cameraUrl: string | null;
  } | null>(null);

  const router = useRouter();

  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  // Set inside `onSlug` (see `upload` below): whether the share link actually
  // made it onto the clipboard, which decides the `?new=1` toast.
  const copiedRef = useRef(false);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mixerRef = useRef<AudioMixer | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // The second encoder, only in `screen+camera`: the raw camera file.
  const cameraRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraChunksRef = useRef<Blob[]>([]);
  // `onstart` stamps of the two encoders; their delta is `cameraOffsetMs`.
  const screenStartRef = useRef(0);
  const cameraStartRef = useRef(0);
  const renderAbortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const dimensionsRef = useRef<{ width: number | null; height: number | null }>({
    width: null,
    height: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  // Settings are only persisted once the stored settings have been read back,
  // so the first render never writes DEFAULT_SETTINGS over the saved ones.
  const hydratedRef = useRef(false);

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
    void mixerRef.current?.close();
    mixerRef.current = null;
    stopStream(screenStreamRef.current);
    stopStream(cameraStreamRef.current);
    stopStream(micStreamRef.current);
    screenStreamRef.current = null;
    cameraStreamRef.current = null;
    micStreamRef.current = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    recorderRef.current = null;
    cameraRecorderRef.current = null;
  }, []);

  // Unmount: tear the pipeline down.
  useEffect(() => () => teardown(), [teardown]);

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
        // Only the *display* step can be cancelled by dismissing a picker; a
        // camera or mic rejection with the same name is a real denial, so the
        // classification is scoped to this await rather than the whole try.
        let display;
        try {
          display = await provider.getDisplay(current.surfacePref);
        } catch (err) {
          if (!isCaptureCancellation(err)) throw err;
          teardown();
          dispatch({ type: "ACQUIRE_CANCELLED" });
          return;
        }
        screenStreamRef.current = display.stream;
        surface = display.surface;
        hasSystemAudio = display.hasSystemAudio;
        display.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          dispatch({ type: "STREAM_ENDED" });
        });
      }

      if (current.mode !== "screen") {
        const camera = await provider.getCamera(current.cameraId || undefined);
        cameraStreamRef.current = camera;
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

      // Raw previews: one <video> per live source, no compositing.
      if (screenVideoRef.current && screenStreamRef.current) {
        screenVideoRef.current.srcObject = screenStreamRef.current;
        void screenVideoRef.current.play().catch(() => {});
      }
      if (cameraVideoRef.current && cameraStreamRef.current) {
        cameraVideoRef.current.srcObject = cameraStreamRef.current;
        void cameraVideoRef.current.play().catch(() => {});
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
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0] ?? null;
    const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0] ?? null;
    const primaryTrack = current.mode === "camera" ? cameraTrack : screenTrack;
    if (!primaryTrack) {
      dispatch({ type: "RECORD_FAILED", error: "Could not start the encoder." });
      return;
    }
    const settings = primaryTrack.getSettings();
    dimensionsRef.current = { width: settings.width ?? null, height: settings.height ?? null };
    // Audio always rides the primary file; the secondary camera file is video-only.
    const recordStream = new MediaStream(
      mixer ? [primaryTrack, mixer.outputTrack] : [primaryTrack],
    );
    const cameraStream =
      current.mode === "screen+camera" && cameraTrack ? new MediaStream([cameraTrack]) : null;

    chunksRef.current = [];
    screenStartRef.current = 0;
    cameraStartRef.current = 0;

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
    recorder.onstart = () => {
      screenStartRef.current = performance.now();
    };

    cameraChunksRef.current = [];
    cameraRecorderRef.current = null;
    if (cameraStream) {
      const camRecorder = new MediaRecorder(cameraStream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 4_000_000,
      });
      camRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) cameraChunksRef.current.push(e.data);
      };
      camRecorder.onstart = () => {
        cameraStartRef.current = performance.now();
      };
      // A camera-file failure must not kill the take: the screen file is still
      // usable and the renderer treats a missing camera blob as camera-less.
      camRecorder.onerror = (e) => console.warn("[Yoom] camera MediaRecorder error", e);
      cameraRecorderRef.current = camRecorder;
    }

    startedAtRef.current = performance.now();
    pausedAtRef.current = 0;
    pausedTotalRef.current = 0;
    // Same tick, so the two `onstart` stamps differ only by encoder start-up skew.
    recorder.start(250);
    cameraRecorderRef.current?.start(250);
    recorderRef.current = recorder;
    // `finishRecording` is a stable callback defined below.
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
    // The camera encoder shadows the primary one so the two files stay aligned.
    const cam = cameraRecorderRef.current;
    if (state.status === "paused" && recorder.state === "recording") {
      pausedAtRef.current = performance.now();
      recorder.pause();
      if (cam?.state === "recording") cam.pause();
    } else if (state.status === "recording" && recorder.state === "paused") {
      if (pausedAtRef.current) {
        pausedTotalRef.current += performance.now() - pausedAtRef.current;
        pausedAtRef.current = 0;
      }
      recorder.resume();
      if (cam?.state === "paused") cam.resume();
    } else if (state.status === "stopping" && recorder.state !== "inactive") {
      recorder.stop();
      if (cam && cam.state !== "inactive") cam.stop();
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

  const finishRecording = useCallback(async () => {
    if (chunksRef.current.length === 0) {
      recorderRef.current = null;
      cameraRecorderRef.current = null;
      dispatch({
        type: "RECORD_FAILED",
        error: "Recording captured no data. Please try again.",
      });
      return;
    }

    // The camera recorder was stopped in the same effect; wait for its last
    // chunk so both files describe the same span of time.
    const cam = cameraRecorderRef.current;
    if (cam && cam.state !== "inactive") {
      await new Promise<void>((resolve) => {
        let timer = 0;
        const done = () => {
          window.clearTimeout(timer);
          cam.removeEventListener("stop", done);
          resolve();
        };
        cam.addEventListener("stop", done);
        timer = window.setTimeout(done, 2000);
      });
    }

    const durationMs = Math.max(
      0,
      Math.round(performance.now() - startedAtRef.current - pausedTotalRef.current),
    );
    const recorder = recorderRef.current;
    const type = recorder?.mimeType?.split(";")[0] || "video/webm";
    recorderRef.current = null;
    cameraRecorderRef.current = null;

    // MediaRecorder omits the EBML duration; patch it so seeking works.
    const patch = async (chunks: Blob[]): Promise<Blob> => {
      const raw = new Blob(chunks, { type });
      if (!type.includes("webm")) return raw;
      try {
        return await fixWebmDuration(raw, durationMs, { logger: false });
      } catch (err) {
        console.warn("[Yoom] could not patch WebM duration", err);
        return raw;
      }
    };

    const blob = await patch(chunksRef.current);
    const cameraBlob =
      cameraChunksRef.current.length > 0 ? await patch(cameraChunksRef.current) : null;
    chunksRef.current = [];
    cameraChunksRef.current = [];
    // Convention: consumers read the camera at `screenTime + cameraOffsetMs`,
    // so a camera that started LATER than the screen gets a NEGATIVE offset.
    // A missing `onstart` stamp (0) means we cannot know the skew — assume none.
    const cameraOffsetMs =
      cameraBlob && screenStartRef.current > 0 && cameraStartRef.current > 0
        ? Math.round(screenStartRef.current - cameraStartRef.current)
        : 0;

    const { width, height } = dimensionsRef.current;
    dispatch({
      type: "BLOB_READY",
      blob,
      cameraBlob,
      cameraOffsetMs,
      durationMs,
      width,
      height,
    });
  }, []);

  // ---------- staging object URLs ----------

  // Keyed on the blobs and the mode, never on the status: staging → rendering →
  // uploading → staging (a failed upload) must not revoke and re-mint the URLs
  // out from under the preview's <video> elements. The export does not read
  // them — it mints its own from the same blobs.
  //
  // Same convention as `finish()`'s `RenderSources`: in camera-only mode the
  // single recorded file IS the camera, so it is published as `cameraUrl` with
  // `screenUrl` null — the staging player picks its primary source by mode.
  useEffect(() => {
    if (!state.blob) {
      setStaging(null);
      return;
    }
    const url = URL.createObjectURL(state.blob);
    const cameraUrl = state.cameraBlob ? URL.createObjectURL(state.cameraBlob) : null;
    const camOnly = state.mode === "camera";
    setStaging({ screenUrl: camOnly ? null : url, cameraUrl: camOnly ? url : cameraUrl });
    return () => {
      URL.revokeObjectURL(url);
      if (cameraUrl) URL.revokeObjectURL(cameraUrl);
    };
  }, [state.blob, state.cameraBlob, state.mode]);

  // ---------- render + upload ----------

  /**
   * Render the staged edit list into one file, then upload it. Both halves of
   * the trip live here because `rendering → uploading` is one user action
   * ("Save"), and a failure in either drops back to `staging` with the raw
   * blobs intact.
   */
  const finish = useCallback(
    async (input: FinishInput) => {
      const current = stateRef.current;
      if (current.status !== "staging" || !current.blob) return;

      // In camera-only mode the single recorded file IS the camera.
      const sources: RenderSources = {
        screen: current.mode === "camera" ? null : current.blob,
        camera:
          current.mode === "screen"
            ? null
            : current.mode === "camera"
              ? current.blob
              : current.cameraBlob,
        mode: current.mode,
        durationMs: current.durationMs,
      };

      dispatch({ type: "RENDER" });
      const abort = new AbortController();
      renderAbortRef.current = abort;
      let rendered: { blob: Blob; thumbnail: Blob | null; width: number; height: number };
      try {
        rendered = await renderToBlob(sources, input.edits, {
          thumbnailAt: input.thumbnailAt,
          onProgress: (percent) => dispatch({ type: "RENDER_PROGRESS", percent }),
          signal: abort.signal,
        });
      } catch (err) {
        renderAbortRef.current = null;
        // A cancel is not an error the user needs told about.
        dispatch({
          type: "RENDER_FAILED",
          error: abort.signal.aborted
            ? ""
            : err instanceof Error
              ? err.message
              : "Render failed.",
        });
        return;
      }
      renderAbortRef.current = null;
      if (rendered.blob.size === 0) {
        dispatch({ type: "RENDER_FAILED", error: "Render produced no data." });
        return;
      }
      dispatch({ type: "RENDER_DONE" });

      // Free the camera and screen while the bytes go up. The streams are gone,
      // so the machine must know it: otherwise an UPLOAD_FAILED drops back to
      // `staging` still believing `streamsAlive`, and Discard lands in a `setup`
      // screen with no capture behind it.
      teardown();
      dispatch({ type: "STREAM_ENDED" });
      copiedRef.current = false;
      let reservedSlug = "";
      try {
        const result = await uploadRecording({
          blob: rendered.blob,
          durationMs: Math.round(editedDurationMs(input.edits, current.durationMs)),
          width: rendered.width,
          height: rendered.height,
          thumbnail: rendered.thumbnail,
          title: input.title,
          description: input.description,
          slug: input.slug,
          edits: input.edits,
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
    },
    [router, teardown],
  );

  /** Abort an in-flight render; the machine falls back to `staging`. */
  const cancelRender = useCallback(() => renderAbortRef.current?.abort(), []);

  // ---------- discard / reset ----------

  /**
   * Stop the current encoder and throw its bytes away. `onstop` is detached
   * first so `finishRecording` never runs for a take the user abandoned.
   */
  const discardRecorder = useCallback(() => {
    chunksRef.current = [];
    cameraChunksRef.current = [];
    const recorder = recorderRef.current;
    const cam = cameraRecorderRef.current;
    recorderRef.current = null;
    cameraRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.stop();
    }
    // The camera encoder has no `onstop` handler, but it must still be stopped
    // or it keeps writing chunks for a take nobody will ever see.
    if (cam && cam.state !== "inactive") {
      cam.ondataavailable = null;
      cam.stop();
    }
  }, []);

  const discard = useCallback(() => {
    dispatch({ type: "DISCARD" });
  }, []);

  const reset = useCallback(() => {
    teardown();
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
      state.status === "rendering" ||
      state.status === "uploading" ||
      (state.status === "staging" && !!state.blob);
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
      }
    });
  }, [acquire, discardRecorder]);

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
    state.status === "staging" ||
    state.status === "rendering" ||
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
          current.status === "staging" ||
          current.status === "rendering" ||
          current.status === "error" ||
          current.status === "idle"
            ? current.status
            : "other",
        elapsedMs: current.elapsedMs,
        countdown: current.countdown,
        markers: current.markers.length,
      });
    };

    // Push immediately so a transition is never a frame late, then keep the
    // timer alive only while there is a moving number to render.
    push();
    if (hudStatus !== "countdown" && hudStatus !== "recording") return;
    const id = window.setInterval(push, 250);
    return () => window.clearInterval(id);
  }, [hudStatus, state.markers.length]);

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
      finish: (input: FinishInput) => void finish(input),
      cancelRender,
      reset,
      toggleMic: (on?: boolean) => dispatch({ type: "TOGGLE_MIC", on }),
      toggleSystem: (on?: boolean) => dispatch({ type: "TOGGLE_SYSTEM", on }),
      setBubble: (patch: Partial<BubbleConfig>) => dispatch({ type: "SET_BUBBLE", patch }),
      setFrame: (patch: Partial<FrameConfig>) => dispatch({ type: "SET_FRAME", patch }),
    }),
    [acquire, cancelRender, discard, discardRecorder, finish, reacquireWith, reset],
  );

  return {
    state,
    capabilities,
    desktop,
    screenVideoRef,
    cameraVideoRef,
    staging,
    getLevel,
    actions,
  };
}
