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

  constructor(takeId: Promise<string>, private readonly deps: Deps = { append: appendChunk }) {
    this.takeId = takeId.catch((err) => {
      console.warn("[Yoom] take not persisted", err);
      return null;
    });
  }

  chunk(kind: FileKind, data: Blob): void {
    const seq = this.seq[kind]++;
    this.queue = this.queue.then(async () => {
      const id = await this.takeId;
      if (!id) return;
      try {
        await this.deps.append(id, kind, seq, data);
      } catch (err) {
        console.warn("[Yoom] could not persist a chunk", err);
      }
    });
  }

  /** Resolves once every queued chunk has been attempted. */
  flush(): Promise<void> {
    return this.queue;
  }

  id(): Promise<string | null> {
    return this.takeId;
  }
}
