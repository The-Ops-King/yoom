import { describe, expect, it } from "vitest";
import { FULL_RECT, insertZoom, toOutput, zoomAt } from "./zoom";

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
});

describe("toOutput", () => {
  it("maps a source rect through the zoom", () => {
    const view = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    expect(toOutput({ x: 0.75, y: 0.75, w: 0.125, h: 0.125 }, view)).toEqual({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
    expect(toOutput({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, FULL_RECT)).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  });
});
