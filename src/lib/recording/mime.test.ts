import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_CODECS, EXPORT_CODECS, pickMimeType } from "./mime";

/**
 * Install a fake `MediaRecorder` whose `isTypeSupported` accepts exactly the
 * containers named. Returns nothing; `afterEach` puts the global back.
 */
function supporting(...supported: string[]) {
  vi.stubGlobal("MediaRecorder", {
    isTypeSupported: (type: string) => supported.includes(type),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("codec preference lists", () => {
  for (const [name, list] of [
    ["CAPTURE_CODECS", CAPTURE_CODECS],
    ["EXPORT_CODECS", EXPORT_CODECS],
  ] as const) {
    describe(name, () => {
      // The whole point of the list order: a WebM from MediaRecorder carries no
      // duration in its header and is unplayable if the take is cut short, so
      // MP4 wins wherever the browser can produce it.
      it("prefers MP4 over every WebM candidate", () => {
        const firstMp4 = list.findIndex((c) => c.startsWith("video/mp4"));
        const firstWebm = list.findIndex((c) => c.startsWith("video/webm"));
        expect(firstMp4).toBeGreaterThanOrEqual(0);
        expect(firstWebm).toBeGreaterThanOrEqual(0);
        expect(firstMp4).toBeLessThan(firstWebm);
      });

      it("asks for H.264 + AAC before bare MP4", () => {
        const mp4 = list.filter((c) => c.startsWith("video/mp4"));
        expect(mp4[0]).toContain("avc1");
        expect(mp4[0]).toContain("mp4a.40.2");
        expect(mp4.at(-1)).toBe("video/mp4");
      });

      // Firefox has no MP4 MediaRecorder at all; dropping WebM would leave it
      // recording nothing.
      it("keeps WebM fallbacks for browsers with no MP4 encoder", () => {
        expect(list.some((c) => c.startsWith("video/webm"))).toBe(true);
      });

      it("contains no empty sentinel — pickMimeType owns that fallback", () => {
        expect(list).not.toContain("");
      });
    });
  }
});

describe("pickMimeType", () => {
  it("returns the first candidate the browser supports", () => {
    supporting("video/webm;codecs=vp9,opus", "video/webm");
    expect(pickMimeType(CAPTURE_CODECS)).toBe("video/webm;codecs=vp9,opus");
  });

  it("picks MP4 when the browser can encode it, even though WebM also works", () => {
    supporting("video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus");
    expect(pickMimeType(CAPTURE_CODECS)).toBe("video/mp4;codecs=avc1,mp4a.40.2");
  });

  it("returns the empty string when nothing is supported, letting the browser choose", () => {
    supporting();
    expect(pickMimeType(CAPTURE_CODECS)).toBe("");
  });

  it("returns the empty string on the server, where MediaRecorder is undefined", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickMimeType(CAPTURE_CODECS)).toBe("");
  });
});
