"use client";

import { useEffect, useRef, useState } from "react";
import { getProvider, orderCameras } from "@/lib/recording/media-sources";

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
  // Read inside the `devicechange` listener, which is registered once.
  const devicesRef = useRef<MediaDeviceInfo[]>([]);
  devicesRef.current = devices;

  useEffect(() => {
    let cancelled = false;
    const provider = getProvider();

    /**
     * `warmPermissions` is a `getUserMedia` call whose only purpose is to make
     * macOS/Chromium hand back device *labels*. In the desktop shell it can
     * legitimately fail the first time — the TCC prompt may still be on screen
     * — so an empty list is a reason to warm again, not a permanent answer.
     */
    async function load(warm: boolean): Promise<void> {
      if (warm) await provider.warmPermissions(kind);
      const listed = await provider.enumerateDevices(kind);
      if (cancelled) return;
      // Physical cameras first: the first entry is the default pick, and a
      // leftover virtual camera (OBS's extension outlives OBS.app) must never
      // win that just because macOS lists it first.
      const filtered = kind === "videoinput" ? orderCameras(listed) : listed;
      setDevices(filtered);
      const known = filtered.some((device) => device.deviceId === value);
      // No choice yet, or the remembered device is gone: take the first real
      // one rather than leaving the browser to pick its own default.
      if (!known) onChange(filtered[0]?.deviceId ?? "");
    }

    void load(true);

    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    // A grant landing (or a device being plugged in) fires `devicechange`.
    // Re-warm when we still have nothing: the grant that just landed is
    // exactly the case where the first warm failed.
    const onDeviceChange = () => {
      void load(devicesRef.current.length === 0);
    };
    md?.addEventListener?.("devicechange", onDeviceChange);

    return () => {
      cancelled = true;
      md?.removeEventListener?.("devicechange", onDeviceChange);
    };
    // `value`/`onChange` are intentionally excluded: re-running on every
    // selection would re-prompt for permissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-dim font-mono uppercase tracking-[0.14em]">
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
