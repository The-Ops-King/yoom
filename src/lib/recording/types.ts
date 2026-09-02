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

export interface DesktopBridge {
  version: 1;
  isDesktop?: boolean;
  mediaSources?: Partial<MediaSourceProvider>;
  capabilities?: Partial<Capabilities>;
  onShortcut?(cb: (action: "toggle" | "pause") => void): () => void;
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

/** Handed to every overlay layer once per composited frame. */
export interface FrameInfo {
  width: number;
  height: number;
  /** `performance.now()` at the top of this frame. */
  nowMs: number;
  /** Milliseconds since the previous composited frame. */
  deltaMs: number;
  frameIndex: number;
  /** Where the screen was drawn, or null in camera-only layout. */
  screenRect: { x: number; y: number; w: number; h: number } | null;
  /** Where the bubble was drawn, or null when hidden / absent. */
  bubbleRect: Rect | null;
}

/**
 * The compositor's plug-in seam. Phase 5 (eased cursor, click ripples,
 * annotations) registers layers here instead of editing the draw loop.
 */
export interface OverlayLayer {
  id: string;
  draw(ctx: CanvasRenderingContext2D, frame: FrameInfo): void;
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
