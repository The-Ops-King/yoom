import { describe, expect, it } from "vitest";
import { EMPTY_EDITS, isEmptyEdits, parseEdits } from "@/lib/edits";

describe("parseEdits", () => {
  it("returns the empty list for junk input", () => {
    for (const junk of [null, undefined, 1, "x", [], {}, { version: 2 }]) {
      expect(parseEdits(junk)).toEqual(EMPTY_EDITS);
    }
  });

  it("keeps well-formed cuts and drops malformed ones", () => {
    const parsed = parseEdits({
      version: 1,
      cuts: [
        { start: 1, end: 2 },
        { start: 5, end: 5 },
        { start: "a", end: 2 },
        null,
      ],
    });
    expect(parsed.cuts).toEqual([{ start: 1, end: 2 }]);
  });

  it("keeps a valid crop and rejects a zero-area one", () => {
    expect(parseEdits({ version: 1, crop: { x: 0, y: 0, w: 1, h: 0.5 } }).crop).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 0.5,
    });
    expect(parseEdits({ version: 1, crop: { x: 0, y: 0, w: 0, h: 1 } }).crop).toBeNull();
  });

  it("keeps zooms with a valid rect", () => {
    const parsed = parseEdits({
      version: 1,
      zooms: [
        { start: 0, end: 3, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
        { start: 0, end: 3, rect: { x: 0.1, y: 0.1, w: 0 } },
      ],
    });
    expect(parsed.zooms).toHaveLength(1);
    expect(parsed.zooms[0].rect.w).toBe(0.5);
  });

  it("keeps only known overlay types and carries n/color", () => {
    const parsed = parseEdits({
      version: 1,
      overlays: [
        { type: "blur", start: 0, end: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
        { type: "callout", start: 1, end: 2, rect: { x: 0, y: 0, w: 1, h: 1 }, n: 3 },
        { type: "sparkle", start: 0, end: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
        {
          type: "highlight",
          start: 0,
          end: 1,
          rect: { x: 0, y: 0, w: 1, h: 1 },
          color: "#ff0",
        },
      ],
    });
    expect(parsed.overlays.map((o) => o.type)).toEqual([
      "blur",
      "callout",
      "highlight",
    ]);
    expect(parsed.overlays[1].n).toBe(3);
    expect(parsed.overlays[2].color).toBe("#ff0");
  });

  it("round-trips through JSON", () => {
    const source = {
      version: 1,
      cuts: [{ start: 0, end: 1 }],
      crop: null,
      zooms: [],
      overlays: [],
    };
    expect(parseEdits(JSON.parse(JSON.stringify(source)))).toEqual({
      version: 1,
      cuts: [{ start: 0, end: 1 }],
      crop: null,
      zooms: [],
      overlays: [],
      markers: [],
    });
  });

  it("keeps well-formed markers, sorts them, and drops invalid entries", () => {
    const parsed = parseEdits({
      version: 1,
      markers: [
        { t: 5, label: "second" },
        { t: 1 },
        { t: -1, label: "bad" },
        { t: "x", label: "bad" },
        null,
      ],
    });
    expect(parsed.markers).toEqual([{ t: 1 }, { t: 5, label: "second" }]);
  });

  it("drops non-string marker labels", () => {
    const parsed = parseEdits({
      version: 1,
      markers: [{ t: 1, label: 5 }],
    });
    expect(parsed.markers).toEqual([{ t: 1 }]);
  });
});

describe("isEmptyEdits", () => {
  it("is true for the empty list and false once anything is set", () => {
    expect(isEmptyEdits(EMPTY_EDITS)).toBe(true);
    expect(
      isEmptyEdits({ ...EMPTY_EDITS, cuts: [{ start: 0, end: 1 }] }),
    ).toBe(false);
    expect(
      isEmptyEdits({ ...EMPTY_EDITS, markers: [{ t: 1 }] }),
    ).toBe(false);
  });
});
