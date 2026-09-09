"use client";

import type { StagingContext } from "./types";
import type { RailSection } from "./rail";

/**
 * The camera panel's icon. No plain text glyph reads as a camera at 15px —
 * a filled circle, a ring, a target all get read as something else — so
 * this is a small inline SVG instead (the project has no icon dependency,
 * and this keeps it that way). `aria-hidden` because the button already
 * carries the real name via `title`/`aria-label`.
 */
function CameraGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

/**
 * One plain glyph per panel — this project has no icon dependency, so these
 * are text characters, except for the camera panel (see `CameraGlyph`
 * above), which no glyph reads clearly as. Each still carries its real name
 * in `title`/`aria-label`, since the glyph alone is not self-explanatory.
 */
const ICONS: { id: RailSection; glyph: React.ReactNode; label: string }[] = [
  { id: "camera", glyph: <CameraGlyph />, label: "Camera" },
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
  // Screen-only has no camera track, so no Camera panel. Camera-only has no
  // screen, so nothing was tracked for the cursor/click/key panel; its Camera
  // panel collapses to the mirror toggle.
  const hidden: RailSection[] =
    ctx.mode === "screen" ? ["camera"] : ctx.mode === "camera" ? ["cursor"] : [];
  const visible = ICONS.filter((i) => !hidden.includes(i.id));

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
