import { describe, expect, it } from "vitest";
import { addCut, editedDuration, editedToSource, keptRanges, sourceToEdited } from "./cuts";

const edits = (over: object) => ({
  version: 1 as const, cuts: [], crop: null, zooms: [], overlays: [], markers: [], ...over,
});

describe("keptRanges", () => {
  it("is the whole take with no edits", () => {
    expect(keptRanges(edits({}), 10)).toEqual([{ start: 0, end: 10 }]);
  });
  it("applies trim then cuts", () => {
    const e = edits({ trim: { start: 1, end: 9 }, cuts: [{ start: 3, end: 4 }, { start: 8.5, end: 20 }] });
    expect(keptRanges(e, 10)).toEqual([{ start: 1, end: 3 }, { start: 4, end: 8.5 }]);
  });
  it("drops empty ranges", () => {
    expect(keptRanges(edits({ cuts: [{ start: 0, end: 10 }] }), 10)).toEqual([]);
  });
  it("is order-independent for unsorted cuts", () => {
    const e = edits({ trim: { start: 1, end: 9 }, cuts: [{ start: 8.5, end: 20 }, { start: 3, end: 4 }] });
    expect(keptRanges(e, 10)).toEqual([{ start: 1, end: 3 }, { start: 4, end: 8.5 }]);
  });
  it("keeps non-adjacent cuts separate", () => {
    const e = edits({ cuts: [{ start: 1, end: 2 }, { start: 4, end: 5 }] });
    expect(keptRanges(e, 10)).toEqual([{ start: 0, end: 1 }, { start: 2, end: 4 }, { start: 5, end: 10 }]);
  });
  it("skips inverted (end <= start) cuts", () => {
    const e = edits({ cuts: [{ start: 5, end: 5 }, { start: 8, end: 3 }] });
    expect(keptRanges(e, 10)).toEqual([{ start: 0, end: 10 }]);
  });
  it("treats a NaN duration like Infinity, not zero", () => {
    expect(keptRanges(edits({}), NaN)).toEqual([{ start: 0, end: Infinity }]);
  });
  it("treats an Infinity duration as unbounded", () => {
    expect(keptRanges(edits({}), Infinity)).toEqual([{ start: 0, end: Infinity }]);
  });
});

describe("time remap", () => {
  const e = edits({ cuts: [{ start: 2, end: 4 }] });
  it("editedDuration subtracts cuts", () => expect(editedDuration(e, 10)).toBe(8));
  it("sourceToEdited collapses a cut onto its start", () => {
    expect(sourceToEdited(e, 10, 1)).toBe(1);
    expect(sourceToEdited(e, 10, 3)).toBe(2);
    expect(sourceToEdited(e, 10, 6)).toBe(4);
  });
  it("editedToSource skips the cut", () => {
    expect(editedToSource(e, 10, 1)).toBe(1);
    expect(editedToSource(e, 10, 2)).toBe(4);
    expect(editedToSource(e, 10, 7.9)).toBeCloseTo(9.9);
  });
  it("editedToSource at the exact cut boundary lands on the resumption point, not the cut start", () => {
    expect(editedToSource(e, 10, 2)).toBe(4);
  });
  it("editedToSource clamps negative (and NaN) edited time to the first range's start", () => {
    expect(editedToSource(e, 10, -5)).toBe(0);
    expect(editedToSource(e, 10, NaN)).toBe(0);
  });
  it("round-trips inside kept ranges", () => {
    for (const t of [0, 1.5, 4.2, 9.99]) {
      expect(editedToSource(e, 10, sourceToEdited(e, 10, t))).toBeCloseTo(t);
    }
  });
});

describe("addCut", () => {
  it("merges overlapping and touching cuts and sorts", () => {
    const cuts = addCut(addCut([{ start: 5, end: 6 }], { start: 1, end: 2 }), { start: 1.5, end: 5 });
    expect(cuts).toEqual([{ start: 1, end: 6 }]);
  });
  it("ignores degenerate spans", () => {
    expect(addCut([], { start: 3, end: 3 })).toEqual([]);
  });
  it("keeps non-adjacent cuts separate", () => {
    const cuts = addCut([{ start: 1, end: 2 }], { start: 5, end: 6 });
    expect(cuts).toEqual([{ start: 1, end: 2 }, { start: 5, end: 6 }]);
  });
  it("does not mutate its inputs", () => {
    const original: { start: number; end: number }[] = [{ start: 1, end: 2 }];
    const snapshot = original.map((c) => ({ ...c }));
    const result = addCut(original, { start: 1.5, end: 3 });
    expect(original).toEqual(snapshot);
    expect(result).not.toBe(original);
    expect(result[0]).not.toBe(original[0]);
  });
});
