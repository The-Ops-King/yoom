"use client";

import type { BubbleConfig, BubbleShape, BubbleSize } from "@/lib/recording/types";

// `full` is gone: a full-screen camera is a staging keyframe now, not a
// capture-time bubble shape.
const SHAPES: Array<{ value: BubbleShape; label: string }> = [
  { value: "circle", label: "Circle" },
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
  { value: "portrait", label: "Portrait" },
];

const SIZES: Array<{ value: BubbleSize; label: string }> = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
];

interface CameraBubbleControlsProps {
  bubble: BubbleConfig;
  /** Camera-only mode fills the frame, so shape/size mean nothing. */
  shapeLocked: boolean;
  onChange: (patch: Partial<BubbleConfig>) => void;
}

export function CameraBubbleControls({
  bubble,
  shapeLocked,
  onChange,
}: CameraBubbleControlsProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-dim">
        Camera bubble default
      </span>

      {!shapeLocked && (
        <>
          <div className="grid grid-cols-4 gap-1 rounded-lg border border-border-subtle bg-background p-1">
            {SHAPES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => onChange({ shape: s.value })}
                className={`rounded-md px-1.5 py-1 text-[11px] font-medium transition-all ${
                  bubble.shape === s.value
                    ? "bg-accent text-white"
                    : "text-muted hover:text-foreground hover:bg-surface-raised"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-dim">Size</span>
            <div className="flex gap-1 rounded-lg border border-border-subtle bg-background p-1">
              {SIZES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => onChange({ size: s.value })}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                    bubble.size === s.value
                      ? "bg-accent text-white"
                      : "text-muted hover:text-foreground hover:bg-surface-raised"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-[11px] text-muted">
        <input
          type="checkbox"
          checked={bubble.mirror}
          onChange={(e) => onChange({ mirror: e.target.checked })}
          className="h-3.5 w-3.5 accent-[var(--color-accent)]"
        />
        Mirror my camera
      </label>

      <p className="text-[11px] leading-tight text-muted-dim">
        You place it after recording.
      </p>
    </div>
  );
}
