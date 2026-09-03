import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FRAME,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
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
