"use client";

import { useEffect, useState } from "react";
import { getProvider } from "@/lib/recording/media-sources";

interface DeviceSelectorProps {
  kind: "audioinput" | "videoinput";
  label: string;
  value: string;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
}

export function DeviceSelector({
  kind,
  label,
  value,
  onChange,
  disabled = false,
}: DeviceSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    const provider = getProvider();

    async function loadDevices() {
      // Labels are only exposed after a permission grant.
      await provider.warmPermissions(kind);
      const filtered = await provider.enumerateDevices(kind);
      if (cancelled) return;
      setDevices(filtered);
      if (filtered.length > 0 && !value) onChange(filtered[0].deviceId);
    }

    void loadDevices();

    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    const onChangeDevices = () => {
      void provider.enumerateDevices(kind).then((d) => {
        if (!cancelled) setDevices(d);
      });
    };
    md?.addEventListener?.("devicechange", onChangeDevices);

    return () => {
      cancelled = true;
      md?.removeEventListener?.("devicechange", onChangeDevices);
    };
    // `value`/`onChange` are intentionally excluded: re-running on every
    // selection would re-prompt for permissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-dim uppercase tracking-wider">
        {label}
      </label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="device-select w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {devices.length === 0 && <option value="">No devices found</option>}
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label ||
              `${kind === "audioinput" ? "Microphone" : "Camera"} ${device.deviceId.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
}
