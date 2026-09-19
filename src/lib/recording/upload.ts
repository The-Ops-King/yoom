import type { VideoEdits } from "@/lib/edits";
import { shareUrl } from "@/lib/share";
import { uploadToDrive } from "@/lib/upload-client";

export interface UploadRecordingInput {
  blob: Blob;
  durationMs: number;
  width: number | null;
  height: number | null;
  /** JPEG grabbed ~1s into the recording; a missing thumbnail is not fatal. */
  thumbnail: Blob | null;
  onProgress: (percent: number) => void;
  title: string;
  description: string;
  /** The slug the user chose in staging; empty means "let the server pick". */
  slug: string;
  /** The whole staging edit list; the server re-validates it. */
  edits: VideoEdits;
  /**
   * Called with the share URL for the slug `/api/upload` reserved, right after
   * that round-trip and before a single byte goes to Drive. The recorder copies
   * it to the clipboard there, while the click's transient activation is still
   * alive — by the time the upload finishes it is long gone.
   */
  onSlug?: (url: string) => void;
  signal?: AbortSignal;
}

export interface UploadRecordingResult {
  id: string;
  slug: string;
  url: string;
  /** True when a late slug collision forced the server to mint a different one. */
  slugChanged?: boolean;
}

/**
 * Default title generated client-side so it reflects the recorder's local time
 * zone rather than the server's (UTC on Vercel).
 */
export function defaultRecordingTitle(now: Date = new Date()): string {
  return `Recording — ${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now)}`;
}

function filenameFor(now: Date, extension: string): string {
  return `yoom-${now.toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

function extensionFor(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

/**
 * Opens the resumable Drive session (and, with it, the share slug). Split out
 * of `uploadRecording` so the fast exporter can open the session up front and
 * stream bytes into it while the export is still rendering; `sizeBytes` is
 * omitted for that streamed case, since the final size isn't known yet.
 */
export async function beginUpload(input: {
  mimeType: string;
  sizeBytes?: number;
  slug: string;
  signal?: AbortSignal;
}): Promise<{ sessionUri: string; slug?: string }> {
  const { mimeType, sizeBytes, slug, signal } = input;

  const sessionRes = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mimeType,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      filename: filenameFor(new Date(), extensionFor(mimeType)),
      slug: slug || undefined,
    }),
    signal,
  });
  if (!sessionRes.ok) {
    let message = "Failed to start the upload";
    try {
      const errorBody = (await sessionRes.json()) as { error?: string };
      if (typeof errorBody.error === "string" && errorBody.error) message = errorBody.error;
    } catch {
      // Malformed or empty body: keep the fallback message.
    }
    throw new Error(message);
  }

  return (await sessionRes.json()) as { sessionUri: string; slug?: string };
}

/**
 * Records the finished upload's metadata against the Drive file, then
 * attaches the thumbnail. Split out of `uploadRecording` so the fast exporter
 * can call it once its own streamed PUT to Drive has finished. The thumbnail
 * POST lives here (not with the caller) because every completion path — the
 * whole-file fallback and the streamed export — needs it fired the same way,
 * right after the video row exists and best-effort.
 */
export async function completeUpload(input: {
  driveFileId: string;
  reservedSlug?: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  title: string;
  description: string;
  edits: VideoEdits;
  thumbnail: Blob | null;
  signal?: AbortSignal;
}): Promise<UploadRecordingResult> {
  const {
    driveFileId,
    reservedSlug,
    durationMs,
    width,
    height,
    title,
    description,
    edits,
    thumbnail,
    signal,
  } = input;

  const completeRes = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      driveFileId,
      durationMs,
      width,
      height,
      title: title.trim() || defaultRecordingTitle(),
      description,
      slug: reservedSlug,
      edits,
    }),
    signal,
  });
  if (!completeRes.ok) throw new Error("Failed to save the recording");

  const {
    id,
    slug: finalSlug,
    url,
    slugChanged,
  } = (await completeRes.json()) as UploadRecordingResult;

  if (thumbnail) {
    const form = new FormData();
    form.set("videoId", id);
    form.set("file", thumbnail, "thumbnail.jpg");
    await fetch("/api/upload/thumbnail", { method: "POST", body: form }).catch(
      () => undefined,
    );
  }

  return { id, slug: finalSlug, url, slugChanged };
}

/**
 * The Phase 1 flow, unchanged: mint a resumable session, PUT the blob to Drive
 * in chunks, record the metadata, then attach the thumbnail.
 */
export async function uploadRecording(
  input: UploadRecordingInput,
): Promise<UploadRecordingResult> {
  const {
    blob,
    durationMs,
    width,
    height,
    thumbnail,
    onProgress,
    title,
    description,
    slug,
    edits,
    onSlug,
    signal,
  } = input;

  if (blob.size === 0) {
    throw new Error("Recording captured no data. Please try again.");
  }

  const mimeType = blob.type || "video/webm";

  const { sessionUri, slug: reservedSlug } = await beginUpload({
    mimeType,
    sizeBytes: blob.size,
    slug,
    signal,
  });

  if (reservedSlug && onSlug) {
    // A failing callback (clipboard denied, insecure context) must never cost
    // the user their recording.
    try {
      onSlug(shareUrl(reservedSlug));
    } catch {
      // ignored
    }
  }

  const { id: driveFileId } = await uploadToDrive(blob, sessionUri, onProgress);

  return completeUpload({
    driveFileId,
    reservedSlug,
    durationMs,
    width,
    height,
    title,
    description,
    edits,
    thumbnail,
    signal,
  });
}
