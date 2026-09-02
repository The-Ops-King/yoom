import { describe, expect, it } from "vitest";
import { frameIntervalMs, isStalled, tickStall, type StallWatch } from "./export";

describe("frameIntervalMs", () => {
  it("turns a capture rate into a timer period", () => {
    expect(frameIntervalMs(30)).toBeCloseTo(1000 / 30);
    expect(frameIntervalMs(60)).toBeCloseTo(1000 / 60);
  });

  it("falls back to 30 fps for nonsense", () => {
    expect(frameIntervalMs(0)).toBeCloseTo(1000 / 30);
    expect(frameIntervalMs(-5)).toBeCloseTo(1000 / 30);
    expect(frameIntervalMs(Number.NaN)).toBeCloseTo(1000 / 30);
    expect(frameIntervalMs(Number.POSITIVE_INFINITY)).toBeCloseTo(1000 / 30);
  });

  it("clamps absurd rates rather than busy-looping", () => {
    expect(frameIntervalMs(10_000)).toBeCloseTo(1000 / 120);
  });

  it("never returns an interval so long the export drops below 1 fps", () => {
    expect(frameIntervalMs(0.01)).toBeLessThanOrEqual(1000);
  });
});

describe("tickStall / isStalled", () => {
  const start: StallWatch = { time: 0, at: 1000 };

  it("keeps the mark while the playhead is frozen", () => {
    const next = tickStall(start, 0, 2000);
    expect(next).toEqual(start);
  });

  it("moves the mark when the playhead advances", () => {
    const next = tickStall(start, 0.033, 2000);
    expect(next).toEqual({ time: 0.033, at: 2000 });
  });

  it("counts a backwards seek as progress", () => {
    const next = tickStall({ time: 5, at: 1000 }, 1.5, 2000);
    expect(next).toEqual({ time: 1.5, at: 2000 });
  });

  it("ignores float noise below the epsilon", () => {
    expect(tickStall(start, 1e-9, 2000)).toEqual(start);
  });

  it("trips only after the limit has fully elapsed", () => {
    // `start.at` is 1000, so the limit is reached at 5000.
    expect(isStalled(start, 4999, 4000)).toBe(false);
    expect(isStalled(start, 5000, 4000)).toBe(true);
    expect(isStalled(start, 9000, 4000)).toBe(true);
  });

  /**
   * The regression the watchdog exists for: a loop whose callbacks keep firing
   * on a dead video must still be declared stalled. The old watchdog was rearmed
   * by the callback itself, so a ticking-but-frozen render never tripped it.
   */
  it("trips on a frozen playhead even though every tick is delivered", () => {
    let watch: StallWatch = { time: 2, at: 0 };
    let tripped = false;
    for (let now = 0; now <= 6000; now += 1000 / 30) {
      watch = tickStall(watch, 2, now);
      if (isStalled(watch, now, 4000)) {
        tripped = true;
        break;
      }
    }
    expect(tripped).toBe(true);
  });

  it("never trips while the playhead keeps moving", () => {
    let watch: StallWatch = { time: 0, at: 0 };
    for (let i = 1; i <= 600; i++) {
      const now = i * (1000 / 30);
      watch = tickStall(watch, i / 30, now);
      expect(isStalled(watch, now, 4000)).toBe(false);
    }
  });
});
