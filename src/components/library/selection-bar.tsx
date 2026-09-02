"use client";

type SelectionBarProps = {
  count: number;
  total: number;
  pending: boolean;
  onAll(): void;
  onClear(): void;
  onDelete(): void;
  failures: { id: string; title: string; error: string }[];
};

export function SelectionBar({
  count,
  total,
  pending,
  onAll,
  onClear,
  onDelete,
  failures,
}: SelectionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
      <span className="text-sm text-foreground">{count} selected</span>
      <button
        type="button"
        onClick={onAll}
        disabled={count === total}
        className="text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
      >
        Select all
      </button>
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-muted transition-colors hover:text-foreground"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="ml-auto rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-400/90 transition-colors hover:bg-red-500/10 disabled:opacity-40"
      >
        {pending ? "Deleting…" : `Delete ${count}`}
      </button>
      {/* Always in the DOM: a live region only announces mutations a screen
          reader was already observing. */}
      <p aria-live="polite" className="w-full text-xs text-red-400/90">
        {failures.length > 0
          ? `Could not delete: ${failures.map((f) => `${f.title} (${f.error})`).join(", ")}`
          : ""}
      </p>
    </div>
  );
}
