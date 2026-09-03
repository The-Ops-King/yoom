import { describe, expect, it } from "vitest";
import { MAX_ZOOMS, type Zoom } from "@/lib/edits";
import { FULL_RECT, fitView, insertZoom, toOutput, zoomAt } from "./zoom";

const z = { start: 2, end: 6, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };

describe("zoomAt", () => {
  it("is the full frame outside any zoom", () => {
    expect(zoomAt([z], 0)).toEqual(FULL_RECT);
    expect(zoomAt([z], 7)).toEqual(FULL_RECT);
  });
  it("holds the rect in the middle and eases at both ends", () => {
    expect(zoomAt([z], 4)).toEqual(z.rect);
    const enter = zoomAt([z], 2.2);
    expect(enter.w).toBeGreaterThan(0.5);
    expect(enter.w).toBeLessThan(1);
    const exit = zoomAt([z], 5.8);
    expect(exit.w).toBeGreaterThan(0.5);
    expect(exit.w).toBeLessThan(1);
  });
  it("respects a custom ramp and a zero ramp", () => {
    expect(zoomAt([{ ...z, ramp: 0 }], 2.01)).toEqual(z.rect);
    expect(zoomAt([{ ...z, ramp: 1 }], 2.5).w).toBeGreaterThan(zoomAt([z], 2.5).w);
  });
  it("is half-open: active at start, not active at end", () => {
    const zr = { ...z, ramp: 0 };
    expect(zoomAt([zr], zr.start)).toEqual(zr.rect);
    expect(zoomAt([zr], zr.end)).toEqual(FULL_RECT);
  });
  it("resolves touching zooms to the later one at the shared frame", () => {
    const a = { start: 0, end: 2, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ramp: 0 };
    const b = { start: 2, end: 4, rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, ramp: 0 };
    expect(zoomAt([a, b], 2)).toEqual(b.rect);
  });
  it("clamps a ramp wider than span/3 and still holds the rect at the midpoint", () => {
    const wide = { start: 0, end: 3, rect: z.rect, ramp: 10 };
    expect(zoomAt([wide], 1.5)).toEqual(wide.rect);
  });
});

describe("zoomAt chaining", () => {
  /** Two touching zooms, each with a 0.4 s ramp. */
  const a: Zoom = { start: 0, end: 3, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ramp: 0.4 };
  const b: Zoom = { start: 3, end: 6, rect: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, ramp: 0.4 };

  it("never passes through the full frame between touching zooms", () => {
    for (let t = 2.2; t <= 3.8; t += 0.05) {
      const r = zoomAt([a, b], t);
      expect(r).not.toEqual(FULL_RECT);
      // The chained ease stays between the two rects — it never widens out.
      expect(r.w).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(r.w).toBeGreaterThanOrEqual(0.4 - 1e-9);
    }
  });

  it("is the midpoint rect at the boundary between touching zooms", () => {
    const mid = zoomAt([a, b], 3);
    expect(mid.x).toBeCloseTo(0.25, 9);
    expect(mid.y).toBeCloseTo(0.25, 9);
    expect(mid.w).toBeCloseTo(0.45, 9);
    expect(mid.h).toBeCloseTo(0.45, 9);
  });

  it("is continuous across the chained window", () => {
    const before = zoomAt([a, b], 3 - 1e-6);
    const after = zoomAt([a, b], 3 + 1e-6);
    expect(before.x).toBeCloseTo(0.25, 4);
    expect(after.x).toBeCloseTo(0.25, 4);
    // The window closes back onto each zoom's own held rect.
    expect(zoomAt([a, b], 2.5)).toEqual(a.rect);
    expect(zoomAt([a, b], 3.5)).toEqual(b.rect);
  });

  it("eases across a short gap instead of returning to the full frame", () => {
    const c: Zoom = { ...b, start: 3.3, end: 6 };
    const mid = zoomAt([a, c], 3.15);
    expect(mid.x).toBeCloseTo(0.25, 6);
    expect(mid.w).toBeCloseTo(0.45, 6);
    expect(zoomAt([a, c], 3.05).w).toBeLessThan(0.5);
    expect(zoomAt([a, c], 3.05).w).toBeGreaterThan(0.45);
    // Inside either zoom the ease-in/out to the full frame is suppressed.
    expect(zoomAt([a, c], 2.9)).toEqual(a.rect);
    expect(zoomAt([a, c], 3.35)).toEqual(c.rect);
  });

  it("still eases out to the full frame across a gap wider than the ramps", () => {
    const far: Zoom = { ...b, start: 5, end: 8 };
    expect(zoomAt([a, far], 4)).toEqual(FULL_RECT);
    expect(zoomAt([a, far], 2.9).w).toBeGreaterThan(0.5);
  });

  it("hard-cuts touching zooms when either ramp is zero", () => {
    const cut: Zoom = { ...b, ramp: 0 };
    expect(zoomAt([a, cut], 2.9)).toEqual(a.rect);
    expect(zoomAt([a, cut], 3)).toEqual(cut.rect);
  });
});

describe("fitView", () => {
  const content = { x: 10, y: 20, w: 800, h: 450 };

  it("fills the content box when the view keeps the source aspect", () => {
    expect(fitView(FULL_RECT, 1600, 900, content)).toEqual(content);
    expect(fitView({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1600, 900, content)).toEqual(content);
  });

  it("pillarboxes a view that is taller than the content box", () => {
    // 0.5 × 1600 : 1 × 900 = 800 : 900, fitted into 800 × 450 → 400 × 450.
    const d = fitView({ x: 0, y: 0, w: 0.5, h: 1 }, 1600, 900, content);
    expect(d.w).toBeCloseTo(400);
    expect(d.h).toBeCloseTo(450);
    expect(d.x).toBeCloseTo(210);
    expect(d.y).toBeCloseTo(20);
  });

  it("letterboxes a view that is wider than the content box", () => {
    // 1 × 1600 : 0.5 × 900 = 1600 : 450, fitted into 800 × 450 → 800 × 225.
    const d = fitView({ x: 0, y: 0, w: 1, h: 0.5 }, 1600, 900, content);
    expect(d.w).toBeCloseTo(800);
    expect(d.h).toBeCloseTo(225);
    expect(d.x).toBeCloseTo(10);
    expect(d.y).toBeCloseTo(132.5);
  });

  it("is scale-free in the source dimensions — only their ratio matters", () => {
    const byContent = fitView({ x: 0, y: 0, w: 0.5, h: 1 }, content.w, content.h, content);
    const bySource = fitView({ x: 0, y: 0, w: 0.5, h: 1 }, 1600, 900, content);
    expect(byContent).toEqual(bySource);
  });

  it("falls back to the content box for a degenerate view or box", () => {
    expect(fitView({ x: 0, y: 0, w: 0, h: 1 }, 1600, 900, content)).toEqual(content);
    expect(fitView(FULL_RECT, 0, 0, content)).toEqual(content);
    expect(fitView(FULL_RECT, 1600, 900, { x: 0, y: 0, w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("insertZoom", () => {
  it("keeps zooms sorted and trims the one it lands on", () => {
    const out = insertZoom([z], { start: 5, end: 8, rect: z.rect });
    expect(out).toEqual([{ ...z, end: 5 }, { start: 5, end: 8, rect: z.rect }]);
  });
  it("drops a zoom it fully covers", () => {
    const out = insertZoom([z], { start: 1, end: 9, rect: z.rect });
    expect(out).toHaveLength(1);
    expect(out[0].start).toBe(1);
  });
  it("keeps the newly inserted zoom under the cap, dropping the oldest others", () => {
    const full: Zoom[] = Array.from({ length: MAX_ZOOMS }, (_, i) => ({
      start: i * 10,
      end: i * 10 + 1,
      rect: FULL_RECT,
    }));
    const inserted: Zoom = { start: MAX_ZOOMS * 10 + 100, end: MAX_ZOOMS * 10 + 101, rect: z.rect };
    const out = insertZoom(full, inserted);
    expect(out).toHaveLength(MAX_ZOOMS);
    expect(out).toContainEqual(inserted);
    expect(out.some((zz) => zz.start === 0)).toBe(false);
    expect(out.some((zz) => zz.start === (MAX_ZOOMS - 1) * 10)).toBe(true);
  });
});

describe("toOutput", () => {
  it("maps a source rect through the zoom", () => {
    const view = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    expect(toOutput({ x: 0.75, y: 0.75, w: 0.125, h: 0.125 }, view)).toEqual({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
    expect(toOutput({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, FULL_RECT)).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  });
});
