import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopBridge,
  isDesktop,
  onDesktopCursor,
  onDesktopInput,
  onDesktopShortcut,
  setDesktopHudState,
} from "./desktop-bridge";
import type { CursorSample, InputSample } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop-bridge", () => {
  it("returns null when there is no window", () => {
    vi.stubGlobal("window", undefined);
    expect(getDesktopBridge()).toBeNull();
    expect(isDesktop()).toBe(false);
  });

  it("returns null when the global is absent", () => {
    vi.stubGlobal("window", {});
    expect(getDesktopBridge()).toBeNull();
    expect(isDesktop()).toBe(false);
  });

  it("ignores a bridge with the wrong version", () => {
    vi.stubGlobal("window", { __yoomDesktop: { version: 2, isDesktop: true } });
    expect(getDesktopBridge()).toBeNull();
  });

  it("returns a version-1 bridge", () => {
    const bridge = { version: 1 as const, isDesktop: true };
    vi.stubGlobal("window", { __yoomDesktop: bridge });
    expect(getDesktopBridge()).toBe(bridge);
    expect(isDesktop()).toBe(true);
  });

  it("forwards every shortcut action the shell can send", () => {
    const seen: string[] = [];
    let emit: ((a: "toggle" | "pause" | "mark" | "restart" | "cancel") => void) | null =
      null;
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        onShortcut: (cb: (a: "toggle" | "pause" | "mark" | "restart" | "cancel") => void) => {
          emit = cb;
          return () => seen.push("unsub");
        },
      },
    });

    const unsub = onDesktopShortcut((a) => seen.push(a));
    emit!("toggle");
    emit!("mark");
    emit!("cancel");
    unsub();
    expect(seen).toEqual(["toggle", "mark", "cancel", "unsub"]);
  });

  it("returns a no-op unsubscribe when the shell has no shortcut support", () => {
    vi.stubGlobal("window", { __yoomDesktop: { version: 1 } });
    expect(() => onDesktopShortcut(() => {})()).not.toThrow();
  });
});

describe("onDesktopCursor", () => {
  it("forwards every batch the shell sends and unsubscribes", () => {
    const seen: (CursorSample[] | string)[] = [];
    let emit: ((samples: CursorSample[]) => void) | null = null;
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        onCursor: (cb: (samples: CursorSample[]) => void) => {
          emit = cb;
          return () => seen.push("unsub");
        },
      },
    });

    const unsub = onDesktopCursor((samples) => seen.push(samples));
    emit!([{ t: 0, x: 0.5, y: 0.5 }]);
    // A batch that left the display: the wire format keeps the overshoot.
    emit!([
      { t: 33, x: 1.1, y: -0.1 },
      { t: 66, x: 0.2, y: 0.9 },
    ]);
    unsub();
    expect(seen).toEqual([
      [{ t: 0, x: 0.5, y: 0.5 }],
      [
        { t: 33, x: 1.1, y: -0.1 },
        { t: 66, x: 0.2, y: 0.9 },
      ],
      "unsub",
    ]);
  });

  it("returns a no-op unsubscribe when the shell has no cursor support", () => {
    vi.stubGlobal("window", { __yoomDesktop: { version: 1 } });
    expect(() => onDesktopCursor(() => {})()).not.toThrow();
  });

  it("returns a no-op unsubscribe in the browser", () => {
    vi.stubGlobal("window", {});
    expect(() => onDesktopCursor(() => {})()).not.toThrow();
  });
});

describe("onDesktopInput", () => {
  it("forwards every mixed batch the shell sends and unsubscribes", () => {
    const seen: (InputSample[] | string)[] = [];
    let emit: ((samples: InputSample[]) => void) | null = null;
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        onInput: (cb: (samples: InputSample[]) => void) => {
          emit = cb;
          return () => seen.push("unsub");
        },
      },
    });

    const unsub = onDesktopInput((samples) => seen.push(samples));
    // Clicks and keys share one time-ordered batch: the ⌘⇧K lands between the
    // two clicks exactly where it was pressed.
    emit!([
      { kind: "click", t: 120, x: 0.25, y: 0.75, button: 0 },
      { kind: "key", t: 340, key: "K", mods: ["shift", "meta"] },
      { kind: "click", t: 480, x: 1.1, y: -0.1, button: 1 },
    ]);
    unsub();
    expect(seen).toEqual([
      [
        { kind: "click", t: 120, x: 0.25, y: 0.75, button: 0 },
        { kind: "key", t: 340, key: "K", mods: ["shift", "meta"] },
        { kind: "click", t: 480, x: 1.1, y: -0.1, button: 1 },
      ],
      "unsub",
    ]);
  });

  it("returns a no-op unsubscribe when the shell has no input support", () => {
    // The permission-denied and pre-input-track shells both look like this.
    vi.stubGlobal("window", { __yoomDesktop: { version: 1 } });
    expect(() => onDesktopInput(() => {})()).not.toThrow();
  });

  it("returns a no-op unsubscribe in the browser", () => {
    vi.stubGlobal("window", {});
    expect(() => onDesktopInput(() => {})()).not.toThrow();
  });
});

describe("setDesktopHudState", () => {
  // This suite's env is `node` (see vitest.config.mts), so there is no ambient
  // `window` to assign to — the bridge is stubbed the same way the suite above
  // stubs it rather than mutating a jsdom global.
  it("is a no-op with no bridge", () => {
    vi.stubGlobal("window", {});
    expect(() =>
      setDesktopHudState({
        status: "recording",
        elapsedMs: 1000,
        countdown: 0,
        markers: 0,
      }),
    ).not.toThrow();
  });

  it("forwards the state to a version-1 bridge", () => {
    const setHudState = vi.fn();
    vi.stubGlobal("window", {
      __yoomDesktop: { version: 1, isDesktop: true, setHudState },
    });
    const state = {
      status: "staging" as const,
      elapsedMs: 4200,
      countdown: 0,
      markers: 2,
    };
    setDesktopHudState(state);
    expect(setHudState).toHaveBeenCalledWith(state);
  });

  it("ignores a bridge that does not implement it", () => {
    vi.stubGlobal("window", { __yoomDesktop: { version: 1, isDesktop: true } });
    expect(() =>
      setDesktopHudState({
        status: "idle",
        elapsedMs: 0,
        countdown: 0,
        markers: 0,
      }),
    ).not.toThrow();
  });
});
