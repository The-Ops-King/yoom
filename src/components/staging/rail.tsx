"use client";

import type { StagingContext } from "./types";
import * as ui from "./ui";
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

const SECTIONS: { id: RailSection; label: string }[] = [
  { id: "camera", label: "Camera" },
  { id: "frame", label: "Frame" },
  { id: "zoom", label: "Zoom" },
  { id: "overlays", label: "Overlays" },
  { id: "cursor", label: "Cursor, input & markers" },
  { id: "details", label: "Details" },
];

export function Rail({
  ctx,
  section,
  onSection,
}: {
  ctx: StagingContext;
  section: RailSection;
  onSection: (s: RailSection) => void;
}) {
  const visible = SECTIONS.filter(
    (s) => s.id !== "camera" || ctx.mode === "screen+camera",
  );

  return (
    // The rail carries its own scroll so a tall section (Frame, Camera) never
    // grows the page: the preview and timeline stay put and only the section
    // list moves. Undo/redo/discard now live in the top bar. Below `lg` the
    // rail sits under the preview and scrolls with the page as normal.
    <aside className="flex flex-col gap-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
      <div className="flex flex-col gap-2 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        {visible.map((s) => (
          <section
            key={s.id}
            className="shrink-0 rounded-lg border border-border bg-surface"
          >
            <button
              type="button"
              onClick={() => onSection(s.id)}
              aria-expanded={section === s.id}
              className={`flex w-full items-center justify-between px-3 py-2 ${ui.label} ${
                section === s.id ? "text-muted" : ""
              }`}
            >
              {s.label}
              <span aria-hidden className="text-sm leading-none">
                {section === s.id ? "–" : "+"}
              </span>
            </button>
            {section === s.id && (
              <div className="border-t border-border p-3">
                {s.id === "camera" && <CameraSection ctx={ctx} />}
                {s.id === "frame" && <FrameSection ctx={ctx} />}
                {s.id === "zoom" && <ZoomSection ctx={ctx} />}
                {s.id === "overlays" && <OverlaysSection ctx={ctx} />}
                {s.id === "cursor" && <CursorSection ctx={ctx} />}
                {s.id === "details" && <DetailsForm ctx={ctx} />}
              </div>
            )}
          </section>
        ))}
      </div>
    </aside>
  );
}
