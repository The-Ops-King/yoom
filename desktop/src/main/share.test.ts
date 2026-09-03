import { describe, expect, it } from "vitest";
import type { SourceInfo } from "../shared/ipc";
import { autoShareSource, matchLastSource } from "./share";

function source(id: string, name: string, kind: "screen" | "window"): SourceInfo {
  return { id, name, kind, thumb: "data:," };
}

const SCREEN_1 = source("screen:1:0", "Display 1", "screen");
const SCREEN_2 = source("screen:2:0", "Display 2", "screen");
const SLACK = source("window:412:0", "Slack", "window");

describe("matchLastSource", () => {
  it("is null with nothing remembered", () => {
    expect(matchLastSource(null, [SCREEN_1, SLACK])).toBeNull();
  });

  it("matches on id first", () => {
    const last = { id: "screen:2:0", name: "stale name", kind: "screen" as const };
    expect(matchLastSource(last, [SCREEN_1, SCREEN_2])).toBe(SCREEN_2);
  });

  it("falls back to kind + title when the window handle has changed", () => {
    // Window ids are handles: relaunching Slack gives the same window a new one.
    const last = { id: "window:99:0", name: "Slack", kind: "window" as const };
    expect(matchLastSource(last, [SCREEN_1, SLACK])).toBe(SLACK);
  });

  it("never crosses kinds on the title fallback", () => {
    // A window called "Display 1" must not resolve to the display: the screen
    // branch is what drives cursor tracking and bubble self-occlusion.
    const last = { id: "window:99:0", name: "Display 1", kind: "window" as const };
    expect(matchLastSource(last, [SCREEN_1])).toBeNull();
  });

  it("is null when the remembered source is gone (monitor unplugged)", () => {
    const last = { id: "screen:2:0", name: "Display 2", kind: "screen" as const };
    expect(matchLastSource(last, [SCREEN_1, SLACK])).toBeNull();
  });
});

describe("autoShareSource", () => {
  it("re-shares the remembered source in auto mode", () => {
    expect(autoShareSource({ mode: "auto", forcePick: false, last: SCREEN_1 })).toBe(
      SCREEN_1,
    );
  });

  it("opens the picker when nothing is remembered", () => {
    expect(autoShareSource({ mode: "auto", forcePick: false, last: null })).toBeNull();
  });

  it("opens the picker in pick mode even with a remembered source", () => {
    expect(autoShareSource({ mode: "pick", forcePick: false, last: SCREEN_1 })).toBeNull();
  });

  it("opens the picker for the one-shot Change button", () => {
    expect(autoShareSource({ mode: "auto", forcePick: true, last: SCREEN_1 })).toBeNull();
  });
});
