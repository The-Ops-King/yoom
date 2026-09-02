import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults system audio on and the bubble visible", () => {
    expect(DEFAULT_SETTINGS.systemOn).toBe(true);
    expect(DEFAULT_SETTINGS.micOn).toBe(true);
    expect(DEFAULT_SETTINGS.bubble.visible).toBe(true);
    expect(DEFAULT_SETTINGS.frame.enabled).toBe(false);
  });

  it("merges stored values over the defaults", () => {
    storage.map.set(
      SETTINGS_KEY,
      JSON.stringify({ mode: "camera", micOn: false, bubble: { shape: "square" } }),
    );
    const s = loadSettings();
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
      background: { kind: "video", src: "blob:http://x/abc" },
      frame: {
        ...DEFAULT_SETTINGS.frame,
        background: { kind: "image", src: "blob:http://x/def" },
      },
    });
    const s = loadSettings();
    expect(s.background).toEqual({ kind: "none" });
    expect(s.frame.background).toEqual({ kind: "none" });
  });

  it("keeps preset sources served from /backgrounds", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      background: { kind: "image", src: "/backgrounds/ocean.svg", presetId: "ocean" },
    });
    expect(loadSettings().background).toEqual({
      kind: "image",
      src: "/backgrounds/ocean.svg",
      presetId: "ocean",
    });
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
