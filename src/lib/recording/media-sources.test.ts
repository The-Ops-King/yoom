import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserCapabilities,
  cameraConstraints,
  displayConstraints,
  getProvider,
  micConstraints,
  readSurface,
} from "./media-sources";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("displayConstraints", () => {
  it("asks for the requested surface at 60fps/4K", () => {
    const c = displayConstraints("window");
    expect(c.video).toMatchObject({
      displaySurface: "window",
      frameRate: { ideal: 60 },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
    });
  });

  it("always requests system audio with processing disabled", () => {
    const c = displayConstraints("monitor");
    expect(c.audio).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(c.systemAudio).toBe("include");
    expect(c.surfaceSwitching).toBe("include");
    expect(c.selfBrowserSurface).toBe("exclude");
    expect(c.preferCurrentTab).toBe(false);
  });

  it("allows the recorder's own tab to be picked for browser capture", () => {
    expect(displayConstraints("browser").selfBrowserSurface).toBe("include");
  });
});

describe("cameraConstraints / micConstraints", () => {
  it("omits deviceId when none is given", () => {
    expect(cameraConstraints()).toEqual({
      frameRate: { ideal: 60, min: 30 },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    });
    expect(micConstraints()).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it("pins the deviceId exactly when given", () => {
    expect(cameraConstraints("cam-1").deviceId).toEqual({ exact: "cam-1" });
    expect(micConstraints("mic-1").deviceId).toEqual({ exact: "mic-1" });
  });
});

describe("readSurface", () => {
  it("maps known display surfaces", () => {
    expect(readSurface({ displaySurface: "monitor" })).toBe("monitor");
    expect(readSurface({ displaySurface: "browser" })).toBe("browser");
  });

  it("falls back to unknown", () => {
    expect(readSurface({})).toBe("unknown");
    expect(readSurface({ displaySurface: "application" })).toBe("unknown");
  });
});

describe("browserCapabilities", () => {
  it("reports tab-only system audio on macOS", () => {
    expect(browserCapabilities("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140"))
      .toEqual({ systemAudio: "tab-only", nativePicker: false, surfaceHints: true });
  });

  it("reports full system audio on Windows Chrome", () => {
    expect(browserCapabilities("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140").systemAudio)
      .toBe("full");
  });

  it("reports none on Safari and Firefox", () => {
    expect(browserCapabilities("Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15").systemAudio)
      .toBe("none");
    expect(browserCapabilities("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/130").systemAudio)
      .toBe("none");
  });
});

describe("getProvider", () => {
  it("returns the browser provider when no bridge is present", () => {
    vi.stubGlobal("window", {});
    const p = getProvider();
    expect(typeof p.getDisplay).toBe("function");
    expect(p.capabilities().nativePicker).toBe(false);
  });

  it("lets the desktop bridge override individual methods", async () => {
    const getDisplay = vi.fn().mockResolvedValue({
      stream: {} as MediaStream,
      surface: "monitor",
      hasSystemAudio: true,
    });
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        isDesktop: true,
        mediaSources: { getDisplay },
        capabilities: { systemAudio: "full", nativePicker: true },
      },
      navigator: { userAgent: "Mozilla/5.0 (Macintosh) Chrome/140" },
    });

    const p = getProvider();
    await p.getDisplay("monitor");
    expect(getDisplay).toHaveBeenCalledWith("monitor");
    // Bridge capabilities are merged over the browser's, field by field.
    expect(p.capabilities()).toEqual({
      systemAudio: "full",
      nativePicker: true,
      surfaceHints: true,
    });
  });
});
