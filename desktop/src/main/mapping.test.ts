import { describe, expect, it } from "vitest";
import {
  BUBBLE_ASPECT,
  HUD_SIZE,
  HUD_TOP_INSET,
  SIZE_FRACTION,
  bubbleCentreToNormalized,
  bubbleWindowSize,
  clamp01,
  clampToWorkArea,
  cycleShape,
  hudDefaultBounds,
  recorderWindowVisibility,
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

  it("uses the live camera aspect for `rounded` when given one", () => {
    // A 4:3 webcam: 422 wide (medium on a 1920 display) / (4/3) ≈ 317 tall —
    // without this, `rounded` would hardcode 16:9 and break self-occlusion
    // for any webcam that isn't 16:9.
    expect(bubbleWindowSize("rounded", "medium", 1920, 4 / 3)).toEqual({
      width: 422,
      height: 317,
    });
  });

  it("falls back to 16:9 for `rounded` when no camera aspect is given", () => {
    expect(bubbleWindowSize("rounded", "medium", 1920)).toEqual(
      bubbleWindowSize("rounded", "medium", 1920, 16 / 9),
    );
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

  it("falls back to medium/circle for an unknown size or shape", () => {
    // Untrusted IPC payloads reach this function; NaN bounds would take the
    // window down. `bubble.ts` validates first, this is the second defence.
    expect(
      bubbleWindowSize("circle", "huge" as unknown as "medium", 1920),
    ).toEqual(bubbleWindowSize("circle", "medium", 1920));
    expect(
      bubbleWindowSize("blob" as unknown as "circle", "medium", 1920),
    ).toEqual(bubbleWindowSize("circle", "medium", 1920));
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

describe("hudDefaultBounds", () => {
  it("centres the pill horizontally at the top of the work area", () => {
    // 1920-wide work area starting below a 25px menu bar.
    const bounds = hudDefaultBounds({ x: 0, y: 25, width: 1920, height: 1055 });
    expect(bounds.width).toBe(HUD_SIZE.width);
    expect(bounds.height).toBe(HUD_SIZE.height);
    expect(bounds.x).toBe(Math.round((1920 - HUD_SIZE.width) / 2));
    expect(bounds.y).toBe(25 + HUD_TOP_INSET);
  });

  it("respects a non-zero display origin (second monitor)", () => {
    const bounds = hudDefaultBounds({ x: 1920, y: 25, width: 1280, height: 775 });
    expect(bounds.x).toBe(1920 + Math.round((1280 - HUD_SIZE.width) / 2));
    expect(bounds.y).toBe(25 + HUD_TOP_INSET);
  });

  it("never places the pill off the left edge of a narrow work area", () => {
    const bounds = hudDefaultBounds({ x: 0, y: 0, width: 200, height: 400 });
    expect(bounds.x).toBe(0);
  });

  it("falls back to the origin for a degenerate work area", () => {
    const bounds = hudDefaultBounds({ x: 0, y: 0, width: NaN, height: NaN });
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(HUD_TOP_INSET);
  });
});

describe("clampToWorkArea", () => {
  // A 1920×1080 screen with a 25px menu bar and a dock reserving 60px.
  const area = { x: 0, y: 25, width: 1920, height: 995 };
  const size = { width: 300, height: 64 };

  it("leaves a window that is already inside alone", () => {
    const at = { x: 810, y: 37, ...size };
    expect(clampToWorkArea(at, area)).toEqual(at);
  });

  it("clamps to every edge of the work area", () => {
    expect(clampToWorkArea({ x: -500, y: 37, ...size }, area).x).toBe(0);
    expect(clampToWorkArea({ x: 5000, y: 37, ...size }, area).x).toBe(1920 - 300);
    // Above the work area is behind the menu bar, where the pill is ungrabbable.
    expect(clampToWorkArea({ x: 810, y: -100, ...size }, area).y).toBe(25);
    expect(clampToWorkArea({ x: 810, y: 5000, ...size }, area).y).toBe(25 + 995 - 64);
  });

  it("respects a work area whose origin is not (0, 0)", () => {
    const second = { x: -1440, y: -300, width: 1440, height: 900 };
    expect(clampToWorkArea({ x: -9999, y: -9999, ...size }, second)).toMatchObject({
      x: -1440,
      y: -300,
    });
    expect(clampToWorkArea({ x: 9999, y: 9999, ...size }, second)).toMatchObject({
      x: -1440 + 1440 - 300,
      y: -300 + 900 - 64,
    });
  });

  it("always returns integers — a fractional setPosition blurs the window", () => {
    const out = clampToWorkArea({ x: 810.4, y: 37.6, ...size }, area);
    expect(out.x).toBe(810);
    expect(out.y).toBe(38);
  });

  it("pins a window larger than the work area to the origin", () => {
    const huge = { x: 500, y: 500, width: 4000, height: 4000 };
    expect(clampToWorkArea(huge, area)).toMatchObject({ x: 0, y: 25 });
  });

  it("survives a work area that went non-finite (display unplugged mid-drag)", () => {
    const out = clampToWorkArea(
      { x: 810, y: 37, ...size },
      { x: NaN, y: NaN, width: NaN, height: NaN },
    );
    expect(out).toMatchObject({ x: 0, y: 0 });
  });

  it("keeps the window's size untouched", () => {
    expect(clampToWorkArea({ x: -1, y: -1, ...size }, area)).toMatchObject(size);
  });
});

describe("recorderWindowVisibility", () => {
  it("hides the recorder when the countdown starts", () => {
    expect(recorderWindowVisibility("setup" as never, "countdown")).toBe("hide");
    expect(recorderWindowVisibility("other", "countdown")).toBe("hide");
  });

  it("leaves the recorder up for a camera-only take (no display capture)", () => {
    expect(recorderWindowVisibility("other", "countdown", false)).toBe("none");
    expect(recorderWindowVisibility("idle", "countdown", false)).toBe("none");
    // Screen takes are unchanged.
    expect(recorderWindowVisibility("other", "countdown", true)).toBe("hide");
  });

  it("does nothing while the take runs", () => {
    expect(recorderWindowVisibility("countdown", "recording")).toBe("none");
    expect(recorderWindowVisibility("recording", "paused")).toBe("none");
    expect(recorderWindowVisibility("paused", "recording")).toBe("none");
    expect(recorderWindowVisibility("recording", "stopping")).toBe("none");
  });

  it("shows the recorder again when the take resolves", () => {
    expect(recorderWindowVisibility("stopping", "staging")).toBe("show");
    expect(recorderWindowVisibility("recording", "error")).toBe("show");
    expect(recorderWindowVisibility("countdown", "idle")).toBe("show");
  });

  it("treats `rendering` exactly like `staging`", () => {
    expect(recorderWindowVisibility("stopping", "rendering")).toBe("show");
    expect(recorderWindowVisibility("other", "rendering")).toBe("none");
    expect(recorderWindowVisibility("rendering", "idle")).toBe("none");
  });

  it("shows the recorder again after a discard back to setup", () => {
    // `setup` collapses to `other` on the HUD channel; a cancel goes straight
    // there without passing through staging/error/idle.
    expect(recorderWindowVisibility("recording", "other")).toBe("show");
    expect(recorderWindowVisibility("countdown", "other")).toBe("show");
  });

  it("does not re-show a window it never hid", () => {
    expect(recorderWindowVisibility("other", "staging")).toBe("none");
    expect(recorderWindowVisibility("idle", "idle")).toBe("none");
    expect(recorderWindowVisibility("staging", "idle")).toBe("none");
  });
});
