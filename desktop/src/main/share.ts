import type { ShareMode, SourceInfo } from "../shared/ipc";

/**
 * The pure half of "the app is ready to record the moment it opens".
 *
 * Kept free of every Electron import so it can be unit-tested: `capture.ts`
 * and `picker.ts` both talk to the window server, this module only decides.
 */

/** What `last-source.json` holds — see `picker.ts#rememberLastSource`. */
export interface LastSource {
  id: string;
  name: string;
  kind: "screen" | "window";
}

/**
 * The remembered source as it appears in TODAY's list, or null.
 *
 * Matched by id first. Window ids (`window:<handle>:0`) are handles, so they do
 * not survive the app — or the captured app — being relaunched; for those, fall
 * back to the same kind with the same title, which is what "Slack" or
 * "Chrome — Yoom" means to the person looking at the grid. Screen ids are
 * stable and hit the first branch.
 *
 * The kind is part of the fallback on purpose: a window named "Screen" must
 * never resolve to a display, because the display branch is what drives cursor
 * tracking and bubble self-occlusion.
 */
export function matchLastSource(
  last: LastSource | null,
  sources: readonly SourceInfo[],
): SourceInfo | null {
  if (!last) return null;
  const exact = sources.find((s) => s.id === last.id);
  if (exact) return exact;
  return sources.find((s) => s.kind === last.kind && s.name === last.name) ?? null;
}

/**
 * The source to answer a display-media request with immediately, or null to
 * open the picker.
 *
 * `forcePick` is the one-shot behind `IPC.changeShare`: the page's "Change"
 * button re-acquires with the picker without giving up auto-share afterwards.
 * With nothing remembered (a fresh install, or the remembered monitor
 * unplugged) auto mode also falls through to the picker — there is nothing to
 * be ready with.
 */
export function autoShareSource(opts: {
  mode: ShareMode;
  forcePick: boolean;
  last: SourceInfo | null;
}): SourceInfo | null {
  if (opts.mode !== "auto") return null;
  if (opts.forcePick) return null;
  return opts.last;
}
