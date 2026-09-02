import type { Marker, Overlay, VideoEdits } from "@/lib/edits";
import type { StagingPlayer } from "@/lib/editor/use-staging-player";
import type { FinishInput } from "@/lib/recording/use-recorder";
import type { BubbleConfig, FrameConfig, RecordingMode } from "@/lib/recording/types";

/**
 * Everything the staging screen needs from the recorder. It owns no capture
 * state of its own: the two raw object URLs, the take's facts, and the two
 * callbacks that end staging.
 */
export interface StagingProps {
  mode: RecordingMode;
  screenUrl: string | null;
  cameraUrl: string | null;
  durationMs: number;
  cameraOffsetMs: number;
  markers: Marker[];
  defaults: { bubble: BubbleConfig; frame: FrameConfig };
  error: string;
  onFinish: (input: FinishInput) => void;
  onDiscard: () => void;
}

/**
 * The upload metadata the rail collects; handed to `onFinish` untouched.
 * `slugOk` is the details form's verdict on the slug (false while its
 * availability check is in flight), read by the upload section to gate the
 * button; an empty slug means "auto" and is always ok.
 */
export type Details = {
  title: string;
  description: string;
  slug: string;
  thumbnailAt: number;
  slugOk?: boolean;
};

/** Which pointer gesture the preview is in. `select` drags/edits what exists. */
export type Tool = "select" | "blur" | "callout" | "highlight" | "underline" | "zoom";

/**
 * The one selected editable thing, shared by the timeline, the preview and
 * the rail so Delete/Backspace has a single meaning. `t` is the camera
 * keyframe's source time (keyframes are addressed by time, not index).
 */
export type Selection = { kind: "overlay" | "cut" | "keyframe" | "zoom"; index: number; t?: number } | null;

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
  mode: RecordingMode;
  tool: Tool;
  setTool(t: Tool): void;
  selected: Selection;
  setSelected(s: Selection): void;
  inPoint: number | null;
  outPoint: number | null;
  setInPoint(t: number | null): void;
  setOutPoint(t: number | null): void;
  details: Details;
  setDetails(d: Details | ((d: Details) => Details)): void;
  addOverlayAt(type: Overlay["type"], rect: Overlay["rect"]): void;
  addZoomAt(rect: Overlay["rect"]): void;
  finish(): void;
  discard(): void;
  error: string;
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}
