/**
 * The staging editor's draft (edits + details) lives in `sessionStorage` under
 * this key. Staging writes it; only a *finished upload* (or a discard) may
 * clear it. Save unmounts staging for the render and the upload, and a failure
 * in either drops back to staging — which rebuilds its edits from this draft.
 * Clearing it on Save threw away every cut the moment a render stalled.
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
