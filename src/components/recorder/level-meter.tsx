"use client";

import { useEffect, useState } from "react";

const SEGMENTS = 8;

interface LevelMeterProps {
  /** Reads the current 0..1 level. Polled, never a React dependency. */
  getLevel: () => number;
  active: boolean;
  label: string;
}

export function LevelMeter({ getLevel, active, label }: LevelMeterProps) {
  const [lit, setLit] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setLit(Math.round(getLevel() * SEGMENTS));
    }, 100);
    return () => window.clearInterval(id);
  }, [active, getLevel]);

  // Derived rather than reset in the effect body: setting state synchronously
  // inside an effect trips `react-hooks/set-state-in-effect`.
  const shown = active ? lit : 0;

  return (
    <div
      className="flex items-center gap-[3px]"
      aria-label={`${label} level`}
      role="meter"
      aria-valuenow={shown}
      aria-valuemin={0}
      aria-valuemax={SEGMENTS}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const on = i < shown;
        const hot = i >= SEGMENTS - 2;
        return (
          <span
            key={i}
            className={`h-3 w-1 rounded-sm transition-colors ${
              on ? (hot ? "bg-accent" : "bg-emerald-400") : "bg-surface-raised"
            }`}
          />
        );
      })}
    </div>
  );
}
