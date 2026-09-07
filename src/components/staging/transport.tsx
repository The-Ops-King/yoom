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
 * timeline's clip track) and the marker list moved into the Cursor & input
 * panel, next to the other captured-event lists it owns.
 */
export function Transport({ ctx }: { ctx: StagingContext }) {
  const { edits, duration, player, inPoint, outPoint } = ctx;
  const trim = edits.trim ?? { start: 0, end: duration };
  const trimmed = trim.start > 0 || trim.end < duration;
  const bothSet = inPoint !== null && outPoint !== null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
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

        <p className={ui.hint}>
          In {inPoint === null ? "—" : fmt(inPoint)} · Out {outPoint === null ? "—" : fmt(outPoint)}
        </p>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">
            Trim {fmt(trim.start)} → {fmt(trim.end)}
          </span>
          <button
            type="button"
            className={ui.btn}
            disabled={!trimmed}
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
