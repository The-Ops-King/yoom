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

export const SETTINGS_KEY = "yoom.recorder.v1";

export const DEFAULT_BUBBLE: BubbleConfig = {
  shape: "circle",
  size: "medium",
  pos: { x: 0.86, y: 0.82 },
  mirror: true,
  visible: true,
};

export const DEFAULT_BACKGROUND: BackgroundConfig = { kind: "none" };

export const DEFAULT_FRAME: FrameConfig = {
  enabled: false,
  padding: 0.05,
  radius: 0.012,
  shadow: true,
  background: { kind: "color", color: "#1a1a1e" },
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
  background: DEFAULT_BACKGROUND,
  frame: DEFAULT_FRAME,
};

const MODES: RecordingMode[] = ["screen", "camera", "screen+camera"];
const SURFACES: SurfacePref[] = ["monitor", "window", "browser"];
const SHAPES: BubbleShape[] = ["circle", "rounded", "square", "portrait", "full"];
const SIZES: BubbleSize[] = ["small", "medium", "large"];
const KINDS: BackgroundKind[] = ["none", "blur", "color", "image", "video"];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
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

function sanitize(raw: unknown): RecorderSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const r = raw as Record<string, unknown>;
  const bubbleRaw = (r.bubble ?? {}) as Record<string, unknown>;
  const posRaw = (bubbleRaw.pos ?? {}) as Record<string, unknown>;
  const frameRaw = (r.frame ?? {}) as Record<string, unknown>;

  return {
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
    background: sanitizeBackground(r.background, DEFAULT_BACKGROUND),
    frame: {
      enabled: bool(frameRaw.enabled, DEFAULT_FRAME.enabled),
      padding: num(frameRaw.padding, DEFAULT_FRAME.padding, 0, 0.2),
      radius: num(frameRaw.radius, DEFAULT_FRAME.radius, 0, 0.1),
      shadow: bool(frameRaw.shadow, DEFAULT_FRAME.shadow),
      background: sanitizeBackground(frameRaw.background, DEFAULT_FRAME.background),
    },
  };
}

export function loadSettings(): RecorderSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: RecorderSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitize(settings)));
  } catch {
    // Private mode / storage disabled — preferences simply do not persist.
  }
}
