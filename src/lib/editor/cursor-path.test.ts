import { describe, expect, it } from "vitest";
import type { CursorSample } from "@/lib/recording/types";
import { CURSOR_TAU_S, createCursorSampler, smoothCursor } from "./cursor-path";

/** A track sampled at `hz` between `t0` and `t1`, positioned by `at`. */
function track(t0: number, t1: number, hz: number, at: (t: number) => { x: number; y: number }): CursorSample[] {
  const out: CursorSample[] = [];
  // Index arithmetic, not accumulation: a step at t = 1 must land on a sample
  // whose `t` is exactly 1, or the test measures the filter plus a rounding lag.
  for (let i = 0; t0 + i / hz <= t1 + 1e-9; i++) {
    const t = t0 + i / hz;
    out.push({ t, ...at(t) });
  }
  return out;
}

describe("smoothCursor", () => {
  it("has nothing to say without samples", () => {
    expect(smoothCursor([], 1)).toBeNull();
  });

  it("is null before the first sample and defined from it on", () => {
    const s: CursorSample[] = [{ t: 1, x: 0.4, y: 0.6 }];
    expect(smoothCursor(s, 0.999)).toBeNull();
    expect(smoothCursor(s, 1)).toEqual({ x: 0.4, y: 0.6 });
  });

  it("returns the point itself for a constant path", () => {
    const s = track(0, 3, 30, () => ({ x: 0.4, y: 0.6 }));
    for (const t of [0, 0.5, 1.7, 3, 5]) {
      const p = smoothCursor(s, t);
      expect(p?.x).toBeCloseTo(0.4, 9);
      expect(p?.y).toBeCloseTo(0.6, 9);
    }
  });

  it("converges 63 % of the way through a step after one time constant", () => {
    const tau = 0.25;
    // 0 until t = 1, then 1: the step lands exactly on a sample.
    const s = track(0, 4, 30, (t) => ({ x: t >= 1 ? 1 : 0, y: 0 }));
    expect(smoothCursor(s, 1, tau)?.x).toBeCloseTo(0, 6);
    expect(smoothCursor(s, 1 + tau, tau)?.x).toBeCloseTo(1 - Math.exp(-1), 2);
    expect(smoothCursor(s, 1 + 2 * tau, tau)?.x).toBeCloseTo(1 - Math.exp(-2), 2);
    // It keeps closing on the target rather than overshooting it.
    expect(smoothCursor(s, 4, tau)?.x).toBeCloseTo(1, 4);
  });

  it("lags a moving cursor rather than tracking it exactly", () => {
    const s = track(0, 4, 30, (t) => ({ x: Math.min(1, t / 4), y: 0.5 }));
    const p = smoothCursor(s, 2);
    expect(p).not.toBeNull();
    expect(p!.x).toBeLessThan(0.5);
    expect(p!.x).toBeGreaterThan(0.3);
  });

  it("clamps to the frame — samples may leave the captured display", () => {
    const s = track(0, 2, 30, () => ({ x: -0.1, y: 1.1 }));
    expect(smoothCursor(s, 2)).toEqual({ x: 0, y: 1 });
  });

  it("holds the last sample after the track ends", () => {
    const s: CursorSample[] = [{ t: 0, x: 0, y: 0 }, { t: 1, x: 1, y: 1 }];
    const p = smoothCursor(s, 100);
    expect(p?.x).toBeCloseTo(1, 6);
    expect(p?.y).toBeCloseTo(1, 6);
  });

  it("is unaffected by a zero time constant (no smoothing at all)", () => {
    const s = track(0, 2, 30, (t) => ({ x: t >= 1 ? 1 : 0, y: 0 }));
    expect(smoothCursor(s, 1, 0)?.x).toBe(1);
    expect(smoothCursor(s, 0.9, 0)?.x).toBe(0);
  });
});

describe("createCursorSampler", () => {
  const s = track(0, 5, 30, (t) => ({ x: t / 5, y: 1 - t / 5 }));

  it("agrees with the one-shot form at every time", () => {
    const at = createCursorSampler(s);
    for (let t = -1; t < 6; t += 0.137) expect(at(t)).toEqual(smoothCursor(s, t));
  });

  it("survives an empty track", () => {
    expect(createCursorSampler([])(0)).toBeNull();
  });

  it("is cheap per call once built", () => {
    // A long track sampled many times must not walk the array each time; a
    // linear scan here would be ~10^8 steps.
    const long = track(0, 600, 60, (t) => ({ x: (t % 1) / 1, y: 0.5 }));
    const at = createCursorSampler(long);
    const t0 = performance.now();
    for (let i = 0; i < 20_000; i++) at((i / 20_000) * 600);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("takes tau as a bare number or as an option object", () => {
    expect(createCursorSampler(s, { tau: CURSOR_TAU_S })(2)).toEqual(
      createCursorSampler(s, CURSOR_TAU_S)(2),
    );
    expect(createCursorSampler(s, {})(2)).toEqual(createCursorSampler(s)(2));
  });

  it("keeps two taus over one track apart", () => {
    // A step the lazy filter is still climbing: the quicker one must be
    // further along, and neither may be evicted by building the other.
    const step = track(0, 2, 30, (t) => ({ x: t < 1 ? 0 : 1, y: 0.5 }));
    const lazy = createCursorSampler(step);
    const quick = createCursorSampler(step, { tau: CURSOR_TAU_S });
    expect(quick(1.15)!.x).toBeGreaterThan(lazy(1.15)!.x);
    // Re-reading the first sampler must still give the lazy answer.
    expect(lazy(1.15)).toEqual(createCursorSampler(step)(1.15));
  });
});
