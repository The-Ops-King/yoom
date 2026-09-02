import { describe, expect, it } from "vitest";
import { EMPTY_EDITS, parseEdits } from "@/lib/edits";
import { defaultCameraTrack } from "./camera-track";
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
  it("addOverlay assigns callout numbers and respects the cap", () => {
    let e = start();
    e = ops.addOverlay(e, { type: "callout", start: 0, end: 3, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    e = ops.addOverlay(e, { type: "callout", start: 0, end: 3, rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } });
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
  it("zoom ops keep the list disjoint", () => {
    let e = ops.addZoom(start(), { start: 1, end: 4, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    e = ops.addZoom(e, { start: 3, end: 6, rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } });
    expect(e.zooms.map((z) => [z.start, z.end])).toEqual([[1, 3], [3, 6]]);
    e = ops.updateZoom(e, 1, { end: 2 });
    expect(e.zooms[1].end).toBeGreaterThan(e.zooms[1].start);
    expect(ops.removeZoom(e, 0).zooms).toHaveLength(1);
  });
});
