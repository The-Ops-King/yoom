import { describe, expect, it } from "vitest";
import { EMPTY_EDITS, hasDrawableEdits, isEmptyEdits, parseEdits } from "@/lib/edits";

describe("parseEdits", () => {
  it("returns the empty list for junk input", () => {
    for (const junk of [null, undefined, 1, "x", [], {}, { version: 2 }]) {
      expect(parseEdits(junk)).toEqual(EMPTY_EDITS);
    }
  });

  it("keeps well-formed cuts and drops malformed ones", () => {
    const parsed = parseEdits({
      version: 1,
      cuts: [
        { start: 1, end: 2 },
        { start: 5, end: 5 },
        { start: "a", end: 2 },
        null,
      ],
    });
    expect(parsed.cuts).toEqual([{ start: 1, end: 2 }]);
  });

  it("keeps a valid crop and rejects a zero-area one", () => {
    expect(parseEdits({ version: 1, crop: { x: 0, y: 0, w: 1, h: 0.5 } }).crop).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 0.5,
    });
    expect(parseEdits({ version: 1, crop: { x: 0, y: 0, w: 0, h: 1 } }).crop).toBeNull();
  });

  it("keeps zooms with a valid rect", () => {
    const parsed = parseEdits({
      version: 1,
      zooms: [
        { start: 0, end: 3, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
        { start: 0, end: 3, rect: { x: 0.1, y: 0.1, w: 0 } },
      ],
    });
    expect(parsed.zooms).toHaveLength(1);
    expect(parsed.zooms[0].rect.w).toBe(0.5);
  });

  it("keeps only known overlay types and carries n/color", () => {
    const parsed = parseEdits({
      version: 1,
      overlays: [
        { type: "blur", start: 0, end: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
        { type: "callout", start: 1, end: 2, rect: { x: 0, y: 0, w: 1, h: 1 }, n: 3 },
        { type: "sparkle", start: 0, end: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
        {
          type: "highlight",
          start: 0,
          end: 1,
          rect: { x: 0, y: 0, w: 1, h: 1 },
          color: "#ff0",
        },
      ],
    });
    expect(parsed.overlays.map((o) => o.type)).toEqual([
      "blur",
      "callout",
      "highlight",
    ]);
    expect(parsed.overlays[1].n).toBe(3);
    expect(parsed.overlays[2].color).toBe("#ff0");
  });

  it("clamps overlay rects into the 0..1 frame", () => {
    const parsed = parseEdits({
      version: 1,
      overlays: [{ type: "blur", start: 0, end: 1, rect: { x: 1.5, y: 0, w: 1, h: 1 } }],
    });
    expect(parsed.overlays[0].rect.x).toBeLessThan(1);
  });

  it("round-trips through JSON", () => {
    const source = {
      version: 1,
      cuts: [{ start: 0, end: 1 }],
      crop: null,
      zooms: [],
      overlays: [],
    };
    expect(parseEdits(JSON.parse(JSON.stringify(source)))).toEqual({
      version: 1,
      cuts: [{ start: 0, end: 1 }],
      crop: null,
      zooms: [],
      overlays: [],
      markers: [],
    });
  });

  it("keeps well-formed markers, sorts them, and drops invalid entries", () => {
    const parsed = parseEdits({
      version: 1,
      markers: [
        { t: 5, label: "second" },
        { t: 1 },
        { t: -1, label: "bad" },
        { t: "x", label: "bad" },
        null,
      ],
    });
    expect(parsed.markers).toEqual([{ t: 1 }, { t: 5, label: "second" }]);
  });

  it("drops non-string marker labels", () => {
    const parsed = parseEdits({
      version: 1,
      markers: [{ t: 1, label: 5 }],
    });
    expect(parsed.markers).toEqual([{ t: 1 }]);
  });

  it("returns a fresh object for empty/invalid input each time", () => {
    expect(parseEdits(null)).not.toBe(parseEdits(null));
  });

  it("does not let mutating one result affect a later call", () => {
    const first = parseEdits(null);
    first.cuts.push({ start: 0, end: 1 });
    first.markers.push({ t: 1 });
    const second = parseEdits(undefined);
    expect(second.cuts).toEqual([]);
    expect(second.markers).toEqual([]);
  });
});

describe("isEmptyEdits", () => {
  it("is true for the empty list and false once anything is set", () => {
    expect(isEmptyEdits(EMPTY_EDITS)).toBe(true);
    expect(
      isEmptyEdits({ ...EMPTY_EDITS, cuts: [{ start: 0, end: 1 }] }),
    ).toBe(false);
    expect(
      isEmptyEdits({ ...EMPTY_EDITS, markers: [{ t: 1 }] }),
    ).toBe(false);
  });
});

describe("hasDrawableEdits", () => {
  it("is false for the empty list and for markers-only edits", () => {
    expect(hasDrawableEdits(EMPTY_EDITS)).toBe(false);
    expect(
      hasDrawableEdits({ ...EMPTY_EDITS, markers: [{ t: 1 }] }),
    ).toBe(false);
  });

  it("is true once anything drawable is set", () => {
    expect(
      hasDrawableEdits({ ...EMPTY_EDITS, cuts: [{ start: 0, end: 1 }] }),
    ).toBe(true);
    expect(
      hasDrawableEdits({
        ...EMPTY_EDITS,
        crop: { x: 0, y: 0, w: 1, h: 1 },
      }),
    ).toBe(true);
    expect(
      hasDrawableEdits({
        ...EMPTY_EDITS,
        zooms: [{ start: 0, end: 1, rect: { x: 0, y: 0, w: 1, h: 1 } }],
      }),
    ).toBe(true);
    expect(
      hasDrawableEdits({
        ...EMPTY_EDITS,
        overlays: [
          {
            type: "blur",
            start: 0,
            end: 1,
            rect: { x: 0, y: 0, w: 1, h: 1 },
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("EMPTY_EDITS", () => {
  it("is deeply frozen so it can be safely shared as a default", () => {
    expect(Object.isFrozen(EMPTY_EDITS)).toBe(true);
    expect(Object.isFrozen(EMPTY_EDITS.cuts)).toBe(true);
    expect(Object.isFrozen(EMPTY_EDITS.zooms)).toBe(true);
    expect(Object.isFrozen(EMPTY_EDITS.overlays)).toBe(true);
    expect(Object.isFrozen(EMPTY_EDITS.markers)).toBe(true);
  });
});

describe("parseEdits staging fields", () => {
  const base = { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] };

  it("keeps trim, frame, camera and cameraOffsetMs", () => {
    const parsed = parseEdits({
      ...base,
      trim: { start: 1, end: 9 },
      frame: { enabled: true, padding: 0.1, radius: 0.02, shadow: false, background: { kind: "color", color: "#fff" } },
      camera: {
        shape: "circle",
        mirror: true,
        keyframes: [
          { t: 0, mode: "bubble", rect: { x: 0.7, y: 0.7, w: 0.2, h: 0.3 } },
          { t: 4, mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } },
        ],
      },
      cameraOffsetMs: 120,
    });
    expect(parsed.trim).toEqual({ start: 1, end: 9 });
    expect(parsed.frame?.padding).toBe(0.1);
    expect(parsed.camera?.keyframes).toHaveLength(2);
    expect(parsed.camera?.keyframes[1].mode).toBe("full");
    expect(parsed.cameraOffsetMs).toBe(120);
  });

  it("forces the first keyframe to t=0, sorts, and clamps rects", () => {
    const parsed = parseEdits({
      ...base,
      camera: {
        shape: "square",
        mirror: false,
        keyframes: [
          { t: 5, mode: "bubble", rect: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } },
          { t: 2, mode: "bubble", rect: { x: -1, y: 0, w: 2, h: 0.2 } },
        ],
      },
    });
    expect(parsed.camera?.keyframes.map((k) => k.t)).toEqual([0, 5]);
    expect(parsed.camera?.keyframes[0].rect).toEqual({ x: 0, y: 0, w: 1, h: 0.2 });
  });

  it("drops an invalid trim and clamps cameraOffsetMs", () => {
    const parsed = parseEdits({ ...base, trim: { start: 5, end: 2 }, cameraOffsetMs: 99999 });
    expect(parsed.trim).toBeUndefined();
    expect(parsed.cameraOffsetMs).toBe(5000);
  });

  it("accepts the click overlay type and truncates to 64 overlays", () => {
    const overlays = Array.from({ length: 70 }, (_, i) => ({
      type: "click", start: i, end: i + 0.5, rect: { x: 0.5, y: 0.5, w: 0.05, h: 0.05 },
    }));
    const parsed = parseEdits({ ...base, overlays });
    expect(parsed.overlays).toHaveLength(64);
    expect(parsed.overlays[0].type).toBe("click");
  });

  it("leaves rows without the new fields unchanged", () => {
    const parsed = parseEdits(base);
    expect(parsed.trim).toBeUndefined();
    expect(parsed.frame).toBeUndefined();
    expect(parsed.camera).toBeUndefined();
  });

  it("treats an empty keyframe list as no camera track", () => {
    const parsed = parseEdits({ ...base, camera: { shape: "circle", mirror: true, keyframes: [] } });
    expect(parsed.camera).toBeUndefined();
  });

  it("accepts an explicit null camera", () => {
    const parsed = parseEdits({ ...base, camera: null });
    expect(parsed.camera).toBeNull();
  });

  it("falls back to circle for an invalid shape and false for a non-boolean mirror", () => {
    const parsed = parseEdits({
      ...base,
      camera: {
        shape: "hexagon",
        mirror: "yes",
        keyframes: [{ t: 0, mode: "bubble", rect: { x: 0, y: 0, w: 0.2, h: 0.2 } }],
      },
    });
    expect(parsed.camera?.shape).toBe("circle");
    expect(parsed.camera?.mirror).toBe(false);
  });

  it("truncates camera keyframes to 64", () => {
    const keyframes = Array.from({ length: 70 }, (_, i) => ({
      t: i,
      mode: "bubble",
      rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    }));
    const parsed = parseEdits({ ...base, camera: { shape: "circle", mirror: false, keyframes } });
    expect(parsed.camera?.keyframes).toHaveLength(64);
  });

  it("clamps zoom ramp to the 0..2 range", () => {
    const parsed = parseEdits({
      ...base,
      zooms: [{ start: 0, end: 1, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ramp: 9 }],
    });
    expect(parsed.zooms[0].ramp).toBe(2);
  });

  it("drops a blob: frame background src", () => {
    const parsed = parseEdits({
      ...base,
      frame: {
        enabled: true,
        padding: 0.1,
        radius: 0.02,
        shadow: true,
        background: { kind: "image", src: "blob:http://x/1" },
      },
    });
    expect(parsed.frame?.background).toEqual({ kind: "none" });
  });

  it("drops a keyframe whose rect contains NaN", () => {
    const parsed = parseEdits({
      ...base,
      camera: {
        shape: "circle",
        mirror: false,
        keyframes: [
          { t: 0, mode: "bubble", rect: { x: NaN, y: 0, w: 0.2, h: 0.2 } },
          { t: 1, mode: "bubble", rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
        ],
      },
    });
    expect(parsed.camera?.keyframes).toHaveLength(1);
    expect(parsed.camera?.keyframes[0].t).toBe(0);
  });
});
