/**
 * Channel names used by `app.ts`, duplicated out of `../shared/ipc`.
 *
 * WHY THE DUPLICATION: preloads run with `sandbox: true`, where a preload is a
 * plain script with no `require` of arbitrary files. If `shared/ipc.ts` stays a
 * *value* import shared by all three preload entries, Rollup emits it as
 * `out/preload/chunks/ipc-*.js` and each preload starts with a `require` of
 * that chunk — which a sandboxed preload cannot resolve, so the bridge never
 * appears. This module has exactly one importer, so Rollup inlines it into
 * `out/preload/app.js` and the bundle stays self-contained.
 *
 * `channels.test.ts` asserts every value here exists in `shared/ipc.ts`'s
 * `IPC`, so drift fails a test rather than silently breaking the bridge.
 */
export const IPC = {
  setSurfacePref: "yoom:set-surface-pref",
  shortcut: "yoom:shortcut",
  bubbleMoved: "yoom:bubble-moved",
  setBubbleAppearance: "yoom:bubble-appearance",
  setBubbleVisible: "yoom:bubble-visible",
  setRecordingActive: "yoom:recording-active",
  setCameraDevice: "yoom:bubble-camera",
  setHudState: "yoom:hud-state",
  cursor: "yoom:cursor",
} as const;
