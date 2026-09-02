"use client";

import type { BubbleConfig, BubbleShape, BubbleSize } from "@/lib/recording/types";

const SHAPES: Array<{ value: BubbleShape; label: string }> = [
  { value: "circle", label: "Circle" },
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
  { value: "portrait", label: "Portrait" },
  { value: "full", label: "Full" },
];

const SIZES: Array<{ value: BubbleSize; label: string }> = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
];

interface CameraBubbleControlsProps {
  bubble: BubbleConfig;
  /** Camera-only mode is always `full`, so shape/size are locked. */
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
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-dim">
          Camera bubble
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={bubble.visible}
          aria-label="Show camera bubble"
          onClick={() => onChange({ visible: !bubble.visible })}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            bubble.visible ? "bg-accent" : "bg-surface-raised border border-border"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              bubble.visible ? "left-4" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {bubble.visible && (
        <>
          {!shapeLocked && (
            <>
              <div className="grid grid-cols-5 gap-1 rounded-lg border border-border-subtle bg-background p-1">
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
                      disabled={bubble.shape === "full"}
                      onClick={() => onChange({ size: s.value })}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-40 ${
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
            Drag the bubble on the preview to reposition it — during setup or
            while recording.
          </p>
        </>
      )}
    </div>
  );
}
