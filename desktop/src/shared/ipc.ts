/**
 * Every IPC channel in the shell, plus the payload types that travel on them.
 * `invoke` channels are request/response; `send` channels are one-way and the
 * comment states the direction.
 *
 * The web-app-facing types here MUST stay identical to
 * `src/lib/recording/types.ts` in the root repo. They are duplicated rather
 * than imported because `desktop/` is a separate package with no path mapping
 * into the Next.js app.
 */

export type SurfacePref = "monitor" | "window" | "browser";
export type BubbleShape = "circle" | "rounded" | "square" | "portrait" | "full";
export type BubbleSize = "small" | "medium" | "large";
export type DesktopShortcut = "toggle" | "pause" | "mark" | "restart" | "cancel";

export interface BubbleAppearance {
  shape: BubbleShape;
  size: BubbleSize;
  mirror: boolean;
  visible: boolean;
}

export interface SourceInfo {
  id: string;
  name: string;
  kind: "screen" | "window";
  /** PNG data URL, 320×180. */
  thumb: string;
  /** PNG data URL of the app icon, windows only. */
  icon?: string;
}

export const IPC = {
  /** app renderer → main. Fire-and-forget surface preference for the picker. */
  setSurfacePref: "yoom:set-surface-pref",
  /** main → app renderer. A global hotkey fired. Payload: DesktopShortcut. */
  shortcut: "yoom:shortcut",
  /** main → app renderer. Bubble was dragged. Payload: { x, y } normalized. */
  bubbleMoved: "yoom:bubble-moved",
  /** app renderer → main. Payload: BubbleAppearance. */
  setBubbleAppearance: "yoom:bubble-appearance",
  /** app renderer → main. Payload: boolean. */
  setBubbleVisible: "yoom:bubble-visible",
  /**
   * app renderer → main. Payload: boolean — true while the encoder is running
   * (status `recording` or `paused`). Drives the auto-hide of the live bubble
   * window for window captures and the YOOM_BUBBLE_HIDE_WHILE_RECORDING
   * escape hatch. See `bubble.ts#setRecordingActive`.
   */
  setRecordingActive: "yoom:recording-active",
  /** app renderer → main. Payload: string | null. */
  setCameraDevice: "yoom:bubble-camera",

  /** main → bubble renderer. Payload: BubbleAppearance. */
  bubbleApply: "yoom:bubble:apply",
  /** main → bubble renderer. Payload: string | null (deviceId). */
  bubbleCamera: "yoom:bubble:camera",
  /** bubble renderer → main. The user clicked "hide" in the control strip. */
  bubbleRequestHide: "yoom:bubble:request-hide",
  /** bubble renderer → main. The user clicked the shape button. */
  bubbleCycleShape: "yoom:bubble:cycle-shape",

  /** main → picker renderer. Payload: PickerPayload. */
  pickerSources: "yoom:picker:sources",
  /** picker renderer → main. Payload: { id: string }. */
  pickerChoose: "yoom:picker:choose",
  /** picker renderer → main. No payload. */
  pickerCancel: "yoom:picker:cancel",
} as const;

export interface PickerPayload {
  sources: SourceInfo[];
  /** Which tab to open on, derived from the last `setSurfacePref`. */
  tab: "screen" | "window";
  /** True when the page asked for audio, so the picker can say so. */
  audioRequested: boolean;
}

export interface BubbleApi {
  onApply(cb: (appearance: BubbleAppearance) => void): void;
  onCamera(cb: (deviceId: string | null) => void): void;
  requestHide(): void;
  cycleShape(): void;
}

export interface PickerApi {
  onSources(cb: (payload: PickerPayload) => void): void;
  choose(id: string): void;
  cancel(): void;
}

declare global {
  interface Window {
    __yoomBubble?: BubbleApi;
    __yoomPicker?: PickerApi;
  }
}
