import { MAX_OVERLAY_THICKNESS } from "@/lib/edits";
import type {
  ArrowStyle,
  BackgroundConfig,
  BackgroundKind,
  BubbleConfig,
  BubbleShape,
  BubbleSize,
  FrameConfig,
  RecorderSettings,
  RecordingMode,
  StagingDefaults,
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
  shadow: 0.5,
  background: { kind: "image", src: "/backgrounds/mint.svg", presetId: "mint" },
};

export const DEFAULT_STAGING: StagingDefaults = {
  cameraShape: "circle",
  cameraMirror: true,
  overlayColor: "#c9973f",
  overlayThickness: 0.04,
  arrowStyle: "standard",
  clickColor: "#c9973f",
  clickRippleMs: 500,
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
  staging: DEFAULT_STAGING,
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
// Not imported from edits.ts: that module is not exported, and edits.ts
// already imports from this file, so importing back would cycle. Kept in
// sync with edits.ts's own (private) ARROW_STYLES by hand.
const ARROW_STYLES: ArrowStyle[] = ["standard", "double", "curved", "fancy"];

/**
 * Sane bounds for the click-ripple duration: instant to noticeably long,
 * never gone or frozen on screen. Exported so `edits.ts`'s
 * `CursorConfig.clickRippleMs` clamps to exactly this range too — one
 * definition, not two numbers that could drift apart.
 */
export const MIN_CLICK_RIPPLE_MS = 100;
export const MAX_CLICK_RIPPLE_MS = 2000;

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
  // A saved wallpaper is the one image background allowed to arrive without a
  // usable `src`: the bytes live in IndexedDB and `loadBackground` mints a
  // fresh object URL from `wallpaperId`. Everything else still needs a src,
  // because a dropped blob: URL would render as nothing at all.
  const wallpaperId = typeof r.wallpaperId === "string" && r.wallpaperId ? r.wallpaperId : undefined;
  if ((kind === "image" || kind === "video") && !src && !wallpaperId) return { kind: "none" };
  const out: BackgroundConfig = { kind };
  if (typeof r.color === "string") {
    out.color = r.color;
  } else if (kind === "color") {
    out.color = fallback.color ?? "#1a1a1e";
  }
  if (src) out.src = src;
  if (typeof r.presetId === "string") out.presetId = r.presetId;
  if (wallpaperId) out.wallpaperId = wallpaperId;
  return out;
}

/**
 * `shadow` was a boolean until this settings shape; it became a 0..1 strength
 * without a `SETTINGS_KEY` bump because bumping the key would discard every
 * other stored preference (mode, bubble position, background, …) just to fix
 * one field. So the boolean form is read forever and never written again: a
 * stored `true` maps to 0.5 (the strength that drew the same pixels the old
 * `true` branch did), `false` maps to 0, and a `SETTINGS_KEY` bump is not
 * revisited for this alone.
 */
function shadowStrength(value: unknown, fallback: number): number {
  if (value === true) return 0.5;
  if (value === false) return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return fallback;
}

/** Clamp an untrusted frame config. Blob URLs are dropped (they do not survive a reload or an upload). */
export function sanitizeFrame(raw: unknown, fallback: FrameConfig = DEFAULT_FRAME): FrameConfig {
  const frameRaw = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: bool(frameRaw.enabled, fallback.enabled),
    padding: num(frameRaw.padding, fallback.padding, 0, 0.2),
    radius: num(frameRaw.radius, fallback.radius, 0, 0.1),
    shadow: shadowStrength(frameRaw.shadow, fallback.shadow),
    background: sanitizeBackground(frameRaw.background, fallback.background),
  };
}

/**
 * Merge a frame config into the stored recorder settings, leaving every other
 * preference alone. The staging editor's frame picker calls this so the next
 * take opens on the background — gradient or saved wallpaper — the last one
 * ended on; the recorder hook itself only ever writes its own state.
 */
export function persistFrame(frame: FrameConfig): void {
  if (typeof window === "undefined") return;
  const current = loadSettings();
  saveSettings({ ...current, frame: sanitizeFrame(frame, current.frame) });
}

/** Clamp an untrusted staging-defaults block. Appearance only — see `StagingDefaults`. */
export function sanitizeStaging(
  raw: unknown,
  fallback: StagingDefaults = DEFAULT_STAGING,
): StagingDefaults {
  const stagingRaw = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    cameraShape: pick(stagingRaw.cameraShape, SHAPES, fallback.cameraShape),
    cameraMirror: bool(stagingRaw.cameraMirror, fallback.cameraMirror),
    overlayColor: str(stagingRaw.overlayColor, fallback.overlayColor),
    overlayThickness: num(
      stagingRaw.overlayThickness,
      fallback.overlayThickness,
      0,
      MAX_OVERLAY_THICKNESS,
    ),
    arrowStyle: pick(stagingRaw.arrowStyle, ARROW_STYLES, fallback.arrowStyle),
    clickColor: str(stagingRaw.clickColor, fallback.clickColor),
    clickRippleMs: num(
      stagingRaw.clickRippleMs,
      fallback.clickRippleMs,
      MIN_CLICK_RIPPLE_MS,
      MAX_CLICK_RIPPLE_MS,
    ),
  };
}

/**
 * Merge staging appearance defaults into the stored recorder settings, leaving
 * every other preference alone — same contract as `persistFrame`. A sibling
 * task wires the staging panels (camera shape/mirror, overlay colour and
 * thickness, arrow style, click colour and ripple duration) to call this;
 * nothing content-shaped (cuts, placed zooms/overlays, click on/off toggles,
 * camera keyframes after t=0, title, description, slug) belongs here.
 */
export function persistStaging(staging: StagingDefaults): void {
  if (typeof window === "undefined") return;
  const current = loadSettings();
  saveSettings({ ...current, staging: sanitizeStaging(staging, current.staging) });
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
    // No SETTINGS_KEY bump for this new block, for the same reason `shadow`
    // above wasn't given one: every existing stored object simply lacks a
    // `staging` key, `sanitizeStaging(undefined)` falls back to
    // DEFAULT_STAGING cleanly, and bumping the key would throw away mode,
    // bubble, and frame preferences that already work today just to add one
    // block that needs no reset at all.
    staging: sanitizeStaging(r.staging),
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
