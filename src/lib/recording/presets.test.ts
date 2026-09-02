import { describe, expect, it } from "vitest";
import { BACKGROUND_PRESETS, FRAME_PRESETS, findPreset } from "./presets";

describe("presets", () => {
  it("ships four gradient frame presets served from /backgrounds", () => {
    expect(FRAME_PRESETS).toHaveLength(4);
    for (const p of FRAME_PRESETS) {
      expect(p.src.startsWith("/backgrounds/")).toBe(true);
      expect(p.src.endsWith(".svg")).toBe(true);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("reuses the same gradients for camera bubble backgrounds", () => {
    expect(BACKGROUND_PRESETS.map((p) => p.id)).toEqual(FRAME_PRESETS.map((p) => p.id));
  });

  it("has unique ids", () => {
    const ids = BACKGROUND_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("findPreset looks presets up by id", () => {
    expect(findPreset("ocean")?.src).toBe("/backgrounds/ocean.svg");
    expect(findPreset("nope")).toBeUndefined();
    expect(findPreset(undefined)).toBeUndefined();
  });
});
