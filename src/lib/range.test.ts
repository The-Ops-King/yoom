import { describe, expect, it } from "vitest";
import { RANGE_WINDOW_BYTES, clampRange } from "@/lib/range";

const MB = 1024 * 1024;

describe("RANGE_WINDOW_BYTES", () => {
  it("is 32 MiB", () => {
    expect(RANGE_WINDOW_BYTES).toBe(32 * MB);
  });
});

describe("clampRange", () => {
  it("returns null when there is no Range header", () => {
    expect(clampRange(null, 1000, RANGE_WINDOW_BYTES)).toBeNull();
  });

  it("returns null for a non-bytes unit", () => {
    expect(clampRange("items=0-10", 1000, RANGE_WINDOW_BYTES)).toBeNull();
  });

  it("returns null for a malformed header", () => {
    expect(clampRange("bytes=", 1000, RANGE_WINDOW_BYTES)).toBeNull();
    expect(clampRange("bytes=abc-def", 1000, RANGE_WINDOW_BYTES)).toBeNull();
  });

  it("parses a closed range", () => {
    expect(clampRange("bytes=0-1023", 10_000, RANGE_WINDOW_BYTES)).toEqual({
      start: 0,
      end: 1023,
    });
  });

  it("clamps a closed range to the last byte", () => {
    expect(clampRange("bytes=0-999999", 500, RANGE_WINDOW_BYTES)).toEqual({
      start: 0,
      end: 499,
    });
  });

  it("clamps an open-ended range to the window", () => {
    expect(clampRange("bytes=0-", 100 * MB, RANGE_WINDOW_BYTES)).toEqual({
      start: 0,
      end: 32 * MB - 1,
    });
  });

  it("does not pad a small open-ended range past the file", () => {
    expect(clampRange("bytes=0-", 1000, RANGE_WINDOW_BYTES)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it("clamps a wide closed range to the window", () => {
    expect(clampRange("bytes=0-99999999", 100 * MB, RANGE_WINDOW_BYTES)).toEqual({
      start: 0,
      end: 32 * MB - 1,
    });
  });

  it("handles a suffix range", () => {
    expect(clampRange("bytes=-500", 10_000, RANGE_WINDOW_BYTES)).toEqual({
      start: 9500,
      end: 9999,
    });
  });

  it("clamps an oversized suffix range to the whole file", () => {
    expect(clampRange("bytes=-99999", 1000, RANGE_WINDOW_BYTES)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it("returns unsatisfiable for a start past the end of the file", () => {
    expect(clampRange("bytes=5000-", 1000, RANGE_WINDOW_BYTES)).toEqual({
      unsatisfiable: true,
    });
  });

  it("returns unsatisfiable when start is greater than end", () => {
    expect(clampRange("bytes=800-100", 1000, RANGE_WINDOW_BYTES)).toEqual({
      unsatisfiable: true,
    });
  });

  it("returns null for a zero-size file", () => {
    expect(clampRange("bytes=0-", 0, RANGE_WINDOW_BYTES)).toBeNull();
  });
});
