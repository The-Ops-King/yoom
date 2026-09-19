import { describe, expect, it } from "vitest";
import { frameCount, sourceTimes, cameraTimes, thumbnailFrame } from "./timeline";

const ranges = [{ start: 0, end: 1 }, { start: 3, end: 4 }]; // a cut over [1,3)

describe("frame timeline", () => {
  it("counts whole output frames over the kept duration", () => {
    expect(frameCount(ranges, 30)).toBe(60);
  });

  it("floors the frame count at 1 for an empty kept range", () => {
    expect(frameCount([], 30)).toBe(1);
  });

  it("floors the frame count at 1 for a range shorter than one frame", () => {
    expect(frameCount([{ start: 0, end: 0.01 }], 30)).toBe(1);
  });

  it("maps each output frame to a source time, skipping cuts", () => {
    const t = [...sourceTimes(ranges, 30)];
    expect(t).toHaveLength(60);
    expect(t[0]).toBe(0);
    expect(t[29]).toBeCloseTo(29 / 30);
    expect(t[30]).toBeCloseTo(3); // first frame after the cut
    expect(t[59]).toBeCloseTo(3 + 29 / 30);
  });

  it("produces one frame at source time 0 for an empty kept range", () => {
    expect([...sourceTimes([], 30)]).toEqual([0]);
  });

  it("keeps source times strictly increasing across multiple cuts", () => {
    const multiCut = [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 5, end: 5.5 },
    ];
    const t = [...sourceTimes(multiCut, 30)];
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });

  it("offsets camera times and clamps them at zero", () => {
    expect([...cameraTimes([0, 0.5, 1], -0.25)]).toEqual([0, 0.25, 0.75]);
  });

  it("holds a flat run of clamped zeros when the offset pushes screen times negative", () => {
    expect([...cameraTimes([0, 0.1, 0.2, 0.5], -0.3)]).toEqual([0, 0, 0, 0.2]);
  });

  it("picks the output frame for a thumbnail given in edited seconds", () => {
    expect(thumbnailFrame(1.5, 60, 30)).toBe(45);
    expect(thumbnailFrame(99, 60, 30)).toBe(59);
    expect(thumbnailFrame(-1, 60, 30)).toBe(0);
  });

  it("picks frame 0 for a single-frame timeline", () => {
    expect(thumbnailFrame(0, 1, 30)).toBe(0);
    expect(thumbnailFrame(5, 1, 30)).toBe(0);
  });
});
