import { editedDurationIn, type Range } from "../cuts";

/** A run of edited frames, one Float32Array per output channel. */
export type AudioBlock = { channels: Float32Array[]; frames: number };

/** One kept range, resolved onto the edited frame grid. */
type Segment = {
  /** Seconds to add to a source time to land on its edited time inside this range. */
  shift: number;
  /** First edited frame this range owns. */
  from: number;
  /** One past the last edited frame this range owns. */
  to: number;
};

/**
 * Lays decoded source audio onto the edited timeline. Push buffers in any
 * order that is roughly chronological; drain blocks strictly in order. Pending
 * samples are held only between the drained edge and the furthest write, so
 * memory stays at a few seconds when the caller drains as it goes.
 *
 * `ranges` must be sorted and disjoint — what `keptRanges` returns. Frames no
 * push ever reached are silence, and a push that lands behind the drained edge
 * is clipped away rather than corrupting the stream.
 *
 * A source with fewer channels than the output is spread across it by repeating
 * its last channel, which is the right upmix for the common mono-mic case; a
 * source with more channels keeps its first `channelCount` and drops the rest.
 * A true downmix is the caller's job — this class places samples, it does not
 * mix them.
 */
export class AudioAssembler {
  private readonly total: number; // edited frames in the whole timeline
  private readonly segments: Segment[]; // kept ranges, on the edited frame grid
  private drained = 0; // edited frames already handed out
  private head = 0; // pending[c][head + i] = edited frame `drained + i`
  private pending: Float32Array[];

  constructor(
    ranges: Range[],
    private readonly sampleRate: number,
    private readonly channelCount: number,
  ) {
    this.total = Math.max(0, Math.round(editedDurationIn(ranges) * sampleRate));
    // Each range's edited window is derived from the running edited offset, so
    // one range's last frame and the next one's first frame are the same number:
    // the seams tile [0, total) exactly however the boundaries round.
    let acc = 0;
    this.segments = ranges.map((r, i) => {
      const from = Math.round(acc * sampleRate);
      acc += r.end - r.start;
      const to = i === ranges.length - 1 ? this.total : Math.round(acc * sampleRate);
      return { shift: from / sampleRate - r.start, from, to };
    });
    this.pending = Array.from({ length: channelCount }, () => new Float32Array(0));
  }

  /** `data[c]` holds channel c; `timestamp` is the first sample's source second. */
  push(data: Float32Array[], timestamp: number): void {
    const n = data[0]?.length ?? 0;
    if (n <= 0 || this.channelCount === 0) return;
    for (const seg of this.segments) {
      // Source sample `i` of this buffer is edited frame `base + i` — one
      // rounding for the whole buffer, so samples never slip against each other.
      const base = Math.round((timestamp + seg.shift) * this.sampleRate);
      const from = Math.max(base, seg.from, this.drained);
      const to = Math.min(base + n, seg.to);
      if (to <= from) continue;
      const count = to - from;
      const at = from - this.drained;
      this.ensure(at + count);
      const srcFrom = from - base;
      for (let c = 0; c < this.channelCount; c++) {
        const src = data[Math.min(c, data.length - 1)];
        if (!src) continue;
        this.pending[c].set(src.subarray(srcFrom, srcFrom + count), this.head + at);
      }
    }
  }

  /**
   * Hand out edited frames `[drained, min(untilFrame, total))`; unwritten
   * samples are silence. `Infinity` drains everything that is left — that is
   * the final flush, which must not drop the audio past the last video frame.
   * `NaN` drains nothing rather than throwing on the export's hot path.
   */
  drain(untilFrame: number): AudioBlock {
    const until = Number.isNaN(untilFrame) ? this.drained : untilFrame;
    const frames = Math.max(0, Math.floor(Math.min(until, this.total)) - this.drained);
    this.ensure(frames);
    const channels = this.pending.map((p) => p.slice(this.head, this.head + frames));
    this.head += frames;
    this.drained += frames;
    return { channels, frames };
  }

  /** Make room for `length` frames at `head`, sliding or growing the buffers. */
  private ensure(length: number): void {
    if (this.channelCount === 0) return;
    const capacity = this.pending[0].length;
    if (this.head + length <= capacity) return;
    if (length <= capacity) {
      // Drained frames are dead, so slide the live window back rather than
      // grow. A caller that drains as it goes never gets here twice over the
      // same frames and would be fine re-slicing the tail instead; this keeps
      // the buffers bounded by the undrained window when a caller decodes far
      // ahead of its drains, and costs one copy of what is still pending.
      for (const p of this.pending) {
        p.copyWithin(0, this.head);
        // Do not drop this fill: copyWithin leaves the tail holding the
        // pre-shift duplicate and the dead drained frames, and those slots now
        // stand for later frames. Zero them so unwritten frames stay silent —
        // otherwise the garbage resurfaces in a future window as audio.
        p.fill(0, capacity - this.head);
      }
    } else {
      const size = Math.max(length, capacity * 2);
      const head = this.head;
      this.pending = this.pending.map((p) => {
        const grown = new Float32Array(size);
        grown.set(p.subarray(head));
        return grown;
      });
    }
    this.head = 0;
  }
}
