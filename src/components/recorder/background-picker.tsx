"use client";

import { useRef, useState } from "react";
import { BACKGROUND_PRESETS, COLOR_SWATCHES } from "@/lib/recording/presets";
import type { BackgroundConfig, BackgroundKind } from "@/lib/recording/types";

const KINDS: Array<{ value: BackgroundKind; label: string }> = [
  { value: "none", label: "None" },
  { value: "blur", label: "Blur" },
  { value: "color", label: "Colour" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
];

interface BackgroundPickerProps {
  background: BackgroundConfig;
  onChange: (background: BackgroundConfig) => void;
}

export function BackgroundPicker({ background, onChange }: BackgroundPickerProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedName, setUploadedName] = useState<string>("");

  // The object URL is handed to the hook, which owns its lifetime: it revokes
  // the previous `background.src` whenever it is replaced, and both on unmount.
  // Revoking here would tear the URL out from under the compositor.
  function handleFile(file: File | undefined, kind: "image" | "video") {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setUploadedName(file.name);
    onChange({ kind, src: url });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-dim">
        Background
      </span>

      <div className="grid grid-cols-5 gap-1 rounded-lg border border-border-subtle bg-background p-1">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => {
              if (k.value === "none" || k.value === "blur") onChange({ kind: k.value });
              else if (k.value === "color")
                onChange({ kind: "color", color: background.color ?? COLOR_SWATCHES[0] });
              else if (k.value === "image") imageInputRef.current?.click();
              else videoInputRef.current?.click();
            }}
            className={`rounded-md px-1.5 py-1 text-[11px] font-medium transition-all ${
              background.kind === k.value
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground hover:bg-surface-raised"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {background.kind === "color" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Background colour ${color}`}
              onClick={() => onChange({ kind: "color", color })}
              style={{ background: color }}
              className={`h-6 w-6 rounded-md border transition-all ${
                background.color === color
                  ? "border-accent ring-2 ring-accent/40"
                  : "border-border"
              }`}
            />
          ))}
          <input
            type="color"
            aria-label="Custom background colour"
            value={background.color ?? "#1a1a1e"}
            onChange={(e) => onChange({ kind: "color", color: e.target.value })}
            className="h-6 w-8 cursor-pointer rounded-md border border-border bg-transparent"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-dim">Presets</span>
        <div className="grid grid-cols-4 gap-1.5">
          {BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.label}
              onClick={() =>
                onChange({ kind: "image", src: preset.src, presetId: preset.id })
              }
              style={{ background: preset.swatch }}
              className={`h-10 rounded-md border transition-all ${
                background.presetId === preset.id
                  ? "border-accent ring-2 ring-accent/40"
                  : "border-border hover:border-accent/50"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="rounded-md border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground"
        >
          Upload image
        </button>
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          className="rounded-md border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground"
        >
          Upload looping video
        </button>
      </div>
      {uploadedName && (
        <p className="truncate text-[11px] text-muted-dim">
          Using {uploadedName} — uploads are not remembered between sessions.
        </p>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0], "image");
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0], "video");
          e.target.value = "";
        }}
      />

      <p className="text-[11px] leading-tight text-muted-dim">
        Backgrounds need person segmentation; until the model loads you will see
        your plain camera.
      </p>
    </div>
  );
}
