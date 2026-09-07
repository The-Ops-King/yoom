/** Anything with a time span: a `Zoom`, an `Overlay`, a `Cut`. */
export type Span = { start: number; end: number };

/**
 * Assign each span the index of a row it can occupy without overlapping
 * anything already in that row.
 *
 * Greedy first-fit over spans sorted by start time uses exactly as many rows as
 * the deepest overlap — no more. (Time spans form an interval graph, where
 * greedy colouring by left endpoint is optimal: when a span is placed, every
 * row below the one it takes is busy, so those spans all overlap it and each
 * other, and no colouring could use fewer.)
 *
 * Touching spans share a row: an overlay ending exactly where the next begins
 * never draws over it.
 *
 * The result is indexed to match `spans`, NOT the sorted order, so callers can
 * do `rows[i]` against their own array.
 */
export function packRows(spans: readonly Span[]): number[] {
  const order = spans
    .map((span, index) => ({ span, index }))
    .sort((a, b) => a.span.start - b.span.start || a.index - b.index);

  const rows = new Array<number>(spans.length);
  /** The end time of the last span placed in each row. */
  const rowEnds: number[] = [];

  for (const { span, index } of order) {
    let row = rowEnds.findIndex((end) => end <= span.start);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(span.end);
    } else {
      rowEnds[row] = span.end;
    }
    rows[index] = row;
  }

  return rows;
}

/** How many rows `packRows` produced. */
export function rowCount(rows: readonly number[]): number {
  return rows.length === 0 ? 0 : Math.max(...rows) + 1;
}
