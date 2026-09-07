"use client";

import * as ui from "./ui";

/**
 * The shared filled-bar slider: the row itself is the track, an accent fill
 * shows the value, name sits left, value sits right. A transparent native
 * `<input type="range">` is stacked over the whole row so the control stays
 * keyboard-operable and screen-reader-announced while looking like a filled
 * bar — see `ui.sliderFill` and friends.
 */
export function Slider({
  name,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const clamped = Math.min(Math.max(value, Math.min(min, max)), Math.max(min, max));
  const pct = max === min ? 0 : ((clamped - min) / (max - min)) * 100;

  return (
    <div className={ui.sliderFill} data-disabled={disabled || undefined}>
      <span aria-hidden className={ui.sliderFillBar} style={{ width: `${pct}%` }} />
      <span className={ui.sliderFillName}>{name}</span>
      <span className={ui.sliderFillValue}>{format(value)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={name}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={ui.sliderInput}
      />
    </div>
  );
}
