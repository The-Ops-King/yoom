import {
  CHUNK_SIZE_BYTES,
  CHUNK_TIMEOUT_MS,
  MAX_ATTEMPTS,
  QUERY_TIMEOUT_MS,
  offsetFromRange,
  putInit,
  type UploadOptions,
} from "@/lib/upload-client";

/** Unsent bytes allowed before `write` makes the encoder wait. */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

export type StreamingUploadOptions = UploadOptions & {
  /** Called with the number of bytes Drive has acknowledged. */
  onProgress?: (sentBytes: number) => void;
  /** Tests only: buffer without sending. */
  autoSend?: boolean;
};

/**
 * A Drive resumable upload fed while the file is still being produced.
 *
 * The total size is unknown until `finish`, so every chunk but the last
 * declares `/*`. Bytes go up while the exporter is still muxing, which is what
 * makes Save cost max(render, upload) instead of render + upload.
 *
 * Every byte is retained: a stream that dies can still be re-uploaded whole
 * with `blob()` instead of re-rendering the take.
 */
export class StreamingUpload {
  /**
   * One Blob per write. `new Blob(parts)` references them; building
   * `new Blob(uint8arrays)` on every chunk would re-copy the whole file each
   * time (O(n^2) on a 500 MB export).
   */
  private readonly parts: Blob[] = [];
  /** Cached composition of `parts`, invalidated by each write. */
  private composite: Blob | null = null;
  /** Bytes handed to us. */
  private received = 0;
  /** Bytes Drive has acknowledged. */
  private sent = 0;
  /** Serialises chunk PUTs: exactly one request is in flight per session. */
  private sending: Promise<void> = Promise.resolve();
  /** A background chunk failure, re-thrown by the next `write`/`finish`. */
  private failure: unknown = null;
  /** Consecutive failed/no-progress requests; reset whenever Drive advances. */
  private attempts = 0;
  /** Set if Drive completes the file before `finish` asks it to. */
  private doneId: string | null = null;
  private done = false;

  constructor(
    private readonly sessionUri: string,
    private readonly options: StreamingUploadOptions = {},
  ) {}

  /** Bytes Drive has acknowledged so far. */
  get sentBytes(): number {
    return this.sent;
  }

  /** Bytes handed to this upload so far. */
  get receivedBytes(): number {
    return this.received;
  }

  /**
   * Append `data`, which must start exactly where the previous write ended.
   * Resolves immediately unless the unsent backlog is over the watermark, in
   * which case it waits for the network and so backpressures the encoder.
   */
  async write(data: Uint8Array, position: number): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.done) throw new Error("Upload already finished");
    if (position !== this.received) {
      throw new Error(`Upload bytes out of order (${position} != ${this.received})`);
    }

    this.parts.push(new Blob([data as BlobPart]));
    this.composite = null;
    this.received += data.byteLength;

    if (this.options.autoSend === false) return;
    if (this.received - this.sent >= CHUNK_SIZE_BYTES) this.kick();
    if (this.received - this.sent > MAX_BUFFERED_BYTES) await this.sending;
    if (this.failure) throw this.failure;
  }

  /**
   * Flush the remainder with the now-known total and resolve with the Drive
   * file id.
   */
  async finish(): Promise<{ id: string }> {
    await this.sending;
    if (this.failure) throw this.failure;
    if (this.doneId) {
      this.done = true;
      return { id: this.doneId };
    }

    const total = this.received;
    if (total === 0) throw new Error("Nothing to upload");
    this.done = true;
    this.attempts = 0;

    // Drain whole chunks first so the final PUT stays small. `>` not `>=`: a
    // remainder of exactly one chunk goes out as the final chunk instead,
    // carrying the real total.
    while (this.received - this.sent > CHUNK_SIZE_BYTES) {
      const id = await this.putRange(this.sent, this.sent + CHUNK_SIZE_BYTES, "*");
      if (id) return { id };
    }

    // `putRange` throws once `attempts` reaches MAX_ATTEMPTS, so this cannot
    // spin forever, and it only returns here with an id in hand.
    for (;;) {
      const id = await this.putRange(this.sent, total, String(total));
      if (id) return { id };
    }
  }

  /** Everything received so far, for a whole-file retry. */
  blob(type: string): Blob {
    return new Blob([this.body()], { type });
  }

  /** Queue a drain of every whole chunk currently buffered. */
  private kick(): void {
    this.sending = this.sending.then(async () => {
      if (this.failure || this.doneId) return;
      try {
        while (this.received - this.sent >= CHUNK_SIZE_BYTES) {
          const id = await this.putRange(this.sent, this.sent + CHUNK_SIZE_BYTES, "*");
          if (id) {
            this.doneId = id;
            return;
          }
        }
      } catch (error) {
        // Held, not thrown: nobody is awaiting this chain, so throwing here
        // would be an unhandled rejection. The next write/finish sees it.
        this.failure = error;
      }
    });
  }

  /**
   * PUT bytes [from, to) declaring `total` ("*" while unknown), or query the
   * session when the range is empty. Exactly one request. Returns the Drive
   * file id when the upload completes, null when the caller should re-derive
   * the next range from `this.sent` and go again, and throws when the upload
   * cannot continue.
   */
  private async putRange(from: number, to: number, total: string): Promise<string | null> {
    const hasBody = to > from;
    const range = hasBody ? `bytes ${from}-${to - 1}/${total}` : `bytes */${total}`;
    const [url, init] = putInit(
      this.sessionUri,
      range,
      hasBody ? this.slice(from, to) : undefined,
      this.options,
      hasBody ? CHUNK_TIMEOUT_MS : QUERY_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (this.options.signal?.aborted) throw error;
      this.attempts += 1;
      if (this.attempts >= MAX_ATTEMPTS) {
        throw new Error("Upload failed after repeated network errors");
      }
      return this.committed();
    }

    if (response.status === 200 || response.status === 201) {
      const json = (await response.json()) as { id?: string };
      if (!json.id) throw new Error("Upload finished without a Drive file id");
      this.advance(this.received);
      return json.id;
    }

    if (response.status === 404 || response.status === 410) {
      throw new Error("Upload session expired. Please try recording again.");
    }

    if (response.status === 308) {
      // A 308 without Range means Drive committed nothing for this chunk.
      const next = offsetFromRange(response.headers.get("range"));
      if (next > this.sent) {
        this.advance(next);
      } else if ((this.attempts += 1) >= MAX_ATTEMPTS) {
        throw new Error("Upload failed: Drive never confirmed the file");
      }
      return null;
    }

    this.attempts += 1;
    if (this.attempts >= MAX_ATTEMPTS) {
      throw new Error(`Upload failed (${response.status})`);
    }
    return this.committed();
  }

  /**
   * Ask Drive how much it actually holds and rewind `sent` to that. Returns an
   * id if Drive says the session is already complete, else null so the caller
   * re-derives its next range from the (possibly rewound) offset — that is
   * what keeps a partial commit from skipping or duplicating bytes.
   */
  private async committed(): Promise<string | null> {
    const [url, init] = putInit(
      this.sessionUri,
      "bytes */*",
      undefined,
      this.options,
      QUERY_TIMEOUT_MS,
    );
    const response = await fetch(url, init);

    if (response.status === 404 || response.status === 410) {
      throw new Error("Upload session expired. Please try recording again.");
    }
    if (response.status === 200 || response.status === 201) {
      const json = (await response.json()) as { id?: string };
      if (!json.id) throw new Error("Upload finished without a Drive file id");
      this.advance(this.received);
      return json.id;
    }
    if (response.status !== 308) {
      throw new Error(`Upload failed while resuming (${response.status})`);
    }

    const next = offsetFromRange(response.headers.get("range"));
    if (next > this.sent) this.attempts = 0;
    this.sent = next;
    this.options.onProgress?.(this.sent);
    return null;
  }

  private advance(to: number): void {
    this.sent = to;
    this.attempts = 0;
    this.options.onProgress?.(this.sent);
  }

  /** Composition of every part so far; Blob slicing is by reference. */
  private body(): Blob {
    if (!this.composite) this.composite = new Blob(this.parts);
    return this.composite;
  }

  private slice(from: number, to: number): Blob {
    return this.body().slice(from, to);
  }
}
