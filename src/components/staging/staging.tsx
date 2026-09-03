"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CURSOR, parseEdits, type CameraTrack, type Overlay, type VideoEdits, type ZoomKind } from "@/lib/edits";
import { defaultCameraTrack } from "@/lib/editor/camera-track";
import { createCursorSampler } from "@/lib/editor/cursor-path";
import * as ops from "@/lib/editor/edit-ops";
import { canRedo, canUndo, createHistory, push, redo, undo, type History } from "@/lib/editor/undo";
import { useStagingPlayer } from "@/lib/editor/use-staging-player";
import { DEFAULT_RAMP_S } from "@/lib/editor/zoom";
import { defaultRecordingTitle } from "@/lib/recording/upload";
import type { BackgroundConfig } from "@/lib/recording/types";
import { Preview } from "./preview";
import { Timeline } from "./timeline";
import { Rail, type RailSection } from "./rail";
import type { Details, Selection, StagingContext, StagingProps, Tool } from "./types";

export type { StagingProps } from "./types";

/**
 * Draft edits survive a reload while the take is being staged. The media does
 * not — a reload drops the blobs and the recorder returns to idle — so the
 * entry is keyed by duration and cleared on finish/discard.
 */
const STORAGE_KEY = "yoom.staging.v1";

/** `player.step` counts frames at the export rate; one second is 30 of them. */
const SECOND_IN_FRAMES = 30;
/** How long editing must pause before the draft is written back. */
const PERSIST_DEBOUNCE_MS = 300;
/** Mirrors the (unexported) `CAP` in `@/lib/editor/undo`; keep the two in step. */
const HISTORY_CAP = 50;

type Draft = { edits?: unknown; details?: Details };

/**
 * The persisted draft for *this* take, or null. Parsed once at mount: the
 * duration guard covers edits and details together, so a stale entry from an
 * earlier take can never leak a title into a new one.
 */
function readDraft(durationMs: number): Draft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object" || j.durationMs !== durationMs) return null;
    return j as Draft;
  } catch {
    /* no storage, or a corrupt entry: start fresh */
    return null;
  }
}

/**
 * A `blob:` frame background is dead the moment the page reloads, so it is
 * never worth persisting — drop it back to "no background" and keep the rest
 * of the frame (padding, radius, shadow) intact. A SAVED wallpaper survives:
 * its bytes are in IndexedDB, so keeping `wallpaperId` is enough for
 * `loadBackground` to mint a fresh URL after the reload.
 */
function persistableEdits(edits: VideoEdits): VideoEdits {
  const frame = edits.frame;
  if (!frame?.background.src?.startsWith("blob:")) return edits;
  const wallpaperId = frame.background.wallpaperId;
  const background: BackgroundConfig = wallpaperId
    ? { kind: "image", wallpaperId }
    : { kind: "none" };
  return { ...edits, frame: { ...frame, background } };
}

function initialEdits(p: StagingProps, screenAspect: number): VideoEdits {
  const base = parseEdits({ version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: p.markers });
  base.cameraOffsetMs = p.cameraOffsetMs;
  base.frame = p.defaults.frame;
  // `defaultCameraTrack` hardcodes `mirror: true`; the pre-record checkbox wins.
  if (p.mode === "screen+camera") {
    base.camera = {
      ...defaultCameraTrack(p.defaults.bubble.shape, p.defaults.bubble.size, screenAspect),
      mirror: p.defaults.bubble.mirror,
    };
  } else if (p.mode === "camera") {
    // Camera-only has no bubble (the rail hides the Camera section), but the
    // track still has to exist to carry `mirror` into the render — otherwise
    // the export falls back to mirroring unconditionally.
    base.camera = {
      shape: "circle",
      mirror: p.defaults.bubble.mirror,
      keyframes: [{ t: 0, mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } }],
    } satisfies CameraTrack;
  } else {
    base.camera = null;
  }
  // The clicks lane starts as the take's own click track with every mark on.
  // From here the LANE is the truth — it is persisted with the edits, so a
  // reload restores it from the draft instead of re-seeding from the track.
  const seeded = ops.setClicks(
    base,
    p.clicks.map((c) => ({ t: c.t, x: c.x, y: c.y, on: true })),
  );
  // `real`: the capture always contains the OS pointer (neither Electron nor
  // Chrome honours a `cursor: "never"` constraint any more), so the synthetic
  // arrow would be a SECOND cursor and has to be asked for. Motion blur is on.
  return ops.setMotionBlur(ops.setCursor(seeded, DEFAULT_CURSOR), true);
}

export function Staging(props: StagingProps) {
  const [draft] = useState<Draft | null>(() => readDraft(props.durationMs));

  const [history, setHistory] = useState<History<VideoEdits>>(() =>
    createHistory(draft ? parseEdits(draft.edits) : initialEdits(props, 16 / 9)),
  );
  const edits = history.present;

  const [details, setDetails] = useState<Details>(
    () => draft?.details ?? { title: defaultRecordingTitle(), description: "", slug: "", thumbnailAt: 1 },
  );

  const [section, setSection] = useState<RailSection>("trim");
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<Selection>(null);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);

  const player = useStagingPlayer(props.screenUrl, props.cameraUrl, props.mode, props.durationMs, edits, {
    cursor: props.cursor,
    keys: props.keys,
  });
  // One sampler for the whole screen: the player draws with it and the zoom
  // box measures against it, so the box lands exactly on what is rendered.
  const cursorAt = useMemo(
    () => (props.cursor.length > 0 ? createCursorSampler(props.cursor) : undefined),
    [props.cursor],
  );
  const duration = props.durationMs / 1000;
  const defaultBubbleSize = props.defaults.bubble.size;

  // The initial track is built against a guessed 16:9; once the real output
  // aspect is known, rebuild it — but only while it is still the untouched
  // default (one keyframe), so this never stomps a placed bubble. Adjusted
  // during render rather than in an effect: React re-runs this render before
  // committing, so the guessed track is never painted (see
  // https://react.dev/learn/you-might-not-need-an-effect).
  const [aspectSeen, setAspectSeen] = useState(0);
  const aspect = player.size.width > 16 ? player.size.width / player.size.height : 0;
  if (aspect !== 0 && aspect !== aspectSeen) {
    setAspectSeen(aspect);
    setHistory((h) => {
      const cam = h.present.camera;
      // Only the screen+camera bubble is aspect-dependent. Camera-only's track
      // is a full-frame mirror carrier — rebuilding it would make it a bubble.
      if (props.mode !== "screen+camera" || !cam || cam.keyframes.length !== 1) return h;
      // Carry `mirror` over: it came from the pre-record checkbox and
      // `defaultCameraTrack` would reset it to `true`.
      const rebuilt = { ...defaultCameraTrack(cam.shape, defaultBubbleSize, aspect), mirror: cam.mirror };
      return { ...h, present: ops.setCamera(h.present, rebuilt) };
    });
  }

  // Debounced: a drag pushes a new `edits` on every pointer move, and
  // serialising the whole edit list at 60 Hz is pure jank.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ durationMs: props.durationMs, edits: persistableEdits(edits), details }),
        );
      } catch {
        /* storage full or unavailable: the draft just is not restorable */
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [edits, details, props.durationMs]);

  const apply = useCallback((fn: (e: VideoEdits) => VideoEdits) => setHistory((h) => push(h, fn(h.present))), []);
  /** Live drags update `present` without a history entry; call `commit` on release. */
  const applyLive = useCallback(
    (fn: (e: VideoEdits) => VideoEdits) => setHistory((h) => ({ ...h, present: fn(h.present) })),
    [],
  );
  const commit = useCallback(
    (from: VideoEdits) =>
      setHistory((h) =>
        h.present === from
          ? h
          : { past: [...h.past, from].slice(-HISTORY_CAP), present: h.present, future: [] },
      ),
    [],
  );

  // The hook hands back a fresh object every render, so the shortcut handler
  // reads it through a ref: otherwise the window listener would be torn down
  // and re-added ten times a second during playback.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      /*
        Space is the transport and NOTHING else. This listener is on `window`
        in the CAPTURE phase, so stopping propagation here keeps the event away
        from whatever happens to have focus: a button (or a lane diamond) is
        activated by Space on keyUP, so both halves of the press have to be
        swallowed, or clicking a lane and hitting space would re-fire that
        control instead of playing. `preventDefault` also kills the page scroll.
      */
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        e.stopPropagation();
        // Auto-repeat while the bar is held must not toggle 30 times a second.
        if (e.type === "keydown" && !e.repeat) playerRef.current.toggle();
        return;
      }
      // Everything below is a keydown shortcut; keyup only exists here for Space.
      if (e.type !== "keydown" || typing) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
        return;
      }
      if (meta) return;
      const p = playerRef.current;
      // The throttled `time` lags by up to 100 ms; mark from the live playhead.
      const now = p.timeRef.current;
      if (e.key === ",") p.step(-1);
      if (e.key === ".") p.step(1);
      // Arrows mirror `,`/`.` — one frame, or a second with Shift. `step`
      // counts frames at the export rate, so a second is 30 of them.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        p.step(dir * (e.shiftKey ? SECOND_IN_FRAMES : 1));
        return;
      }
      // Home/End land on the EDITED timeline, so a cut at either end does not
      // strand the playhead on material the viewer never sees.
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        p.pause();
        p.seekEdited(e.key === "Home" ? 0 : p.editedDuration);
        return;
      }
      if (e.key.toLowerCase() === "i") setInPoint(now);
      if (e.key.toLowerCase() === "o") setOutPoint(now);
      if (e.key.toLowerCase() === "c" && inPoint !== null && outPoint !== null) {
        apply((ed) => ops.addCut(ed, { start: Math.min(inPoint, outPoint), end: Math.max(inPoint, outPoint) }));
        setInPoint(null);
        setOutPoint(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        if (selected.kind === "overlay") apply((ed) => ops.removeOverlay(ed, selected.index));
        if (selected.kind === "cut") apply((ed) => ops.removeCut(ed, selected.index));
        if (selected.kind === "zoom") apply((ed) => ops.removeZoom(ed, selected.index));
        if (selected.kind === "keyframe" && selected.t !== undefined) {
          const t = selected.t;
          apply((ed) => ops.removeCameraKeyframe(ed, t));
        }
        setSelected(null);
      }
      if (e.key === "Escape") {
        setTool("select");
        setSelected(null);
      }
    };
    // Capture phase, and keyup as well as keydown — see the Space branch.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [apply, inPoint, outPoint, selected]);

  /** In/out points scope a new span when both are set; otherwise 3 s from the playhead. */
  const spanForNew = useCallback(() => {
    if (inPoint !== null && outPoint !== null) {
      return { start: Math.min(inPoint, outPoint), end: Math.max(inPoint, outPoint) };
    }
    const start = playerRef.current.timeRef.current;
    return { start, end: Math.min(duration, start + 3) };
  }, [duration, inPoint, outPoint]);

  const addOverlayAt = useCallback(
    (type: Overlay["type"], rect: Overlay["rect"], extra?: Partial<Overlay>) => {
      const { start, end } = spanForNew();
      // `extra` first, so it cannot overwrite the identity fields; `addOverlay`
      // is what re-derives an arrow's rect from the `from`/`to` it carries.
      const next = ops.addOverlay(edits, { ...extra, type, start, end, rect });
      apply(() => next);
      // `addOverlay` refuses past `MAX_OVERLAYS`: only select what it added.
      if (next.overlays.length > edits.overlays.length) {
        setSelected({ kind: "overlay", index: next.overlays.length - 1 });
      }
      setTool("select");
    },
    [apply, edits, spanForNew],
  );

  const addZoomAt = useCallback(
    (rect: Overlay["rect"], kind: ZoomKind = "static") => {
      const { start, end } = spanForNew();
      // Only a follow zoom carries a `kind`: an absent one already means
      // static everywhere that reads it, so a plain zoom stays plain on disk.
      const next = ops.addZoom(edits, kind === "follow" ? { start, end, rect, kind } : { start, end, rect });
      apply(() => next);
      // `insertZoom` re-sorts and can drop the new zoom as a sliver, so find
      // it by its (disjoint, therefore unique) start rather than by position.
      const at = next.zooms.findIndex((z) => z.start === start);
      setSelected(at >= 0 ? { kind: "zoom", index: at } : null);
      if (at >= 0) {
        // Land past the ease-in, like the rail's Go button, so the drawn
        // region is actually shown zoomed instead of mid-ramp.
        const z = next.zooms[at];
        playerRef.current.seek(Math.min(z.end, z.start + (z.ramp ?? DEFAULT_RAMP_S)));
      }
      setTool("select");
    },
    [apply, edits, spanForNew],
  );

  // Object URLs minted for the edits (uploaded frame backgrounds). They
  // outlive any single rail section — undo can restore an earlier `src`, and
  // the export loads whichever one is current — so they are only released
  // when the whole screen goes away, which covers both finish and discard.
  const blobUrls = useRef<string[]>([]);
  const registerBlobUrl = useCallback((url: string) => {
    if (url.startsWith("blob:") && !blobUrls.current.includes(url)) blobUrls.current.push(url);
  }, []);
  useEffect(() => {
    const urls = blobUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.length = 0;
    };
  }, []);

  const finish = useCallback(() => {
    props.onFinish({
      edits,
      title: details.title,
      description: details.description,
      slug: details.slug,
      thumbnailAt: details.thumbnailAt,
    });
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [details, edits, props]);

  const discard = useCallback(() => {
    if (!window.confirm("Discard this take? Both recordings are thrown away.")) return;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    props.onDiscard();
  }, [props]);

  /*
    NOTE: `player` is a fresh object every render, so this memo recomputes on
    every render — deliberately. `useStagingPlayer` lives here, so its 10 Hz
    `time` push re-renders this component during playback no matter what the
    memo does; dropping `player` from the deps would only make `ctx` stale
    (the preview's play/pause state and the timeline's readout both read it).
    The 60 Hz work is already kept out of React: the canvas draws from the
    hook's own rAF and the playhead animates from `player.timeRef`.
  */
  const ctx = useMemo<StagingContext>(
    () => ({
      edits,
      apply,
      applyLive,
      commit,
      player,
      duration,
      cursor: props.cursor,
      cursorAt,
      clicks: props.clicks,
      keys: props.keys,
      mode: props.mode,
      tool,
      setTool,
      selected,
      setSelected,
      openSection: setSection,
      inPoint,
      outPoint,
      setInPoint,
      setOutPoint,
      details,
      setDetails,
      addOverlayAt,
      addZoomAt,
      registerBlobUrl,
      finish,
      discard,
      error: props.error,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      undo: () => setHistory(undo),
      redo: () => setHistory(redo),
    }),
    [
      edits,
      apply,
      applyLive,
      commit,
      player,
      duration,
      props.cursor,
      cursorAt,
      props.clicks,
      props.keys,
      props.mode,
      props.error,
      tool,
      selected,
      inPoint,
      outPoint,
      details,
      addOverlayAt,
      addZoomAt,
      registerBlobUrl,
      finish,
      discard,
      history,
    ],
  );

  return (
    <div className="grid w-full max-w-6xl select-none gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <Preview ctx={ctx} />
        <Timeline ctx={ctx} />
      </div>
      <Rail ctx={ctx} section={section} onSection={setSection} />
    </div>
  );
}
