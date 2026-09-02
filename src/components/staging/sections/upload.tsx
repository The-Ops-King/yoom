"use client";

import { formatElapsed } from "@/components/recorder/preview-stage";
import { keptRanges } from "@/lib/editor/cuts";
import type { StagingContext } from "../types";

/**
 * The take's summary and the one button that ends staging: render, then
 * upload. Blocked while the share link is unverified or taken, and when the
 * trim and cuts have left nothing to render.
 */
export function UploadSection({ ctx }: { ctx: StagingContext }) {
  const { details, edits, duration, player } = ctx;
  const { width, height } = player.size;

  const nothingKept = keptRanges(edits, duration).length === 0;
  // An empty slug means "auto" and never blocks; anything else has to have
  // come back available from the details form's check.
  const slugBlocked = details.slug !== "" && details.slugOk !== true;
  const disabled = nothingKept || slugBlocked;

  const reason = nothingKept
    ? "Every second is trimmed or cut away."
    : slugBlocked
      ? "Waiting on the share link — check it in Details."
      : null;

  return (
    <div className="space-y-3">
      <dl className="space-y-1 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-dim">Length</dt>
          <dd className="text-muted">{formatElapsed(player.editedDuration * 1000)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-dim">Size</dt>
          <dd className="text-muted">
            {width} × {height}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-dim">Link</dt>
          <dd className="truncate text-muted">{details.slug === "" ? "auto" : details.slug}</dd>
        </div>
      </dl>

      <button
        type="button"
        disabled={disabled}
        aria-describedby={reason ? "staging-upload-reason" : undefined}
        onClick={ctx.finish}
        className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
      >
        Upload
      </button>

      <p id="staging-upload-reason" aria-live="polite" className="text-[11px] text-muted-dim empty:hidden">
        {reason}
      </p>
      {ctx.error && (
        <p role="alert" className="text-[11px] text-red-400/90">
          {ctx.error}
        </p>
      )}
    </div>
  );
}
