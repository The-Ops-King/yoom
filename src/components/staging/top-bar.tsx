"use client";

import { MAX_TITLE } from "@/lib/limits";
import { keptRanges } from "@/lib/editor/cuts";
import type { StagingContext } from "./types";
import * as ui from "./ui";

/**
 * Whether the Upload button may fire, and the copy to show when it can't:
 * blocked while the trim and cuts have left nothing to render, or while the
 * share link is unverified or taken. An empty slug means "auto" and never
 * blocks; anything else has to have come back available from the details
 * form's check.
 */
function uploadGate(ctx: StagingContext): { disabled: boolean; reason: string | null } {
  const nothingKept = keptRanges(ctx.edits, ctx.duration).length === 0;
  const slugBlocked = ctx.details.slug !== "" && ctx.details.slugOk !== true;

  const reason = nothingKept
    ? "Every second is trimmed or cut away."
    : slugBlocked
      ? "Waiting on the share link — check it in Details."
      : null;

  return { disabled: nothingKept || slugBlocked, reason };
}

/**
 * The editor's top bar: undo/redo, the title, the share link, Discard and the
 * one button that ends staging — render, then upload. Formerly
 * `sections/upload.tsx`'s gating and button; the take's Length/Size/Link
 * summary moved to the Details panel instead.
 *
 * The row degrades in one direction as it narrows: Undo/Redo/Discard/Upload
 * never shrink, the title gives up space first (`flex-1 min-w-0` against the
 * others' `shrink-0`), and the share link truncates once there is nothing
 * left to take from the title.
 */
export function TopBar({ ctx, shareBase }: { ctx: StagingContext; shareBase: string }) {
  const { details, setDetails } = ctx;
  const { disabled, reason } = uploadGate(ctx);

  return (
    <header className="space-y-2 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 gap-1">
          <button type="button" disabled={!ctx.canUndo} onClick={ctx.undo} className={ui.btn}>
            Undo
          </button>
          <button type="button" disabled={!ctx.canRedo} onClick={ctx.redo} className={ui.btn}>
            Redo
          </button>
        </div>

        <input
          value={details.title}
          maxLength={MAX_TITLE}
          onChange={(e) => setDetails((d) => ({ ...d, title: e.target.value }))}
          placeholder="Untitled recording"
          aria-label="Recording title"
          className="min-w-0 flex-1 select-text border-b border-dashed border-border bg-transparent pb-0.5 text-sm font-semibold text-foreground outline-none placeholder:text-muted-dim focus:border-accent/50"
        />

        <span className={`${ui.hint} min-w-0 max-w-[280px] truncate`}>
          {shareBase}/v/<span className="text-muted">{details.slug || "auto"}</span>
        </span>

        <button type="button" onClick={ctx.discard} className={`${ui.btnDanger} shrink-0`}>
          Discard
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-describedby={reason ? "staging-upload-reason" : undefined}
          onClick={ctx.finish}
          className="shrink-0 rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
        >
          Upload
        </button>
      </div>

      <p id="staging-upload-reason" aria-live="polite" className={`${ui.hint} empty:hidden`}>
        {reason}
      </p>
      {ctx.error && (
        <p role="alert" className="text-[11px] text-danger-text/90">
          {ctx.error}
        </p>
      )}
    </header>
  );
}
