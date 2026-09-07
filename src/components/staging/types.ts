import type { Marker, Overlay, VideoEdits, ZoomKind } from "@/lib/edits";
import type { StagingPlayer } from "@/lib/editor/use-staging-player";
import type { CursorAt } from "@/lib/editor/zoom";
import type { FinishInput } from "@/lib/recording/use-recorder";
import type {
  BubbleConfig,
  ClickSample,
  CursorSample,
  FrameConfig,
  KeySample,
  RecordingMode,
  StagingDefaults,
} from "@/lib/recording/types";
import type { RailSection } from "./rail";

/**
 * Everything the staging screen needs from the recorder. It owns no capture
 * state of its own: the two raw object URLs, the take's facts, and the two
 * callbacks that end staging.
 */
export interface StagingProps {
  mode: RecordingMode;
  /** The screen take; null in camera-only mode, where the take is the camera. */
  screenUrl: string | null;
  /** The camera take; in camera-only mode this is the single recorded file. */
  cameraUrl: string | null;
  durationMs: number;
  cameraOffsetMs: number;
  markers: Marker[];
  /**
   * The desktop shell's cursor track for this take (mouse-follow zoom), with
   * `t` already in SECONDS. Empty in the browser and for window captures, which
   * is how the Zoom section decides whether to offer "Follow mouse". Lives in
   * memory only: it is never written to `videos.edits` or to sessionStorage.
   */
  cursor: CursorSample[];
  /**
   * The take's global clicks, on the same terms as `cursor` (seconds, memory
   * only). Staging seeds `edits.clicks` from them once, on first load; from
   * then on the LANE is the truth and this array is only its origin. Empty
   * whenever the shell captured none — no hook, no Input Monitoring, or a
   * window capture — which is what hides the Clicks lane.
   */
  clicks: ClickSample[];
  /**
   * The take's key presses, same terms again. Read live by the renderer (the
   * `keys` overlay's badge samples it at draw time), never copied into the
   * edit list — only the overlay's span is persisted.
   */
  keys: KeySample[];
  defaults: { bubble: BubbleConfig; frame: FrameConfig };
  error: string;
  onFinish: (input: FinishInput) => void;
  onDiscard: () => void;
  /**
   * Public share origin, resolved on the server (see `shareBaseUrl()` in
   * `@/lib/env`). Threaded down from `src/app/page.tsx` because this tree is
   * a Client Component, where calling it directly would fall back to
   * localhost — see `video-card.tsx`'s `shareBase` prop for the same pattern.
   */
  shareBase: string;
}

/**
 * The upload metadata the rail collects; handed to `onFinish` untouched.
 * `slugOk` is the details form's verdict on the slug (false while its
 * availability check is in flight), read by the top bar to gate its Upload
 * button; an empty slug means "auto" and is always ok.
 */
export type Details = {
  title: string;
  description: string;
  slug: string;
  thumbnailAt: number;
  slugOk?: boolean;
};

/**
 * Which pointer gesture the preview is in. `select` drags/edits what exists.
 * Every member but `zoom`/`followZoom` is an `OverlayType` placed by a gesture
 * — which is why `image` is NOT here: an image is placed from the Overlays
 * section's file picker, not rubber-banded, so arming it as a tool would let
 * you draw a picture-less image overlay. (`keys` and `click` are likewise not
 * drawn: they come from the take's input tracks.)
 *
 * `zoom` and `followZoom` differ only in the `ZoomKind` the drag produces.
 */
export type Tool =
  | "select"
  | "blur"
  | "blackout"
  | "ellipse"
  | "rect"
  | "step"
  | "highlight"
  | "underline"
  | "line"
  | "arrow"
  | "text"
  | "emoji"
  | "draw"
  | "zoom"
  | "followZoom";

/**
 * The one selected editable thing, shared by the timeline, the preview and
 * the rail so Delete/Backspace has a single meaning. `t` is the camera
 * keyframe's source time (keyframes are addressed by time, not index).
 * `"camera"` selects the bubble as a whole (its track has no keyframe
 * concept independent of `"keyframe"` above); its `index` is always `0` —
 * there is one camera track.
 */
export type Selection =
  | { kind: "overlay" | "cut" | "keyframe" | "zoom" | "camera"; index: number; t?: number }
  | null;

/**
 * The whole staging screen's state, passed down as one `ctx` prop rather
 * than through React context: every child re-renders with the edits anyway.
 */
export interface StagingContext {
  edits: VideoEdits;
  /** Apply an edit and push a history entry. */
  apply(fn: (e: VideoEdits) => VideoEdits): void;
  /** Apply without a history entry — for live drags; call `commit` on release. */
  applyLive(fn: (e: VideoEdits) => VideoEdits): void;
  /** Close a live drag by pushing the pre-drag `from` onto the undo stack. */
  commit(from: VideoEdits): void;
  player: StagingPlayer;
  /** Source duration in seconds. */
  duration: number;
  /**
   * The take's cursor track, `t` in seconds (see `StagingProps.cursor`). A
   * stable reference for the life of staging, and empty whenever there is no
   * track — an empty array means "no Follow mouse".
   */
  cursor: CursorSample[];
  /**
   * `cursor` filtered, for anything that has to resolve a `follow` zoom's
   * effective rect on screen (the zoom box, the overlay mapping). The same
   * sampler the player draws with; undefined when there is no track.
   */
  cursorAt?: CursorAt;
  /**
   * The take's raw input tracks (see `StagingProps`). The Cursor, input &
   * markers section reads their lengths to explain a take that captured
   * neither, and the Clicks lane is drawn from `edits.clicks`, not from
   * `clicks`.
   */
  clicks: ClickSample[];
  keys: KeySample[];
  mode: RecordingMode;
  tool: Tool;
  setTool(t: Tool): void;
  selected: Selection;
  setSelected(s: Selection): void;
  /**
   * Reveal a rail section. The timeline calls it alongside `setSelected` so
   * clicking a clip lands on the panel that edits it. Optional: the rail's
   * open section is `Staging`'s state, and nothing else has to care.
   */
  openSection?(id: RailSection): void;
  inPoint: number | null;
  outPoint: number | null;
  setInPoint(t: number | null): void;
  setOutPoint(t: number | null): void;
  details: Details;
  setDetails(d: Details | ((d: Details) => Details)): void;
  /**
   * Place a new overlay over `rect` at the playhead (or the in/out range).
   * `extra` carries the fields a rect alone cannot express — an arrow's
   * `from`/`to`, an image's `src` — and is merged in before the op runs.
   */
  addOverlayAt(type: Overlay["type"], rect: Overlay["rect"], extra?: Partial<Overlay>): void;
  /**
   * Place a new zoom over `rect` at the playhead (or the in/out range). `kind`
   * defaults to `static`; `follow` makes `rect` the window SIZE and lets the
   * centre ride the cursor track (see `edits.ts`), which is only meaningful on
   * a take that has one.
   */
  addZoomAt(rect: Overlay["rect"], kind?: ZoomKind): void;
  /**
   * Hand an object URL minted for the edits (an uploaded frame background) to
   * the screen, which revokes it when staging unmounts. Never revoked on
   * replacement: undo can put an earlier `src` back and the export still has
   * to be able to load it.
   */
  registerBlobUrl(url: string): void;
  finish(): void;
  discard(): void;
  error: string;
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  /**
   * The sticky appearance defaults last used in any take. A panel calls
   * `setStagingDefaults` alongside the `ops.*` call that changes the thing on
   * screen; `Staging` debounces the actual write to `localStorage`. Wired so
   * far: camera shape/mirror (seeded on a fresh take), overlay colour,
   * thickness, and arrow style (seeded on a newly placed overlay), and click
   * ripple colour/duration (seeded on the take's cursor config, read by
   * `render-input.ts`'s click-ripple draw).
   */
  stagingDefaults: StagingDefaults;
  setStagingDefaults(patch: Partial<StagingDefaults>): void;
}
