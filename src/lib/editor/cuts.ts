import type { Cut, VideoEdits } from "@/lib/edits";

export type Range = { start: number; end: number };

/** Ranges of source time that survive trim and cuts, sorted and disjoint. */
export function keptRanges(edits: VideoEdits, duration: number): Range[] {
  const start = Math.max(0, edits.trim?.start ?? 0);
  const end = Math.min(duration, edits.trim?.end ?? duration);
  let kept: Range[] = end > start ? [{ start, end }] : [];
  for (const cut of edits.cuts) {
    const next: Range[] = [];
    for (const r of kept) {
      if (cut.end <= r.start || cut.start >= r.end) { next.push(r); continue; }
      if (cut.start > r.start) next.push({ start: r.start, end: cut.start });
      if (cut.end < r.end) next.push({ start: cut.end, end: r.end });
    }
    kept = next;
  }
  return kept.filter((r) => r.end - r.start > 1e-6);
}

export function editedDuration(edits: VideoEdits, duration: number): number {
  return keptRanges(edits, duration).reduce((sum, r) => sum + (r.end - r.start), 0);
}

/** Source seconds → edited seconds. Inside a removed range, snaps to where that range collapses to. */
export function sourceToEdited(edits: VideoEdits, duration: number, t: number): number {
  let acc = 0;
  for (const r of keptRanges(edits, duration)) {
    if (t < r.start) return acc;
    if (t <= r.end) return acc + (t - r.start);
    acc += r.end - r.start;
  }
  return acc;
}

/** Edited seconds → source seconds. Past the end, returns the end of the last kept range. */
export function editedToSource(edits: VideoEdits, duration: number, t: number): number {
  const ranges = keptRanges(edits, duration);
  let acc = 0;
  for (const r of ranges) {
    const len = r.end - r.start;
    if (t < acc + len) return r.start + (t - acc);
    acc += len;
  }
  return ranges.length ? ranges[ranges.length - 1].end : 0;
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
