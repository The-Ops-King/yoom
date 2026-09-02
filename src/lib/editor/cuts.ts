import type { Cut, VideoEdits } from "@/lib/edits";

export type Range = { start: number; end: number };

/** Ranges shorter than this are treated as empty — floating-point slop, not a real kept span. */
const MIN_RANGE_S = 1e-6;

/** Ranges of source time that survive trim and cuts, sorted and disjoint. */
export function keptRanges(edits: VideoEdits, duration: number): Range[] {
  const d = Number.isFinite(duration) ? duration : Infinity;
  const start = Math.max(0, edits.trim?.start ?? 0);
  const end = Math.min(d, edits.trim?.end ?? d);
  let kept: Range[] = end > start ? [{ start, end }] : [];
  for (const cut of edits.cuts) {
    if (!(cut.end > cut.start)) continue;
    const next: Range[] = [];
    for (const r of kept) {
      if (cut.end <= r.start || cut.start >= r.end) { next.push(r); continue; }
      if (cut.start > r.start) next.push({ start: r.start, end: cut.start });
      if (cut.end < r.end) next.push({ start: cut.end, end: r.end });
    }
    kept = next;
  }
  return kept.filter((r) => r.end - r.start > MIN_RANGE_S);
}

/** Total edited-time duration for precomputed kept ranges: the sum of their lengths. */
export function editedDurationIn(ranges: Range[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
}

/** Total edited-time duration after trim and cuts. */
export function editedDuration(edits: VideoEdits, duration: number): number {
  return editedDurationIn(keptRanges(edits, duration));
}

/** Source seconds → edited seconds, given precomputed kept ranges. Inside a removed range, snaps to where that range collapses to. */
export function sourceToEditedIn(ranges: Range[], t: number): number {
  let acc = 0;
  for (const r of ranges) {
    if (t < r.start) return acc;
    if (t <= r.end) return acc + (t - r.start);
    acc += r.end - r.start;
  }
  return acc;
}

/** Source seconds → edited seconds. Inside a removed range, snaps to where that range collapses to. */
export function sourceToEdited(edits: VideoEdits, duration: number, t: number): number {
  return sourceToEditedIn(keptRanges(edits, duration), t);
}

/**
 * Edited seconds → source seconds, given precomputed kept ranges.
 *
 * Past the end, returns the end of the last kept range. A removed span
 * (a cut) has zero width in edited time, so the edited time that sits
 * exactly at the far boundary of a kept range must resolve to one side
 * of it; it resolves to the START of the NEXT kept range rather than
 * the end of the current one, so playback stays continuous across the
 * cut instead of landing just before it. That is why the loop test
 * below is `t < acc + len`, not `t <= acc + len`.
 */
export function editedToSourceIn(ranges: Range[], t: number): number {
  if (!(t > 0)) return ranges.length ? ranges[0].start : 0;
  let acc = 0;
  for (const r of ranges) {
    const len = r.end - r.start;
    if (t < acc + len) return r.start + (t - acc);
    acc += len;
  }
  return ranges.length ? ranges[ranges.length - 1].end : 0;
}

/** Edited seconds → source seconds. Past the end, returns the end of the last kept range. */
export function editedToSource(edits: VideoEdits, duration: number, t: number): number {
  return editedToSourceIn(keptRanges(edits, duration), t);
}

/** Insert a cut, keeping the list sorted, merged and disjoint. */
export function addCut(cuts: Cut[], cut: Cut): Cut[] {
  if (!(cut.end > cut.start)) return cuts;
  const all = [...cuts, cut].sort((a, b) => a.start - b.start);
  const out: Cut[] = [];
  for (const c of all) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else out.push({ ...c });
  }
  return out;
}
