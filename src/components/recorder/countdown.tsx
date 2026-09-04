"use client";

interface CountdownProps {
  value: number;
  onSkip: () => void;
}

/**
 * The last two ticks are words, not numbers: "Ready?" then "Go!". Every take
 * counts from 2, so the countdown is entirely words; a longer count (any
 * `seconds` on START) would show its leading ticks as digits.
 *
 * The desktop HUD renders the same labels off the same `countdown` number, so
 * this mapping has a twin in `desktop/src/renderer/hud`.
 */
export function countdownLabel(value: number): string {
  if (value === 2) return "Ready?";
  if (value === 1) return "Go!";
  return String(value);
}

export function Countdown({ value, onSkip }: CountdownProps) {
  const label = countdownLabel(value);
  const isWord = value <= 2;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background/90 backdrop-blur">
      <span
        key={value}
        aria-live="assertive"
        className={`font-bold text-foreground ${
          isWord ? "text-7xl tracking-tight" : "text-8xl tabular-nums"
        }`}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={onSkip}
        className="rounded-lg border border-border bg-surface px-5 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        Skip
      </button>
    </div>
  );
}
