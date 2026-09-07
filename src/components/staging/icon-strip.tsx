"use client";

import type { StagingContext } from "./types";
import type { RailSection } from "./rail";

/**
 * One plain glyph per panel — this project has no icon dependency, so these
 * are text characters, not an icon font. Each still carries its real name in
 * `title`/`aria-label`, since the glyph alone is not self-explanatory.
 */
const ICONS: { id: RailSection; glyph: string; label: string }[] = [
  { id: "camera", glyph: "◉", label: "Camera" },
  { id: "frame", glyph: "▢", label: "Frame" },
  { id: "zoom", glyph: "⊕", label: "Zoom" },
  { id: "overlays", glyph: "▦", label: "Overlays" },
  { id: "cursor", glyph: "➤", label: "Cursor, input & markers" },
  { id: "details", glyph: "≡", label: "Details" },
];

/**
 * The rail's vertical strip of panel buttons — one 34px square per
 * `RailSection`. `section` is the panel currently shown (already resolved by
 * `Rail` for the camera fallback), so the active button here always matches
 * the open panel.
 */
export function IconStrip({
  ctx,
  section,
  onSection,
}: {
  ctx: StagingContext;
  section: RailSection;
  onSection: (s: RailSection) => void;
}) {
  const visible = ICONS.filter((i) => i.id !== "camera" || ctx.mode === "screen+camera");

  return (
    <nav aria-label="Editor panels" className="flex shrink-0 flex-col gap-1">
      {visible.map((i) => {
        const active = section === i.id;
        return (
          <button
            key={i.id}
            type="button"
            title={i.label}
            aria-label={i.label}
            aria-current={active ? "true" : undefined}
            onClick={() => onSection(i.id)}
            className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md border text-base leading-none transition-colors ${
              active
                ? "border-accent bg-accent/15 text-foreground"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            <span aria-hidden>{i.glyph}</span>
          </button>
        );
      })}
    </nav>
  );
}
