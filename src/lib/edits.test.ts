import { describe, expect, it } from "vitest";
import {
  arrowRect,
  EMPTY_EDITS,
  hasDrawableEdits,
  isEmptyEdits,
  MAX_CLICKS,
  MAX_DRAW_POINTS,
  MAX_MARKERS,
  MAX_OVERLAY_DATA_SRC,
  MAX_OVERLAY_SRC,
  MAX_OVERLAY_THICKNESS,
  MAX_TEXT,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  parseEdits,
  pointsRect,
} from "@/lib/edits";

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
        { type: "step", start: 1, end: 2, rect: { x: 0, y: 0, w: 1, h: 1 }, n: 3 },
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
      "step",
      "highlight",
    ]);
    expect(parsed.overlays[1].n).toBe(3);
    expect(parsed.overlays[2].color).toBe("#ff0");
  });

  it("maps the legacy `callout` type onto `step`", () => {
    const parsed = parseEdits({
      version: 1,
      overlays: [{ type: "callout", start: 1, end: 2, rect: { x: 0, y: 0, w: 1, h: 1 }, n: 3 }],
    });
    expect(parsed.overlays).toEqual([
      { type: "step", start: 1, end: 2, rect: { x: 0, y: 0, w: 1, h: 1 }, n: 3 },
    ]);
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
      frame: { enabled: true, padding: 0.1, radius: 0.02, shadow: 0, background: { kind: "color", color: "#fff" } },
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

  it("migrates a legacy boolean shadow to the equivalent strength on load", () => {
    const parsed = parseEdits({
      ...base,
      frame: { enabled: true, padding: 0.1, radius: 0.02, shadow: true, background: { kind: "color", color: "#fff" } },
    });
    expect(parsed.frame?.shadow).toBe(0.5);
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

  it("keeps a per-keyframe shape and drops an unrecognised one", () => {
    const parsed = parseEdits({
      ...base,
      camera: {
        shape: "circle",
        mirror: true,
        keyframes: [
          { t: 0, mode: "bubble", rect: { x: 0, y: 0, w: 0.2, h: 0.2 } },
          { t: 1, mode: "bubble", rect: { x: 0, y: 0, w: 0.2, h: 0.2 }, shape: "square" },
          { t: 2, mode: "bubble", rect: { x: 0, y: 0, w: 0.2, h: 0.2 }, shape: "hexagon" },
        ],
      },
    });
    expect(parsed.camera?.keyframes.map((k) => k.shape)).toEqual([undefined, "square", undefined]);
  });

  it("keeps a per-keyframe pan, clamped into 0..1", () => {
    const kf = (t: number, pan: unknown) => ({ t, mode: "bubble", rect: { x: 0, y: 0, w: 0.2, h: 0.2 }, pan });
    const parsed = parseEdits({
      ...base,
      camera: {
        shape: "circle",
        mirror: true,
        keyframes: [kf(0, { x: 0.25, y: 0.75 }), kf(1, { x: -4, y: 9 }), kf(2, { x: 0.3 })],
      },
    });
    expect(parsed.camera?.keyframes.map((k) => k.pan)).toEqual([
      { x: 0.25, y: 0.75 },
      { x: 0, y: 1 },
      // A half-written pan fills the missing axis in at centred rather than
      // dropping the axis the author did set.
      { x: 0.3, y: 0.5 },
    ]);
  });

  it("leaves pan absent when a keyframe has none or an unusable one", () => {
    const parsed = parseEdits({
      ...base,
      camera: {
        shape: "circle",
        mirror: true,
        keyframes: [
          { t: 0, mode: "bubble", rect: { x: 0, y: 0, w: 0.2, h: 0.2 } },
          { t: 1, mode: "bubble", rect: { x: 0, y: 0, w: 0.2, h: 0.2 }, pan: "middle" },
          { t: 2, mode: "bubble", rect: { x: 0, y: 0, w: 0.2, h: 0.2 }, pan: { x: Number.NaN, y: null } },
        ],
      },
    });
    expect(parsed.camera?.keyframes.map((k) => k.pan)).toEqual([undefined, undefined, undefined]);
  });

  it("accepts the hidden camera mode and rejects any other string", () => {
    const parsed = parseEdits({
      ...base,
      camera: {
        shape: "circle",
        mirror: true,
        keyframes: [
          { t: 0, mode: "bubble", rect: { x: 0, y: 0, w: 0.2, h: 0.2 } },
          { t: 1, mode: "hidden", rect: { x: 0, y: 0, w: 0.2, h: 0.2 } },
          { t: 2, mode: "invisible", rect: { x: 0, y: 0, w: 0.2, h: 0.2 } },
        ],
      },
    });
    expect(parsed.camera?.keyframes.map((k) => k.mode)).toEqual(["bubble", "hidden", "bubble"]);
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
        shadow: 0.5,
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

describe("parseEdits overlay fields", () => {
  const base = { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] };
  const one = (o: Record<string, unknown>) => parseEdits({ ...base, overlays: [o] }).overlays[0];

  it("keeps every new overlay type", () => {
    const types = ["blur", "ellipse", "step", "underline", "highlight", "arrow", "image", "click"];
    const parsed = parseEdits({
      ...base,
      overlays: types.map((type) => ({ type, start: 0, end: 1, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } })),
    });
    expect(parsed.overlays.map((o) => o.type)).toEqual(types);
  });

  it("clamps an arrow's from/to into 0..1 and derives the rect as their bounding box", () => {
    const o = one({
      type: "arrow",
      start: 0,
      end: 1,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      from: { x: -3, y: 0.25 },
      to: { x: 0.75, y: 4 },
    });
    expect(o.from).toEqual({ x: 0, y: 0.25 });
    expect(o.to).toEqual({ x: 0.75, y: 1 });
    expect(o.rect).toEqual(arrowRect({ x: 0, y: 0.25 }, { x: 0.75, y: 1 }));
  });

  it("gives an arrow with no points the rect's diagonal", () => {
    const o = one({ type: "arrow", start: 0, end: 1, rect: { x: 0.1, y: 0.2, w: 0.4, h: 0.3 } });
    expect(o.from).toEqual({ x: 0.1, y: 0.2 });
    expect(o.to).toEqual({ x: 0.5, y: 0.5 });
  });

  it("drops from/to from every non-arrow overlay", () => {
    const o = one({
      type: "ellipse",
      start: 0,
      end: 1,
      rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      from: { x: 0.1, y: 0.1 },
      to: { x: 0.2, y: 0.2 },
    });
    expect(o.from).toBeUndefined();
    expect(o.to).toBeUndefined();
  });

  it("keeps a blob: src as-is and drops a URL over the length cap", () => {
    const rect = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const src = "blob:http://localhost/abc";
    expect(one({ type: "image", start: 0, end: 1, rect, src }).src).toBe(src);
    const long = `blob:http://localhost/${"a".repeat(MAX_OVERLAY_SRC)}`;
    expect(one({ type: "image", start: 0, end: 1, rect, src: long }).src).toBeUndefined();
    expect(one({ type: "image", start: 0, end: 1, rect, src: 7 }).src).toBeUndefined();
  });

  it("holds a data: src to the much larger image cap, not the URL cap", () => {
    const rect = { x: 0, y: 0, w: 0.5, h: 0.5 };
    // A data URL IS the picture, so a URL-length cap would drop every real one.
    const embedded = `data:image/png;base64,${"A".repeat(MAX_OVERLAY_SRC)}`;
    expect(one({ type: "image", start: 0, end: 1, rect, src: embedded }).src).toBe(embedded);
    const huge = `data:image/png;base64,${"A".repeat(MAX_OVERLAY_DATA_SRC)}`;
    expect(one({ type: "image", start: 0, end: 1, rect, src: huge }).src).toBeUndefined();
  });

  it("rounds a step number up into a counting number", () => {
    const rect = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(one({ type: "step", start: 0, end: 1, rect, n: 3.7 }).n).toBe(4);
    expect(one({ type: "step", start: 0, end: 1, rect, n: 0 }).n).toBe(1);
    expect(one({ type: "step", start: 0, end: 1, rect, n: -2 }).n).toBe(1);
  });

  it("clamps thickness and opacity, and drops non-numbers", () => {
    const r = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(one({ type: "ellipse", start: 0, end: 1, rect: r, thickness: 9 }).thickness).toBe(MAX_OVERLAY_THICKNESS);
    expect(one({ type: "ellipse", start: 0, end: 1, rect: r, thickness: -1 }).thickness).toBe(0);
    expect(one({ type: "highlight", start: 0, end: 1, rect: r, opacity: 5 }).opacity).toBe(1);
    expect(one({ type: "highlight", start: 0, end: 1, rect: r, opacity: -5 }).opacity).toBe(0);
    expect(one({ type: "highlight", start: 0, end: 1, rect: r, opacity: "x" }).opacity).toBeUndefined();
    expect(one({ type: "ellipse", start: 0, end: 1, rect: r, thickness: NaN }).thickness).toBeUndefined();
  });
});

describe("arrowRect", () => {
  it("is the bounding box of the two points, whatever their order", () => {
    const r = arrowRect({ x: 0.8, y: 0.6 }, { x: 0.2, y: 0.1 });
    expect(r.x).toBeCloseTo(0.2);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.6);
    expect(r.h).toBeCloseTo(0.5);
  });

  it("never collapses to zero for an axis-aligned arrow", () => {
    const r = arrowRect({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 });
    expect(r.w).toBeCloseTo(0.6);
    expect(r.h).toBeGreaterThan(0);
  });
});

describe("parseEdits clicks", () => {
  const base = { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] };

  it("is absent when the row carries none", () => {
    expect(parseEdits(base).clicks).toBeUndefined();
    expect(parseEdits({ ...base, clicks: "nope" }).clicks).toBeUndefined();
  });

  it("sorts by t, clamps x/y into the frame and defaults `on` to true", () => {
    const parsed = parseEdits({
      ...base,
      clicks: [
        { t: 3, x: 1.4, y: -0.2, on: false },
        { t: 1, x: 0.25, y: 0.75 },
        { t: 2, x: 0.5, y: 0.5, on: true },
      ],
    });
    expect(parsed.clicks).toEqual([
      { t: 1, x: 0.25, y: 0.75, on: true },
      { t: 2, x: 0.5, y: 0.5, on: true },
      { t: 3, x: 1, y: 0, on: false },
    ]);
  });

  it("drops malformed marks and caps the list at MAX_CLICKS", () => {
    const parsed = parseEdits({
      ...base,
      clicks: [null, { t: "a", x: 0, y: 0 }, { t: -1, x: 0, y: 0 }, { t: 1, x: 0, y: "b" }, { t: 1, x: 0, y: 0 }],
    });
    expect(parsed.clicks).toEqual([{ t: 1, x: 0, y: 0, on: true }]);

    const many = Array.from({ length: MAX_CLICKS + 40 }, (_, i) => ({ t: i, x: 0.5, y: 0.5, on: true }));
    expect(parseEdits({ ...base, clicks: many }).clicks).toHaveLength(MAX_CLICKS);
  });

  it("sorts before capping, so an unordered list is thinned rather than truncated", () => {
    // Newest first: capping before the sort would keep the END of the take and
    // throw the beginning away, which is the opposite of what the cap means.
    const many = Array.from({ length: MAX_CLICKS + 40 }, (_, i) => ({
      t: MAX_CLICKS + 40 - i,
      x: 0.5,
      y: 0.5,
      on: true,
    }));
    const clicks = parseEdits({ ...base, clicks: many }).clicks!;
    expect(clicks).toHaveLength(MAX_CLICKS);
    expect(clicks[0].t).toBe(1);
    expect(clicks[MAX_CLICKS - 1].t).toBe(MAX_CLICKS);
  });

  it("sorts markers before capping them too", () => {
    const many = Array.from({ length: MAX_MARKERS + 20 }, (_, i) => ({ t: MAX_MARKERS + 20 - i }));
    const markers = parseEdits({ ...base, markers: many }).markers;
    expect(markers).toHaveLength(MAX_MARKERS);
    expect(markers[0].t).toBe(1);
    expect(markers[MAX_MARKERS - 1].t).toBe(MAX_MARKERS);
  });
});

describe("parseEdits cursor and motionBlur", () => {
  const base = { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] };

  it("keeps a well-formed cursor config", () => {
    expect(parseEdits({ ...base, cursor: { style: "smooth", size: 1.5 } }).cursor).toEqual({
      style: "smooth",
      size: 1.5,
    });
  });

  it("falls back to the defaults and clamps size into 0.5..2", () => {
    expect(parseEdits({ ...base, cursor: {} }).cursor).toEqual({ style: "real", size: 1 });
    expect(parseEdits({ ...base, cursor: { style: "wat", size: 9 } }).cursor).toEqual({ style: "real", size: 2 });
    expect(parseEdits({ ...base, cursor: { style: "none", size: 0 } }).cursor).toEqual({ style: "none", size: 0.5 });
    expect(parseEdits({ ...base, cursor: 7 }).cursor).toBeUndefined();
    expect(parseEdits(base).cursor).toBeUndefined();
  });

  it("keeps motionBlur only when it is a boolean", () => {
    expect(parseEdits({ ...base, motionBlur: false }).motionBlur).toBe(false);
    expect(parseEdits({ ...base, motionBlur: true }).motionBlur).toBe(true);
    expect(parseEdits({ ...base, motionBlur: "yes" }).motionBlur).toBeUndefined();
    expect(parseEdits(base).motionBlur).toBeUndefined();
  });
});

describe("parseEdits zoom kind", () => {
  const base = { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] };
  const rect = { x: 0, y: 0, w: 0.5, h: 0.5 };
  const one = (z: Record<string, unknown>) => parseEdits({ ...base, zooms: [z] }).zooms[0];

  it("migrates the legacy `follow` flag to `kind` and stops emitting it", () => {
    const z = one({ start: 0, end: 1, rect, follow: true });
    expect(z.kind).toBe("follow");
    expect(z.follow).toBeUndefined();
  });

  it("keeps an explicit kind and leaves an ordinary zoom without one", () => {
    expect(one({ start: 0, end: 1, rect, kind: "follow" }).kind).toBe("follow");
    expect(one({ start: 0, end: 1, rect, kind: "static" }).kind).toBe("static");
    expect(one({ start: 0, end: 1, rect }).kind).toBeUndefined();
    expect(one({ start: 0, end: 1, rect, kind: "wat" }).kind).toBeUndefined();
    expect(one({ start: 0, end: 1, rect, follow: false }).kind).toBeUndefined();
  });
});

describe("parseEdits addendum overlay fields", () => {
  const base = { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] };
  const rect = { x: 0, y: 0, w: 0.5, h: 0.5 };
  const one = (o: Record<string, unknown>) => parseEdits({ ...base, overlays: [o] }).overlays[0];

  it("keeps every overlay type in the full set", () => {
    const types = [
      "blur", "blackout", "ellipse", "rect", "line", "arrow", "step",
      "underline", "highlight", "text", "emoji", "draw", "image", "keys", "click",
    ];
    const parsed = parseEdits({
      ...base,
      overlays: types.map((type) => ({ type, start: 0, end: 1, rect })),
    });
    expect(parsed.overlays.map((o) => o.type)).toEqual(types);
  });

  it("still maps the legacy `callout` type to `step`", () => {
    expect(one({ type: "callout", start: 0, end: 1, rect }).type).toBe("step");
  });

  it("gives a line the same from/to/rect invariant as an arrow", () => {
    const o = one({ type: "line", start: 0, end: 1, rect, from: { x: 0.1, y: 0.9 }, to: { x: 0.6, y: 0.2 } });
    expect(o.from).toEqual({ x: 0.1, y: 0.9 });
    expect(o.to).toEqual({ x: 0.6, y: 0.2 });
    expect(o.rect).toEqual(arrowRect({ x: 0.1, y: 0.9 }, { x: 0.6, y: 0.2 }));
  });

  it("keeps fill, arrow style, bg and a clamped ctrl point", () => {
    expect(one({ type: "rect", start: 0, end: 1, rect, fill: true }).fill).toBe(true);
    expect(one({ type: "rect", start: 0, end: 1, rect, fill: "yes" }).fill).toBeUndefined();
    expect(one({ type: "arrow", start: 0, end: 1, rect, style: "curved" }).style).toBe("curved");
    expect(one({ type: "arrow", start: 0, end: 1, rect, style: "wobbly" }).style).toBeUndefined();
    expect(one({ type: "arrow", start: 0, end: 1, rect, ctrl: { x: 2, y: -1 } }).ctrl).toEqual({ x: 1, y: 0 });
    expect(one({ type: "arrow", start: 0, end: 1, rect, ctrl: { x: 0.5 } }).ctrl).toBeUndefined();
    expect(one({ type: "text", start: 0, end: 1, rect, bg: "#000" }).bg).toBe("#000");
  });

  it("truncates text to MAX_TEXT and clamps size into the text-size range", () => {
    expect(one({ type: "text", start: 0, end: 1, rect, text: "hi" }).text).toBe("hi");
    expect(one({ type: "text", start: 0, end: 1, rect, text: "x".repeat(MAX_TEXT + 50) }).text).toHaveLength(MAX_TEXT);
    expect(one({ type: "text", start: 0, end: 1, rect, text: 7 }).text).toBeUndefined();
    expect(one({ type: "text", start: 0, end: 1, rect, size: 9 }).size).toBe(MAX_TEXT_SIZE);
    expect(one({ type: "text", start: 0, end: 1, rect, size: 0 }).size).toBe(MIN_TEXT_SIZE);
    expect(one({ type: "text", start: 0, end: 1, rect, size: NaN }).size).toBeUndefined();
  });

  it("clamps draw points, caps them at MAX_DRAW_POINTS and re-derives the rect", () => {
    const o = one({
      type: "draw",
      start: 0,
      end: 1,
      rect,
      points: [{ x: -1, y: 0.4 }, { x: 0.8, y: 2 }, null, { x: 0.3, y: "a" }],
    });
    expect(o.points).toEqual([{ x: 0, y: 0.4 }, { x: 0.8, y: 1 }]);
    expect(o.rect).toEqual(pointsRect(o.points!));

    const many = Array.from({ length: MAX_DRAW_POINTS + 100 }, () => ({ x: 0.5, y: 0.5 }));
    expect(one({ type: "draw", start: 0, end: 1, rect, points: many }).points).toHaveLength(MAX_DRAW_POINTS);
  });

  it("drops points from every non-draw overlay", () => {
    expect(one({ type: "ellipse", start: 0, end: 1, rect, points: [{ x: 0.1, y: 0.1 }] }).points).toBeUndefined();
  });

  it("leaves a draw overlay's stored rect alone when it has no usable points", () => {
    const o = one({ type: "draw", start: 0, end: 1, rect, points: [] });
    expect(o.points).toBeUndefined();
    expect(o.rect).toEqual(rect);
  });
});

describe("pointsRect", () => {
  it("is the bounding box of every point, never zero-area", () => {
    expect(pointsRect([{ x: 0.2, y: 0.8 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.5 }])).toEqual(
      arrowRect({ x: 0.2, y: 0.1 }, { x: 0.6, y: 0.8 }),
    );
    const dot = pointsRect([{ x: 0.5, y: 0.5 }]);
    expect(dot!.w).toBeGreaterThan(0);
    expect(dot!.h).toBeGreaterThan(0);
    expect(pointsRect([])).toBeNull();
  });
});
