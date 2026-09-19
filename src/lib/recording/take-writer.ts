import { appendChunk, type FileKind } from "./take-store";

type Deps = { append: (id: string, kind: FileKind, seq: number, data: Blob) => Promise<void> };

/**
 * Fire-and-forget persistence for one take. Storage failures are logged and
 * ignored: the in-memory recording is still the source of truth for this run.
 */
export class TakeWriter {
  private queue: Promise<void> = Promise.resolve();
  private readonly seq: Record<FileKind, number> = { screen: 0, camera: 0 };
  private readonly takeId: Promise<string | null>;
  // IDB failures here (quota, corruption) are persistent, not per-chunk: once
  // one write fails the rest will too. Latching after the first stops a long
  // take from queuing — and logging — hundreds of doomed writes.
  private failed = false;

  constructor(takeId: Promise<string>, private readonly deps: Deps = { append: appendChunk }) {
    this.takeId = takeId.catch((err) => {
      console.warn("[Yoom] take not persisted", err);
      return null;
    });
  }

  chunk(kind: FileKind, data: Blob): void {
    // Captured synchronously — numbering can't drift if the write itself
    // runs later, behind other queued writes or the still-pending take id.
    const seq = this.seq[kind]++;
    // Writes are serialized (never concurrent): appendChunk does a
    // read-modify-write of the take record's byte/chunk counters, so two
    // in-flight appends would race and drop one of those updates.
    this.queue = this.queue.then(async () => {
      if (this.failed) return;
      const id = await this.takeId;
      if (!id) return;
      try {
        await this.deps.append(id, kind, seq, data);
      } catch (err) {
        this.failed = true;
        console.warn("[Yoom] stopped persisting this take", err);
      }
    });
  }

  /**
   * Resolves once every chunk queued so far has been attempted — not every
   * chunk that will ever be queued. Callers must stop calling `chunk()`
   * before awaiting this (see use-recorder's discardStoredTake, which nulls
   * its writer ref synchronously before awaiting flush).
   */
  flush(): Promise<void> {
    return this.queue;
  }

  id(): Promise<string | null> {
    return this.takeId;
  }

  /**
   * `false` once storage has failed: chunks were dropped after that point, so
   * the stored take is truncated — shorter than the in-memory recording, and
   * its `durationMs` is the length the recorder THOUGHT it captured.
   *
   * Finalize the take either way and pass the inverse as take-store's
   * `truncated` flag — `finalizeTake(id, meta, { truncated: !writer.ok() })`,
   * which is what use-recorder does. That keeps every real track the recorder
   * captured (cursor, clicks, keys, markers, camera offset) and lets `loadTake`
   * correct the one field that is actually wrong, substituting its
   * contiguous-chunk duration estimate. Skipping the finalize instead would
   * throw all of that metadata away to fix the same number.
   */
  ok(): boolean {
    return !this.failed;
  }
}
