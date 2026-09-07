import { describe, expect, it } from "vitest";
import { packRows } from "./lanes";

const span = (start: number, end: number) => ({ start, end });

describe("packRows", () => {
  it("puts everything in one row when nothing overlaps", () => {
    expect(packRows([span(0, 1), span(2, 3), span(4, 5)])).toEqual([0, 0, 0]);
  });

  it("opens a second row for an overlap", () => {
    expect(packRows([span(0, 5), span(2, 7)])).toEqual([0, 1]);
  });

  it("uses exactly as many rows as the deepest overlap", () => {
    // three live at t=3, so three rows and no more
    const rows = packRows([span(0, 5), span(2, 7), span(3, 4), span(9, 10)]);
    expect(Math.max(...rows) + 1).toBe(3);
  });

  it("reuses a row once it is free", () => {
    // the third starts after the first ends, so it goes back to row 0
    expect(packRows([span(0, 5), span(2, 7), span(6, 8)])).toEqual([0, 1, 0]);
  });

  it("treats touching spans as non-overlapping", () => {
    expect(packRows([span(0, 5), span(5, 9)])).toEqual([0, 0]);
  });

  it("returns rows in the caller's order, not sorted order", () => {
    // input is out of time order; result must line up index-for-index
    expect(packRows([span(6, 8), span(0, 5), span(2, 7)])).toEqual([0, 0, 1]);
  });

  it("handles zero-length spans", () => {
    expect(packRows([span(3, 3), span(3, 3)])).toEqual([0, 0]);
  });

  it("is empty for no input", () => {
    expect(packRows([])).toEqual([]);
  });
});
