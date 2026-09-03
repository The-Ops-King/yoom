import { describe, expect, it } from "vitest";
import { Clock, displayIdFromSourceId, normalize } from "./cursor-track";

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
// A second display placed to the right of the primary one, as macOS reports it.
const secondary = { x: 1920, y: -200, width: 1280, height: 800 };

describe("normalize", () => {
  it("maps a point into 0..1 of the display", () => {
    expect(normalize({ x: 960, y: 540 }, primary)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalize({ x: 0, y: 0 }, primary)).toEqual({ x: 0, y: 0 });
    expect(normalize({ x: 1920, y: 1080 }, primary)).toEqual({ x: 1, y: 1 });
  });

  it("subtracts the display's origin, so a second monitor normalizes too", () => {
    expect(normalize({ x: 2560, y: 200 }, secondary)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps to ±0.1 of overshoot when the cursor leaves the display", () => {
    // Far off to the left / above, and far off to the right / below.
    expect(normalize({ x: -5000, y: -5000 }, primary)).toEqual({ x: -0.1, y: -0.1 });
    expect(normalize({ x: 9000, y: 9000 }, primary)).toEqual({ x: 1.1, y: 1.1 });
  });

  it("keeps a small excursion instead of pinning it to the edge", () => {
    // 96 px left of a 1920-wide display is −0.05, inside the overshoot band.
    expect(normalize({ x: -96, y: 540 }, primary)).toEqual({ x: -0.05, y: 0.5 });
  });

  it("falls back to the centre for a degenerate display or a NaN point", () => {
    expect(normalize({ x: 10, y: 10 }, { x: 0, y: 0, width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(normalize({ x: NaN, y: 540 }, primary)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("displayIdFromSourceId", () => {
  it("reads the display id out of a screen source id", () => {
    expect(displayIdFromSourceId("screen:69733382:0")).toBe(69733382);
    expect(displayIdFromSourceId("screen:0:0")).toBe(0);
  });

  it("returns null for window sources and for junk", () => {
    expect(displayIdFromSourceId("window:12345:0")).toBeNull();
    expect(displayIdFromSourceId("screen:abc:0")).toBeNull();
    expect(displayIdFromSourceId("")).toBeNull();
    expect(displayIdFromSourceId("screen:")).toBeNull();
  });
});

describe("Clock", () => {
  it("is not running before start", () => {
    const clock = new Clock();
    expect(clock.isRunning).toBe(false);
    expect(clock.elapsed(1000)).toBe(0);
  });

  it("counts wall time while running", () => {
    const clock = new Clock();
    clock.start(1000);
    expect(clock.elapsed(1000)).toBe(0);
    expect(clock.elapsed(1500)).toBe(500);
  });

  it("freezes t while paused and keeps it frozen across the pause", () => {
    const clock = new Clock();
    clock.start(0);
    clock.pause(1000);
    expect(clock.isPaused).toBe(true);
    // Time passes; recorded material does not.
    expect(clock.elapsed(1500)).toBe(1000);
    expect(clock.elapsed(9000)).toBe(1000);
  });

  it("resumes from where it froze, so t stays aligned with the media", () => {
    const clock = new Clock();
    clock.start(0);
    clock.pause(1000);
    clock.resume(5000); // 4 s of pause
    expect(clock.isPaused).toBe(false);
    expect(clock.elapsed(5000)).toBe(1000);
    expect(clock.elapsed(6000)).toBe(2000);
  });

  it("accumulates across several pauses", () => {
    const clock = new Clock();
    clock.start(0);
    clock.pause(1000);
    clock.resume(2000);
    clock.pause(3000); // 1000 ms of material so far, +1000 since resume = 2000
    clock.resume(10_000);
    expect(clock.elapsed(10_000)).toBe(2000);
    expect(clock.elapsed(10_500)).toBe(2500);
  });

  it("ignores a redundant pause and a resume with no pause", () => {
    const clock = new Clock();
    clock.start(0);
    clock.pause(1000);
    clock.pause(2000); // no-op: already paused, must not move the origin
    clock.resume(3000);
    clock.resume(4000); // no-op
    expect(clock.elapsed(4000)).toBe(2000);
  });

  it("resets t to zero on restart", () => {
    const clock = new Clock();
    clock.start(0);
    clock.pause(1000);
    clock.resume(2000);
    clock.start(50_000);
    expect(clock.elapsed(50_000)).toBe(0);
    expect(clock.elapsed(50_250)).toBe(250);
  });

  it("stops", () => {
    const clock = new Clock();
    clock.start(0);
    clock.stop();
    expect(clock.isRunning).toBe(false);
    expect(clock.isPaused).toBe(false);
    expect(clock.elapsed(1000)).toBe(0);
  });

  it("never reports negative time if the clock jumps backwards", () => {
    const clock = new Clock();
    clock.start(1000);
    expect(clock.elapsed(500)).toBe(0);
  });
});
