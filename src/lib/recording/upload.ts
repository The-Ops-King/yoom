import { uploadToDrive } from "@/lib/upload-client";

export interface UploadRecordingInput {
  blob: Blob;
  durationMs: number;
  width: number | null;
  height: number | null;
  /** JPEG grabbed ~1s into the recording; a missing thumbnail is not fatal. */
  thumbnail: Blob | null;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}

export interface UploadRecordingResult {
  id: string;
  slug: string;
  url: string;
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
 * The Phase 1 flow, unchanged: mint a resumable session, PUT the blob to Drive
 * in chunks, record the metadata, then attach the thumbnail.
 */
export async function uploadRecording(
  input: UploadRecordingInput,
): Promise<UploadRecordingResult> {
  const { blob, durationMs, width, height, thumbnail, onProgress, signal } = input;

  if (blob.size === 0) {
    throw new Error("Recording captured no data. Please try again.");
  }

  const now = new Date();
  const mimeType = blob.type || "video/webm";

  const sessionRes = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mimeType,
      sizeBytes: blob.size,
      filename: filenameFor(now, extensionFor(mimeType)),
    }),
    signal,
  });
  if (!sessionRes.ok) throw new Error("Failed to start the upload");

  const { sessionUri } = (await sessionRes.json()) as { sessionUri: string };

  const { id: driveFileId } = await uploadToDrive(blob, sessionUri, onProgress);

  const completeRes = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      driveFileId,
      durationMs,
      width,
      height,
      title: defaultRecordingTitle(now),
    }),
    signal,
  });
  if (!completeRes.ok) throw new Error("Failed to save the recording");

  const { id, slug, url } = (await completeRes.json()) as UploadRecordingResult;

  if (thumbnail) {
    const form = new FormData();
    form.set("videoId", id);
    form.set("file", thumbnail, "thumbnail.jpg");
    await fetch("/api/upload/thumbnail", { method: "POST", body: form }).catch(
      () => undefined,
    );
  }

  return { id, slug, url };
}
