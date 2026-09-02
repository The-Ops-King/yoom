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

export type UpstreamRangePlan =
  | { kind: "full" }
  | { kind: "range"; start: number; end: number }
  | { kind: "passthrough"; header: string }
  | { kind: "unsatisfiable" };

/**
 * Decide what Range (if any) to send upstream to Drive.
 *
 * When the file size is known (`size > 0`) this clamps the client's Range to
 * the file and to the window, falling back to a first-window request when
 * the client didn't send a usable Range and the file is bigger than the
 * window.
 *
 * When the size is unknown (`size <= 0`, i.e. Drive omitted it), we can
 * never safely stream unbounded: forward the client's Range verbatim if it
 * sent one (we can't clamp against an unknown size), otherwise force a
 * bounded first-window request.
 */
export function planUpstreamRange(
  rangeHeader: string | null,
  size: number,
  windowBytes: number,
): UpstreamRangePlan {
  if (size > 0) {
    const clamped = clampRange(rangeHeader, size, windowBytes);
    if (clamped && "unsatisfiable" in clamped) return { kind: "unsatisfiable" };
    if (clamped) return { kind: "range", start: clamped.start, end: clamped.end };
    if (size > windowBytes) return { kind: "range", start: 0, end: windowBytes - 1 };
    return { kind: "full" };
  }

  if (rangeHeader) return { kind: "passthrough", header: rangeHeader };
  return { kind: "range", start: 0, end: windowBytes - 1 };
}
