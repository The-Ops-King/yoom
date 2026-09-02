import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseEdits, type CameraTrack } from "@/lib/edits";
import { defaultCameraTrack } from "./camera-track";
import { drawFrame, outputSize, type RenderInputs } from "./render";

/**
 * `Path2D` only exists in a browser; `render.ts` builds clip paths with it, so
 * the node run needs a stand-in (same trick as `geometry.test.ts`).
 */
class StubPath2D {
  ops: string[] = [];
  rect() { this.ops.push("rect"); }
  roundRect() { this.ops.push("roundRect"); }
  arc() { this.ops.push("arc"); }
}
beforeAll(() => { vi.stubGlobal("Path2D", StubPath2D); });
afterAll(() => { vi.unstubAllGlobals(); });

type Call = [string, unknown[]];
function fakeCtx() {
  const calls: Call[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "calls") return calls;
      return (...args: unknown[]) => { calls.push([String(prop), args]); return undefined; };
    },
    set() { return true; },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D & { calls: Call[] };
}
const video = (w: number, h: number) => ({ videoWidth: w, videoHeight: h, readyState: 4 }) as unknown as HTMLVideoElement;

const base = parseEdits({ version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] });

describe("outputSize", () => {
  it("matches the source with framing off and pads with it on", () => {
    expect(outputSize(1920, 1080, base)).toEqual({ width: 1920, height: 1080 });
    const framed = { ...base, frame: { enabled: true, padding: 0.05, radius: 0.01, shadow: false, background: { kind: "color" as const, color: "#000" } } };
    expect(outputSize(1920, 1080, framed)).toEqual({ width: 2112, height: 1272 });
  });
});

describe("drawFrame", () => {
  const inputs = (edits = base, mode: RenderInputs["mode"] = "screen+camera"): RenderInputs => ({
    screen: video(1920, 1080), camera: video(1280, 720), mode,
    edits, background: null,
  });
  it("draws the screen, then the camera clipped, then overlays", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: defaultCameraTrack("circle", "medium", 16 / 9),
      overlays: [{ type: "blur" as const, start: 0, end: 5, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }] };
    drawFrame(ctx, inputs(e), 1, 1920, 1080);
    const names = ctx.calls.map((c) => c[0]);
    const firstDraw = names.indexOf("drawImage");
    expect(firstDraw).toBeGreaterThanOrEqual(0);
    // Screen + camera. There is no `document` in node, so the blur overlay
    // falls back to its solid fill rather than the scratch-canvas draw.
    expect(names.filter((n) => n === "drawImage").length).toBeGreaterThanOrEqual(2);
    expect(names.indexOf("clip")).toBeGreaterThan(firstDraw);
  });
  it("draws the zoomed source region when a zoom is active", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: null, zooms: [{ start: 0, end: 10, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, ramp: 0 }] };
    drawFrame(ctx, inputs(e), 5, 1920, 1080);
    const draw = ctx.calls.find((c) => c[0] === "drawImage")!;
    expect(draw[1].slice(1, 5)).toEqual([480, 270, 960, 540]);
  });
  it("skips overlays outside their span and the camera when the track is null", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: null, overlays: [{ type: "blur" as const, start: 5, end: 6, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } }] };
    drawFrame(ctx, inputs(e), 1, 1920, 1080);
    expect(ctx.calls.filter((c) => c[0] === "drawImage")).toHaveLength(1);
  });
  it("maps overlays through the active zoom", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: null,
      zooms: [{ start: 0, end: 10, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, ramp: 0 }],
      overlays: [{ type: "highlight" as const, start: 0, end: 10, rect: { x: 0.35, y: 0.35, w: 0.1, h: 0.1 } }] };
    drawFrame(ctx, inputs(e), 5, 1920, 1080);
    const names = ctx.calls.map((c) => c[0]);
    const overlayFill = names.lastIndexOf("fillRect");
    // (0.35 - 0.25) / 0.5 = 0.2 of the content box, twice the unzoomed size.
    for (const [i, want] of [384, 216, 384, 216].entries()) {
      expect(ctx.calls[overlayFill][1][i] as number).toBeCloseTo(want, 6);
    }
    // A zoom can push a mapped overlay past the frame, so it is clipped first.
    expect(names.lastIndexOf("clip", overlayFill)).toBeGreaterThan(-1);
  });
  it("cross-fades both camera modes while a mode change is settling", () => {
    const ctx = fakeCtx();
    const track: CameraTrack = { shape: "circle", mirror: false, keyframes: [
      { t: 0, mode: "bubble", rect: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 } },
      { t: 1, mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } },
    ] };
    drawFrame(ctx, inputs({ ...base, camera: track }), 1.15, 1920, 1080);
    // Screen once, then the outgoing bubble and the incoming full frame.
    expect(ctx.calls.filter((c) => c[0] === "drawImage")).toHaveLength(3);
  });
  it("draws the camera as the primary source in camera-only mode, with no bubble", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: defaultCameraTrack("circle", "medium", 16 / 9) };
    drawFrame(ctx, inputs(e, "camera"), 1, 1920, 1080);
    const draws = ctx.calls.filter((c) => c[0] === "drawImage");
    expect(draws).toHaveLength(1);
    // The 1280×720 camera is the source rect (cover-cropped), not the screen.
    expect(draws[0][1].slice(1, 5)).toEqual([0, 0, 1280, 720]);
    // Mirrored by default, and no bubble ring.
    expect(ctx.calls.some((c) => c[0] === "scale" && (c[1] as number[])[0] === -1)).toBe(true);
    expect(ctx.calls.some((c) => c[0] === "stroke")).toBe(false);
  });
  it("does not mirror a camera-only frame whose track says mirror: false", () => {
    const ctx = fakeCtx();
    const track: CameraTrack = {
      shape: "circle", mirror: false,
      keyframes: [{ t: 0, mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } }],
    };
    drawFrame(ctx, inputs({ ...base, camera: track }, "camera"), 1, 1920, 1080);
    expect(ctx.calls.filter((c) => c[0] === "drawImage")).toHaveLength(1);
    expect(ctx.calls.some((c) => c[0] === "scale" && (c[1] as number[])[0] === -1)).toBe(false);
  });
  it("covers rather than letterboxes a zoomed camera-only frame", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: null, zooms: [{ start: 0, end: 10, rect: { x: 0, y: 0, w: 0.5, h: 1 }, ramp: 0 }] };
    drawFrame(ctx, inputs(e, "camera"), 5, 1920, 1080);
    const draw = ctx.calls.find((c) => c[0] === "drawImage")!;
    // The 640×720 zoom region is cover-cropped to 16:9, not squeezed into it.
    expect(draw[1].slice(1, 5)).toEqual([0, 180, 640, 360]);
  });
});
