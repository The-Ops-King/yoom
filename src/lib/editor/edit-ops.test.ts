import { describe, expect, it } from "vitest";
import { arrowRect, EMPTY_EDITS, MAX_CLICKS, MAX_CUTS, parseEdits, pointsRect } from "@/lib/edits";
import { cameraAt, defaultCameraTrack } from "./camera-track";
import * as ops from "./edit-ops";

const start = () => parseEdits(EMPTY_EDITS);

describe("edit-ops", () => {
  it("setTrim clamps into the duration and orders start/end", () => {
    const e = ops.setTrim(start(), 12, { start: -1, end: 20 });
    expect(e.trim).toEqual({ start: 0, end: 12 });
  });
  it("addCut and removeCut", () => {
    let e = ops.addCut(start(), { start: 1, end: 2 });
    e = ops.addCut(e, { start: 1.5, end: 3 });
    expect(e.cuts).toEqual([{ start: 1, end: 3 }]);
    expect(ops.removeCut(e, 0).cuts).toEqual([]);
  });
  it("addOverlay assigns step numbers and respects the cap", () => {
    let e = start();
    e = ops.addOverlay(e, { type: "step", start: 0, end: 3, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    e = ops.addOverlay(e, { type: "step", start: 0, end: 3, rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } });
    expect(e.overlays.map((o) => o.n)).toEqual([1, 2]);
    for (let i = 0; i < 70; i++) e = ops.addOverlay(e, { type: "blur", start: i, end: i + 1, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    expect(e.overlays).toHaveLength(64);
  });
  it("updateOverlay keeps end > start", () => {
    let e = ops.addOverlay(start(), { type: "blur", start: 2, end: 5, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    e = ops.updateOverlay(e, 0, { end: 1 });
    expect(e.overlays[0].end).toBeGreaterThan(e.overlays[0].start);
  });
  it("camera ops route through the track helpers", () => {
    let e = ops.setCamera(start(), defaultCameraTrack("circle", "small", 16 / 9));
    e = ops.upsertCameraKeyframe(e, 3, { mode: "full" });
    expect(e.camera?.keyframes).toHaveLength(2);
    e = ops.removeCameraKeyframe(e, 3);
    expect(e.camera?.keyframes).toHaveLength(1);
    expect(ops.setCameraOffset(e, 9999).cameraOffsetMs).toBe(5000);
  });
  it("a shape or hidden keyframe is visible at the playhead it was written at", () => {
    let e = ops.setCamera(start(), defaultCameraTrack("circle", "small", 16 / 9));
    e = ops.upsertCameraKeyframe(e, 4, { shape: "square" });
    e = ops.upsertCameraKeyframe(e, 8, { mode: "hidden" });
    expect(cameraAt(e.camera!, 4).shape).toBe("square");
    expect(cameraAt(e.camera!, 8).mode).toBe("hidden");
    // The track's default shape is untouched: it only backs keyframes that
    // carry none of their own.
    expect(e.camera?.shape).toBe("circle");
    expect(cameraAt(e.camera!, 0).shape).toBe("circle");
  });
  it("zoom ops keep the list disjoint", () => {
    let e = ops.addZoom(start(), { start: 1, end: 4, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    e = ops.addZoom(e, { start: 3, end: 6, rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } });
    expect(e.zooms.map((z) => [z.start, z.end])).toEqual([[1, 3], [3, 6]]);
    e = ops.updateZoom(e, 1, { end: 2 });
    expect(e.zooms[1].end).toBeGreaterThan(e.zooms[1].start);
    expect(ops.removeZoom(e, 0).zooms).toHaveLength(1);
  });
  it("step numbering never duplicates after a removal", () => {
    let e = start();
    e = ops.addOverlay(e, { type: "step", start: 0, end: 1, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    e = ops.addOverlay(e, { type: "step", start: 1, end: 2, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    e = ops.addOverlay(e, { type: "step", start: 2, end: 3, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    e = ops.removeOverlay(e, 1); // drops the n=2 step
    e = ops.addOverlay(e, { type: "step", start: 3, end: 4, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    expect(e.overlays.map((o) => o.n)).toEqual([1, 3, 4]);
  });

  it("addOverlay derives an arrow's rect from its endpoints", () => {
    const e = ops.addOverlay(start(), {
      type: "arrow",
      start: 0,
      end: 3,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      from: { x: 0.6, y: 0.8 },
      to: { x: 0.2, y: 0.3 },
    });
    expect(e.overlays[0].rect).toEqual(arrowRect({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 }));
  });

  it("updateOverlay moves an arrow's endpoints with its rect and re-derives the rect", () => {
    let e = ops.addOverlay(start(), {
      type: "arrow",
      start: 0,
      end: 3,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      from: { x: 0.2, y: 0.2 },
      to: { x: 0.4, y: 0.4 },
    });
    // Dragging the box translates both points by the same delta...
    e = ops.updateOverlay(e, 0, { rect: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 } });
    expect(e.overlays[0].from!.x).toBeCloseTo(0.3);
    expect(e.overlays[0].to!.y).toBeCloseTo(0.5);
    // ...and moving one endpoint re-derives the bounding box.
    e = ops.updateOverlay(e, 0, { to: { x: 0.9, y: 0.9 } });
    expect(e.overlays[0].rect).toEqual(arrowRect(e.overlays[0].from!, { x: 0.9, y: 0.9 }));
  });

  it("stops an arrow at the frame edge instead of deforming it", () => {
    let e = ops.addOverlay(start(), {
      type: "arrow",
      start: 0,
      end: 3,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      from: { x: 0.5, y: 0.5 },
      to: { x: 0.8, y: 0.6 },
    });
    // Shove the box far past the right edge: the translation is clamped, so
    // the arrow keeps its length and angle and simply stops against the wall.
    e = ops.updateOverlay(e, 0, { rect: { x: 0.9, y: 0.5, w: 0.3, h: 0.1 } });
    const { from, to } = e.overlays[0];
    expect(to!.x).toBeCloseTo(1);
    expect(to!.x - from!.x).toBeCloseTo(0.3);
    expect(to!.y - from!.y).toBeCloseTo(0.1);
  });

  it("only steps are numbered", () => {
    const e = ops.addOverlay(start(), { type: "ellipse", start: 0, end: 1, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    expect(e.overlays[0].n).toBeUndefined();
  });
  it("out-of-range removes and updates return the same reference", () => {
    const withCut = ops.addCut(start(), { start: 1, end: 2 });
    expect(ops.removeCut(withCut, 5)).toBe(withCut);
    expect(ops.removeCut(withCut, -1)).toBe(withCut);

    const withOverlay = ops.addOverlay(start(), { type: "blur", start: 0, end: 1, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    expect(ops.removeOverlay(withOverlay, 5)).toBe(withOverlay);
    expect(ops.updateOverlay(withOverlay, 5, { end: 2 })).toBe(withOverlay);

    const withZoom = ops.addZoom(start(), { start: 0, end: 1, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    expect(ops.removeZoom(withZoom, 5)).toBe(withZoom);
    expect(ops.updateZoom(withZoom, 5, { end: 2 })).toBe(withZoom);
  });
  it("a rejected addCut/addZoom span returns the same reference", () => {
    const e = start();
    expect(ops.addCut(e, { start: 2, end: 2 })).toBe(e);
    expect(ops.addZoom(e, { start: 2, end: 2, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toBe(e);
  });
  it("setTrim is a no-op (same reference) for a non-positive or NaN duration", () => {
    const e = start();
    expect(ops.setTrim(e, 0, { start: 0, end: 1 })).toBe(e);
    expect(ops.setTrim(e, NaN, { start: 0, end: 1 })).toBe(e);
    expect(ops.setTrim(e, -1, { start: 0, end: 1 })).toBe(e);
  });
  it("addOverlay and updateOverlay clamp start and rect into range", () => {
    let e = ops.addOverlay(start(), { type: "blur", start: -5, end: -4, rect: { x: 1.5, y: 0, w: 1, h: 1 } });
    expect(e.overlays[0].start).toBe(0);
    expect(e.overlays[0].end).toBeGreaterThan(e.overlays[0].start);
    expect(e.overlays[0].rect.x).toBeLessThan(1);
    e = ops.updateOverlay(e, 0, { start: -10, rect: { x: 2, y: 2, w: 1, h: 1 } });
    expect(e.overlays[0].start).toBe(0);
    expect(e.overlays[0].rect.x).toBeLessThan(1);
    expect(e.overlays[0].rect.y).toBeLessThan(1);
  });
  it("addCut cap keeps the newly added cut, dropping the oldest other cut", () => {
    let e = start();
    for (let i = 0; i < MAX_CUTS; i++) e = ops.addCut(e, { start: i * 10, end: i * 10 + 1 });
    expect(e.cuts).toHaveLength(MAX_CUTS);
    const newCut = { start: 100_000, end: 100_001 };
    e = ops.addCut(e, newCut);
    expect(e.cuts).toHaveLength(MAX_CUTS);
    expect(e.cuts.some((c) => c.start === newCut.start && c.end === newCut.end)).toBe(true);
    expect(e.cuts.some((c) => c.start === 0)).toBe(false);
  });
  it("updateZoom preserves ramp and kind when the patch doesn't override them", () => {
    let e = ops.addZoom(start(), { start: 1, end: 4, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ramp: 0.7, kind: "follow" });
    e = ops.updateZoom(e, 0, { end: 5 });
    expect(e.zooms[0].ramp).toBe(0.7);
    expect(e.zooms[0].kind).toBe("follow");
    // …and drops it when the patch does.
    expect(ops.updateZoom(e, 0, { kind: "static" }).zooms[0].kind).toBe("static");
  });
});

describe("edit-ops: zoom kind", () => {
  const zoom = { start: 1, end: 4, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, ramp: 0.7 };

  it("sets the kind while preserving every other field", () => {
    const e = ops.setZoomKind(ops.addZoom(start(), zoom), 0, "follow");
    expect(e.zooms[0]).toEqual({ ...zoom, kind: "follow" });
    expect(ops.setZoomKind(e, 0, "static").zooms[0]).toEqual({ ...zoom, kind: "static" });
  });

  it("migrates a legacy `follow` zoom rather than leaving both fields", () => {
    const legacy = ops.addZoom(start(), { ...zoom, follow: true });
    const e = ops.setZoomKind(legacy, 0, "static");
    expect(e.zooms[0].kind).toBe("static");
    expect(e.zooms[0].follow).toBeUndefined();
  });

  it("is a reference no-op for an out-of-range index or an unchanged kind", () => {
    const e = ops.setZoomKind(ops.addZoom(start(), zoom), 0, "follow");
    expect(ops.setZoomKind(e, 0, "follow")).toBe(e);
    expect(ops.setZoomKind(e, 5, "static")).toBe(e);
    expect(ops.setZoomKind(e, -1, "static")).toBe(e);
  });
});

describe("edit-ops: clicks, cursor and motion blur", () => {
  const marks = [
    { t: 3, x: 1.5, y: 0.5, on: true },
    { t: 1, x: 0.2, y: 0.2, on: true },
  ];

  it("setClicks sorts by t, clamps x/y and caps the list", () => {
    const e = ops.setClicks(start(), marks);
    expect(e.clicks).toEqual([
      { t: 1, x: 0.2, y: 0.2, on: true },
      { t: 3, x: 1, y: 0.5, on: true },
    ]);
    const many = Array.from({ length: MAX_CLICKS + 10 }, (_, i) => ({ t: i, x: 0.5, y: 0.5, on: true }));
    expect(ops.setClicks(start(), many).clicks).toHaveLength(MAX_CLICKS);
    // Writing the same list back changes nothing.
    expect(ops.setClicks(e, marks)).toBe(e);
  });

  it("toggleClick flips one mark and no-ops out of range", () => {
    const e = ops.setClicks(start(), marks);
    const t = ops.toggleClick(e, 0);
    expect(t.clicks?.map((c) => c.on)).toEqual([false, true]);
    expect(ops.toggleClick(t, 0).clicks?.map((c) => c.on)).toEqual([true, true]);
    expect(ops.toggleClick(e, 9)).toBe(e);
    const empty = start();
    expect(ops.toggleClick(empty, 0)).toBe(empty);
  });

  it("setAllClicks turns the whole lane on or off, and no-ops when it already is", () => {
    const e = ops.setClicks(start(), marks);
    const off = ops.setAllClicks(e, false);
    expect(off.clicks?.every((c) => !c.on)).toBe(true);
    expect(ops.setAllClicks(off, false)).toBe(off);
    expect(ops.setAllClicks(e, true)).toBe(e);
  });

  it("setCursor validates the style and clamps the size", () => {
    let e = ops.setCursor(start(), { style: "smooth", size: 9 });
    expect(e.cursor).toEqual({ style: "smooth", size: 2 });
    e = ops.setCursor(e, { style: "none", size: 0 });
    expect(e.cursor).toEqual({ style: "none", size: 0.5 });
    expect(ops.setCursor(e, { style: "none", size: 0.2 })).toBe(e);
  });

  it("setMotionBlur toggles the flag and no-ops when unchanged", () => {
    const e = ops.setMotionBlur(start(), false);
    expect(e.motionBlur).toBe(false);
    expect(ops.setMotionBlur(e, false)).toBe(e);
    expect(ops.setMotionBlur(e, true).motionBlur).toBe(true);
  });
});

describe("edit-ops: draw and line overlays", () => {
  const rect = { x: 0, y: 0, w: 0.5, h: 0.5 };

  it("updateOverlay re-derives a draw overlay's rect from its points", () => {
    let e = ops.addOverlay(start(), { type: "draw", start: 0, end: 2, rect });
    e = ops.updateOverlay(e, 0, { points: [{ x: 0.2, y: 0.8 }, { x: 0.6, y: 0.1 }, { x: 2, y: -1 }] });
    expect(e.overlays[0].points).toEqual([{ x: 0.2, y: 0.8 }, { x: 0.6, y: 0.1 }, { x: 1, y: 0 }]);
    expect(e.overlays[0].rect).toEqual(pointsRect(e.overlays[0].points!));
  });

  it("addOverlay derives a draw overlay's rect from its points too", () => {
    const e = ops.addOverlay(start(), {
      type: "draw",
      start: 0,
      end: 2,
      rect,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.7 }],
    });
    expect(e.overlays[0].rect).toEqual(arrowRect({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.7 }));
  });

  it("clamps a curved arrow's ctrl point", () => {
    let e = ops.addOverlay(start(), { type: "arrow", start: 0, end: 2, rect, style: "curved" });
    e = ops.updateOverlay(e, 0, { ctrl: { x: 3, y: -2 } });
    expect(e.overlays[0].ctrl).toEqual({ x: 1, y: 0 });
  });

  it("keeps a line's rect as its endpoints' bounding box", () => {
    const e = ops.addOverlay(start(), {
      type: "line",
      start: 0,
      end: 2,
      rect,
      from: { x: 0.2, y: 0.7 },
      to: { x: 0.9, y: 0.3 },
    });
    expect(e.overlays[0].rect).toEqual(arrowRect({ x: 0.2, y: 0.7 }, { x: 0.9, y: 0.3 }));
  });
});
