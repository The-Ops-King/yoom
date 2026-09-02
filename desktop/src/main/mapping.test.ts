import { describe, expect, it } from "vitest";
import {
  BUBBLE_ASPECT,
  SIZE_FRACTION,
  bubbleCentreToNormalized,
  bubbleWindowSize,
  clamp01,
  cycleShape,
  shapeToCss,
} from "./mapping";

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe("clamp01", () => {
  it("clamps and defaults non-finite input to the centre", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(NaN)).toBe(0.5);
  });
});

describe("bubbleCentreToNormalized", () => {
  it("maps a window's centre into 0..1 of the display", () => {
    // Centre of a 240×240 window at (840, 420) is (960, 540) = dead centre.
    expect(
      bubbleCentreToNormalized({ x: 840, y: 420, width: 240, height: 240 }, display),
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it("respects a display whose origin is not (0, 0)", () => {
    const second = { x: 1920, y: -200, width: 1440, height: 900 };
    const centred = { x: 1920 + 720 - 100, y: -200 + 450 - 100, width: 200, height: 200 };
    expect(bubbleCentreToNormalized(centred, second)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps a window dragged partly off the display", () => {
    expect(
      bubbleCentreToNormalized({ x: -400, y: -400, width: 240, height: 240 }, display),
    ).toEqual({ x: 0, y: 0 });
    expect(
      bubbleCentreToNormalized({ x: 3000, y: 2000, width: 240, height: 240 }, display),
    ).toEqual({ x: 1, y: 1 });
  });

  it("returns the centre for a degenerate display", () => {
    expect(
      bubbleCentreToNormalized(
        { x: 0, y: 0, width: 240, height: 240 },
        { x: 0, y: 0, width: 0, height: 0 },
      ),
    ).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("bubbleWindowSize", () => {
  it("matches the web compositor's size fractions", () => {
    // These MUST equal SIZE_FRACTION in src/lib/recording/geometry.ts.
    expect(SIZE_FRACTION).toEqual({ small: 0.15, medium: 0.22, large: 0.3 });
  });

  it("sizes a circle as a square at the size fraction of the display width", () => {
    expect(bubbleWindowSize("circle", "medium", 1920)).toEqual({
      width: 422,
      height: 422,
    });
  });

  it("applies the shape aspect ratio", () => {
    // rounded = 16/9 → 288 wide, 162 tall at small on a 1920-wide display.
    expect(bubbleWindowSize("rounded", "small", 1920)).toEqual({
      width: 288,
      height: 162,
    });
    // portrait = 9/16 → 576 wide, 1024 tall at large.
    expect(bubbleWindowSize("portrait", "large", 1920)).toEqual({
      width: 576,
      height: 1024,
    });
  });

  it("never returns a window narrower than the minimum usable size", () => {
    const { width, height } = bubbleWindowSize("circle", "small", 200);
    expect(width).toBe(120);
    expect(height).toBe(120);
  });

  it("clamps the width first so the minimum keeps the aspect ratio", () => {
    // 200 * 0.15 = 30 → clamped to the 120px minimum, and the height follows
    // from the aspect rather than being clamped independently (which would
    // turn a 16:9 bubble into a square and break self-occlusion).
    expect(bubbleWindowSize("rounded", "small", 200)).toEqual({
      width: 120,
      height: 68,
    });
    expect(bubbleWindowSize("portrait", "small", 200)).toEqual({
      width: 120,
      height: 213,
    });
  });

  it("treats a non-finite display width as zero", () => {
    expect(bubbleWindowSize("circle", "medium", Number.NaN)).toEqual({
      width: 120,
      height: 120,
    });
    expect(bubbleWindowSize("circle", "medium", Number.POSITIVE_INFINITY)).toEqual({
      width: 120,
      height: 120,
    });
  });

  it("knows every shape's aspect ratio", () => {
    expect(BUBBLE_ASPECT.circle).toBe(1);
    expect(BUBBLE_ASPECT.square).toBe(1);
    expect(BUBBLE_ASPECT.rounded).toBeCloseTo(16 / 9, 6);
    expect(BUBBLE_ASPECT.portrait).toBeCloseTo(9 / 16, 6);
    expect(BUBBLE_ASPECT.full).toBeCloseTo(16 / 9, 6);
  });
});

describe("shapeToCss", () => {
  it("rounds a circle to a pill of half its short side", () => {
    expect(shapeToCss("circle", false)).toEqual({
      borderRadius: "50%",
      transform: "none",
    });
  });

  it("squares off a square", () => {
    expect(shapeToCss("square", false)).toEqual({
      borderRadius: "0px",
      transform: "none",
    });
  });

  it("squares off `full` too — camera-only mode fills its container", () => {
    expect(shapeToCss("full", false).borderRadius).toBe("0px");
  });

  it("uses the shared 14% corner fraction for rounded and portrait", () => {
    expect(shapeToCss("rounded", false).borderRadius).toBe("14%");
    expect(shapeToCss("portrait", false).borderRadius).toBe("14%");
  });

  it("mirrors with a scale transform, never by flipping the layout", () => {
    expect(shapeToCss("circle", true).transform).toBe("scaleX(-1)");
  });
});

describe("cycleShape", () => {
  it("walks circle → rounded → square → portrait → circle", () => {
    expect(cycleShape("circle")).toBe("rounded");
    expect(cycleShape("rounded")).toBe("square");
    expect(cycleShape("square")).toBe("portrait");
    expect(cycleShape("portrait")).toBe("circle");
  });

  it("treats `full` as circle (the floating bubble has no full-screen shape)", () => {
    expect(cycleShape("full")).toBe("circle");
  });
});
