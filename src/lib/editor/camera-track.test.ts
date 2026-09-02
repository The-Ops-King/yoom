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

  it("returns the first keyframe before the next transition begins", () => {
    const s = cameraAt(two, 5 - CAMERA_ANIM_S - 0.01);
    expect(s.mode).toBe("bubble");
    expect(s.fade).toBe(1);
    expect(s.fromMode).toBeUndefined();
    expect(s.rect).toEqual(track.keyframes[0].rect);
  });

  it("is settled in the keyframe's own state exactly at its t", () => {
    const s = cameraAt(two, 5);
    expect(s.mode).toBe("full");
    expect(s.fade).toBe(1);
    expect(s.fromMode).toBeUndefined();
    expect(s.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("cross-fades in the window BEFORE the keyframe, finishing at its t", () => {
    const s = cameraAt(two, 5 - CAMERA_ANIM_S / 2);
    expect(s.fromMode).toBe("bubble");
    expect(s.mode).toBe("full");
    expect(s.fade).toBeGreaterThan(0);
    expect(s.fade).toBeLessThan(1);
  });

  it("stays settled after the keyframe", () => {
    const s = cameraAt(two, 6);
    expect(s.mode).toBe("full");
    expect(s.fade).toBe(1);
    expect(s.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("interpolates rect over the window ending at the later keyframe", () => {
    const moved = upsertKeyframe(track, 3, { rect: { x: 0.1, y: 0.1, w: 0.22, h: 0.22 * (16 / 9) } });
    const mid = cameraAt(moved, 3 - CAMERA_ANIM_S / 2);
    expect(mid.rect.x).toBeGreaterThan(0.1);
    expect(mid.rect.x).toBeLessThan(track.keyframes[0].rect.x);
    // ...and lands exactly on the keyframe's own rect at its t.
    expect(cameraAt(moved, 3).rect.x).toBeCloseTo(0.1);
  });

  it("gives the keyframe's rect at its own t however small the move", () => {
    // The editor's WYSIWYG guarantee: dragging at the playhead and sampling
    // at that same playhead must show what was just dragged.
    const dragged = upsertKeyframe(track, 4.2, { rect: { x: 0.42, y: 0.11, w: 0.2, h: 0.2 } });
    expect(cameraAt(dragged, 4.2).rect).toEqual({ x: 0.42, y: 0.11, w: 0.2, h: 0.2 });
  });

  it("compresses, never clips, the window of a keyframe near t = 0", () => {
    // kf@0 and kf@0.1: the full 0.3 s window would start at -0.2, so frame 0
    // would already be two-thirds through the move and the t=0 state would
    // never be shown. The window compresses to [0, 0.1] instead.
    const near = upsertKeyframe(track, 0.1, { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    expect(cameraAt(near, 0).rect).toEqual(track.keyframes[0].rect);
    expect(cameraAt(near, 0.1).rect).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    const mid = cameraAt(near, 0.05);
    expect(mid.rect.x).toBeGreaterThan(0.1);
    expect(mid.rect.x).toBeLessThan(track.keyframes[0].rect.x);
  });

  it("does not pop when a keyframe re-targets before the prior animation settles", () => {
    // keyframe1 at t=5, keyframe2 at t=5.1 — its window [4.8, 5.1] opens
    // while keyframe1's window [4.7, 5.0] is still running.
    const withB = upsertKeyframe(track, 5, {
      mode: "bubble",
      rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    });
    const withC = upsertKeyframe(withB, 5.1, {
      mode: "bubble",
      rect: { x: 0.05, y: 0.05, w: 0.2, h: 0.2 },
    });
    const before = cameraAt(withC, 4.799);
    const after = cameraAt(withC, 4.801);
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

    const before = fullWeight(cameraAt(backToBubble, 4.799));
    const after = fullWeight(cameraAt(backToBubble, 4.801));
    expect(Math.abs(after - before)).toBeLessThan(0.02);
  });

  it("reports the track's shape when the keyframe carries none", () => {
    const s = cameraAt(track, 1);
    expect(s.shape).toBe("circle");
    expect(s.fromShape).toBeUndefined();
    expect(s.shapeFade).toBe(1);
  });

  it("morphs the shape over the window before the keyframe that changes it", () => {
    const square = upsertKeyframe(track, 4, { shape: "square" });
    const mid = cameraAt(square, 4 - CAMERA_ANIM_S / 2);
    expect(mid.shape).toBe("square");
    expect(mid.fromShape).toBe("circle");
    expect(mid.shapeFade).toBeGreaterThan(0);
    expect(mid.shapeFade).toBeLessThan(1);

    const at = cameraAt(square, 4);
    expect(at.shape).toBe("square");
    expect(at.fromShape).toBeUndefined();
    expect(at.shapeFade).toBe(1);
  });

  it("cross-fades a hidden keyframe like any other mode", () => {
    const hide = upsertKeyframe(track, 3, { mode: "hidden" });
    const mid = cameraAt(hide, 3 - CAMERA_ANIM_S / 2);
    expect(mid.mode).toBe("hidden");
    expect(mid.fromMode).toBe("bubble");
    expect(mid.fade).toBeGreaterThan(0);
    expect(mid.fade).toBeLessThan(1);
    expect(cameraAt(hide, 3).mode).toBe("hidden");
    expect(cameraAt(hide, 3).fade).toBe(1);
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
  it("inherits the previous keyframe's own shape rather than the track default", () => {
    const a = upsertKeyframe(track, 2, { shape: "square" });
    const b = upsertKeyframe(a, 4, { mode: "full" });
    expect(b.keyframes[2].shape).toBe("square");
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
