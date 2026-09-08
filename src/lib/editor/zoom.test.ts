import { describe, expect, it } from "vitest";
import { MAX_ZOOMS, type Zoom } from "@/lib/edits";
import { effectiveRect, FULL_RECT, fitView, insertZoom, toOutput, zoomAt } from "./zoom";

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

describe("follow zooms", () => {
  /** A follow zoom: a 0.4 × 0.4 window whose stored position is ignored. */
  const f: Zoom = { start: 0, end: 10, rect: { x: 0, y: 0, w: 0.4, h: 0.4 }, ramp: 0, kind: "follow" };
  /** The cursor at the middle of the frame, then hard against the top-left. */
  const at = (t: number) => (t < 5 ? { x: 0.5, y: 0.5 } : { x: 0, y: 0 });

  it("centres the window on the cursor", () => {
    expect(zoomAt([f], 1, at)).toEqual({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
  });

  it("clamps the window inside the frame", () => {
    expect(zoomAt([f], 6, at)).toEqual({ x: 0, y: 0, w: 0.4, h: 0.4 });
    expect(zoomAt([f], 6, () => ({ x: 1, y: 1 }))).toEqual({ x: 0.6, y: 0.6, w: 0.4, h: 0.4 });
  });

  it("keeps the stored rect without a sampler, or before the track starts", () => {
    expect(zoomAt([f], 1)).toEqual(f.rect);
    expect(zoomAt([f], 1, () => null)).toEqual(f.rect);
  });

  it("leaves a non-follow zoom alone even with a sampler", () => {
    expect(zoomAt([z], 4, at)).toEqual(z.rect);
  });

  it("ramps from the full frame to the followed rect", () => {
    const ramped: Zoom = { ...f, ramp: 0.4 };
    const enter = zoomAt([ramped], 0.2, at);
    expect(enter.w).toBeGreaterThan(0.4);
    expect(enter.w).toBeLessThan(1);
    // Halfway between the full frame's centre and the cursor-centred window.
    expect(enter.x).toBeCloseTo((1 - enter.w) / 2, 9);
    expect(zoomAt([ramped], 1, at)).toEqual({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
  });

  it("chains between two zooms using their effective rects", () => {
    const a: Zoom = { start: 0, end: 3, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ramp: 0.4 };
    const b: Zoom = { start: 3, end: 6, rect: { x: 0, y: 0, w: 0.4, h: 0.4 }, ramp: 0.4, kind: "follow" };
    // b follows to (0.3, 0.3); the shared frame is the midpoint of the two.
    const mid = zoomAt([a, b], 3, () => ({ x: 0.5, y: 0.5 }));
    expect(mid.x).toBeCloseTo(0.15, 9);
    expect(mid.w).toBeCloseTo(0.45, 9);
  });

  it("insertZoom keeps `kind` when it trims a zoom", () => {
    const out = insertZoom([{ ...f, end: 4 }], { start: 2, end: 8, rect: z.rect });
    expect(out[0]).toEqual({ ...f, end: 2 });
  });

  it("effectiveRect is the identity for a rect zoom and the window for a follow zoom", () => {
    expect(effectiveRect(z, 4, at)).toBe(z.rect);
    expect(effectiveRect(f, 1, at)).toEqual({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
  });
});

describe("follow zoom deadzone", () => {
  /** A 0.4 × 0.4 follow window over a 20 s zoom. */
  const f: Zoom = { start: 0, end: 20, rect: { x: 0, y: 0, w: 0.4, h: 0.4 }, ramp: 0, kind: "follow" };

  it("leaves the window unchanged while the cursor circles inside the deadzone", () => {
    // Starts centred at (0.5, 0.5) -> window (0.3, 0.3). A small circle of
    // radius 0.05 stays well within the deadzone (half-extent 0.13 on a 0.4
    // window at the 65% fraction), so the window must never move from its
    // opening position.
    const at = (t: number) => ({ x: 0.5 + 0.05 * Math.cos(t), y: 0.5 + 0.05 * Math.sin(t) });
    const opening = effectiveRect(f, 0, at);
    // The opening cursor position (t=0, so cos=1, sin=0) is (0.55, 0.5).
    expect(opening.x).toBeCloseTo(0.35, 9);
    expect(opening.y).toBeCloseTo(0.3, 9);
    for (let t = 0; t <= 20; t += 0.37) {
      expect(effectiveRect(f, t, at)).toEqual(opening);
    }
  });

  it("moves only enough to bring the cursor back to the deadzone edge, and eases rather than snaps", () => {
    // Cursor holds at the centre until t=1, then jumps hard along X only, to
    // (0.9, 0.5) — off-centre enough to cross the deadzone but nowhere near
    // a frame edge, so clamping cannot muddy what the deadzone math did.
    const at = (t: number) => (t < 1 ? { x: 0.5, y: 0.5 } : { x: 0.9, y: 0.5 });
    const before = effectiveRect(f, 0.5, at);
    expect(before).toEqual({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });

    // Deadzone half-extent is 0.65 * 0.4 / 2 = 0.13. The cursor's new X is
    // 0.9 - 0.5 = 0.4 past the window's old centre, 0.27 beyond the deadzone
    // edge, so the centre moves by exactly that much: 0.5 + 0.27 = 0.77,
    // i.e. a top-left of 0.77 - 0.2 = 0.57 — short of 0.7, which is where a
    // window fully centred on the cursor would have landed. Y never left the
    // deadzone (dy=0), so it must not have moved at all.
    const settled = effectiveRect(f, 3, at);
    expect(settled.x).toBeCloseTo(0.57, 9);
    expect(settled.y).toBeCloseTo(0.3, 9);
    expect(settled.x).toBeLessThan(0.7);

    // Mid-ease it must be a deliberate move: strictly between the old and
    // new X, not an instant jump to either one.
    const mid = effectiveRect(f, 1.15, at);
    expect(mid.x).toBeGreaterThan(before.x);
    expect(mid.x).toBeLessThan(settled.x);
    expect(mid.y).toBeCloseTo(0.3, 9);
  });

  it("is order-independent: scrubbing gives the same result as playing in order", () => {
    // A cursor path with several deadzone crossings, so the track has
    // multiple, possibly-interrupted moves to get wrong.
    const at = (t: number) => ({
      x: 0.5 + 0.4 * Math.sin(t * 1.3),
      y: 0.5 + 0.4 * Math.cos(t * 0.7),
    });
    const g: Zoom = { start: 0, end: 8, rect: { x: 0, y: 0, w: 0.3, h: 0.3 }, ramp: 0, kind: "follow" };

    const ts: number[] = [];
    for (let t = 0; t <= 8; t += 0.13) ts.push(t);

    const inOrder = ts.map((t) => effectiveRect(g, t, at));

    // Same t's, deliberately shuffled (reverse, then interleave).
    const shuffled = [...ts].reverse();
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) [shuffled[i], shuffled[i + 1]] = [shuffled[i + 1], shuffled[i]];
    }
    const scrambledResults = new Map<number, ReturnType<typeof effectiveRect>>();
    for (const t of shuffled) scrambledResults.set(t, effectiveRect(g, t, at));

    ts.forEach((t, i) => {
      expect(scrambledResults.get(t)).toEqual(inOrder[i]);
    });
  });

  it("falls back to the stored rect with no cursor track, or before the track starts", () => {
    expect(effectiveRect(f, 5)).toBe(f.rect);
    expect(effectiveRect(f, 5, () => null)).toBe(f.rect);

    // Track starts partway through the zoom. Query well clear of the exact
    // t=4 boundary in either direction so the assertion doesn't depend on
    // which side of 4 the internal deadzone-walk's fixed-step grid lands on.
    const at = (t: number) => (t < 4 ? null : { x: 0.9, y: 0.1 });
    expect(effectiveRect(f, 2, at)).toBe(f.rect);
    expect(effectiveRect(f, 5, at)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 });
  });

  it("never leaves the window outside [0, 1] with the cursor pinned to a frame corner", () => {
    // Starts centred, then the cursor jumps hard to the (0,0) corner —
    // exercises the clamp while the window is actually moving there, not
    // just its already-settled resting state.
    const at = (t: number) => (t < 1 ? { x: 0.5, y: 0.5 } : { x: 0, y: 0 });
    for (let t = 0; t <= 20; t += 0.5) {
      const r = effectiveRect(f, t, at);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    }
    // And it should have actually walked all the way to the corner.
    expect(effectiveRect(f, 20, at)).toEqual({ x: 0, y: 0, w: 0.4, h: 0.4 });
  });

  it("still holds the window during the zoom while easing to/from the full frame at its edges (ramp unaffected)", () => {
    const ramped: Zoom = { ...f, ramp: 0.4 };
    const at = () => ({ x: 0.5, y: 0.5 });
    const mid = zoomAt([ramped], 10, at);
    expect(mid).toEqual({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
    const entering = zoomAt([ramped], 0.2, at);
    expect(entering.w).toBeGreaterThan(0.4);
    expect(entering.w).toBeLessThan(1);
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
