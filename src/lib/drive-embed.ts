/**
 * Google Drive's own player, used as the watch page's fallback.
 *
 * When the native `<video>` raises a `MediaError` the viewer would otherwise
 * be left looking at the word "error" — which is the whole complaint this
 * exists to answer. Drive renders the same file with its own player, so the
 * viewer sees the recording even when our player cannot decode it.
 *
 * The file must be shared "anyone with the link" on Drive for this to render;
 * a private file shows Drive's sign-in page inside the frame instead.
 */

/** Drive file ids are URL-safe base64-ish: letters, digits, `-` and `_`. */
export const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * Drive's embeddable player URL, or null when the id is not a Drive id.
 *
 * The id comes from a database column and is interpolated into an iframe
 * `src`, so it is validated rather than escaped: anything that is not the
 * documented shape is refused outright.
 */
export function drivePreviewUrl(fileId: string | null | undefined): string | null {
  if (!fileId || !DRIVE_FILE_ID_RE.test(fileId)) return null;
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED",
  2: "MEDIA_ERR_NETWORK",
  3: "MEDIA_ERR_DECODE",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
};

/** Human-readable name for a `MediaError.code`, for logs and the library UI. */
export function mediaErrorName(code: number | null | undefined): string {
  return (code != null && MEDIA_ERROR_NAMES[code]) || "MEDIA_ERR_UNKNOWN";
}

/**
 * A `MediaError.code` we are willing to store, or null.
 *
 * The value arrives from the public network, so only the four codes the spec
 * defines are accepted — the column is a smallint and junk belongs nowhere
 * near it.
 */
export function normalizeErrorCode(code: unknown): number | null {
  if (typeof code !== "number" || !Number.isInteger(code)) return null;
  return code >= 1 && code <= 4 ? code : null;
}
