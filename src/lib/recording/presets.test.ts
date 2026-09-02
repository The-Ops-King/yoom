import { describe, expect, it } from "vitest";
import { COLOR_SWATCHES, FRAME_PRESETS } from "./presets";

describe("presets", () => {
  it("ships four gradient frame presets served from /backgrounds", () => {
    expect(FRAME_PRESETS).toHaveLength(4);
    for (const p of FRAME_PRESETS) {
      expect(p.src.startsWith("/backgrounds/")).toBe(true);
      expect(p.src.endsWith(".svg")).toBe(true);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = FRAME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers solid colour swatches alongside the gradients", () => {
    expect(COLOR_SWATCHES.length).toBeGreaterThan(0);
    for (const c of COLOR_SWATCHES) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
