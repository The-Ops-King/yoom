import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseEdits, type CameraTrack } from "@/lib/edits";
import { defaultCameraTrack, upsertKeyframe } from "./camera-track";
import { drawFrame, outputSize, preloadOverlayImages, type RenderInputs } from "./render";

/**
 * `Path2D` only exists in a browser; `render.ts` builds clip paths with it, so
 * the node run needs a stand-in (same trick as `geometry.test.ts`).
 */
/** Every corner radius any `roundRect` was built with, in call order. */
const radii: number[] = [];
/** Every box any `roundRect` was built with, in call order. */
const boxes: number[][] = [];
class StubPath2D {
  ops: string[] = [];
  rect() { this.ops.push("rect"); }
  roundRect(x: number, y: number, w: number, h: number, r: number) { this.ops.push("roundRect"); radii.push(r); boxes.push([x, y, w, h]); }
  arc() { this.ops.push("arc"); }
}
beforeAll(() => { vi.stubGlobal("Path2D", StubPath2D); });
afterAll(() => { vi.unstubAllGlobals(); });

type Call = [string, unknown[]];
/** `props` holds the last value assigned to each context property (`lineWidth`, `fillStyle`, ...). */
function fakeCtx() {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "calls") return calls;
      if (prop === "props") return props;
      return (...args: unknown[]) => { calls.push([String(prop), args]); return undefined; };
    },
    set(_t, prop, value) { props[String(prop)] = value; return true; },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D & {
    calls: Call[];
    props: Record<string, unknown>;
  };
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
  it("letterboxes a zoom whose rect does not keep the source aspect", () => {
    const ctx = fakeCtx();
    // A half-width, full-height view is 960 × 1080 of source pixels: fitted
    // into the 1920 × 1080 content box it is pillarboxed to 960 wide.
    const e = { ...base, camera: null, zooms: [{ start: 0, end: 10, rect: { x: 0, y: 0, w: 0.5, h: 1 }, ramp: 0 }] };
    drawFrame(ctx, inputs(e), 5, 1920, 1080);
    const draw = ctx.calls.find((c) => c[0] === "drawImage")!;
    expect(draw[1].slice(1, 5)).toEqual([0, 0, 960, 1080]);
    expect(draw[1].slice(5, 9)).toEqual([480, 0, 960, 1080]);
  });
  it("anchors overlays to the fitted view box, not the whole content box", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: null,
      zooms: [{ start: 0, end: 10, rect: { x: 0, y: 0, w: 0.5, h: 1 }, ramp: 0 }],
      overlays: [{ type: "highlight" as const, start: 0, end: 10, rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }] };
    drawFrame(ctx, inputs(e), 5, 1920, 1080);
    const names = ctx.calls.map((c) => c[0]);
    const overlayFill = names.lastIndexOf("fillRect");
    // Mapped through the zoom to x 0.2 of the view, then into the 960-wide
    // dest box that starts at 480 — not into the full-width content box.
    for (const [i, want] of [672, 108, 192, 108].entries()) {
      expect(ctx.calls[overlayFill][1][i] as number).toBeCloseTo(want, 6);
    }
  });
  it("shows the frame background, not black, in a framed letterbox", () => {
    const framed = { ...base, camera: null,
      frame: { enabled: true, padding: 0.05, radius: 0.01, shadow: false, background: { kind: "color" as const, color: "#0f0" } },
      zooms: [{ start: 0, end: 10, rect: { x: 0, y: 0, w: 0.5, h: 1 }, ramp: 0 }] };
    const ctx = fakeCtx();
    drawFrame(ctx, inputs(framed), 5, 2112, 1272);
    // Nothing paints black over the pillars: the only fill is the wallpaper
    // itself, and the clip hugs the fitted picture so the letterbox stays it.
    const fills = ctx.calls.filter((c) => c[0] === "fillRect");
    expect(fills).toHaveLength(1);
    expect(ctx.calls.filter((c) => c[0] === "fillStyle")).toHaveLength(0);
  });
  it("hugs the drop shadow to the picture, not the whole content box, when zoomed", () => {
    // A 0.4-wide view: geometry no other test builds, so the module-level
    // frame-path cache cannot hand back a path recorded before this test.
    const framed = { ...base, camera: null,
      frame: { enabled: true, padding: 0.05, radius: 0.01, shadow: true, background: { kind: "color" as const, color: "#0f0" } },
      zooms: [{ start: 0, end: 10, rect: { x: 0, y: 0, w: 0.4, h: 1 }, ramp: 0 }] };
    boxes.length = 0;
    drawFrame(fakeCtx(), inputs(framed), 5, 2112, 1272);
    // At 2112×1272 the content box is exactly the padded 1920×1080 at (96,96);
    // a 0.4-wide view fits as 768×1080 centred in it, so the shadow (and the
    // clip) are built around that fitted box — nothing spans the full 1920.
    expect(boxes.some(([x, , w]) => Math.abs(x - 672) < 1 && Math.abs(w - 768) < 1)).toBe(true);
    expect(boxes.some(([, , w]) => Math.abs(w - 1920) < 1)).toBe(false);
  });
  it("cross-fades both camera modes while a mode change is settling", () => {
    const ctx = fakeCtx();
    const track: CameraTrack = { shape: "circle", mirror: false, keyframes: [
      { t: 0, mode: "bubble", rect: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 } },
      { t: 1, mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } },
    ] };
    // Keyframes settle AT their `t`, so the cross-fade is the window before it.
    drawFrame(ctx, inputs({ ...base, camera: track }), 0.85, 1920, 1080);
    // Screen once, then the outgoing bubble and the incoming full frame.
    expect(ctx.calls.filter((c) => c[0] === "drawImage")).toHaveLength(3);
    // ...and by the keyframe's own `t` only the full-screen camera is drawn.
    const settled = fakeCtx();
    drawFrame(settled, inputs({ ...base, camera: track }), 1, 1920, 1080);
    expect(settled.calls.filter((c) => c[0] === "drawImage")).toHaveLength(2);
  });
  it("draws no camera at all once a hidden keyframe has settled", () => {
    const track: CameraTrack = { shape: "circle", mirror: false, keyframes: [
      { t: 0, mode: "bubble", rect: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 } },
      { t: 1, mode: "hidden", rect: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 } },
    ] };
    const hidden = fakeCtx();
    drawFrame(hidden, inputs({ ...base, camera: track }), 1, 1920, 1080);
    expect(hidden.calls.filter((c) => c[0] === "drawImage")).toHaveLength(1); // screen only
    // Mid-fade the outgoing bubble is still drawn (once), so hiding is a fade.
    const fading = fakeCtx();
    drawFrame(fading, inputs({ ...base, camera: track }), 0.85, 1920, 1080);
    expect(fading.calls.filter((c) => c[0] === "drawImage")).toHaveLength(2);
  });
  it("morphs the bubble radius between a keyframe's shape and the track default", () => {
    const rect = { x: 0.7, y: 0.7, w: 0.2, h: 0.2 };
    const track: CameraTrack = { shape: "circle", mirror: false, keyframes: [
      { t: 0, mode: "bubble", rect },
      { t: 2, mode: "bubble", rect, shape: "square" },
    ] };
    const e = { ...base, camera: track };
    // The box is 0.2 × 1080 = 216 px tall: a circle clips at 108, a square at
    // 4% of the short side = 8.64, and mid-morph lands strictly between.
    const radiusAt = (t: number) => {
      radii.length = 0;
      drawFrame(fakeCtx(), inputs(e), t, 1920, 1080);
      return radii[0];
    };
    expect(radiusAt(0)).toBeCloseTo(108);
    expect(radiusAt(2)).toBeCloseTo(8.64);
    const mid = radiusAt(2 - 0.15);
    expect(mid).toBeGreaterThan(8.64);
    expect(mid).toBeLessThan(108);
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

  /** The camera's source rect from the nth `drawImage` of this frame. */
  const cropOf = (ctx: ReturnType<typeof fakeCtx>, n: number) =>
    ctx.calls.filter((c) => c[0] === "drawImage")[n][1].slice(1, 5);

  it("cover-crops the bubble at the sample's pan", () => {
    // The 1280×720 camera in a square bubble leaves 1280 - 720 = 560 px of
    // horizontal slack; pan.x picks where in that slack the window sits.
    const panned = (x: number) => {
      const ctx = fakeCtx();
      const track = upsertKeyframe(defaultCameraTrack("circle", "medium", 16 / 9), 0, { pan: { x, y: 0.5 } });
      drawFrame(ctx, inputs({ ...base, camera: track }), 0, 1920, 1080);
      return cropOf(ctx, 1)[0]; // [0] is the screen, [1] the bubble
    };
    expect(panned(0)).toBe(0);
    expect(panned(0.5)).toBe(280);
    expect(panned(1)).toBe(560);
  });

  it("leaves the bubble centred when no keyframe carries a pan", () => {
    const ctx = fakeCtx();
    const e = { ...base, camera: defaultCameraTrack("circle", "medium", 16 / 9) };
    drawFrame(ctx, inputs(e), 0, 1920, 1080);
    expect(cropOf(ctx, 1)[0]).toBe(280);
  });

  it("pans a camera-only primary draw too", () => {
    // Zoomed to a 640×720 region and covered into 16:9: 360 px of vertical slack.
    const panned = (y: number) => {
      const ctx = fakeCtx();
      const track = upsertKeyframe(
        { shape: "circle", mirror: true, keyframes: [{ t: 0, mode: "full", rect: { x: 0, y: 0, w: 1, h: 1 } }] } as CameraTrack,
        0,
        { pan: { x: 0.5, y } },
      );
      const e = { ...base, camera: track, zooms: [{ start: 0, end: 10, rect: { x: 0, y: 0, w: 0.5, h: 1 }, ramp: 0 }] };
      drawFrame(ctx, inputs(e, "camera"), 5, 1920, 1080);
      return cropOf(ctx, 0)[1];
    };
    expect(panned(0)).toBe(0);
    expect(panned(0.5)).toBe(180);
    expect(panned(1)).toBe(360);
  });
});

describe("drawOverlay", () => {
  const src = video(1920, 1080);
  const inputs = (overlays: RenderInputs["edits"]["overlays"]): RenderInputs => ({
    screen: src, camera: null, mode: "screen",
    edits: { ...base, camera: null, overlays }, background: null,
  });
  /** Args of the last call to `name`, or undefined. */
  const last = (ctx: ReturnType<typeof fakeCtx>, name: string) =>
    [...ctx.calls].reverse().find((c) => c[0] === name)?.[1];

  it("strokes an ellipse inscribed in the rect", () => {
    const ctx = fakeCtx();
    drawFrame(ctx, inputs([{ type: "ellipse", start: 0, end: 5, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }]), 1, 1920, 1080);
    const e = last(ctx, "ellipse") as number[];
    // Centre of a half-size centred rect, with the rect's half-extents as radii.
    expect(e.slice(0, 4)).toEqual([960, 540, 480, 270]);
    expect(ctx.calls.some((c) => c[0] === "stroke")).toBe(true);
  });

  it("draws a step as a filled badge with its number", () => {
    const ctx = fakeCtx();
    drawFrame(ctx, inputs([{ type: "step", start: 0, end: 5, rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.1 }, n: 3 }]), 1, 1920, 1080);
    // The badge is a circle of diameter min(w, h) = 0.1 × 1080 = 108.
    const arc = last(ctx, "arc") as number[];
    expect(arc[2]).toBeCloseTo(54);
    expect(last(ctx, "fillText")?.[0]).toBe("3");
  });

  it("draws an arrow from `from` to `to` with a filled head", () => {
    const ctx = fakeCtx();
    drawFrame(
      ctx,
      inputs([{ type: "arrow", start: 0, end: 5, rect: { x: 0.2, y: 0.5, w: 0.6, h: 0.001 }, from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } }]),
      1,
      1920,
      1080,
    );
    const moves = ctx.calls.filter((c) => c[0] === "moveTo").map((c) => c[1] as number[]);
    // The shaft starts at `from`, and the head's first point is the tip at `to`.
    expect(moves[0]).toEqual([384, 540]);
    expect(moves[1]).toEqual([1536, 540]);
    expect(ctx.calls.some((c) => c[0] === "fill")).toBe(true);
  });

  it("maps an arrow's endpoints through the active zoom", () => {
    const ctx = fakeCtx();
    const e = {
      ...base, camera: null,
      zooms: [{ start: 0, end: 10, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, ramp: 0 }],
      overlays: [{ type: "arrow" as const, start: 0, end: 10, rect: { x: 0.35, y: 0.35, w: 0.1, h: 0.1 }, from: { x: 0.35, y: 0.35 }, to: { x: 0.45, y: 0.45 } }],
    };
    drawFrame(ctx, { screen: src, camera: null, mode: "screen", edits: e, background: null }, 5, 1920, 1080);
    // (0.35 - 0.25) / 0.5 = 0.2 of the content box.
    expect((ctx.calls.filter((c) => c[0] === "moveTo")[0][1] as number[])[0]).toBeCloseTo(384, 6);
  });

  it("fills a blackout opaquely in its own near-black, not the shared accent", () => {
    const ctx = fakeCtx();
    drawFrame(ctx, inputs([{ type: "blackout", start: 0, end: 5, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]), 1, 1920, 1080);
    expect(last(ctx, "fillRect")).toEqual([192, 108, 384, 216]);
    expect(ctx.props.fillStyle).toBe("#0b0b0d");
    expect(ctx.props.globalAlpha).toBe(1);
  });

  it("strokes a rect by default and fills it translucently when `fill` is set", () => {
    const outline = fakeCtx();
    const r = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    drawFrame(outline, inputs([{ type: "rect", start: 0, end: 5, rect: r }]), 1, 1920, 1080);
    expect(last(outline, "strokeRect")).toEqual([480, 270, 960, 540]);
    expect(outline.calls.some((c) => c[0] === "fillRect" && (c[1] as number[])[2] === 960)).toBe(false);

    const filled = fakeCtx();
    drawFrame(filled, inputs([{ type: "rect", start: 0, end: 5, rect: r, fill: true, opacity: 0.4 }]), 1, 1920, 1080);
    expect(last(filled, "fillRect")).toEqual([480, 270, 960, 540]);
    expect(filled.props.globalAlpha).toBe(0.4);
    expect(filled.calls.some((c) => c[0] === "strokeRect")).toBe(false);
  });

  it("draws a line end to end with no head", () => {
    const ctx = fakeCtx();
    drawFrame(
      ctx,
      inputs([{ type: "line", start: 0, end: 5, rect: { x: 0.2, y: 0.3, w: 0.6, h: 0.4 }, from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.7 }, thickness: 0.01 }]),
      1,
      1920,
      1080,
    );
    expect(last(ctx, "moveTo")).toEqual([384, 324]);
    expect(last(ctx, "lineTo")).toEqual([1536, 756]);
    expect(ctx.props.lineWidth).toBeCloseTo(10.8);
    // No head: a line never fills.
    expect(ctx.calls.some((c) => c[0] === "fill")).toBe(false);
  });

  describe("arrow styles", () => {
    const arrow = (style: "standard" | "double" | "curved" | "fancy", extra: Record<string, unknown> = {}) => {
      const ctx = fakeCtx();
      drawFrame(
        ctx,
        inputs([{ type: "arrow", start: 0, end: 5, rect: { x: 0.2, y: 0.5, w: 0.6, h: 0.001 }, from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, style, ...extra }]),
        1,
        1920,
        1080,
      );
      return ctx;
    };

    it("puts a head on both ends of a `double` and pulls the shaft back off each", () => {
      const ctx = arrow("double");
      const moves = ctx.calls.filter((c) => c[0] === "moveTo").map((c) => c[1] as number[]);
      // Shaft, then the head at `to`, then the head back at `from`.
      expect(moves).toHaveLength(3);
      expect(moves[1]).toEqual([1536, 540]);
      expect(moves[2]).toEqual([384, 540]);
      expect(ctx.calls.filter((c) => c[0] === "fill")).toHaveLength(2);
      // The shaft no longer starts on the tail point — it clears the head.
      expect(moves[0][0]).toBeGreaterThan(384);
      expect(moves[0][0]).toBeLessThan(1536);
    });

    it("bows a `curved` arrow through the midpoint perpendicular when it has no ctrl", () => {
      const q = arrow("curved").calls.find((c) => c[0] === "quadraticCurveTo")![1] as number[];
      // Midpoint (960, 540) pushed 15 % of the 1152 px length along +y.
      expect(q[0]).toBeCloseTo(960);
      expect(q[1]).toBeCloseTo(540 + 1152 * 0.15);
    });

    it("bends a `curved` arrow through its own ctrl when it has one", () => {
      const q = arrow("curved", { ctrl: { x: 0.5, y: 0.2 } }).calls.find((c) => c[0] === "quadraticCurveTo")![1] as number[];
      expect(q.slice(0, 2)).toEqual([960, 216]);
    });

    it("draws a `fancy` arrow as a filled tapered body with no stroked shaft", () => {
      const ctx = arrow("fancy", { thickness: 0.01 });
      expect(ctx.calls.some((c) => c[0] === "stroke")).toBe(false);
      // The body quad plus the head.
      expect(ctx.calls.filter((c) => c[0] === "fill")).toHaveLength(2);
      const moves = ctx.calls.filter((c) => c[0] === "moveTo").map((c) => c[1] as number[]);
      // Thick at the tail: half a stroke width either side of `from`.
      expect(moves[0][1]).toBeCloseTo(540 + 10.8);
    });
  });

  it("wraps text inside the rect and plates it when a bg is set", () => {
    const wide = fakeCtx();
    drawFrame(wide, inputs([{ type: "text", start: 0, end: 5, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 }, text: "hello world" }]), 1, 1920, 1080);
    const lines = wide.calls.filter((c) => c[0] === "fillText").map((c) => c[1] as [string, number, number]);
    expect(lines.map((l) => l[0])).toEqual(["hello world"]);
    // 0.05 of the 1080-tall frame, padded by 0.35 of that inside the rect.
    expect(String(wide.props.font).startsWith("54px ")).toBe(true);
    expect(lines[0][1]).toBeCloseTo(192 + 54 * 0.35);
    // No bg: nothing is plated behind it.
    expect(wide.calls.some((c) => c[0] === "fill")).toBe(false);

    const narrow = fakeCtx();
    drawFrame(
      narrow,
      inputs([{ type: "text", start: 0, end: 5, rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.2 }, text: "hello world", bg: "#000" }]),
      1,
      1920,
      1080,
    );
    const wrapped = narrow.calls.filter((c) => c[0] === "fillText").map((c) => (c[1] as string[])[0]);
    expect(wrapped).toEqual(["hello", "world"]);
    // The plate is one filled rounded path behind the two lines.
    expect(narrow.calls.filter((c) => c[0] === "fill")).toHaveLength(1);
  });

  it("honours an explicit text size and keeps the string's own newlines", () => {
    const ctx = fakeCtx();
    drawFrame(
      ctx,
      inputs([{ type: "text", start: 0, end: 5, rect: { x: 0, y: 0, w: 0.8, h: 0.3 }, text: "one\ntwo", size: 0.1 }]),
      1,
      1920,
      1080,
    );
    const lines = ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1] as [string, number, number]);
    expect(lines.map((l) => l[0])).toEqual(["one", "two"]);
    // 0.1 × 1080 = 108 px, one line box (1.25 ×) apart.
    expect(String(ctx.props.font).startsWith("108px ")).toBe(true);
    expect(lines[1][2] - lines[0][2]).toBeCloseTo(108 * 1.25);
  });

  it("scales text with the zoom, so a caption grows with the box it sits in", () => {
    const at = (zooms: RenderInputs["edits"]["zooms"]) => {
      const ctx = fakeCtx();
      const e = { ...base, camera: null, zooms,
        overlays: [{ type: "text" as const, start: 0, end: 10, rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.2 }, text: "hi" }] };
      drawFrame(ctx, { screen: src, camera: null, mode: "screen", edits: e, background: null }, 5, 1920, 1080);
      return Number(String(ctx.props.font).split("px")[0]);
    };
    // 0.05 of the 1080-tall frame unzoomed; a half-height view magnifies the
    // box 2×, and the type in it has to follow or the caption shrinks inside
    // its own plate. The VERTICAL magnification is what sizes it: a view that
    // is half as wide but full height leaves it alone.
    expect(at([])).toBeCloseTo(54);
    expect(at([{ start: 0, end: 10, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, ramp: 0 }])).toBeCloseTo(108);
    expect(at([{ start: 0, end: 10, rect: { x: 0, y: 0, w: 0.5, h: 1 }, ramp: 0 }])).toBeCloseTo(54);
  });

  it("reuses one mapped path array across frames while the zoom is held", () => {
    const overlay = { type: "draw" as const, start: 0, end: 10, rect: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, points: [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }, { x: 0.5, y: 0.5 }] };
    const e = { ...base, camera: null, zooms: [{ start: 0, end: 10, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, ramp: 0 }], overlays: [overlay] };
    const path = (ctx: ReturnType<typeof fakeCtx>) =>
      ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "quadraticCurveTo" || c[0] === "lineTo").map((c) => c[1]);
    const a = fakeCtx();
    const b = fakeCtx();
    drawFrame(a, { screen: src, camera: null, mode: "screen", edits: e, background: null }, 5, 1920, 1080);
    drawFrame(b, { screen: src, camera: null, mode: "screen", edits: e, background: null }, 6, 1920, 1080);
    // Same overlay, same held view: the second frame draws the identical path.
    expect(path(b)).toEqual(path(a));
    // And a different view re-maps it rather than serving the stale one.
    const moved = fakeCtx();
    drawFrame(
      moved,
      { screen: src, camera: null, mode: "screen", edits: { ...e, zooms: [{ start: 0, end: 10, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, ramp: 0 }] }, background: null },
      5,
      1920,
      1080,
    );
    expect(path(moved)).not.toEqual(path(a));
  });

  it("draws an emoji centred in its rect at the rect's height", () => {
    const ctx = fakeCtx();
    drawFrame(ctx, inputs([{ type: "emoji", start: 0, end: 5, rect: { x: 0.4, y: 0.45, w: 0.1, h: 0.1 }, text: "🔥" }]), 1, 1920, 1080);
    expect(last(ctx, "fillText")).toEqual(["🔥", 864, 540]);
    expect(String(ctx.props.font).startsWith("108px ")).toBe(true);
    expect(ctx.props.textAlign).toBe("center");
    expect(ctx.props.textBaseline).toBe("middle");
  });

  it("smooths a freehand stroke through its points and needs at least two", () => {
    const three = fakeCtx();
    drawFrame(
      three,
      inputs([{ type: "draw", start: 0, end: 5, rect: { x: 0, y: 0, w: 1, h: 1 }, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }] }]),
      1,
      1920,
      1080,
    );
    expect(last(three, "moveTo")).toEqual([0, 0]);
    // Curve THROUGH the middle sample to the midpoint of the next segment.
    expect(last(three, "quadraticCurveTo")).toEqual([960, 540, 1440, 810]);
    expect(last(three, "lineTo")).toEqual([1920, 1080]);
    expect(three.calls.some((c) => c[0] === "stroke")).toBe(true);

    const one = fakeCtx();
    drawFrame(one, inputs([{ type: "draw", start: 0, end: 5, rect: { x: 0, y: 0, w: 0.1, h: 0.1 }, points: [{ x: 0, y: 0 }] }]), 1, 1920, 1080);
    expect(one.calls.some((c) => c[0] === "stroke")).toBe(false);
  });

  it("maps a freehand stroke's points through the active zoom", () => {
    const ctx = fakeCtx();
    const e = {
      ...base, camera: null,
      zooms: [{ start: 0, end: 10, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, ramp: 0 }],
      overlays: [{ type: "draw" as const, start: 0, end: 10, rect: { x: 0.35, y: 0.35, w: 0.1, h: 0.1 }, points: [{ x: 0.35, y: 0.35 }, { x: 0.45, y: 0.45 }] }],
    };
    drawFrame(ctx, { screen: src, camera: null, mode: "screen", edits: e, background: null }, 5, 1920, 1080);
    // (0.35 - 0.25) / 0.5 = 0.2 of the content box.
    expect((last(ctx, "moveTo") as number[])[0]).toBeCloseTo(384, 6);
  });

  it("skips an image until it is decoded, then draws it contain-fitted", async () => {
    const loaded: StubImage[] = [];
    class StubImage {
      complete = false;
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      #src = "";
      constructor() { loaded.push(this); }
      get src() { return this.#src; }
      set src(v: string) {
        this.#src = v;
        queueMicrotask(() => {
          this.complete = true;
          this.naturalWidth = 200;
          this.naturalHeight = 100;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("Image", StubImage);
    const overlays = [{ type: "image" as const, start: 0, end: 5, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, src: "blob:test-1" }];

    // First frame: the decode has only just been kicked off, so nothing is drawn.
    const cold = fakeCtx();
    drawFrame(cold, inputs(overlays), 1, 1920, 1080);
    expect(cold.calls.filter((c) => c[0] === "drawImage")).toHaveLength(1); // the screen only

    await preloadOverlayImages({ ...base, overlays });
    const warm = fakeCtx();
    drawFrame(warm, inputs(overlays), 1, 1920, 1080);
    const draws = warm.calls.filter((c) => c[0] === "drawImage");
    expect(draws).toHaveLength(2);
    // 960 × 540 box, 2:1 image → 960 × 480, centred vertically.
    expect((draws[1][1] as unknown[]).slice(1)).toEqual([480, 300, 960, 480]);
    // The element is decoded once and reused across frames.
    expect(loaded).toHaveLength(1);
    vi.stubGlobal("Image", undefined);
  });
});

describe("overlay stroke width", () => {
  const src = video(1920, 1080);
  const ellipse = { type: "ellipse" as const, start: 0, end: 10, rect: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, thickness: 0.01 };
  const draw = (zooms: NonNullable<RenderInputs["edits"]["zooms"]>) => {
    const ctx = fakeCtx();
    drawFrame(
      ctx,
      { screen: src, camera: null, mode: "screen", edits: { ...base, camera: null, zooms, overlays: [ellipse] }, background: null },
      5,
      1920,
      1080,
    );
    return ctx.props.lineWidth as number;
  };

  it("is the same under a free-aspect zoom as it is unzoomed", () => {
    // 0.01 of the 1080-tall content box. The zoom below fits a 2.5:1 region
    // into that box, letterboxing it to 432 px tall — sizing the stroke off
    // the fitted box rather than the frame would thin it out 2.5×.
    expect(draw([])).toBeCloseTo(10.8);
    expect(draw([{ start: 0, end: 10, rect: { x: 0.2, y: 0.4, w: 0.5, h: 0.2 }, ramp: 0 }])).toBeCloseTo(10.8);
  });
});

describe("preloadOverlayImages", () => {
  it("resolves for an image that has already failed to load", async () => {
    // `complete` with a zero natural size is how a FAILED image looks; its
    // load/error events have long since fired, so waiting on them would hang.
    class DeadImage {
      complete = true;
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
    }
    vi.stubGlobal("Image", DeadImage);
    const overlays = [{ type: "image" as const, start: 0, end: 5, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, src: "blob:dead-1" }];
    const settled = await Promise.race([
      preloadOverlayImages({ ...base, overlays }).then(() => "done"),
      new Promise((r) => setTimeout(() => r("hung"), 50)),
    ]);
    expect(settled).toBe("done");
    vi.stubGlobal("Image", undefined);
  });
});

/**
 * Motion blur is composited, so what matters is the alpha AT each draw — the
 * shared `fakeCtx` only keeps the last value assigned to a property, hence a
 * local context that snapshots `globalAlpha` on every `drawImage`.
 */
describe("drawFrame motion blur", () => {
  function alphaCtx() {
    const draws: number[] = [];
    const clips: string[] = [];
    let alpha = 1;
    const target = {
      get globalAlpha() { return alpha; },
      set globalAlpha(v: number) { alpha = v; },
      drawImage: () => { draws.push(alpha); },
      clip: () => { clips.push("clip"); },
    };
    const handler: ProxyHandler<typeof target> = {
      get(t, prop) {
        if (prop === "draws") return draws;
        if (prop === "clips") return clips;
        if (prop === "globalAlpha") return t.globalAlpha;
        if (prop === "drawImage") return t.drawImage;
        if (prop === "clip") return t.clip;
        return () => undefined;
      },
      set(t, prop, value) {
        if (prop === "globalAlpha") t.globalAlpha = value as number;
        return true;
      },
    };
    return new Proxy(target, handler) as unknown as CanvasRenderingContext2D & {
      draws: number[];
      clips: string[];
    };
  }

  /** Mid ease-in, so the view's centre really is travelling at t = 0.7. */
  const moving = {
    ...base,
    zooms: [{ start: 0.5, end: 3, rect: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, ramp: 0.4 }],
  };
  /** Where `moving` is halfway through its ramp. */
  const T = 0.7;
  const inputs = (edits: typeof base): RenderInputs => ({
    screen: video(1920, 1080), camera: null, mode: "screen", edits, background: null,
  });

  it("draws the source once when nothing is moving", () => {
    const ctx = alphaCtx();
    drawFrame(ctx, inputs(base), T, 1920, 1080);
    expect(ctx.draws).toEqual([1]);
  });

  it("draws three taps at 1, 1/2, 1/3 while the view travels", () => {
    const ctx = alphaCtx();
    drawFrame(ctx, inputs(moving), T, 1920, 1080);
    expect(ctx.draws).toEqual([1, 0.5, 1 / 3]);
  });

  it("clips the taps so a ghost cannot spill out of the picture", () => {
    const ctx = alphaCtx();
    drawFrame(ctx, inputs(moving), T, 1920, 1080);
    expect(ctx.clips.length).toBeGreaterThan(0);
  });

  it("honours `motionBlur: false`", () => {
    const ctx = alphaCtx();
    drawFrame(ctx, inputs({ ...moving, motionBlur: false }), T, 1920, 1080);
    expect(ctx.draws).toEqual([1]);
  });
});
