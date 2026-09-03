import type {
  BackgroundConfig,
  BackgroundKind,
  BubbleConfig,
  BubbleShape,
  BubbleSize,
  FrameConfig,
  RecorderSettings,
  RecordingMode,
  SurfacePref,
} from "./types";

/**
 * Bumped to v2 in Phase 2.1: camera-bubble backgrounds were removed, so a v1
 * object carries a `background` key that no longer means anything. `sanitize`
 * ignores unknown keys anyway, but the fresh key also drops the stale blob.
 *
 * Bumped to v3 because the frame defaults changed (framed on, 2 % padding, the
 * mint background). Those are plain booleans and numbers, so a v2 object would
 * silently win over the new defaults for anyone who had ever opened the app —
 * they would still see framing off at 5 %. A new key is the only honest reset.
 */
export const SETTINGS_KEY = "yoom.recorder.v3";
const LEGACY_SETTINGS_KEYS = ["yoom.recorder.v1", "yoom.recorder.v2"];

export const DEFAULT_BUBBLE: BubbleConfig = {
  shape: "circle",
  size: "medium",
  pos: { x: 0.86, y: 0.82 },
  mirror: true,
  visible: true,
};

export const DEFAULT_FRAME: FrameConfig = {
  enabled: true,
  padding: 0.02,
  radius: 0.012,
  shadow: true,
  background: { kind: "image", src: "/backgrounds/mint.svg", presetId: "mint" },
};

export const DEFAULT_SETTINGS: RecorderSettings = {
  mode: "screen+camera",
  surfacePref: "monitor",
  micId: "",
  cameraId: "",
  micOn: true,
  // System audio is on by default per the spec; the UI explains when the
  // platform cannot deliver it.
  systemOn: true,
  bubble: DEFAULT_BUBBLE,
  frame: DEFAULT_FRAME,
};

/**
 * The two modes the picker offers. Bare `screen` is deliberately absent: a
 * screen take always carries the camera track, and the camera is hidden in
 * post instead, so a stored `"screen"` falls back to the default.
 */
const MODES: RecordingMode[] = ["screen+camera", "camera"];

const SURFACES: SurfacePref[] = ["monitor", "window", "browser"];
export const SHAPES: BubbleShape[] = ["circle", "rounded", "square", "portrait", "full"];
const SIZES: BubbleSize[] = ["small", "medium", "large"];
const KINDS: BackgroundKind[] = ["none", "blur", "color", "image", "video"];

export function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Only same-origin `/`-rooted URLs survive a reload; blob: URLs do not. */
function persistableSrc(src: string | undefined): string | undefined {
  return src && src.startsWith("/") ? src : undefined;
}

function sanitizeBackground(
  raw: unknown,
  fallback: BackgroundConfig,
): BackgroundConfig {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const kind = pick(r.kind, KINDS, fallback.kind);
  const src = persistableSrc(typeof r.src === "string" ? r.src : undefined);
  if ((kind === "image" || kind === "video") && !src) return { kind: "none" };
  const out: BackgroundConfig = { kind };
  if (typeof r.color === "string") {
    out.color = r.color;
  } else if (kind === "color") {
    out.color = fallback.color ?? "#1a1a1e";
  }
  if (src) out.src = src;
  if (typeof r.presetId === "string") out.presetId = r.presetId;
  return out;
}

/** Clamp an untrusted frame config. Blob URLs are dropped (they do not survive a reload or an upload). */
export function sanitizeFrame(raw: unknown, fallback: FrameConfig = DEFAULT_FRAME): FrameConfig {
  const frameRaw = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: bool(frameRaw.enabled, fallback.enabled),
    padding: num(frameRaw.padding, fallback.padding, 0, 0.2),
    radius: num(frameRaw.radius, fallback.radius, 0, 0.1),
    shadow: bool(frameRaw.shadow, fallback.shadow),
    background: sanitizeBackground(frameRaw.background, fallback.background),
  };
}

function sanitize(raw: unknown): RecorderSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const r = raw as Record<string, unknown>;
  const bubbleRaw = (r.bubble ?? {}) as Record<string, unknown>;
  const posRaw = (bubbleRaw.pos ?? {}) as Record<string, unknown>;

  return {
    // Screen (which always carries the camera) or camera only. A stored
    // `"screen"` from an older build is not offered any more and falls back.
    mode: pick(r.mode, MODES, DEFAULT_SETTINGS.mode),
    surfacePref: pick(r.surfacePref, SURFACES, DEFAULT_SETTINGS.surfacePref),
    micId: str(r.micId, DEFAULT_SETTINGS.micId),
    cameraId: str(r.cameraId, DEFAULT_SETTINGS.cameraId),
    micOn: bool(r.micOn, DEFAULT_SETTINGS.micOn),
    systemOn: bool(r.systemOn, DEFAULT_SETTINGS.systemOn),
    bubble: {
      shape: pick(bubbleRaw.shape, SHAPES, DEFAULT_BUBBLE.shape),
      size: pick(bubbleRaw.size, SIZES, DEFAULT_BUBBLE.size),
      pos: {
        x: num(posRaw.x, DEFAULT_BUBBLE.pos.x, 0, 1),
        y: num(posRaw.y, DEFAULT_BUBBLE.pos.y, 0, 1),
      },
      mirror: bool(bubbleRaw.mirror, DEFAULT_BUBBLE.mirror),
      visible: bool(bubbleRaw.visible, DEFAULT_BUBBLE.visible),
    },
    frame: sanitizeFrame(r.frame),
  };
}

export function loadSettings(): RecorderSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    // A v1 object still carries `background`; `sanitize` simply ignores it.
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: RecorderSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitize(settings)));
    for (const legacy of LEGACY_SETTINGS_KEYS) localStorage.removeItem(legacy);
  } catch {
    // Private mode / storage disabled — preferences simply do not persist.
  }
}
