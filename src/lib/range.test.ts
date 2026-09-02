import { describe, expect, it } from "vitest";
import { RANGE_WINDOW_BYTES, clampRange, planUpstreamRange } from "@/lib/range";

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

describe("planUpstreamRange", () => {
  it("size>0: returns unsatisfiable when the range is unsatisfiable", () => {
    expect(planUpstreamRange("bytes=5000-", 1000, RANGE_WINDOW_BYTES)).toEqual({
      kind: "unsatisfiable",
    });
  });

  it("size>0: returns a clamped range when the client sent a usable Range", () => {
    expect(planUpstreamRange("bytes=0-1023", 10_000, RANGE_WINDOW_BYTES)).toEqual({
      kind: "range",
      start: 0,
      end: 1023,
    });
  });

  it("size>0: falls back to the first window when no Range and file exceeds the window", () => {
    expect(planUpstreamRange(null, 100 * MB, RANGE_WINDOW_BYTES)).toEqual({
      kind: "range",
      start: 0,
      end: RANGE_WINDOW_BYTES - 1,
    });
  });

  it("size>0: serves the whole file when no Range and file fits within the window", () => {
    expect(planUpstreamRange(null, 1000, RANGE_WINDOW_BYTES)).toEqual({ kind: "full" });
  });

  it("size<=0: forwards the client's Range header verbatim", () => {
    expect(planUpstreamRange("bytes=1000-2000", 0, RANGE_WINDOW_BYTES)).toEqual({
      kind: "passthrough",
      header: "bytes=1000-2000",
    });
  });

  it("size<=0: forces a bounded first-window request when there is no Range", () => {
    expect(planUpstreamRange(null, 0, RANGE_WINDOW_BYTES)).toEqual({
      kind: "range",
      start: 0,
      end: RANGE_WINDOW_BYTES - 1,
    });
  });

  it("size<=0 (negative): forces a bounded first-window request when there is no Range", () => {
    expect(planUpstreamRange(null, -1, RANGE_WINDOW_BYTES)).toEqual({
      kind: "range",
      start: 0,
      end: RANGE_WINDOW_BYTES - 1,
    });
  });
});
