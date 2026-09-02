/** Drive requires chunk sizes that are multiples of 256 KiB. */
export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
/** Used when routing through /api/upload/chunk (Vercel caps bodies at 4.5 MB). */
export const PROXY_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;

const MAX_ATTEMPTS = 5;

export type UploadResult = { id: string };
export type ProgressCallback = (percent: number) => void;

export type UploadOptions = {
  /** Chunk size in bytes; must be a multiple of 256 KiB. */
  chunkSize?: number;
  /** Route chunks through the server proxy instead of straight to Drive. */
  proxyUrl?: string;
  signal?: AbortSignal;
};

function putInit(
  sessionUri: string,
  contentRange: string,
  body: BodyInit | undefined,
  options: UploadOptions,
): [string, RequestInit] {
  if (options.proxyUrl) {
    return [
      options.proxyUrl,
      {
        method: "PUT",
        headers: {
          "x-upload-session-uri": sessionUri,
          "x-upload-content-range": contentRange,
          "Content-Type": "application/octet-stream",
        },
        body,
        signal: options.signal,
      },
    ];
  }
  return [
    sessionUri,
    {
      method: "PUT",
      headers: { "Content-Range": contentRange },
      body,
      signal: options.signal,
    },
  ];
}

/** Parse `Range: bytes=0-N` into the next byte offset to send. */
function offsetFromRange(header: string | null): number {
  if (!header) return 0;
  const match = /bytes=0-(\d+)/.exec(header);
  return match ? Number(match[1]) + 1 : 0;
}

async function queryOffset(
  sessionUri: string,
  total: number,
  options: UploadOptions,
): Promise<number> {
  const [url, init] = putInit(sessionUri, `bytes */${total}`, undefined, options);
  const response = await fetch(url, init);

  if (response.status === 404 || response.status === 410) {
    throw new Error("Upload session expired. Please try recording again.");
  }
  if (response.status === 200 || response.status === 201) {
    return total;
  }
  if (response.status !== 308) {
    throw new Error(`Upload failed while resuming (${response.status})`);
  }
  return offsetFromRange(response.headers.get("range"));
}

/**
 * Upload a blob to a Drive resumable session URI in fixed-size chunks.
 * Resolves with the created Drive file id.
 */
export async function uploadToDrive(
  blob: Blob,
  sessionUri: string,
  onProgress?: ProgressCallback,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const total = blob.size;
  if (total === 0) throw new Error("Nothing to upload");

  const chunkSize =
    options.chunkSize ??
    (options.proxyUrl ? PROXY_CHUNK_SIZE_BYTES : CHUNK_SIZE_BYTES);

  let offset = 0;
  let attempts = 0;

  onProgress?.(0);

  while (offset < total) {
    const end = Math.min(offset + chunkSize, total);
    const contentRange = `bytes ${offset}-${end - 1}/${total}`;
    const [url, init] = putInit(
      sessionUri,
      contentRange,
      blob.slice(offset, end),
      options,
    );

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        throw new Error("Upload failed after repeated network errors");
      }
      offset = await queryOffset(sessionUri, total, options);
      onProgress?.(Math.round((offset / total) * 100));
      continue;
    }

    if (response.status === 200 || response.status === 201) {
      const json = (await response.json()) as { id?: string };
      if (!json.id) throw new Error("Upload finished without a Drive file id");
      onProgress?.(100);
      return { id: json.id };
    }

    if (response.status === 308) {
      const next = offsetFromRange(response.headers.get("range"));
      offset = next > offset ? next : end;
      onProgress?.(Math.round((offset / total) * 100));
      continue;
    }

    if (response.status === 404 || response.status === 410) {
      throw new Error("Upload session expired. Please try recording again.");
    }

    attempts += 1;
    if (attempts >= MAX_ATTEMPTS) {
      throw new Error(`Upload failed (${response.status})`);
    }
    offset = await queryOffset(sessionUri, total, options);
    onProgress?.(Math.round((offset / total) * 100));
  }

  // Every byte was acknowledged by a 308 but Drive never returned the file id.
  throw new Error("Upload failed: Drive never confirmed the file");
}
