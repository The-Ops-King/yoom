/**
 * The staging editor's draft (edits + details) lives in `sessionStorage` under
 * this key. Staging writes it, and exactly three things may clear it: a
 * *finished upload*, a *discard*, and *restoring a take that has no stored
 * draft of its own* (use-recorder's restore path — `readDraft` matches on
 * duration alone, so a stale draft would otherwise follow the wrong take into
 * staging). Nothing else. Save unmounts staging for the render and the upload,
 * and a failure in either drops back to staging — which rebuilds its edits
 * from this draft. Clearing it on Save threw away every cut the moment a
 * render stalled.
 *
 * The media does not survive a reload (the blobs die and the recorder returns
 * to idle), so the entry is keyed by the take's duration.
 */
export const STAGING_DRAFT_KEY = "yoom.staging.v1";

export function clearStagingDraft(): void {
  try {
    sessionStorage.removeItem(STAGING_DRAFT_KEY);
  } catch {
    /* no storage: nothing to clear */
  }
}
