"use client";

import { formatElapsed } from "./preview-stage";
import type { TakeSummary } from "@/lib/recording/take-store";

interface PendingTakesProps {
  takes: TakeSummary[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Unsaved takes from an earlier run (crash, force-quit) that never made it to
 * staging. Offered once, in `idle`, before the user can start a fresh take
 * over one. No year in the date — takes are pruned at 14 days, so an
 * ambiguous year can't come up.
 */
export function PendingTakes({ takes, onRestore, onDelete }: PendingTakesProps) {
  return (
    <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-border bg-surface p-3">
      <p className="text-sm font-medium text-foreground">
        Unsaved take{takes.length > 1 ? "s" : ""}
      </p>
      {takes.map((t) => {
        const dateLabel = new Date(t.createdAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        return (
          <div key={t.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">
              {dateLabel}
              {" · "}
              {t.estimated ? "~" : ""}
              {formatElapsed(t.durationMs)}
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => onRestore(t.id)}
                aria-label={`Restore take from ${dateLabel}`}
                className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-accent-hover"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => onDelete(t.id)}
                aria-label={`Delete take from ${dateLabel}`}
                className="shrink-0 rounded-md border border-border bg-surface-raised px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
              >
                Delete
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
