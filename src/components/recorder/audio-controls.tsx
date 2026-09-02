"use client";

import { useCallback } from "react";
import { DeviceSelector } from "@/components/device-selector";
import { LevelMeter } from "./level-meter";
import type { Capabilities } from "@/lib/recording/types";

interface AudioControlsProps {
  micOn: boolean;
  systemOn: boolean;
  micId: string;
  hasSystemAudio: boolean;
  /** True once capture is live, so device pickers must not change mid-stream. */
  live: boolean;
  capabilities: Capabilities;
  getLevel: (id: "mic" | "system") => number;
  onToggleMic: () => void;
  onToggleSystem: () => void;
  onMicChange: (deviceId: string) => void;
}

function Toggle({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "border border-border bg-surface-raised"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
          on ? "left-4" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function AudioControls({
  micOn,
  systemOn,
  micId,
  hasSystemAudio,
  live,
  capabilities,
  getLevel,
  onToggleMic,
  onToggleSystem,
  onMicChange,
}: AudioControlsProps) {
  const getMicLevel = useCallback(() => getLevel("mic"), [getLevel]);
  const getSystemLevel = useCallback(() => getLevel("system"), [getLevel]);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-dim">
        Audio
      </span>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground">Microphone</span>
        <div className="flex items-center gap-3">
          <LevelMeter getLevel={getMicLevel} active={micOn} label="Microphone" />
          <Toggle on={micOn} label="Microphone" onClick={onToggleMic} />
        </div>
      </div>

      {!live && (
        <DeviceSelector
          kind="audioinput"
          label="Microphone device"
          value={micId}
          onChange={onMicChange}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground">System audio</span>
        <div className="flex items-center gap-3">
          <LevelMeter
            getLevel={getSystemLevel}
            active={systemOn && hasSystemAudio}
            label="System audio"
          />
          <Toggle on={systemOn} label="System audio" onClick={onToggleSystem} />
        </div>
      </div>

      {!hasSystemAudio && capabilities.systemAudio !== "full" && (
        <p className="text-[11px] leading-tight text-muted-dim">
          {capabilities.systemAudio === "tab-only"
            ? "System audio is available for tab recordings, or use the desktop app."
            : "This browser cannot capture system audio. Use the desktop app."}
        </p>
      )}

      <p className="text-[11px] leading-tight text-muted-dim">
        Both sources are mixed into one track before recording starts, so you can
        toggle either one mid-recording.
      </p>
    </div>
  );
}
