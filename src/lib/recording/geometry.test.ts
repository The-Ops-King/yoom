import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BUBBLE, DEFAULT_FRAME } from "./settings";
import {
  bubblePath,
  clampNormalized,
  computeBubbleRect,
  computeFrameLayout,
  coverCrop,
  pointerToNormalized,
  SIZE_FRACTION,
} from "./geometry";
import type { BubbleConfig } from "./types";

const bubble = (patch: Partial<BubbleConfig> = {}): BubbleConfig => ({
  ...DEFAULT_BUBBLE,
  ...patch,
});

describe("coverCrop", () => {
  it("crops the sides of a wide source into a square", () => {
    expect(coverCrop(1920, 1080, 100, 100)).toEqual({
      sx: 420,
      sy: 0,
      sw: 1080,
      sh: 1080,
    });
  });

  it("crops the top and bottom of a tall source into a wide box", () => {
    expect(coverCrop(1080, 1920, 160, 90)).toEqual({
      sx: 0,
      sy: 656.25,
      sw: 1080,
      sh: 607.5,
    });
  });

  it("returns the whole source when aspects match", () => {
    expect(coverCrop(1280, 720, 640, 360)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it("is safe with degenerate sizes", () => {
    expect(coverCrop(0, 0, 100, 100)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(coverCrop(100, 100, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
  });
});

describe("clampNormalized", () => {
  it("clamps into 0..1", () => {
    expect(clampNormalized(-2)).toBe(0);
    expect(clampNormalized(3)).toBe(1);
    expect(clampNormalized(0.4)).toBe(0.4);
    expect(clampNormalized(Number.NaN)).toBe(0.5);
  });
});

describe("computeBubbleRect", () => {
  it("sizes the bubble as a fraction of canvas width", () => {
    expect(SIZE_FRACTION).toEqual({ small: 0.15, medium: 0.22, large: 0.3 });
    const r = computeBubbleRect(1000, 1000, 1280, 720, bubble({ size: "small", pos: { x: 0.5, y: 0.5 } }));
    expect(r.w).toBe(150);
    expect(r.h).toBe(150); // circle is 1:1
  });

  it("uses 9:16 for portrait and the camera aspect for rounded", () => {
    const portrait = computeBubbleRect(1000, 2000, 1280, 720, bubble({ shape: "portrait", size: "medium" }));
    expect(portrait.w).toBe(220);
    expect(portrait.h).toBe(Math.round((220 * 16) / 9));

    const rounded = computeBubbleRect(1000, 1000, 1280, 720, bubble({ shape: "rounded", size: "medium" }));
    expect(rounded.h).toBe(Math.round(220 * (720 / 1280)));
  });

  it("fills the canvas for the full shape", () => {
    const r = computeBubbleRect(1600, 900, 1280, 720, bubble({ shape: "full" }));
    expect(r).toMatchObject({ x: 0, y: 0, w: 1600, h: 900 });
  });

  it("centres on the normalized position", () => {
    const r = computeBubbleRect(1000, 1000, 1000, 1000, bubble({ size: "small", pos: { x: 0.5, y: 0.25 } }));
    expect(r.x + r.w / 2).toBe(500);
    expect(r.y + r.h / 2).toBe(250);
  });

  it("clamps the bubble inside the canvas", () => {
    const r = computeBubbleRect(1000, 1000, 1000, 1000, bubble({ size: "small", pos: { x: 1, y: 1 } }));
    expect(r.x + r.w).toBe(1000);
    expect(r.y + r.h).toBe(1000);
    const r2 = computeBubbleRect(1000, 1000, 1000, 1000, bubble({ size: "small", pos: { x: 0, y: 0 } }));
    expect(r2.x).toBe(0);
    expect(r2.y).toBe(0);
  });

  it("centres rather than exploding when the bubble is larger than the canvas", () => {
    const r = computeBubbleRect(100, 100, 1280, 720, bubble({ shape: "portrait", size: "large" }));
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.y)).toBe(true);
  });

  it("carries an object-fit-cover crop for the camera", () => {
    const r = computeBubbleRect(1000, 1000, 1280, 720, bubble({ size: "small" }));
    expect(r.crop).toEqual(coverCrop(1280, 720, r.w, r.h));
  });

  it("returns a zero-size rect when the canvas is empty", () => {
    expect(computeBubbleRect(0, 0, 1280, 720, bubble()).w).toBe(0);
  });
});

describe("computeFrameLayout", () => {
  it("is a pass-through when disabled", () => {
    expect(computeFrameLayout(1920, 1080, { ...DEFAULT_FRAME, enabled: false })).toEqual({
      canvasW: 1920,
      canvasH: 1080,
      dest: { x: 0, y: 0, w: 1920, h: 1080 },
      radius: 0,
    });
  });

  it("pads the canvas symmetrically and keeps even dimensions", () => {
    const l = computeFrameLayout(1920, 1080, {
      ...DEFAULT_FRAME,
      enabled: true,
      padding: 0.05,
      radius: 0.01,
    });
    expect(l.canvasW).toBe(2112); // 1920 + 2*96
    expect(l.canvasH).toBe(1272); // 1080 + 2*96
    expect(l.canvasW % 2).toBe(0);
    expect(l.canvasH % 2).toBe(0);
    expect(l.dest).toEqual({ x: 96, y: 96, w: 1920, h: 1080 });
    expect(l.radius).toBe(19);
  });

  it("clamps padding and radius to their allowed ranges", () => {
    const l = computeFrameLayout(1000, 1000, {
      ...DEFAULT_FRAME,
      enabled: true,
      padding: 9,
      radius: -3,
    });
    expect(l.canvasW).toBe(1400); // padding clamped to 0.2
    expect(l.radius).toBe(0);
  });

  it("is a pass-through for degenerate sources", () => {
    expect(computeFrameLayout(0, 0, { ...DEFAULT_FRAME, enabled: true }).canvasW).toBe(0);
  });
});

describe("pointerToNormalized", () => {
  it("maps a client point inside a rect to 0..1", () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(pointerToNormalized(300, 150, rect)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps points outside the rect", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(pointerToNormalized(-40, 400, rect)).toEqual({ x: 0, y: 1 });
  });

  it("returns the centre for a zero-size rect", () => {
    expect(pointerToNormalized(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });
});

describe("bubblePath", () => {
  class StubPath2D {
    ops: string[] = [];
    ellipse() {
      this.ops.push("ellipse");
    }
    rect() {
      this.ops.push("rect");
    }
    roundRect() {
      this.ops.push("roundRect");
    }
    closePath() {
      this.ops.push("close");
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an ellipse for circle, a rect for square and a roundRect otherwise", () => {
    vi.stubGlobal("Path2D", StubPath2D);
    const rect = { x: 0, y: 0, w: 100, h: 100, crop: { sx: 0, sy: 0, sw: 1, sh: 1 } };

    expect((bubblePath(rect, "circle") as unknown as StubPath2D).ops).toContain("ellipse");
    expect((bubblePath(rect, "square") as unknown as StubPath2D).ops).toContain("rect");
    expect((bubblePath(rect, "rounded") as unknown as StubPath2D).ops).toContain("roundRect");
    expect((bubblePath(rect, "portrait") as unknown as StubPath2D).ops).toContain("roundRect");
    expect((bubblePath(rect, "full") as unknown as StubPath2D).ops).toContain("rect");
  });

  it("falls back to rect when roundRect is unavailable", () => {
    class NoRoundRect {
      ops: string[] = [];
      rect() {
        this.ops.push("rect");
      }
      ellipse() {
        this.ops.push("ellipse");
      }
      closePath() {}
    }
    vi.stubGlobal("Path2D", NoRoundRect);
    const rect = { x: 0, y: 0, w: 100, h: 60, crop: { sx: 0, sy: 0, sw: 1, sh: 1 } };
    expect((bubblePath(rect, "rounded") as unknown as NoRoundRect).ops).toEqual(["rect"]);
  });
});
