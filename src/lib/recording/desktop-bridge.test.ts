import { afterEach, describe, expect, it, vi } from "vitest";
import type { BubbleAppearance } from "./types";
import {
  getDesktopBridge,
  isDesktop,
  onDesktopBubbleAppearance,
  onDesktopBubbleMove,
  onDesktopShortcut,
  setDesktopBubbleAppearance,
  setDesktopBubbleVisible,
  setDesktopCameraDevice,
  setDesktopRecordingActive,
} from "./desktop-bridge";

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
    expect(() => onDesktopBubbleMove(() => {})()).not.toThrow();
  });

  it("forwards bubble moves", () => {
    const seen: { x: number; y: number }[] = [];
    let emit: ((p: { x: number; y: number }) => void) | null = null;
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        onBubbleMove: (cb: (p: { x: number; y: number }) => void) => {
          emit = cb;
          return () => {};
        },
      },
    });
    onDesktopBubbleMove((p) => seen.push(p));
    emit!({ x: 0.8, y: 0.9 });
    expect(seen).toEqual([{ x: 0.8, y: 0.9 }]);
  });

  it("bubble setters are silent no-ops without a bridge", () => {
    vi.stubGlobal("window", {});
    expect(() => setDesktopBubbleVisible(true)).not.toThrow();
    expect(() =>
      setDesktopBubbleAppearance({
        shape: "circle",
        size: "medium",
        mirror: true,
        visible: true,
        framed: false,
      }),
    ).not.toThrow();
    expect(() => setDesktopCameraDevice(null)).not.toThrow();
    expect(() => setDesktopRecordingActive(true)).not.toThrow();
    expect(onDesktopBubbleAppearance(() => {})).toBeTypeOf("function");
  });

  it("bubble setters reach a version-1 bridge", () => {
    const calls: unknown[] = [];
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        setBubbleVisible: (v: boolean) => calls.push(["visible", v]),
        setBubbleAppearance: (a: unknown) => calls.push(["appearance", a]),
        setCameraDevice: (id: string | null) => calls.push(["camera", id]),
      },
    });
    setDesktopBubbleVisible(false);
    setDesktopBubbleAppearance({
      shape: "rounded",
      size: "large",
      mirror: false,
      visible: true,
      framed: true,
      cameraAspect: 4 / 3,
    });
    setDesktopCameraDevice("cam-1");
    expect(calls).toEqual([
      ["visible", false],
      [
        "appearance",
        {
          shape: "rounded",
          size: "large",
          mirror: false,
          visible: true,
          framed: true,
          cameraAspect: 4 / 3,
        },
      ],
      ["camera", "cam-1"],
    ]);
  });

  it("forwards appearance changes made by the desktop bubble itself", () => {
    const seen: BubbleAppearance[] = [];
    let emit: ((a: BubbleAppearance) => void) | null = null;
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        onBubbleAppearance: (cb: (a: BubbleAppearance) => void) => {
          emit = cb;
          return () => {};
        },
      },
    });
    const off = onDesktopBubbleAppearance((a) => seen.push(a));
    const next: BubbleAppearance = {
      shape: "square",
      size: "small",
      mirror: false,
      visible: false,
      framed: false,
      cameraAspect: 16 / 9,
    };
    emit!(next);
    expect(seen).toEqual([next]);
    expect(off).toBeTypeOf("function");
  });

  it("reports recording-active to a version-1 bridge", () => {
    const calls: boolean[] = [];
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        setRecordingActive: (a: boolean) => calls.push(a),
      },
    });
    setDesktopRecordingActive(true);
    setDesktopRecordingActive(false);
    expect(calls).toEqual([true, false]);
  });
});
