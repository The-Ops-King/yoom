"use client";

import type { StagingContext } from "./types";
import { TrimSection } from "./sections/trim";
import { CameraSection } from "./sections/camera";
import { FrameSection } from "./sections/frame";
import { ZoomSection } from "./sections/zoom";
import { OverlaysSection } from "./sections/overlays";
import { DetailsForm } from "./details-form";
import { UploadSection } from "./sections/upload";

export type RailSection = "trim" | "camera" | "frame" | "zoom" | "overlays" | "details" | "upload";

const SECTIONS: { id: RailSection; label: string }[] = [
  { id: "trim", label: "Trim & cut" },
  { id: "camera", label: "Camera" },
  { id: "frame", label: "Frame" },
  { id: "zoom", label: "Zoom" },
  { id: "overlays", label: "Overlays" },
  { id: "details", label: "Details" },
  { id: "upload", label: "Upload" },
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
  return (
    <aside className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!ctx.canUndo}
            onClick={ctx.undo}
            className="rounded px-2 py-1 text-xs text-muted disabled:opacity-30"
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!ctx.canRedo}
            onClick={ctx.redo}
            className="rounded px-2 py-1 text-xs text-muted disabled:opacity-30"
          >
            Redo
          </button>
        </div>
        <button type="button" onClick={ctx.discard} className="text-xs text-red-400/80 hover:text-red-300">
          Discard
        </button>
      </div>

      {SECTIONS.filter((s) => s.id !== "camera" || ctx.mode === "screen+camera").map((s) => (
        <section key={s.id} className="rounded-lg border border-border bg-surface">
          <button
            type="button"
            onClick={() => onSection(s.id)}
            aria-expanded={section === s.id}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-dim"
          >
            {s.label}
            <span aria-hidden>{section === s.id ? "–" : "+"}</span>
          </button>
          {section === s.id && (
            <div className="border-t border-border p-3">
              {s.id === "trim" && <TrimSection ctx={ctx} />}
              {s.id === "camera" && <CameraSection ctx={ctx} />}
              {s.id === "frame" && <FrameSection ctx={ctx} />}
              {s.id === "zoom" && <ZoomSection ctx={ctx} />}
              {s.id === "overlays" && <OverlaysSection ctx={ctx} />}
              {s.id === "details" && <DetailsForm ctx={ctx} />}
              {s.id === "upload" && <UploadSection ctx={ctx} />}
            </div>
          )}
        </section>
      ))}
    </aside>
  );
}
