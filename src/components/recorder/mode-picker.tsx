"use client";

import type { RecordingMode, SurfacePref } from "@/lib/recording/types";

const MODES: Array<{ value: RecordingMode; label: string; hint: string }> = [
  { value: "screen+camera", label: "Screen + Cam", hint: "Bubble over your screen" },
  { value: "screen", label: "Screen", hint: "Just the screen" },
  { value: "camera", label: "Camera", hint: "Talking head" },
];

const SURFACES: Array<{ value: SurfacePref; label: string }> = [
  { value: "monitor", label: "Entire screen" },
  { value: "window", label: "Window" },
  { value: "browser", label: "Tab" },
];

const SURFACE_LABEL: Record<SurfacePref | "unknown", string> = {
  monitor: "Entire screen",
  window: "Window",
  browser: "Browser tab",
  unknown: "Unknown source",
};

interface ModePickerProps {
  mode: RecordingMode;
  surfacePref: SurfacePref;
  /** The surface actually captured, once acquisition succeeded. */
  surface: SurfacePref | "unknown" | null;
  disabled: boolean;
  onModeChange: (mode: RecordingMode) => void;
  onSurfaceChange: (pref: SurfacePref) => void;
}

export function ModePicker({
  mode,
  surfacePref,
  surface,
  disabled,
  onModeChange,
  onSurfaceChange,
}: ModePickerProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-dim uppercase tracking-wider">
          Mode
        </label>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onModeChange(opt.value)}
                className={`rounded-lg border p-3 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  active
                    ? "border-accent/60 bg-accent/10 shadow-sm"
                    : "border-border bg-surface hover:bg-surface-raised"
                }`}
              >
                <span
                  className={`block text-sm font-semibold ${
                    active ? "text-foreground" : "text-muted"
                  }`}
                >
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-tight text-muted-dim">
                  {opt.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {mode !== "camera" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-dim uppercase tracking-wider">
            Capture
          </label>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1">
            {SURFACES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onSurfaceChange(opt.value)}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  surfacePref === opt.value
                    ? "bg-accent text-white shadow-sm"
                    : "text-muted hover:text-foreground hover:bg-surface-raised"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {surface && (
            <p className="text-[11px] text-muted-dim">
              Capturing:{" "}
              <span className="text-muted">{SURFACE_LABEL[surface]}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
