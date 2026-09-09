"use client";

import type { StagingContext } from "./types";
import * as ui from "./ui";
import { IconStrip } from "./icon-strip";
import { CameraSection } from "./sections/camera";
import { FrameSection } from "./sections/frame";
import { ZoomSection } from "./sections/zoom";
import { CursorSection } from "./sections/cursor";
import { OverlaysSection } from "./sections/overlays";
import { DetailsForm } from "./details-form";

export type RailSection =
  | "camera"
  | "frame"
  | "zoom"
  | "overlays"
  | "cursor"
  | "details";

const LABEL: Record<RailSection, string> = {
  camera: "Camera",
  frame: "Frame",
  zoom: "Zoom",
  overlays: "Overlays",
  cursor: "Cursor, input & markers",
  details: "Details",
};

export function Rail({
  ctx,
  section,
  onSection,
}: {
  ctx: StagingContext;
  section: RailSection;
  onSection: (s: RailSection) => void;
}) {
  // A camera track exists on screen+camera AND camera-only takes (camera-only
  // collapses the panel to the mirror toggle). `section` can still be
  // "camera" on a screen-only take (it is `Staging`'s initial state regardless
  // of mode), so resolve that here rather than rendering an empty panel —
  // Frame is the icon strip's first entry on a camera-less take. Keep this in
  // step with `IconStrip`'s hidden list.
  const hasCamera = ctx.mode !== "screen";
  const active: RailSection = section === "camera" && !hasCamera ? "frame" : section;

  return (
    // The rail carries its own scroll so a tall panel (Frame, Camera) never
    // grows the page: the preview and timeline stay put and only the open
    // panel scrolls. Undo/redo/discard live in the top bar. Below `lg` the
    // rail sits under the preview and scrolls with the page as normal.
    <aside className="flex gap-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
      <IconStrip ctx={ctx} section={active} onSection={onSection} />
      <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface lg:min-h-0">
        <h2 className={`shrink-0 border-b border-border px-4 py-3 ${ui.sectionHeaderTitle}`}>
          {LABEL[active]}
        </h2>
        <div className="p-4 lg:min-h-0 lg:overflow-y-auto">
          {active === "camera" && <CameraSection ctx={ctx} />}
          {active === "frame" && <FrameSection ctx={ctx} />}
          {active === "zoom" && <ZoomSection ctx={ctx} />}
          {active === "overlays" && <OverlaysSection ctx={ctx} />}
          {active === "cursor" && <CursorSection ctx={ctx} />}
          {active === "details" && <DetailsForm ctx={ctx} />}
        </div>
      </div>
    </aside>
  );
}
