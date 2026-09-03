/** Every shared type for the recording stack. No runtime code lives here. */

export type RecordingMode = "screen" | "camera" | "screen+camera";
export type SurfacePref = "monitor" | "window" | "browser";

// ---------- media sources ----------

export type SystemAudioSupport = "full" | "tab-only" | "none";

export interface Capabilities {
  /** How much system audio this runtime can capture. */
  systemAudio: SystemAudioSupport;
  /** True when a native (Electron) source picker replaces Chrome's sheet. */
  nativePicker: boolean;
  /** True when `displaySurface` constraints actually steer the picker. */
  surfaceHints: boolean;
}

export interface DisplayCapture {
  stream: MediaStream;
  /** What the user actually chose, read back from the track settings. */
  surface: SurfacePref | "unknown";
  hasSystemAudio: boolean;
}

export interface MediaSourceProvider {
  getDisplay(pref: SurfacePref): Promise<DisplayCapture>;
  getCamera(deviceId?: string): Promise<MediaStream>;
  getMic(deviceId?: string): Promise<MediaStream>;
  warmPermissions(kind: "audioinput" | "videoinput"): Promise<void>;
  enumerateDevices(kind: "audioinput" | "videoinput"): Promise<MediaDeviceInfo[]>;
  capabilities(): Capabilities;
}

// ---------- desktop bridge ----------

/**
 * Every hotkey the desktop shell forwards. The web app binds the same chords
 * itself (`use-recorder.ts`), but those only fire while the page has focus;
 * the shell registers them globally and replays them through this union.
 */
export type DesktopShortcut =
  | "toggle"
  | "pause"
  | "mark"
  | "restart"
  | "cancel";

/**
 * What the floating desktop camera bubble should look like. `visible` is the
 * user's own bubble toggle; the shell ALSO gates the window on
 * `setBubbleVisible`, which follows the recorder's status. The window is shown
 * only when both are true.
 */
export interface BubbleAppearance {
  shape: BubbleShape;
  size: BubbleSize;
  mirror: boolean;
  visible: boolean;
  /**
   * True when framed capture is on. The shell uses it to hide the live bubble
   * window while recording: framing insets the screen inside a larger canvas,
   * so the burned-in bubble no longer covers the captured pixels of the live
   * one and both would appear in the frame.
   */
  framed: boolean;
  /**
   * The live camera track's width/height, when known. `rounded` bubbles
   * follow the camera's real aspect ratio (see `computeBubbleRect`) rather
   * than assuming 16:9, so the shell needs it too to size the floating
   * window identically — otherwise a 4:3 webcam breaks self-occlusion.
   */
  cameraAspect?: number;
}

/**
 * The subset of `RecorderStatus` the HUD needs. Anything the HUD does not
 * distinguish (`acquiring`, `setup`, `uploading`, `done`) collapses to
 * `"other"`, so the shell never has to track the web app's full state machine.
 */
export type HudStatus =
  | "idle"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "staging"
  | "rendering"
  | "error"
  | "other";

/**
 * What the recording HUD renders. Pushed from the page at ~4 Hz while a take
 * is live, and once on every status change.
 *
 * `markers` is a COUNT, not the array: the HUD only shows how many were
 * dropped, and structured-cloning a growing array four times a second across
 * the contextBridge for no reason would be silly.
 *
 * MUST stay identical to `HudState` in `desktop/src/shared/ipc.ts`.
 */
export interface HudState {
  status: HudStatus;
  /** Milliseconds of recorded material, excluding paused time. */
  elapsedMs: number;
  /** 3…1 while `status === "countdown"`, else 0. */
  countdown: number;
  markers: number;
}

/**
 * One sampled cursor position, forwarded by the desktop shell while a take is
 * live (mouse-follow zoom). `t` is milliseconds of RECORDED material — paused
 * time excluded — so it lines up with `HudState.elapsedMs` and with the
 * staging editor's timeline. `x`/`y` are normalized to the captured display and
 * arrive clamped to [-0.1, 1.1]: the cursor really does leave the captured
 * display, and a following zoom should keep drifting rather than sticking to
 * the edge. Consumers clamp the rest of the way.
 *
 * Only DISPLAY captures produce a track; a window capture produces none, so an
 * empty track is the signal to hide the "Follow mouse" toggle.
 *
 * MUST stay identical to `CursorSample` in `desktop/src/shared/ipc.ts`.
 */
export interface CursorSample {
  t: number;
  x: number;
  y: number;
}

/**
 * One global mouse click, forwarded by the desktop shell's native input hook
 * while a take is live. Same `t` clock and same normalised `x`/`y` space as
 * `CursorSample`; the staging editor seeds `edits.clicks` from these with every
 * mark on, and each on mark draws a ripple at `t..t + 0.5 s`.
 *
 * Kept in memory only — the raw track is never persisted, just the edited
 * `ClickMark[]` in `videos.edits`.
 *
 * MUST stay identical to `ClickSample` in `desktop/src/shared/ipc.ts`.
 */
export interface ClickSample {
  t: number;
  x: number;
  y: number;
  /** 0 = left, 1 = right, 2 = middle; anything else is whatever the hook reported. */
  button: number;
}

/** The modifier keys a `KeySample` may be held with. */
export type KeyMod = "meta" | "ctrl" | "alt" | "shift";

/**
 * One global key press, forwarded alongside `ClickSample` on the same `t`
 * clock. `key` is the printable key or a named one ("Enter", "Escape", "F5");
 * `mods` are the modifiers held with it, which the `keys` overlay combines into
 * a single keycap badge ("⌘ ⇧ K").
 *
 * Kept in memory only; nothing about the key track is persisted.
 *
 * MUST stay identical to `KeySample` in `desktop/src/shared/ipc.ts`.
 */
export interface KeySample {
  t: number;
  key: string;
  mods: KeyMod[];
}

/**
 * What the desktop shell actually puts on the wire: one mixed, time-ordered
 * batch rather than two arrays, so a click and the key pressed with it keep
 * their relative order without the page having to merge on `t`. Consumers
 * split it by `kind` into `ClickSample[]` and `KeySample[]`.
 *
 * MUST stay identical to `InputSample` in `desktop/src/shared/ipc.ts`.
 */
export type InputSample =
  | ({ kind: "click" } & ClickSample)
  | ({ kind: "key" } & KeySample);

export interface DesktopBridge {
  version: 1;
  isDesktop?: boolean;
  mediaSources?: Partial<MediaSourceProvider>;
  capabilities?: Partial<Capabilities>;
  onShortcut?(cb: (action: DesktopShortcut) => void): () => void;
  /**
   * Announce the surface preference before `getDisplayMedia` runs so the native
   * picker opens on the right tab. Fire-and-forget: the stream itself is still
   * created by the page, because `contextBridge` cannot carry a `MediaStream`
   * across worlds.
   */
  setSurfacePref?(pref: SurfacePref): void;
  /** The user dragged the floating bubble; `pos` is normalized to the captured display. */
  onBubbleMove?(cb: (pos: { x: number; y: number }) => void): () => void;
  /** Shape / size / mirror / user-visibility of the floating bubble. */
  setBubbleAppearance?(appearance: BubbleAppearance): void;
  /** The desktop bubble's own control strip changed shape or visibility. */
  onBubbleAppearance?(cb: (appearance: BubbleAppearance) => void): () => void;
  /** Status-driven show/hide of the floating bubble window. */
  setBubbleVisible?(visible: boolean): void;
  /**
   * True while the encoder is running (`recording` or `paused`). Drives the
   * shell's auto-hide of the live bubble window for window and framed captures.
   */
  setRecordingActive?(active: boolean): void;
  /**
   * Push the HUD's view of the take. Throttled by the caller; the shell
   * forwards it to the HUD window verbatim and uses the status transitions to
   * hide and re-show the recorder window.
   */
  setHudState?(state: HudState): void;
  /** Which camera the floating bubble should open (`null` = default device). */
  setCameraDevice?(deviceId: string | null): void;
  /**
   * Batched cursor samples while a take is recording, ~4 batches a second.
   * Absent on a shell that predates the mouse-follow zoom, which is why the
   * whole feature is optional-chained through `onDesktopCursor`.
   */
  onCursor?(cb: (samples: CursorSample[]) => void): () => void;
  /**
   * Batched global clicks and key presses while a take is recording, ~4 batches
   * a second. Absent on a shell that predates the input tracks, and silent on
   * one where macOS Input Monitoring was never granted — which is why the whole
   * feature is optional-chained through `onDesktopInput`. Clicks additionally
   * need a display capture (a window capture has no rectangle to normalize
   * against); keys arrive for every capture kind.
   */
  onInput?(cb: (samples: InputSample[]) => void): () => void;
}

// ---------- compositor ----------

export type BubbleShape = "circle" | "rounded" | "square" | "portrait" | "full";
export type BubbleSize = "small" | "medium" | "large";

export interface BubbleConfig {
  shape: BubbleShape;
  size: BubbleSize;
  /** Normalized centre of the bubble within the canvas, 0..1. */
  pos: { x: number; y: number };
  mirror: boolean;
  /** Tyler: hide/show mid-recording without touching the camera track. */
  visible: boolean;
}

/** Framed capture only — camera-bubble backgrounds were removed in Phase 2.1. */
export type BackgroundKind = "none" | "blur" | "color" | "image" | "video";

export interface BackgroundConfig {
  kind: BackgroundKind;
  /** CSS colour for `kind: "color"`. */
  color?: string;
  /** URL for `kind: "image" | "video"` — a `/backgrounds/...` path or a blob: URL. */
  src?: string;
  /** Set when `src` came from the preset catalogue; used to re-select on reload. */
  presetId?: string;
  /**
   * Set when `src` came from a saved wallpaper (`src/lib/wallpapers.ts`). The
   * blob: URL in `src` dies with its document, so this — not the URL — is what
   * persists; `loadBackground` re-mints the URL from the stored bytes.
   */
  wallpaperId?: string;
}

export interface FrameConfig {
  enabled: boolean;
  /** Padding as a fraction of the source width, 0..0.2. */
  padding: number;
  /** Corner radius as a fraction of the source width, 0..0.1. */
  radius: number;
  shadow: boolean;
  /** `blur` is meaningless here; the picker only offers none/color/image/video. */
  background: BackgroundConfig;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** object-fit: cover source rect for the media drawn into this rect. */
  crop: CropRect;
}

export interface FrameLayout {
  canvasW: number;
  canvasH: number;
  dest: { x: number; y: number; w: number; h: number };
  radius: number;
}

// ---------- settings ----------

export interface RecorderSettings {
  mode: RecordingMode;
  surfacePref: SurfacePref;
  micId: string;
  cameraId: string;
  micOn: boolean;
  systemOn: boolean;
  bubble: BubbleConfig;
  frame: FrameConfig;
}
