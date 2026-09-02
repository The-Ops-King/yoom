import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopBridge, isDesktop } from "./desktop-bridge";

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
});
