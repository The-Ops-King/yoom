import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_OVERLAY_THICKNESS } from "@/lib/edits";
import {
  DEFAULT_FRAME,
  DEFAULT_SETTINGS,
  DEFAULT_STAGING,
  SETTINGS_KEY,
  loadSettings,
  persistFrame,
  persistStaging,
  sanitizeFrame,
  saveSettings,
} from "./settings";

function makeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  storage = makeStorage();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults system audio on", () => {
    expect(DEFAULT_SETTINGS.systemOn).toBe(true);
    expect(DEFAULT_SETTINGS.micOn).toBe(true);
  });

  it("merges stored values over the defaults", () => {
    storage.map.set(
      SETTINGS_KEY,
      JSON.stringify({ mode: "camera", micOn: false, bubble: { shape: "square" } }),
    );
    const s = loadSettings();
    // `mode` is user-selectable again (Screen vs Camera only).
    expect(s.mode).toBe("camera");
    expect(s.micOn).toBe(false);
    expect(s.bubble.shape).toBe("square");
    // untouched nested fields keep their defaults
    expect(s.bubble.size).toBe(DEFAULT_SETTINGS.bubble.size);
  });

  it("rejects invalid enum values and out-of-range numbers", () => {
    storage.map.set(
      SETTINGS_KEY,
      JSON.stringify({
        mode: "hologram",
        surfacePref: "nope",
        bubble: { shape: "triangle", size: "huge", pos: { x: 9, y: -4 } },
        frame: { enabled: true, padding: 5, radius: -1 },
      }),
    );
    const s = loadSettings();
    expect(s.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(s.surfacePref).toBe(DEFAULT_SETTINGS.surfacePref);
    expect(s.bubble.shape).toBe(DEFAULT_SETTINGS.bubble.shape);
    expect(s.bubble.size).toBe(DEFAULT_SETTINGS.bubble.size);
    expect(s.bubble.pos).toEqual({ x: 1, y: 0 });
    expect(s.frame.enabled).toBe(true);
    expect(s.frame.padding).toBe(0.2);
    expect(s.frame.radius).toBe(0);
  });

  it("keeps a stored camera-only mode but never bare screen", () => {
    storage.map.set(SETTINGS_KEY, JSON.stringify({ mode: "camera" }));
    expect(loadSettings().mode).toBe("camera");
    // Bare `screen` is not offered by the picker: a take always carries the
    // camera track, and the camera is hidden in post instead.
    storage.map.set(SETTINGS_KEY, JSON.stringify({ mode: "screen" }));
    expect(loadSettings().mode).toBe("screen+camera");
  });

  it("round-trips the selected mode through a save", () => {
    saveSettings({ ...DEFAULT_SETTINGS, mode: "camera" });
    expect(loadSettings().mode).toBe("camera");
  });

  it("survives corrupt JSON", () => {
    storage.map.set(SETTINGS_KEY, "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saveSettings", () => {
  it("round-trips through localStorage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, cameraId: "cam-9", systemOn: false });
    const s = loadSettings();
    expect(s.cameraId).toBe("cam-9");
    expect(s.systemOn).toBe(false);
  });

  it("drops blob: sources that cannot survive a reload", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      frame: {
        ...DEFAULT_SETTINGS.frame,
        background: { kind: "image", src: "blob:http://x/def" },
      },
    });
    expect(loadSettings().frame.background).toEqual({ kind: "none" });
  });

  it("strips blob:/data: sources at save time, not just at load time", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      frame: {
        ...DEFAULT_SETTINGS.frame,
        background: { kind: "video", src: "blob:http://x/abc" },
      },
    });
    // What actually reached localStorage must already be clean: a reload in a
    // new tab must never see a URL that only existed in the previous document.
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.background).toBeUndefined();
    expect(stored.frame.background).toEqual({ kind: "none" });
    expect(stored.frame.background.src).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain("blob:");
    expect(JSON.stringify(stored)).not.toContain("data:");
  });

  it("keeps preset sources served from /backgrounds", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      frame: {
        ...DEFAULT_SETTINGS.frame,
        background: { kind: "image", src: "/backgrounds/ocean.svg", presetId: "ocean" },
      },
    });
    expect(loadSettings().frame.background).toEqual({
      kind: "image",
      src: "/backgrounds/ocean.svg",
      presetId: "ocean",
    });
  });

  it("keeps a saved wallpaper id and drops its dead blob: src", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      frame: {
        ...DEFAULT_SETTINGS.frame,
        background: {
          kind: "image",
          src: "blob:http://x/ghi",
          wallpaperId: "wp-1",
        },
      },
    });
    // The bytes are in IndexedDB, so the id alone is enough — `loadBackground`
    // mints a fresh object URL from it on the next take.
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.frame.background).toEqual({ kind: "image", wallpaperId: "wp-1" });
    expect(JSON.stringify(stored)).not.toContain("blob:");
    expect(loadSettings().frame.background).toEqual({
      kind: "image",
      wallpaperId: "wp-1",
    });
  });

  it("still drops an image background with neither a src nor a wallpaperId", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      frame: {
        ...DEFAULT_SETTINGS.frame,
        background: { kind: "image", wallpaperId: "" },
      },
    });
    expect(loadSettings().frame.background).toEqual({ kind: "none" });
  });

  it("persists the frame on its own without disturbing the other preferences", () => {
    saveSettings({ ...DEFAULT_SETTINGS, cameraId: "cam-9", micOn: false });
    persistFrame({
      ...DEFAULT_SETTINGS.frame,
      padding: 0.05,
      background: { kind: "image", src: "blob:http://x/jkl", wallpaperId: "wp-2" },
    });
    const s = loadSettings();
    expect(s.cameraId).toBe("cam-9");
    expect(s.micOn).toBe(false);
    expect(s.frame.padding).toBe(0.05);
    expect(s.frame.background).toEqual({ kind: "image", wallpaperId: "wp-2" });
  });

  it("falls back to the default colour when a stored color background has none", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      frame: {
        ...DEFAULT_SETTINGS.frame,
        background: { kind: "color" } as unknown as (typeof DEFAULT_FRAME)["background"],
      },
    });
    expect(loadSettings().frame.background.color).toBe(
      DEFAULT_SETTINGS.frame.background.color ?? "#1a1a1e",
    );
  });

  it("ignores a stale camera-bubble background from a v1 settings object", () => {
    // Phase 2.1 removed camera-bubble backgrounds. An object written by an
    // older build still carries the key; loading it must not throw or leak it.
    storage.map.set(
      SETTINGS_KEY,
      JSON.stringify({
        mode: "camera",
        background: { kind: "blur" },
        bubble: { shape: "square" },
      }),
    );
    const s = loadSettings();
    expect(s.mode).toBe("camera");
    expect(s.bubble.shape).toBe("square");
    expect("background" in s).toBe(false);
  });

  it("ignores a v2 object and clears every legacy key", () => {
    // v2 predates the new frame defaults (framed on, 2 % padding, mint). Its
    // stored `enabled: false` / `padding: 0.05` must not win over them.
    storage.map.set("yoom.recorder.v1", JSON.stringify({ micOn: false }));
    storage.map.set(
      "yoom.recorder.v2",
      JSON.stringify({ frame: { enabled: false, padding: 0.05 } }),
    );
    expect(SETTINGS_KEY).toBe("yoom.recorder.v3");
    expect(loadSettings().frame).toEqual(DEFAULT_FRAME);

    saveSettings(DEFAULT_SETTINGS);
    expect(storage.map.has("yoom.recorder.v1")).toBe(false);
    expect(storage.map.has("yoom.recorder.v2")).toBe(false);
  });

  it("never throws when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

/**
 * `parseEdits` (server side, `src/lib/edits.ts`) runs an untrusted `frame`
 * through this exact function, so a `wallpaperId` posted with a take has to
 * come out the other side — it is a harmless opaque string, and dropping it
 * would strand the background on the next load.
 */
describe("sanitizeFrame on the parseEdits path", () => {
  it("keeps a wallpaperId on an image background with no usable src", () => {
    const frame = sanitizeFrame({
      enabled: true,
      padding: 0.03,
      radius: 0.01,
      shadow: 0.5,
      background: { kind: "image", src: "blob:http://x/mno", wallpaperId: "wp-7" },
    });
    expect(frame.background).toEqual({ kind: "image", wallpaperId: "wp-7" });
  });

  it("ignores a non-string wallpaperId", () => {
    const frame = sanitizeFrame({
      background: { kind: "image", src: "/backgrounds/g01.svg", wallpaperId: 42 },
    });
    expect(frame.background).toEqual({ kind: "image", src: "/backgrounds/g01.svg" });
  });
});

describe("sanitizeFrame shadow migration", () => {
  it("maps a legacy true to today's rendered weight", () => {
    expect(sanitizeFrame({ shadow: true }).shadow).toBe(0.5);
  });
  it("maps a legacy false to no shadow", () => {
    expect(sanitizeFrame({ shadow: false }).shadow).toBe(0);
  });
  it("keeps an in-range number", () => {
    expect(sanitizeFrame({ shadow: 0.15 }).shadow).toBe(0.15);
  });
  it("clamps out of range", () => {
    expect(sanitizeFrame({ shadow: 4 }).shadow).toBe(1);
    expect(sanitizeFrame({ shadow: -1 }).shadow).toBe(0);
  });
  it("falls back for garbage", () => {
    expect(sanitizeFrame({ shadow: "heavy" }).shadow).toBe(DEFAULT_FRAME.shadow);
  });
});

describe("staging defaults", () => {
  it("falls back to DEFAULT_STAGING when nothing is stored", () => {
    expect(loadSettings().staging).toEqual(DEFAULT_STAGING);
  });

  it("round-trips a changed overlay colour", () => {
    persistStaging({ ...DEFAULT_STAGING, overlayColor: "#b8543d" });
    expect(loadSettings().staging.overlayColor).toBe("#b8543d");
  });

  it("leaves other preferences alone", () => {
    saveSettings({ ...DEFAULT_SETTINGS, micOn: false });
    persistStaging({ ...DEFAULT_STAGING, clickColor: "#c9973f" });
    const after = loadSettings();
    expect(after.micOn).toBe(false);
    expect(after.staging.clickColor).toBe("#c9973f");
  });

  it("clamps a stored thickness out of range", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ staging: { overlayThickness: 99 } }));
    expect(loadSettings().staging.overlayThickness).toBe(MAX_OVERLAY_THICKNESS);
  });

  it("ignores a garbage staging block", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ staging: "nope" }));
    expect(loadSettings().staging).toEqual(DEFAULT_STAGING);
  });

  it("loads an old stored object with no staging key at all, defaulted", () => {
    // Every existing user's first load after this ships: a v3 object written
    // before this change carries no `staging` key whatsoever.
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ mode: "camera", micOn: false, bubble: { shape: "square" } }),
    );
    expect(() => loadSettings()).not.toThrow();
    const s = loadSettings();
    expect(s.staging).toEqual(DEFAULT_STAGING);
    expect(s.mode).toBe("camera");
    expect(s.micOn).toBe(false);
  });
});
