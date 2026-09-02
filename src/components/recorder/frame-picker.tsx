"use client";

import { useRef } from "react";
import { COLOR_SWATCHES, FRAME_PRESETS } from "@/lib/recording/presets";
import type { FrameConfig } from "@/lib/recording/types";

interface FramePickerProps {
  frame: FrameConfig;
  /** Padding changes the canvas size, so it is locked once recording starts. */
  locked: boolean;
  onChange: (patch: Partial<FrameConfig>) => void;
}

export function FramePicker({ frame, locked, onChange }: FramePickerProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-dim">
          Framed capture
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={frame.enabled}
          aria-label="Enable framed capture"
          disabled={locked}
          onClick={() => onChange({ enabled: !frame.enabled })}
          className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
            frame.enabled ? "bg-accent" : "border border-border bg-surface-raised"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              frame.enabled ? "left-4" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {frame.enabled && (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {FRAME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.label}
                disabled={locked}
                onClick={() =>
                  onChange({
                    background: { kind: "image", src: preset.src, presetId: preset.id },
                  })
                }
                style={{ background: preset.swatch }}
                className={`h-10 rounded-md border transition-all disabled:opacity-50 ${
                  frame.background.presetId === preset.id
                    ? "border-accent ring-2 ring-accent/40"
                    : "border-border hover:border-accent/50"
                }`}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {COLOR_SWATCHES.slice(0, 5).map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Frame colour ${color}`}
                disabled={locked}
                onClick={() => onChange({ background: { kind: "color", color } })}
                style={{ background: color }}
                className={`h-6 w-6 rounded-md border transition-all disabled:opacity-50 ${
                  frame.background.kind === "color" && frame.background.color === color
                    ? "border-accent ring-2 ring-accent/40"
                    : "border-border"
                }`}
              />
            ))}
            <button
              type="button"
              disabled={locked}
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
            >
              Upload
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                // The hook owns the object URL: it revokes the previous
                // `frame.background.src` when this replaces it, and on unmount.
                onChange({
                  background: { kind: "image", src: URL.createObjectURL(file) },
                });
              }}
            />
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-muted-dim">
              Padding {Math.round(frame.padding * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={0.2}
              step={0.005}
              value={frame.padding}
              disabled={locked}
              onChange={(e) => onChange({ padding: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)] disabled:opacity-50"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] text-muted-dim">
              Corner radius {Math.round(frame.radius * 1000) / 10}%
            </span>
            <input
              type="range"
              min={0}
              max={0.05}
              step={0.002}
              value={frame.radius}
              disabled={locked}
              onChange={(e) => onChange({ radius: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)] disabled:opacity-50"
            />
          </label>

          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={frame.shadow}
              disabled={locked}
              onChange={(e) => onChange({ shadow: e.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Drop shadow
          </label>

          {locked && (
            <p className="text-[11px] leading-tight text-muted-dim">
              Frame settings are locked while recording — the canvas size is
              fixed once the encoder starts.
            </p>
          )}
        </>
      )}
    </div>
  );
}
