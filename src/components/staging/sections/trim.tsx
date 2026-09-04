"use client";

import * as ops from "@/lib/editor/edit-ops";
import type { StagingContext } from "../types";
import * as ui from "../ui";

/** Seconds a marker's one-click cut spans. */
const MARKER_CUT_S = 2;


function fmt(t: number): string {
  return `${t.toFixed(1)}s`;
}

export function TrimSection({ ctx }: { ctx: StagingContext }) {
  const { edits, duration, player, inPoint, outPoint } = ctx;
  const trim = edits.trim ?? { start: 0, end: duration };
  const trimmed = trim.start > 0 || trim.end < duration;
  const bothSet = inPoint !== null && outPoint !== null;

  return (
    <div className={ui.section}>
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

      <div className="flex items-center justify-between gap-2">
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

      <div className={ui.group}>
        <span className={ui.label}>Cuts ({edits.cuts.length})</span>
        {edits.cuts.length === 0 ? (
          <p className={ui.hint}>No cuts yet.</p>
        ) : (
          <ul className={ui.group}>
            {edits.cuts.map((cut, i) => (
              <li key={`${cut.start}-${cut.end}`} className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    ctx.setSelected({ kind: "cut", index: i });
                    player.seek(cut.start);
                  }}
                  className={`flex-1 text-left text-[11px] ${
                    ctx.selected?.kind === "cut" && ctx.selected.index === i ? "text-foreground" : "text-muted"
                  }`}
                >
                  {fmt(cut.start)} → {fmt(cut.end)}
                </button>
                <button
                  type="button"
                  aria-label={`Remove cut ${i + 1}`}
                  onClick={() => {
                    ctx.apply((e) => ops.removeCut(e, i));
                    ctx.setSelected(null);
                  }}
                  className="text-[11px] text-danger-text/80 hover:text-danger-hover"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {edits.markers.length > 0 && (
        <div className={ui.group}>
          <span className={ui.label}>
            Markers ({edits.markers.length})
          </span>
          <ul className={ui.group}>
            {edits.markers.map((m) => (
              <li key={m.t} className="flex items-center justify-between gap-1.5">
                <button
                  type="button"
                  onClick={() => player.seek(m.t)}
                  className="flex-1 text-left text-[11px] text-muted hover:text-foreground"
                >
                  {m.label ?? fmt(m.t)}
                </button>
                <button
                  type="button"
                  className={ui.btn}
                  onClick={() =>
                    ctx.apply((e) =>
                      ops.addCut(e, { start: Math.max(0, m.t - MARKER_CUT_S), end: m.t }),
                    )
                  }
                >
                  Cut 2 s before
                </button>
                <button
                  type="button"
                  className={ui.btn}
                  onClick={() =>
                    ctx.apply((e) =>
                      ops.addCut(e, { start: m.t, end: Math.min(duration, m.t + MARKER_CUT_S) }),
                    )
                  }
                >
                  Cut 2 s after
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
