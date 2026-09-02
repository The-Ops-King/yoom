import { describe, expect, it } from "vitest";
import { shouldDraw } from "./use-staging-player";

describe("shouldDraw", () => {
  /**
   * The bug this guards: with `requestVideoFrameCallback` present the loop drew
   * only when something had marked the canvas dirty, and rVFC was the only
   * thing that marked it dirty during playback. The decoders are detached
   * `<video>` elements, which Chromium never composites, so rVFC ran at the
   * ~4 Hz background-rendering rate and zoom ramps did not animate. Playback
   * alone must be enough to draw, whatever the platform offers.
   */
  it("draws every frame while playing, even with a clean canvas", () => {
    expect(shouldDraw(true, false)).toBe(true);
  });

  it("draws while playing when also dirty", () => {
    expect(shouldDraw(true, true)).toBe(true);
  });

  it("draws while paused when something marked the canvas dirty", () => {
    expect(shouldDraw(false, true)).toBe(true);
  });

  it("skips the draw only when paused and clean", () => {
    expect(shouldDraw(false, false)).toBe(false);
  });
});
