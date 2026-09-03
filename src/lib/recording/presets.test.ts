import { describe, expect, it } from "vitest";
import {
  COLOR_SWATCHES,
  FRAME_PRESETS,
  PRESET_ALIASES,
  resolvePresetId,
} from "./presets";
import { DEFAULT_FRAME } from "./settings";

describe("presets", () => {
  it("ships sixteen gradient frame presets served from /backgrounds", () => {
    expect(FRAME_PRESETS).toHaveLength(16);
    for (const p of FRAME_PRESETS) {
      expect(p.src.startsWith("/backgrounds/")).toBe(true);
      expect(p.src.endsWith(".svg")).toBe(true);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("uses g01…g16 ids that match their file names", () => {
    expect(FRAME_PRESETS.map((p) => p.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `g${String(i + 1).padStart(2, "0")}`),
    );
    for (const p of FRAME_PRESETS) expect(p.src).toBe(`/backgrounds/${p.id}.svg`);
  });

  it("has unique ids and unique labels", () => {
    const ids = FRAME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const labels = FRAME_PRESETS.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("gives every preset a 135° swatch built from three hex stops", () => {
    for (const p of FRAME_PRESETS) {
      expect(p.swatch).toMatch(
        /^linear-gradient\(135deg,#[0-9a-f]{6} 0%,#[0-9a-f]{6} 55%,#[0-9a-f]{6} 100%\)$/i,
      );
    }
  });

  it("offers solid colour swatches alongside the gradients", () => {
    expect(COLOR_SWATCHES.length).toBeGreaterThan(0);
    for (const c of COLOR_SWATCHES) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("resolvePresetId", () => {
  it("maps every legacy id onto a real catalogue entry", () => {
    const ids = new Set(FRAME_PRESETS.map((p) => p.id));
    for (const [legacy, target] of Object.entries(PRESET_ALIASES)) {
      expect(ids.has(target)).toBe(true);
      expect(resolvePresetId(legacy)).toBe(target);
    }
  });

  it("passes a catalogue id through untouched", () => {
    expect(resolvePresetId("g01")).toBe("g01");
    expect(resolvePresetId("unknown")).toBe("unknown");
    expect(resolvePresetId(undefined)).toBeUndefined();
  });

  it("keeps the shipped default (`mint`) selectable", () => {
    // DEFAULT_FRAME still points at /backgrounds/mint.svg, which is generated
    // as a copy of g09 — the picker rings g09 for it.
    expect(DEFAULT_FRAME.background.presetId).toBe("mint");
    expect(DEFAULT_FRAME.background.src).toBe("/backgrounds/mint.svg");
    expect(resolvePresetId(DEFAULT_FRAME.background.presetId)).toBe("g09");
  });
});
