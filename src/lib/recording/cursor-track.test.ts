import { describe, expect, it } from "vitest";
import { appendSamples, CURSOR_CAP, toSeconds } from "./cursor-track";
import type { CursorSample } from "./types";

const sample = (t: number, x = 0.5, y = 0.5): CursorSample => ({ t, x, y });

describe("appendSamples", () => {
  it("appends a batch onto an empty track", () => {
    const out = appendSamples([], [sample(0), sample(33)]);
    expect(out.map((s) => s.t)).toEqual([0, 33]);
  });

  it("keeps earlier samples ahead of later ones", () => {
    const first = appendSamples([], [sample(0), sample(33)]);
    const second = appendSamples(first, [sample(66)]);
    expect(second.map((s) => s.t)).toEqual([0, 33, 66]);
  });

  it("does not mutate the input track", () => {
    const track = [sample(0)];
    appendSamples(track, [sample(33)]);
    expect(track).toHaveLength(1);
  });

  it("returns the same reference for an empty batch", () => {
    const track = [sample(0)];
    expect(appendSamples(track, [])).toBe(track);
  });

  it("truncates a batch that would cross the cap", () => {
    const track = [sample(0), sample(1)];
    const out = appendSamples(track, [sample(2), sample(3), sample(4)], 4);
    expect(out.map((s) => s.t)).toEqual([0, 1, 2, 3]);
  });

  it("ignores every sample once the cap is reached", () => {
    const full = [sample(0), sample(1)];
    const out = appendSamples(full, [sample(2)], 2);
    expect(out).toBe(full);
    expect(out.map((s) => s.t)).toEqual([0, 1]);
  });

  it("defaults to the 60 000-sample cap", () => {
    const full = Array.from({ length: CURSOR_CAP }, (_, i) => sample(i));
    expect(appendSamples(full, [sample(CURSOR_CAP)])).toBe(full);
    expect(CURSOR_CAP).toBe(60_000);
  });
});

describe("toSeconds", () => {
  it("converts milliseconds to seconds and leaves x/y alone", () => {
    expect(toSeconds([{ t: 1500, x: 0.25, y: 0.75 }])).toEqual([{ t: 1.5, x: 0.25, y: 0.75 }]);
  });

  it("preserves an intentional overshoot outside 0..1", () => {
    expect(toSeconds([{ t: 0, x: -0.1, y: 1.1 }])).toEqual([{ t: 0, x: -0.1, y: 1.1 }]);
  });

  it("does not mutate its input", () => {
    const src: CursorSample[] = [sample(2000)];
    const out = toSeconds(src);
    expect(src[0].t).toBe(2000);
    expect(out[0].t).toBe(2);
  });

  it("maps an empty track to an empty track", () => {
    expect(toSeconds([])).toEqual([]);
  });
});
