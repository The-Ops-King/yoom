import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserCapabilities,
  browserProvider,
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
    });
    vi.stubGlobal(
      "navigator",
      { userAgent: "Mozilla/5.0 (Macintosh) Chrome/140" },
    );

    const p = getProvider();
    await p.getDisplay("monitor");
    expect(getDisplay).toHaveBeenCalledWith("monitor");
    // Bridge capabilities are merged over the browser's, field by field.
    // The macOS Chrome UA delivers system audio only for tab captures and
    // supports surface hints — but the bridge overrides systemAudio here.
    expect(p.capabilities()).toEqual({
      systemAudio: "full",
      nativePicker: true,
      surfaceHints: true,
    });
  });

  it("ignores bridge keys explicitly set to undefined", () => {
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        isDesktop: true,
        mediaSources: { getDisplay: undefined },
      },
    });

    const p = getProvider();
    expect(p.getDisplay).toBe(browserProvider.getDisplay);
  });

  it("binds a bridge-supplied capabilities function to its own mediaSources", async () => {
    const mediaSources = {
      marker: "bridge-media-sources",
      capabilities(this: { marker: string }): ReturnType<typeof browserCapabilities> {
        // Only readable when called with `mediaSources` as `this`.
        const marker = this.marker;
        return { systemAudio: marker ? "none" : "full", nativePicker: false, surfaceHints: false };
      },
    };
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        isDesktop: true,
        mediaSources,
        capabilities: { nativePicker: true },
      },
    });

    const p = getProvider();
    const caps = p.capabilities();
    expect(caps).toEqual({ systemAudio: "none", nativePicker: true, surfaceHints: false });
  });
});

describe("getProvider surface pref", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("announces the surface pref to the shell before delegating to the page", async () => {
    const order: string[] = [];
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: "monitor" }) }],
      getAudioTracks: () => [{}],
    };
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/140",
      mediaDevices: {
        getDisplayMedia: async () => {
          order.push("getDisplayMedia");
          return stream;
        },
      },
    });
    vi.stubGlobal("window", {
      __yoomDesktop: {
        version: 1,
        isDesktop: true,
        setSurfacePref: (pref: string) => order.push(`pref:${pref}`),
        capabilities: { systemAudio: "full", nativePicker: true, surfaceHints: false },
      },
    });

    const provider = getProvider();
    const result = await provider.getDisplay("window");

    expect(order).toEqual(["pref:window", "getDisplayMedia"]);
    expect(result.surface).toBe("monitor");
    expect(result.hasSystemAudio).toBe(true);
    expect(provider.capabilities()).toMatchObject({
      systemAudio: "full",
      nativePicker: true,
      surfaceHints: false,
    });
  });

  it("leaves getDisplay untouched when the shell has no setSurfacePref", async () => {
    vi.stubGlobal("window", { __yoomDesktop: { version: 1, isDesktop: true } });
    expect(getProvider().getDisplay).toBe(browserProvider.getDisplay);
  });
});
