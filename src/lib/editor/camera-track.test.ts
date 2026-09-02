import { describe, expect, it } from "vitest";
import { cameraAt, defaultCameraTrack, removeKeyframe, upsertKeyframe, CAMERA_ANIM_S } from "./camera-track";

const track = defaultCameraTrack("circle", "medium", 16 / 9);

describe("defaultCameraTrack", () => {
  it("has one keyframe at t=0 in the bottom-right, square in pixels", () => {
    const k = track.keyframes[0];
    expect(k.t).toBe(0);
    expect(k.mode).toBe("bubble");
    expect(k.rect.w).toBeCloseTo(0.22);
    // circle: h_norm = w_norm * screenAspect so the pixel box is square
    expect(k.rect.h).toBeCloseTo(0.22 * (16 / 9));
    expect(k.rect.x + k.rect.w).toBeLessThanOrEqual(1);
    expect(k.rect.y + k.rect.h).toBeLessThanOrEqual(1);
  });
});

describe("cameraAt", () => {
  const two = upsertKeyframe(track, 5, { mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } });
  it("returns the first keyframe before any change", () => {
    const s = cameraAt(two, 2);
    expect(s.mode).toBe("bubble");
    expect(s.fade).toBe(0);
  });
  it("cross-fades during the animation window after a keyframe", () => {
    const s = cameraAt(two, 5 + CAMERA_ANIM_S / 2);
    expect(s.fromMode).toBe("bubble");
    expect(s.mode).toBe("full");
    expect(s.fade).toBeGreaterThan(0);
    expect(s.fade).toBeLessThan(1);
  });
  it("settles after the window", () => {
    const s = cameraAt(two, 6);
    expect(s.mode).toBe("full");
    expect(s.fade).toBe(1);
    expect(s.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it("interpolates rect between bubble keyframes", () => {
    const moved = upsertKeyframe(track, 3, { rect: { x: 0.1, y: 0.1, w: 0.22, h: 0.22 * (16 / 9) } });
    const s = cameraAt(moved, 3 + CAMERA_ANIM_S / 2);
    expect(s.rect.x).toBeGreaterThan(0.1);
    expect(s.rect.x).toBeLessThan(track.keyframes[0].rect.x);
  });
});

describe("upsertKeyframe / removeKeyframe", () => {
  it("replaces a keyframe within tolerance instead of adding", () => {
    const a = upsertKeyframe(track, 2, { mode: "full" });
    const b = upsertKeyframe(a, 2.01, { mode: "bubble" });
    expect(b.keyframes).toHaveLength(2);
    expect(b.keyframes[1].mode).toBe("bubble");
  });
  it("inherits rect/mode from the previous keyframe", () => {
    const a = upsertKeyframe(track, 2, { mode: "full" });
    expect(a.keyframes[1].rect).toEqual(track.keyframes[0].rect);
  });
  it("never removes t=0", () => {
    expect(removeKeyframe(track, 0).keyframes).toHaveLength(1);
    const a = upsertKeyframe(track, 2, { mode: "full" });
    expect(removeKeyframe(a, 2).keyframes).toHaveLength(1);
  });
});
