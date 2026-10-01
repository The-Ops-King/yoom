"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import fixWebmDuration from "fix-webm-duration";
import type { VideoEdits } from "@/lib/edits";
import { editedDuration } from "@/lib/editor/cuts";
import { renderToBlob, type RenderResult, type RenderSources } from "@/lib/editor/export";
import type { FastRenderResult } from "@/lib/editor/fast-export/render-fast";
import { shareUrl } from "@/lib/share";
import { StreamingUpload } from "@/lib/streaming-upload";
import { AudioMixer } from "./audio-mixer";
import { appendSamples, toSeconds } from "./cursor-track";
import {
  changeDesktopShare,
  isDesktop,
  onDesktopCursor,
  onDesktopInput,
  onDesktopShareSource,
  onDesktopShortcut,
  setDesktopHudState,
  setDesktopShareMode,
} from "./desktop-bridge";
import { getProvider, isCaptureCancellation } from "./media-sources";
import { CAPTURE_CODECS, pickMimeType } from "./mime";
import {
  MAX_DURATION_MS,
  RESTART_COUNTDOWN_SECONDS,
  initialRecorderState,
  recorderReducer,
  type RecorderState,
} from "./recorder-machine";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";
import { clearStagingDraft, STAGING_DRAFT_KEY } from "./staging-draft";
import {
  createTake,
  deleteTake,
  finalizeTake,
  listTakes,
  loadTake,
  pruneTakes,
  type TakeSummary,
} from "./take-store";
import { TakeWriter } from "./take-writer";
import {
  beginUpload,
  completeUpload,
  uploadRecording,
  type UploadRecordingResult,
} from "./upload";
import type {
  BubbleConfig,
  Capabilities,
  ClickSample,
  CursorSample,
  FrameConfig,
  HudStatus,
  KeySample,
  RecordingMode,
  ShareSource,
  SurfacePref,
} from "./types";

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
  /**
   * What the desktop shell says it is sharing, for the ready panel's "Sharing"
   * row. Always null in the browser and on a shell that predates auto-share —
   * the panel falls back to a generic label rather than hiding the row, since
   * something IS being shared either way.
   */
  shareSource: ShareSource | null;
  /** Raw screen preview while configuring (screen and screen+camera). */
  screenVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Raw camera preview while configuring (camera and screen+camera). */
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>;
  /**
   * What staging needs from the take: object URLs for the two raw files, plus
   * the desktop cursor track. Null outside staging.
   *
   * `cursor` is the mouse-follow-zoom track, and its `t` is in SECONDS here —
   * the bridge delivers milliseconds, and the conversion happens at this
   * boundary because staging's whole timeline is in seconds. It is empty in the
   * browser, on a shell that predates the feature, and for window captures
   * (only display captures produce samples), which is the signal to hide the
   * "Follow mouse" toggle. The array identity is stable for the whole staging
   * session.
   */
  staging: {
    screenUrl: string | null;
    cameraUrl: string | null;
    cursor: CursorSample[];
    /**
     * The take's global clicks, `t` in SECONDS like `cursor`. Staging seeds
     * `edits.clicks` from them once. Empty in the browser, on a shell that
     * predates the input hook, without macOS Input Monitoring, and for window
     * captures — which is how the Clicks lane decides whether to appear.
     */
    clicks: ClickSample[];
    /** The take's key presses, on the same terms as `clicks`. */
    keys: KeySample[];
    /**
     * Id of the crash-safe copy of this take in the take store, so staging can
     * keep its draft somewhere durable. Null when IndexedDB is unavailable.
     */
    takeId: string | null;
  } | null;
  /**
   * Unsaved takes left behind by an earlier run, newest first, for the restore
   * prompt. `null` until the store has been read — which is NOT the same as
   * "none": the desktop shell holds off re-sharing the screen while it is null,
   * so the prompt is never skipped by an auto-acquire landing first.
   */
  pendingTakes: TakeSummary[] | null;
  getLevel: (id: "mic" | "system") => number;
  actions: {
    /** Screen (screen + camera) or camera only. Idle/setup only. */
    setMode(mode: RecordingMode): void;
    setSurfacePref(pref: SurfacePref): void;
    setDevice(kind: "mic" | "camera", deviceId: string): void;
    acquire(): void;
    /**
     * Desktop only: pick a different screen or window. Asks the shell for a
     * one-shot picker, then re-acquires.
     */
    changeShare(): void;
    start(): void;
    skipCountdown(): void;
    pause(): void;
    resume(): void;
    stop(): void;
    /**
     * Throw the take away and count a new one in with the short "Ready? Go!"
     * countdown. Restart button / ⌘⇧K.
     */
    restart(): void;
    /** Throw the take away and go back to setup. Trash button / ⌘⇧X. */
    cancel(): void;
    /** Drop a timestamp marker at the current elapsed time. Mark button / ⌘⇧M. */
    mark(): void;
    discard(): void;
    /**
     * Put a stored take back on screen (staging). Ignored unless the recorder
     * is `idle`/`error`; never throws, and drops the take from `pendingTakes`
     * either way so the prompt cannot get stuck on it.
     */
    restoreTake(id: string): void;
    /** Throw a stored take away without looking at it. Never throws. */
    dropTake(id: string): void;
    /** Render the edit list to one file, then upload it with the details. */
    finish(input: FinishInput): void;
    /**
     * Abort the export. On the fast path the render and the upload overlap and
     * share one controller, so this is the only Cancel either half needs.
     */
    cancelExport(): void;
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
  // What the shell says it is sharing. Null in the browser and until the first
  // announcement arrives; the ready panel labels that case generically.
  const [shareSource, setShareSource] = useState<ShareSource | null>(null);
  const [stagingUrls, setStagingUrls] = useState<{
    screenUrl: string | null;
    cameraUrl: string | null;
  } | null>(null);
  // Id of the stored copy of the take on screen, for staging's durable draft.
  // Set when the take is finalized; null again as soon as it is thrown away.
  const [takeId, setTakeId] = useState<string | null>(null);
  /** Unsaved takes from an earlier run; null until the store has been read. */
  const [pendingTakes, setPendingTakes] = useState<TakeSummary[] | null>(null);

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
  // One controller for the whole export — render AND upload. On the fast path
  // the two overlap, so Cancel has to reach both through the same signal.
  const exportAbortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const dimensionsRef = useRef<{ width: number | null; height: number | null }>({
    width: null,
    height: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  // Mouse-follow zoom: the desktop shell's cursor samples for the current take,
  // in the bridge's own unit (milliseconds of recorded material). Kept in a ref
  // because nothing re-renders on a new batch — staging reads the finished
  // track once. Cleared when a take begins and when one is thrown away.
  const cursorRef = useRef<CursorSample[]>([]);
  // The other two input tracks, on identical terms: the shell's native hook
  // forwards them in one mixed batch and they are split by `kind` here.
  const clicksRef = useRef<ClickSample[]>([]);
  const keysRef = useRef<KeySample[]>([]);
  // Settings are only persisted once the stored settings have been read back,
  // so the first render never writes DEFAULT_SETTINGS over the saved ones.
  const hydratedRef = useRef(false);
  // The desktop app's zero-friction start acquires once, on mount. One shot:
  // after a Cancel back to `idle` the user asked to stop sharing, and grabbing
  // the screen again behind their back would be rude.
  const autoAcquiredRef = useRef(false);
  /** Crash-safe copy of the current take (see take-store.ts); null outside a take. */
  const takeWriterRef = useRef<TakeWriter | null>(null);
  /**
   * Bumped by every restore attempt and by every new take. A `restoreTake`
   * continuation whose token no longer matches has been superseded and must
   * touch nothing (see `restoreTake`).
   */
  const restoreSeqRef = useRef(0);

  // ---------- boot: settings + capabilities ----------

  useEffect(() => {
    const settings = loadSettings();
    // `loadSettings` only ever returns a mode the picker offers, so this is
    // safe to feed straight into the machine.
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
    // Sticky, and sent before anything can ask for a display: the shell should
    // answer with the last recorded source and no picker.
    if (isDesktop()) setDesktopShareMode("auto");
    hydratedRef.current = true;
  }, []);

  // What survived the last run. Anything older than two weeks is dropped first:
  // an unsaved take that has sat there that long is never coming back, and its
  // chunks are the biggest thing this origin stores.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined); // ask Chromium not to evict takes
    void pruneTakes(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .then(listTakes)
      .then(setPendingTakes)
      // `listTakes` never throws and `pruneTakes` swallows its own failures, but
      // leaving this null forever would wedge the desktop auto-acquire below.
      .catch(() => setPendingTakes([]));
  }, []);

  // Which source the shell is sharing. Subscribed for the life of the page; a
  // no-op in the browser.
  useEffect(() => onDesktopShareSource(setShareSource), []);

  // Mouse-follow zoom: subscribe once for the life of the page. The shell only
  // emits while a take is live, and `beginRecording` clears the track, so there
  // is nothing to unsubscribe between takes. A no-op in the browser.
  useEffect(() => onDesktopCursor((batch) => {
    cursorRef.current = appendSamples(cursorRef.current, batch);
  }), []);

  // Clicks and keys arrive on one mixed, time-ordered channel (`yoom:input`),
  // subscribed for the life of the page like the cursor. `kind` is dropped on
  // the way in: the two tracks are separate everywhere downstream, and staging
  // asks different questions of each.
  useEffect(() => onDesktopInput((batch) => {
    // Split the batch first and append once per track: `appendSamples` copies,
    // so appending sample by sample would be quadratic in a long take.
    const clicks: ClickSample[] = [];
    const keys: KeySample[] = [];
    for (const s of batch) {
      if (s.kind === "click") clicks.push({ t: s.t, x: s.x, y: s.y, button: s.button });
      else keys.push({ t: s.t, key: s.key, mods: s.mods });
    }
    if (clicks.length > 0) clicksRef.current = appendSamples(clicksRef.current, clicks);
    if (keys.length > 0) keysRef.current = appendSamples(keysRef.current, keys);
  }), []);

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
      // `staging` is not tracked in RecorderState (that's a sibling task's
      // job); read back whatever is currently stored so this save — which
      // fully overwrites the settings blob — never clobbers a staging
      // preference the editor persisted separately via `persistStaging`.
      staging: loadSettings().staging,
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

  /**
   * Delete the persisted bytes of the current take (restart, cancel, discard,
   * uploaded). The writer ref is dropped synchronously, so nothing can queue a
   * chunk behind the delete; `flush()` then waits for the writes already in
   * flight. `appendChunk` aborts on a missing take, so an unflushed write could
   * not corrupt anything — waiting just keeps the delete from racing a write
   * that would otherwise log a failure. The cost is that a discard is only as
   * fast as the outstanding writes, which on the upload path is a beat of
   * latency before the redirect.
   *
   * Never rejects — a missing IndexedDB means there was nothing to delete.
   */
  const discardStoredTake = useCallback(async () => {
    const writer = takeWriterRef.current;
    takeWriterRef.current = null;
    setTakeId(null);
    if (!writer) return;
    const id = await writer.id();
    if (!id) return;
    await writer.flush();
    await deleteTake(id).catch(() => undefined);
  }, []);

  /**
   * Put a stored take back on screen. Only from `idle`/`error` — the reducer
   * ignores RESTORE from anywhere else, and the side effects here (the input
   * tracks, the draft, the writer) would still have overwritten a take the user
   * is editing, so they are gated on a fresh check taken AFTER the last await.
   *
   * Reading and patching a long take takes seconds, and every one of those
   * awaits is a chance for the user to start a new take or to pick a different
   * stored one. Two guards cover that, and neither subsumes the other:
   * `restoreSeqRef` catches a newer restore and a new take (`beginRecording`
   * bumps it) — including the case where the newer restore has not reached its
   * dispatch yet, so a status check would still read `idle`; the status
   * re-check catches the acquire/setup path, which starts no take and so never
   * bumps the seq, but must not be dropped into staging from under the user.
   *
   * Never rejects: a store that cannot be read drops the entry from the prompt
   * (the bytes stay on disk for the next run) rather than leaving a button that
   * does nothing.
   */
  const restoreTake = useCallback(async (id: string) => {
    const status = stateRef.current.status;
    if (status !== "idle" && status !== "error") return;
    const attempt = ++restoreSeqRef.current;
    let take;
    try {
      take = await loadTake(id);
    } catch (err) {
      console.warn("[Yoom] could not read the stored take", err);
      setPendingTakes((p) => p?.filter((t) => t.id !== id) ?? null);
      return;
    }
    if (!take) {
      setPendingTakes((p) => p?.filter((t) => t.id !== id) ?? null);
      return;
    }
    const { meta } = take;
    // The stored chunks have no EBML duration, same as a fresh recording.
    // `fixWebmDuration` can throw synchronously (it reads the blob), and this
    // callback is void-called from a click handler, so the try covers both a
    // throw and a rejection rather than only the latter.
    const patch = async (b: Blob) => {
      if (!meta.mimeType.includes("webm")) return b;
      try {
        return await fixWebmDuration(b, meta.durationMs, { logger: false });
      } catch {
        return b;
      }
    };
    const primary = await patch(take.screen);
    const secondary = take.camera ? await patch(take.camera) : null;
    // Last chance to bail: from here down everything is a side effect.
    // The seq covers a newer restore and a new take; the status covers an
    // acquire that has moved the user on to `setup` in the meantime.
    if (restoreSeqRef.current !== attempt) return;
    const now = stateRef.current.status;
    if (now !== "idle" && now !== "error") return;
    cursorRef.current = meta.cursor;
    clicksRef.current = meta.clicks;
    keysRef.current = meta.keys;
    // Staging reads its draft synchronously at mount, from sessionStorage. The
    // duration is overwritten because a take that never finalized carries an
    // ESTIMATED one here, which `readDraft`'s guard would otherwise reject.
    if (take.draft) {
      try {
        sessionStorage.setItem(
          STAGING_DRAFT_KEY,
          JSON.stringify({ ...take.draft, durationMs: meta.durationMs }),
        );
      } catch {
        /* the take restores without its edits */
      }
    } else {
      // A take with no draft must land in a CLEAN staging. Only a finished
      // upload or a discard otherwise clears the key, so an abandoned take's
      // draft is still sitting there — and `readDraft` matches on duration
      // alone, which for an unfinalized take is quantized to 250 ms chunks and
      // collides easily. That would carry a stranger's title and description
      // into this take. This branch is the third and last clearer of the key
      // (see `staging-draft.ts`).
      clearStagingDraft();
    }
    // Staging keeps writing its draft to the same record, and a new take
    // replaces this writer wholesale (`beginRecording`), so the reused chunk
    // sequence is never appended to.
    takeWriterRef.current = new TakeWriter(Promise.resolve(id));
    setTakeId(id);
    setPendingTakes((p) => p?.filter((t) => t.id !== id) ?? null);
    dispatch({
      type: "RESTORE",
      mode: meta.mode,
      blob: primary,
      cameraBlob: secondary,
      cameraOffsetMs: meta.cameraOffsetMs,
      durationMs: meta.durationMs,
      width: meta.width,
      height: meta.height,
      markers: meta.markers,
    });
  }, []);

  /** Throw a stored take away from the restore prompt. Never rejects. */
  const dropTake = useCallback(async (id: string) => {
    await deleteTake(id).catch(() => undefined);
    setPendingTakes((p) => p?.filter((t) => t.id !== id) ?? null);
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

  /**
   * Zero-friction start in the desktop app: the shell answers `getDisplayMedia`
   * with the last recorded screen and no picker, so the ready panel can be on
   * screen the moment the window opens. With nothing remembered the shell shows
   * its picker, which is the same first-run experience as before.
   *
   * The browser deliberately does NOT do this: `getDisplayMedia` needs a user
   * gesture, so there the "Choose what to share" button stays.
   */
  useEffect(() => {
    // Offer to restore an unsaved take before grabbing the screen again.
    if (pendingTakes === null || pendingTakes.length > 0) return;
    if (!desktop || autoAcquiredRef.current) return;
    if (state.status !== "idle" || state.mode === "camera") return;
    autoAcquiredRef.current = true;
    void acquire();
  }, [desktop, pendingTakes, state.status, state.mode, acquire]);

  /**
   * "Change" in the ready panel: ask the shell for a one-shot picker, then
   * re-acquire so the picked source replaces the current one. On a shell that
   * predates the one-shot we would just re-acquire the SAME source and look
   * broken, so nothing happens there.
   */
  const changeShare = useCallback(() => {
    if (!changeDesktopShare()) return;
    if (stateRef.current.status === "setup") reacquireWith(() => {});
    else void acquire();
  }, [acquire, reacquireWith]);

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
    // A restore still reading its blobs off disk is now stale: this take owns
    // the input tracks and the writer it was about to overwrite.
    restoreSeqRef.current++;
    // Covers the first take and every restart: the shell's `t` restarts at 0
    // with the encoder, so a stale track would sit in front of the new one.
    cursorRef.current = [];
    clicksRef.current = [];
    keysRef.current = [];

    const mimeType = pickMimeType(CAPTURE_CODECS);
    const recorder = new MediaRecorder(recordStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: current.mode === "camera" ? 5_000_000 : 10_000_000,
    });

    // Start the crash-safe copy of this take. The previous writer is simply
    // dropped, never deleted: the two ways to get here still holding one are a
    // take that FAILED (an encoder error, the stop watchdog) and a take
    // RESTORED into staging that the user then recorded over, and in both cases
    // those bytes are exactly what the restore prompt exists to hand back.
    // `pruneTakes` ages them out if the user never wants them. Restart and
    // Cancel do delete theirs — they go through `discardRecorder` on the way
    // out.
    //
    // The recorder is built first so the store records the container the
    // browser actually chose, not the one we asked for: `loadTake` types the
    // restored Blob from this string, and a substituted container would
    // mislabel it.
    takeWriterRef.current = new TakeWriter(
      createTake({
        mode: current.mode,
        mimeType: (recorder.mimeType || mimeType || "video/webm").split(";")[0],
      }),
    );

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        takeWriterRef.current?.chunk("screen", e.data);
      }
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
        if (e.data.size > 0) {
          cameraChunksRef.current.push(e.data);
          takeWriterRef.current?.chunk("camera", e.data);
        }
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
  // is nulled by `restart` / `cancel` / `finishRecording`, so this fires on the
  // first entry and again on the way out of a restart's countdown, but never on
  // resume.
  useEffect(() => {
    if (state.status === "recording" && !recorderRef.current) beginRecording();
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
      // Nothing was captured, so the stored copy is an empty shell — drop it
      // rather than leave it for the restore prompt to offer.
      void discardStoredTake();
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

    // Complete the stored copy: the same description staging is about to get,
    // so a crash from here on can be restored into staging as-is. The metadata
    // is snapshotted NOW — the flush below can outlive the take, and a Discard
    // in the meantime would have emptied the refs and the machine's markers.
    // Snapshotting is enough because all four are reassigned wholesale when a
    // take ends, never mutated in place, so this object keeps the old arrays.
    const writer = takeWriterRef.current;
    const meta = {
      mode: stateRef.current.mode,
      mimeType: type,
      durationMs,
      cameraOffsetMs,
      width,
      height,
      markers: stateRef.current.markers,
      cursor: cursorRef.current,
      clicks: clicksRef.current,
      keys: keysRef.current,
    };
    void writer
      ?.id()
      .then((id) => {
        if (!id) return;
        // A Discard / Restart / Cancel between the stop and here has already
        // deleted this take and cleared `takeId`; publishing the dead id would
        // point staging at a record that no longer exists (its draft saves
        // would then fail with "Unknown take"). The ref is the flag: whoever
        // threw the take away replaced or nulled it.
        if (takeWriterRef.current !== writer) return;
        setTakeId(id);
        // `ok()` is false when a storage failure dropped chunks: the metadata
        // is all still true, but what is on disk is SHORTER than
        // `meta.durationMs`, and finalizing as-is would have the restore prompt
        // advertising 7:00 of a 0:30 file and staging drawing a timeline past
        // the end of the footage. The flag is the fix — `loadTake` overrides
        // that one field with its contiguous-chunk estimate and keeps
        // everything else. NOT finalizing would be far worse: the take would
        // fall back to an empty estimated meta and lose the cursor, clicks,
        // keys, markers, dimensions and `cameraOffsetMs` (which desyncs the
        // camera audibly) — all of which we are holding right here.
        return writer.flush().then(() => finalizeTake(id, meta, { truncated: !writer.ok() }));
      })
      .catch((err) => console.warn("[Yoom] could not finalize the stored take", err));

    dispatch({
      type: "BLOB_READY",
      blob,
      cameraBlob,
      cameraOffsetMs,
      durationMs,
      width,
      height,
    });
  }, [discardStoredTake]);

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
      setStagingUrls(null);
      return;
    }
    const url = URL.createObjectURL(state.blob);
    const cameraUrl = state.cameraBlob ? URL.createObjectURL(state.cameraBlob) : null;
    const camOnly = state.mode === "camera";
    setStagingUrls({ screenUrl: camOnly ? null : url, cameraUrl: camOnly ? url : cameraUrl });
    return () => {
      URL.revokeObjectURL(url);
      if (cameraUrl) URL.revokeObjectURL(cameraUrl);
    };
  }, [state.blob, state.cameraBlob, state.mode]);

  /*
    What staging actually receives. The three input tracks are read from their
    refs exactly once per take: `stagingUrls` only changes identity when the blobs
    do, i.e. when a NEW take lands, and the shell has stopped sampling by then —
    so the converted array is computed once and its identity stays stable for
    the whole staging session (the editor holds it in `ctx`).
  */
  const staging = useMemo(
    () =>
      stagingUrls
        ? {
            ...stagingUrls,
            takeId,
            cursor: toSeconds(cursorRef.current),
            clicks: toSeconds(clicksRef.current),
            keys: toSeconds(keysRef.current),
          }
        : null,
    [stagingUrls, takeId],
  );

  // ---------- render + upload ----------

  /**
   * Render the staged edit list into one file, then upload it. Both halves of
   * the trip live here because `rendering → uploading` is one user action
   * ("Save"), and a failure in either drops back to `staging` with the raw
   * blobs intact.
   *
   * The fast path overlaps them: `renderFast` writes the fragmented MP4's
   * bytes, in order, straight into a resumable Drive session that was opened
   * before the first frame, so Save costs max(render, upload) rather than
   * render + upload. Two fallbacks keep that from being a one-way bet — a
   * machine that cannot fast-export runs the old real-time render, and a
   * streamed upload that dies after the render is retried whole-file from the
   * bytes `StreamingUpload` kept, never by rendering again.
   *
   * The roadmap, in order — the phase banners below match these numbers:
   *   1. probe for WebCodecs (free: a machine that cannot fast-export opens no
   *      session and downloads no exporter)
   *   2. open the resumable Drive session, which reserves the share slug
   *   3. copy the share link, inside the click's transient activation
   *   4. import the fast exporter (the ~545 KB mediabunny chunk)
   *   5. render, streaming bytes into that session as they are muxed
   *   6. finish the session, then record the metadata against the Drive file
   *   7. clear the draft, drop the stored take, navigate to the video
   *
   * Steps 1-5 can still fall back to the legacy real-time render. From 6 on the
   * bytes are on Drive and only the upload half is retryable.
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
      exportAbortRef.current = abort;
      const { signal } = abort;
      const startedAt = performance.now();
      copiedRef.current = false;
      // One instant for both `/api/upload` calls: the Drive filename and the
      // default title are stamped from it, and on the fast path a whole render
      // separates the two calls.
      const now = new Date();

      try {
        // ---- shared shape of the trip ----

        const renderOpts = {
          thumbnailAt: input.thumbnailAt,
          onProgress: (percent: number) => dispatch({ type: "RENDER_PROGRESS", percent }),
          signal,
          cursor: toSeconds(cursorRef.current),
          // The key track is not persisted, so the export has to be handed it.
          // The CLICK track deliberately is not passed: what the render draws
          // is `edits.clicks`, the lane the user actually toggled, which rides
          // along inside `input.edits`.
          keys: toSeconds(keysRef.current),
        };
        // Everything every completion route sends unchanged.
        const common = {
          durationMs: Math.round(editedDurationMs(input.edits, current.durationMs)),
          title: input.title,
          description: input.description,
          edits: input.edits,
          // Every route that talks to `/api/upload` gets the SAME instant, so
          // the Drive filename and the default title agree however the take
          // got here. Left to default, each route would mint its own `new
          // Date()` after the render instead.
          now,
          signal,
        };

        // Filled in as the export progresses and read by `logExport`, so the
        // terminal log lines cannot drift apart between paths. `codecs` stays
        // null on the legacy path: MediaRecorder picks its own container and
        // never tells us which pair it settled on.
        let renderMs = 0;
        let exportedBytes = 0;
        let codecs: FastRenderResult["codecs"] | null = null;

        /**
         * One line per FINISHED export, on every path, with the same five keys.
         * Task 10 measures the fast path against the legacy baseline from these,
         * so a path that completes without logging is a path that cannot be
         * proven faster. The early `{path, reason}` lines below are a separate
         * thing: they say why the fast path was declined, before any timing
         * exists.
         */
        const logExport = (path: "fast" | "fast-retry" | "legacy") =>
          console.info("[Yoom] export", {
            path,
            codecs,
            renderMs: Math.round(renderMs),
            uploadTailMs: Math.round(performance.now() - startedAt - renderMs),
            bytes: exportedBytes,
          });

        // Loom behaviour: the link must be on the clipboard before the page
        // changes. `navigator.clipboard.writeText` only works inside the click's
        // transient activation (~5 s), and a real upload takes far longer than
        // that — so the server reserves the slug up front and we copy here, one
        // round-trip after the click.
        const copyLink = (slug: string) => {
          navigator.clipboard
            .writeText(shareUrl(slug))
            .then(() => {
              copiedRef.current = true;
            })
            .catch(() => {
              // Insecure context or denied permission; the detail page still
              // shows the link.
            });
        };

        /**
         * Step 7, and terminal: the recording exists, so forget the draft, drop
         * the crash-safe copy and navigate to it. Pairs with `failed`.
         */
        const succeed = async (result: UploadRecordingResult, reserved: string | undefined) => {
          if (reserved && result.slug !== reserved) {
            // A slug collision made the server mint a different one, so whatever
            // is on the clipboard points at the wrong video.
            console.warn(
              `Reserved slug ${reserved} was taken; saved as ${result.slug}. The copied link is stale.`,
            );
            copiedRef.current = false;
          }
          // Only now is the edit list safe to forget; every failure above drops
          // back to staging, which restores the cuts from this draft.
          clearStagingDraft();
          // The bytes are safely on the server; the crash-safe copy has done its
          // job. Awaited, not fired off: the redirect below unmounts this hook,
          // and a delete still in flight would leave an uploaded take on disk
          // for the restore prompt to offer next launch.
          await discardStoredTake();
          dispatch({ type: "UPLOAD_DONE", videoId: result.id, shareUrl: result.url });
          router.push(`/library/${result.id}${copiedRef.current ? "?new=1" : ""}`);
        };

        // A cancel is not an error the user needs told about.
        const failed = (type: "RENDER_FAILED" | "UPLOAD_FAILED", err: unknown) =>
          dispatch({
            type,
            error: signal.aborted
              ? ""
              : err instanceof Error
                ? err.message
                : type === "RENDER_FAILED"
                  ? "Render failed."
                  : "Upload failed. Please try again.",
          });

        /**
         * Yesterday's path, unchanged: render the whole file in real time, then
         * upload it. `reserved` is the slug the fast path already put on the
         * clipboard, if it got that far — `uploadRecording` asks the server for
         * that same slug so the copied link still lands on this video. With
         * nothing reserved yet, `onSlug` does the copying as it always did.
         */
        const runLegacy = async (reserved?: string) => {
          let reservedSlug = reserved;
          let rendered: RenderResult;
          try {
            rendered = await renderToBlob(sources, input.edits, renderOpts);
          } catch (err) {
            failed("RENDER_FAILED", err);
            return;
          }
          if (rendered.blob.size === 0) {
            dispatch({ type: "RENDER_FAILED", error: "Render produced no data." });
            return;
          }
          renderMs = performance.now() - startedAt;
          exportedBytes = rendered.blob.size;
          dispatch({ type: "RENDER_DONE" });

          // Free the camera and screen while the bytes go up. The streams are
          // gone, so the machine must know it: otherwise an UPLOAD_FAILED drops
          // back to `staging` still believing `streamsAlive`, and Discard lands
          // in a `setup` screen with no capture behind it.
          teardown();
          dispatch({ type: "STREAM_ENDED" });
          try {
            const result = await uploadRecording({
              ...common,
              blob: rendered.blob,
              width: rendered.width,
              height: rendered.height,
              thumbnail: rendered.thumbnail,
              slug: reservedSlug ?? input.slug,
              onProgress: (percent) => dispatch({ type: "UPLOAD_PROGRESS", percent }),
              onSlug: reservedSlug
                ? undefined
                : (slug) => {
                    reservedSlug = slug;
                    copyLink(slug);
                  },
            });
            logExport("legacy");
            await succeed(result, reservedSlug);
          } catch (err) {
            failed("UPLOAD_FAILED", err);
          }
        };

        // ---- 1. can this machine fast-export at all? ----
        //
        // The WebCodecs probe is free and comes first: a machine that cannot
        // fast-export neither opens a Drive session it will never write a byte
        // to nor downloads the exporter chunk in step 4.
        if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
          console.info("[Yoom] export", { path: "legacy", reason: "no WebCodecs" });
          await runLegacy();
          return;
        }

        // ---- 2. open the Drive session, reserving the share slug ----
        let session: { sessionUri: string; slug?: string };
        try {
          session = await beginUpload({ mimeType: "video/mp4", slug: input.slug, now, signal });
        } catch (err) {
          // Still `rendering` as far as the machine is concerned, so this is a
          // RENDER_FAILED — it drops back to staging with the edits intact.
          failed("RENDER_FAILED", err);
          return;
        }

        // ---- 3. the share link, while the click is still "recent" ----
        if (session.slug) copyLink(session.slug);

        // ---- 4. load the fast exporter ----
        //
        // THIS IMPORT MUST STAY BELOW STEP 3. `writeText` only succeeds inside
        // the click's transient activation (~5 s), so nothing slower than the
        // one `/api/upload` round-trip may run before it — and this is a ~545 KB
        // chunk fetch that is cold on first Save and on a slow disk. Hoisting it
        // to the top of `finish`, or to module scope, shaves a little latency
        // and silently costs the user the share link after every recording,
        // with every test still green. See the note on `copyLink` above.
        //
        // It is dynamic at all because it pulls in ~1.2 MB of mediabunny that
        // the legacy path never touches; a chunk that will not load is just one
        // more reason to render the old way.
        //
        // The codec-PAIR probe cannot run before this point — it lives inside
        // mediabunny — so a machine with WebCodecs but no encodable pair, like
        // a load failure here, abandons the session opened in step 2. Harmless:
        // `/api/upload` only hands back a session URI and an optimistic slug
        // (nothing is persisted until `/api/upload/complete`), and an untouched
        // resumable session expires on Drive's own schedule.
        let fast: typeof import("@/lib/editor/fast-export/render-fast");
        try {
          fast = await import("@/lib/editor/fast-export/render-fast");
        } catch (err) {
          console.warn("[Yoom] fast exporter did not load", err);
          console.info("[Yoom] export", { path: "legacy", reason: "fast exporter did not load" });
          // The reserved slug goes with it, so the link already on the clipboard
          // still points at this recording.
          await runLegacy(session.slug);
          return;
        }

        // ---- 5. render, streaming the bytes as they are muxed ----
        //
        // Upload percent is acked bytes over the finished file's size, and that
        // size is only known once `renderFast` returns. So the callback closes
        // over a total that is still 0 for the whole overlapped half and stays
        // silent until then — during which the render bar is the honest one (and
        // the machine ignores UPLOAD_PROGRESS while `rendering` anyway). No
        // throttling: `renderFast` only reports whole percents, and this fires
        // once per 8 MiB chunk Drive acknowledges.
        let renderedBytes = 0;
        const up = new StreamingUpload(session.sessionUri, {
          signal,
          onProgress: (sent) => {
            if (renderedBytes <= 0) return;
            dispatch({
              type: "UPLOAD_PROGRESS",
              percent: Math.min(99, Math.round((sent / renderedBytes) * 100)),
            });
          },
        });

        let rendered: FastRenderResult;
        try {
          rendered = await fast.renderFast(sources, input.edits, {
            ...renderOpts,
            onChunk: (data, position) => up.write(data, position),
          });
        } catch (err) {
          if (!(err instanceof fast.FastExportUnsupported) || signal.aborted) {
            // `failed` first, `abort` second: it reads `signal.aborted` to
            // decide whether this is a cancel, and aborting ahead of it would
            // report every render error as a silent one.
            failed("RENDER_FAILED", err);
            // Nobody will ever call `up.finish()` now, so stop the chunk PUTs
            // still in flight against a session that is going nowhere. Waste
            // only — Drive drops an abandoned session itself — but it is a line.
            abort.abort();
            return;
          }
          // This machine has WebCodecs but no encodable codec pair, and it said
          // so before writing a byte. Render the old way into the slug we
          // reserved. NOT aborted: `runLegacy` renders on this same signal, so
          // killing it here would cancel the fallback before it started.
          console.info("[Yoom] export", { path: "legacy", reason: err.message });
          await runLegacy(session.slug);
          return;
        }
        if (rendered.size === 0) {
          // Same guard the legacy path has: a zero-byte file fails loudly here
          // rather than becoming an empty video on the library page.
          dispatch({ type: "RENDER_FAILED", error: "Render produced no data." });
          abort.abort();
          return;
        }
        renderedBytes = rendered.size;
        exportedBytes = rendered.size;
        codecs = rendered.codecs;
        renderMs = performance.now() - startedAt;
        dispatch({ type: "RENDER_DONE" });

        // Free the camera and screen while the tail of the bytes goes up. The
        // streams are gone, so the machine must know it: otherwise an
        // UPLOAD_FAILED drops back to `staging` still believing `streamsAlive`,
        // and Discard lands in a `setup` screen with no capture behind it.
        teardown();
        dispatch({ type: "STREAM_ENDED" });

        // ---- 6. close the session and record the metadata ----
        try {
          let driveFileId: string;
          try {
            ({ id: driveFileId } = await up.finish());
          } catch (err) {
            if (signal.aborted) throw err;
            // The streamed session died, but `StreamingUpload` kept every byte —
            // so retry the file whole rather than make the user sit through a
            // second render. A fresh session reserves the same slug, so the link
            // already on the clipboard still points here.
            console.warn("[Yoom] streamed upload failed; retrying whole-file", err);
            const retried = await uploadRecording({
              ...common,
              blob: up.blob(rendered.mimeType),
              width: rendered.width,
              height: rendered.height,
              thumbnail: rendered.thumbnail,
              slug: session.slug ?? input.slug,
              onProgress: (percent) => dispatch({ type: "UPLOAD_PROGRESS", percent }),
            });
            // Its own path name: the tail here is a full whole-file upload, so
            // averaging it in with a clean "fast" export would understate the
            // overlap Task 10 is measuring.
            logExport("fast-retry");
            await succeed(retried, session.slug);
            return;
          }
          // From here the bytes are on Drive. A `completeUpload` failure below
          // therefore leaves that file orphaned, and a re-Save from staging
          // uploads a second copy of the same take. That is the deliberate
          // trade from the plan: retrying `completeUpload` on its own would
          // risk duplicate VIDEO ROWS for one Drive file, which is the worse
          // duplicate — the orphan is invisible to the library and costs only
          // storage.
          const result = await completeUpload({
            ...common,
            driveFileId,
            reservedSlug: session.slug,
            width: rendered.width,
            height: rendered.height,
            thumbnail: rendered.thumbnail,
          });
          logExport("fast");
          // ---- 7. ----
          await succeed(result, session.slug);
        } catch (err) {
          failed("UPLOAD_FAILED", err);
        }
      } finally {
        // One place, so the next early return above cannot forget it. Guarded
        // in case a later export has already claimed the ref.
        if (exportAbortRef.current === abort) exportAbortRef.current = null;
      }
    },
    [discardStoredTake, router, teardown],
  );

  /**
   * Abort the export. One controller covers the render and the upload, so this
   * stops whichever halves are still running; the machine falls back to
   * `staging` (RENDER_FAILED) or, once uploading, to `staging` via
   * UPLOAD_FAILED — both with an empty error, since a cancel is not news.
   */
  const cancelExport = useCallback(() => exportAbortRef.current?.abort(), []);

  // ---------- discard / reset ----------

  /**
   * Stop the current encoder and throw its bytes away. `onstop` is detached
   * first so `finishRecording` never runs for a take the user abandoned.
   */
  const discardRecorder = useCallback(() => {
    // Covers both callers — Restart and Cancel throw the take away, so its
    // stored copy goes with it. This drops the writer ref synchronously, so the
    // encoders' last `ondataavailable` cannot queue anything more behind it.
    void discardStoredTake();
    chunksRef.current = [];
    cameraChunksRef.current = [];
    cursorRef.current = [];
    clicksRef.current = [];
    keysRef.current = [];
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
  }, [discardStoredTake]);

  const discard = useCallback(() => {
    dispatch({ type: "DISCARD" });
    void discardStoredTake();
  }, [discardStoredTake]);

  const reset = useCallback(() => {
    teardown();
    dispatch({ type: "RESET" });
  }, [teardown]);

  // Streams died (mode change, Stop sharing) → release everything.
  useEffect(() => {
    if (state.streamsAlive) return;
    if (state.status === "idle" || state.status === "error") teardown();
  }, [state.streamsAlive, state.status, teardown]);

  /**
   * The take is over the moment its bytes land in staging: nothing after that
   * (editing, rendering, uploading, done) reads a live source, and keeping the
   * display capture open leaves the screen "shared" — the macOS sharing
   * indicator stays lit and the desktop shell keeps its capture warm — for
   * as long as the editor is open. Release everything here. `streamsAlive`
   * goes false so Discard lands in `idle`, where the desktop shell re-shares
   * on its own (the auto-acquire is re-armed below) and the browser shows
   * its "Choose what to share" button, rather than in a `setup` with no
   * stream behind it. Restart is not reachable from staging (`LIVE` in the
   * machine), so no path expects the old stream to still be there.
   */
  useEffect(() => {
    if (state.status !== "staging" || !state.streamsAlive) return;
    teardown();
    dispatch({ type: "STREAM_ENDED" });
    autoAcquiredRef.current = false;
  }, [state.status, state.streamsAlive, teardown]);

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
        dispatch({ type: "RESTART", seconds: RESTART_COUNTDOWN_SECONDS });
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
        dispatch({ type: "RESTART", seconds: RESTART_COUNTDOWN_SECONDS });
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
      // From `setup` the mode toggle swaps the live capture under the panel
      // rather than dropping back to a blank idle screen.
      setMode: (mode: RecordingMode) =>
        reacquireWith(() => dispatch({ type: "SELECT_MODE", mode })),
      setSurfacePref: (pref: SurfacePref) =>
        reacquireWith(() => dispatch({ type: "SET_SURFACE_PREF", pref })),
      setDevice: (kind: "mic" | "camera", deviceId: string) =>
        dispatch({ type: "SET_DEVICE", kind, deviceId }),
      acquire: () => void acquire(),
      changeShare,
      start: () => dispatch({ type: "START" }),
      skipCountdown: () => dispatch({ type: "SKIP_COUNTDOWN" }),
      pause: () => dispatch({ type: "PAUSE" }),
      resume: () => dispatch({ type: "RESUME" }),
      stop: () => dispatch({ type: "STOP" }),
      restart: () => {
        discardRecorder();
        dispatch({ type: "RESTART", seconds: RESTART_COUNTDOWN_SECONDS });
      },
      cancel: () => {
        discardRecorder();
        dispatch({ type: "CANCEL" });
      },
      mark: () => dispatch({ type: "MARK" }),
      discard,
      // Fire-and-forget like `finish`: both swallow their own failures, so a
      // click handler never has a rejection to deal with.
      restoreTake: (id: string) => void restoreTake(id),
      dropTake: (id: string) => void dropTake(id),
      finish: (input: FinishInput) => void finish(input),
      cancelExport,
      reset,
      toggleMic: (on?: boolean) => dispatch({ type: "TOGGLE_MIC", on }),
      toggleSystem: (on?: boolean) => dispatch({ type: "TOGGLE_SYSTEM", on }),
      setBubble: (patch: Partial<BubbleConfig>) => dispatch({ type: "SET_BUBBLE", patch }),
      setFrame: (patch: Partial<FrameConfig>) => dispatch({ type: "SET_FRAME", patch }),
    }),
    [
      acquire,
      cancelExport,
      changeShare,
      discard,
      discardRecorder,
      dropTake,
      finish,
      reacquireWith,
      reset,
      restoreTake,
    ],
  );

  return {
    state,
    capabilities,
    desktop,
    shareSource,
    screenVideoRef,
    cameraVideoRef,
    staging,
    pendingTakes,
    getLevel,
    actions,
  };
}
