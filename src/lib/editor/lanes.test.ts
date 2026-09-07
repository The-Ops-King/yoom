import { describe, expect, it } from "vitest";
import { packRows } from "./lanes";

const span = (start: number, end: number) => ({ start, end });

describe("packRows", () => {
  it("puts everything in one row when nothing overlaps", () => {
    expect(packRows([span(0, 1), span(2, 3), span(4, 5)])).toEqual({
      rows: [0, 0, 0],
      count: 1,
    });
  });

  it("opens a second row for an overlap", () => {
    expect(packRows([span(0, 5), span(2, 7)])).toEqual({
      rows: [0, 1],
      count: 2,
    });
  });

  it("uses exactly as many rows as the deepest overlap", () => {
    // three live at t=3, so three rows and no more
    expect(packRows([span(0, 5), span(2, 7), span(3, 4), span(9, 10)])).toEqual(
      {
        rows: [0, 1, 2, 0],
        count: 3,
      }
    );
  });

  it("reuses a row once it is free", () => {
    // the third starts after the first ends, so it goes back to row 0
    expect(packRows([span(0, 5), span(2, 7), span(6, 8)])).toEqual({
      rows: [0, 1, 0],
      count: 2,
    });
  });

  it("treats touching spans as non-overlapping", () => {
    expect(packRows([span(0, 5), span(5, 9)])).toEqual({
      rows: [0, 0],
      count: 1,
    });
  });

  it("returns rows in the caller's order, not sorted order", () => {
    // input is out of time order; result must line up index-for-index
    expect(packRows([span(6, 8), span(0, 5), span(2, 7)])).toEqual({
      rows: [0, 0, 1],
      count: 2,
    });
  });

  it("handles zero-length spans", () => {
    expect(packRows([span(3, 3), span(3, 3)])).toEqual({
      rows: [0, 0],
      count: 0,
    });
  });

  it("is empty for no input", () => {
    expect(packRows([])).toEqual({ rows: [], count: 0 });
  });

  it("assigns malformed spans (NaN end) to row 0 without inflating count", () => {
    // NaN end is malformed; should get row 0, and not affect packing of the valid span
    expect(
      packRows([span(0, 5), span(2, NaN)])
    ).toEqual({
      rows: [0, 0],
      count: 1,
    });
  });

  it("assigns malformed spans (NaN start) to row 0 without inflating count", () => {
    // NaN start is malformed; should get row 0, and not affect packing of the valid span
    expect(
      packRows([span(0, 5), span(NaN, 7)])
    ).toEqual({
      rows: [0, 0],
      count: 1,
    });
  });

  it("assigns malformed spans (inverted) to row 0 without inflating count", () => {
    // end < start is malformed; should get row 0, and not affect packing of the valid span
    expect(
      packRows([span(0, 5), span(7, 3)])
    ).toEqual({
      rows: [0, 0],
      count: 1,
    });
  });
});
