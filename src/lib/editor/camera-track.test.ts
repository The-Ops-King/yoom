import { describe, expect, it } from "vitest";
import { MAX_KEYFRAMES } from "@/lib/edits";
import type { CameraTrack } from "@/lib/edits";
import type { CameraSample } from "./camera-track";
import {
  bubbleHeightFor,
  cameraAt,
  defaultCameraTrack,
  removeKeyframe,
  upsertKeyframe,
  CAMERA_ANIM_S,
} from "./camera-track";

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

  it("returns a fixed full-mode keyframe for shape 'full'", () => {
    const full = defaultCameraTrack("full", "medium", 16 / 9);
    expect(full.shape).toBe("circle");
    expect(full.keyframes).toEqual([{ t: 0, mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } }]);
  });

  it("falls back to 16:9 when screenAspect is NaN or 0", () => {
    const withDefault = defaultCameraTrack("circle", "medium", 16 / 9);
    expect(defaultCameraTrack("circle", "medium", NaN).keyframes[0].rect).toEqual(withDefault.keyframes[0].rect);
    expect(defaultCameraTrack("circle", "medium", 0).keyframes[0].rect).toEqual(withDefault.keyframes[0].rect);
  });
});

describe("bubbleHeightFor", () => {
  it("falls back to 16:9 for non-finite or zero screenAspect", () => {
    const expected = bubbleHeightFor("circle", 0.22, 16 / 9);
    expect(bubbleHeightFor("circle", 0.22, NaN)).toBeCloseTo(expected);
    expect(bubbleHeightFor("circle", 0.22, 0)).toBeCloseTo(expected);
    expect(bubbleHeightFor("circle", 0.22, -1)).toBeCloseTo(expected);
  });
});

describe("cameraAt", () => {
  const two = upsertKeyframe(track, 5, { mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } });
  it("returns the first keyframe before any change", () => {
    const s = cameraAt(two, 2);
    expect(s.mode).toBe("bubble");
    expect(s.fade).toBe(1);
    expect(s.fromMode).toBeUndefined();
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

  it("does not pop when a keyframe re-targets before the prior animation settles", () => {
    // keyframe1 at t=5 (far from t=0, fully settles by the time it matters);
    // keyframe2 at t=5.1, well inside keyframe1's own 0.3s animation window.
    const withB = upsertKeyframe(track, 5, {
      mode: "bubble",
      rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    });
    const withC = upsertKeyframe(withB, 5.1, {
      mode: "bubble",
      rect: { x: 0.05, y: 0.05, w: 0.2, h: 0.2 },
    });
    const before = cameraAt(withC, 5.099);
    const after = cameraAt(withC, 5.101);
    expect(Math.abs(after.rect.x - before.rect.x)).toBeLessThan(0.02);
  });

  it("does not pop the mode cross-fade weight when it reverses before settling", () => {
    // bubble@0 -> full@5 -> bubble@5.1: the second keyframe reverses the
    // mode change back before the first cross-fade (into "full") settles.
    const toFull = upsertKeyframe(track, 5, { mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } });
    const backToBubble = upsertKeyframe(toFull, 5.1, { mode: "bubble", rect: track.keyframes[0].rect });

    const fullWeight = (s: CameraSample): number => {
      if (s.fromMode === undefined) return s.mode === "full" ? 1 : 0;
      return s.mode === "full" ? s.fade : 1 - s.fade;
    };

    const before = fullWeight(cameraAt(backToBubble, 5.099));
    const after = fullWeight(cameraAt(backToBubble, 5.101));
    expect(Math.abs(after - before)).toBeLessThan(0.02);
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
  it("upserting within tolerance of t=0 patches index 0 and keeps t=0", () => {
    const a = upsertKeyframe(track, 0.02, { mode: "full" });
    expect(a.keyframes).toHaveLength(1);
    expect(a.keyframes[0].t).toBe(0);
    expect(a.keyframes[0].mode).toBe("full");
  });
  it("returns the track unchanged when inserting past MAX_KEYFRAMES", () => {
    const many: CameraTrack = {
      ...track,
      keyframes: Array.from({ length: MAX_KEYFRAMES }, (_, i) => ({
        t: i,
        mode: "bubble" as const,
        rect: track.keyframes[0].rect,
      })),
    };
    const result = upsertKeyframe(many, 1000, { mode: "full" });
    expect(result).toBe(many);
  });
});
