import { describe, expect, it } from "vitest";
import { deviceFromUserAgent, fmtBytes, fmtDuration, fmtRelative } from "@/lib/format";

describe("fmtDuration", () => {
  it("formats m:ss under an hour", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(9_000)).toBe("0:09");
    expect(fmtDuration(75_000)).toBe("1:15");
  });

  it("formats h:mm:ss at an hour and over", () => {
    expect(fmtDuration(3_600_000)).toBe("1:00:00");
    expect(fmtDuration(3_725_000)).toBe("1:02:05");
  });

  it("renders an em dash for unknown durations", () => {
    expect(fmtDuration(null)).toBe("—");
    expect(fmtDuration(-1)).toBe("—");
  });
});

describe("fmtBytes", () => {
  it("scales to the nearest unit", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(999)).toBe("999 B");
    expect(fmtBytes(1024)).toBe("1.0 KB");
    expect(fmtBytes(1024 * 1024 * 3.5)).toBe("3.5 MB");
    expect(fmtBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("renders an em dash for unknown sizes", () => {
    expect(fmtBytes(null)).toBe("—");
  });
});

describe("fmtRelative", () => {
  const now = new Date("2026-09-02T12:00:00Z");

  it("describes recent times", () => {
    expect(fmtRelative("2026-09-02T11:59:30Z", now)).toBe("just now");
    expect(fmtRelative("2026-09-02T11:45:00Z", now)).toBe("15m ago");
    expect(fmtRelative("2026-09-02T09:00:00Z", now)).toBe("3h ago");
    expect(fmtRelative("2026-08-30T12:00:00Z", now)).toBe("3d ago");
    expect(fmtRelative("2026-08-05T12:00:00Z", now)).toBe("4w ago");
    expect(fmtRelative("2025-09-02T12:00:00Z", now)).toBe("1y ago");
  });

  it("renders an em dash for missing or unparsable input", () => {
    expect(fmtRelative(null, now)).toBe("—");
    expect(fmtRelative("not-a-date", now)).toBe("—");
  });
});

describe("deviceFromUserAgent", () => {
  it("is re-exported from alerts so there is one implementation", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (Macintosh) Chrome/120")).toBe(
      "Mac · Chrome",
    );
    expect(deviceFromUserAgent(null)).toBe("Unknown device");
  });
});
