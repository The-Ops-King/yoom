"use client";

import * as ops from "@/lib/editor/edit-ops";
import type { StagingContext } from "./types";
import * as ui from "./ui";

function fmt(t: number): string {
  return `${t.toFixed(1)}s`;
}

/**
 * The transport row: playhead-scoped trim controls on the left, play state and
 * time on the right. Sits between the preview and the timeline rather than in
 * the rail, because Set In/Set Out/Cut/Reset act on the playhead, not on any
 * one rail section — formerly `sections/trim.tsx`. That file's other two
 * pieces moved elsewhere instead of coming along: the cut list is dropped
 * (cuts are already selectable, and removable with Delete/Backspace, on the
 * timeline's clip track) and the marker list moved into the Cursor, input &
 * markers panel, next to the other captured-event lists it owns.
 *
 * Degrades by wrapping, not shrinking: the outer row is `flex-wrap`, so under
 * width pressure the playback readout drops to its own line first, then the
 * trim/reset pair wraps under the in/out controls — nothing here truncates or
 * disappears the way the top bar's title does.
 */
export function Transport({ ctx }: { ctx: StagingContext }) {
  const { edits, duration, player, inPoint, outPoint } = ctx;
  const trim = edits.trim ?? { start: 0, end: duration };
  const trimmed = trim.start > 0 || trim.end < duration;
  const bothSet = inPoint !== null && outPoint !== null;

  return (
    // Not a `<header>` — that's the top bar's role for the page as a whole.
    // This is a mid-page control group, so it announces itself as one.
    <div
      role="toolbar"
      aria-label="Playback transport"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={ui.btn} onClick={() => ctx.setInPoint(player.timeRef.current)}>
            Set in (I)
          </button>
          <button type="button" className={ui.btn} onClick={() => ctx.setOutPoint(player.timeRef.current)}>
            Set out (O)
          </button>
          <button
            type="button"
            className={ui.btn}
            disabled={!bothSet}
            title={bothSet ? undefined : "Set both In and Out first"}
            onClick={() => {
              if (inPoint === null || outPoint === null) return;
              ctx.apply((e) =>
                ops.addCut(e, { start: Math.min(inPoint, outPoint), end: Math.max(inPoint, outPoint) }),
              );
              ctx.setInPoint(null);
              ctx.setOutPoint(null);
            }}
          >
            Cut in→out (C)
          </button>
        </div>

        <p className={ui.hint} aria-live="polite">
          In {inPoint === null ? "—" : fmt(inPoint)} · Out {outPoint === null ? "—" : fmt(outPoint)}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-[11px] text-muted">
            Trim {fmt(trim.start)} → {fmt(trim.end)}
          </span>
          <button
            type="button"
            className={ui.btn}
            disabled={!trimmed}
            title={trimmed ? undefined : "Nothing is trimmed yet"}
            onClick={() => ctx.apply((e) => ops.setTrim(e, duration, { start: 0, end: duration }))}
          >
            Reset trim
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted">
        <span>{fmt(player.editedTime)}</span>
        <button
          type="button"
          aria-label={player.playing ? "Pause" : "Play"}
          className={ui.btn}
          onClick={player.toggle}
        >
          {player.playing ? "Pause" : "Play"}
        </button>
        <span>{fmt(player.editedDuration)}</span>
      </div>
    </div>
  );
}
