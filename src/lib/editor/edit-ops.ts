import { MAX_CAMERA_OFFSET_MS, MAX_CUTS, MAX_OVERLAYS, type CameraKeyframe, type CameraTrack, type Cut, type Overlay, type VideoEdits, type Zoom } from "@/lib/edits";
import { insertZoom } from "./zoom";
import type { FrameConfig } from "@/lib/recording/types";
import { addCut as mergeCut } from "./cuts";
import { removeKeyframe, upsertKeyframe } from "./camera-track";

const MIN_SPAN = 0.1;

export function setTrim(e: VideoEdits, duration: number, trim: { start: number; end: number }): VideoEdits {
  const start = Math.max(0, Math.min(duration, Math.min(trim.start, trim.end)));
  const end = Math.max(start + MIN_SPAN, Math.min(duration, Math.max(trim.start, trim.end)));
  return { ...e, trim: { start, end: Math.min(duration, end) } };
}

export const addCut = (e: VideoEdits, cut: Cut): VideoEdits => ({ ...e, cuts: mergeCut(e.cuts, cut).slice(0, MAX_CUTS) });
export const removeCut = (e: VideoEdits, index: number): VideoEdits => ({ ...e, cuts: e.cuts.filter((_, i) => i !== index) });

export function addOverlay(e: VideoEdits, overlay: Overlay): VideoEdits {
  if (e.overlays.length >= MAX_OVERLAYS) return e;
  const next = { ...overlay };
  if (next.type === "callout" && next.n === undefined) {
    next.n = e.overlays.filter((o) => o.type === "callout").length + 1;
  }
  return { ...e, overlays: [...e.overlays, next] };
}

export function updateOverlay(e: VideoEdits, index: number, patch: Partial<Overlay>): VideoEdits {
  return {
    ...e,
    overlays: e.overlays.map((o, i) => {
      if (i !== index) return o;
      const merged = { ...o, ...patch };
      if (merged.end <= merged.start) merged.end = merged.start + MIN_SPAN;
      return merged;
    }),
  };
}

export const removeOverlay = (e: VideoEdits, index: number): VideoEdits => ({ ...e, overlays: e.overlays.filter((_, i) => i !== index) });
export const setFrame = (e: VideoEdits, frame: FrameConfig): VideoEdits => ({ ...e, frame });
export const setCamera = (e: VideoEdits, camera: CameraTrack | null): VideoEdits => ({ ...e, camera });

export function upsertCameraKeyframe(e: VideoEdits, t: number, patch: Partial<Omit<CameraKeyframe, "t">>): VideoEdits {
  return e.camera ? { ...e, camera: upsertKeyframe(e.camera, t, patch) } : e;
}
export function removeCameraKeyframe(e: VideoEdits, t: number): VideoEdits {
  return e.camera ? { ...e, camera: removeKeyframe(e.camera, t) } : e;
}
export const setCameraOffset = (e: VideoEdits, ms: number): VideoEdits => ({
  ...e,
  cameraOffsetMs: Math.max(-MAX_CAMERA_OFFSET_MS, Math.min(MAX_CAMERA_OFFSET_MS, Math.round(ms))),
});

export const addZoom = (e: VideoEdits, zoom: Zoom): VideoEdits => ({ ...e, zooms: insertZoom(e.zooms, zoom) });
export const removeZoom = (e: VideoEdits, index: number): VideoEdits => ({ ...e, zooms: e.zooms.filter((_, i) => i !== index) });
export function updateZoom(e: VideoEdits, index: number, patch: Partial<Zoom>): VideoEdits {
  const cur = e.zooms[index];
  if (!cur) return e;
  const next = { ...cur, ...patch };
  if (next.end <= next.start) next.end = next.start + MIN_SPAN;
  return { ...e, zooms: insertZoom(e.zooms.filter((_, i) => i !== index), next) };
}
