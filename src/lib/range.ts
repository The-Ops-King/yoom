/** One stream invocation never serves more than this many bytes. */
export const RANGE_WINDOW_BYTES = 32 * 1024 * 1024;

export type ClampedRange =
  | { start: number; end: number }
  | { unsatisfiable: true };

/**
 * Parse a single-range `Range` header and clamp it to the file size and to a
 * maximum window. Returns null when the header is absent or unparseable, in
 * which case the caller should serve the whole file (200).
 */
export function clampRange(
  rangeHeader: string | null | undefined,
  size: number,
  windowBytes: number,
): ClampedRange | null {
  if (!rangeHeader || size <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;

  if (rawStart === "") {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start >= size) return { unsatisfiable: true };
    if (end < start) return { unsatisfiable: true };
    end = Math.min(end, size - 1);
  }

  // Never serve more than the window in a single invocation.
  end = Math.min(end, start + windowBytes - 1);
  return { start, end };
}
