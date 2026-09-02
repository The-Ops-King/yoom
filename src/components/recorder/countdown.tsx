"use client";

interface CountdownProps {
  value: number;
  onSkip: () => void;
}

export function Countdown({ value, onSkip }: CountdownProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background/90 backdrop-blur">
      <span
        key={value}
        aria-live="assertive"
        className="text-8xl font-bold tabular-nums text-foreground"
      >
        {value}
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
