import { describe, expect, it } from "vitest";
import {
  DRIVE_FILE_ID_RE,
  drivePreviewUrl,
  mediaErrorName,
  normalizeErrorCode,
} from "./drive-embed";

describe("drivePreviewUrl", () => {
  it("builds Drive's own player URL for a file id", () => {
    expect(drivePreviewUrl("1a2B3c-_4D5e6F")).toBe(
      "https://drive.google.com/file/d/1a2B3c-_4D5e6F/preview",
    );
  });

  // The id reaches this from a database column that is rendered into an
  // iframe `src`; anything that is not a Drive id has no business there.
  it("refuses an id with characters a Drive id cannot contain", () => {
    for (const bad of [
      "../../etc/passwd",
      "abc/preview?x=1",
      "abc#frag",
      'abc"onload=alert(1)',
      "javascript:alert(1)",
      "abc def",
      "",
    ]) {
      expect(drivePreviewUrl(bad)).toBeNull();
    }
  });

  it("accepts the shape Drive actually issues", () => {
    expect(DRIVE_FILE_ID_RE.test("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms")).toBe(true);
    expect(drivePreviewUrl("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms")).toContain(
      "/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/preview",
    );
  });
});

describe("mediaErrorName", () => {
  it("names each MediaError code", () => {
    expect(mediaErrorName(1)).toBe("MEDIA_ERR_ABORTED");
    expect(mediaErrorName(2)).toBe("MEDIA_ERR_NETWORK");
    expect(mediaErrorName(3)).toBe("MEDIA_ERR_DECODE");
    expect(mediaErrorName(4)).toBe("MEDIA_ERR_SRC_NOT_SUPPORTED");
  });

  it("falls back for an unknown code", () => {
    expect(mediaErrorName(99)).toBe("MEDIA_ERR_UNKNOWN");
    expect(mediaErrorName(null)).toBe("MEDIA_ERR_UNKNOWN");
  });
});

describe("normalizeErrorCode", () => {
  it("keeps the four real codes", () => {
    for (const c of [1, 2, 3, 4]) expect(normalizeErrorCode(c)).toBe(c);
  });

  it("maps anything else to null rather than storing junk", () => {
    for (const bad of [0, 5, -1, 1.5, NaN, Infinity, "3", null, undefined, {}]) {
      expect(normalizeErrorCode(bad)).toBeNull();
    }
  });
});
