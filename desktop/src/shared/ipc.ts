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

/**
 * How the next `getDisplayMedia` request is answered.
 *
 * `"auto"` — the default — re-shares whatever was recorded last time without
 * showing anything, which is what makes the app ready to record the moment it
 * opens. `"pick"` always opens the native picker. The page can also ask for a
 * one-shot pick with `IPC.changeShare` without leaving `"auto"` behind.
 *
 * MUST stay identical to `ShareMode` in `src/lib/recording/types.ts`.
 */
export type ShareMode = "auto" | "pick";

/**
 * The source the shell is currently sharing with the page, announced on
 * `IPC.shareSource` so the page can name it ("Sharing: Display 1") and offer a
 * "Change" button.
 *
 * MUST stay identical to `ShareSource` in `src/lib/recording/types.ts`.
 */
export interface ShareSource {
  id: string;
  name: string;
  kind: "screen" | "window";
}
export type BubbleShape = "circle" | "rounded" | "square" | "portrait" | "full";
export type BubbleSize = "small" | "medium" | "large";
export type DesktopShortcut =
  | "toggle"
  | "pause"
  | "mark"
  | "restart"
  | "cancel";

/**
 * The subset of the web app's `RecorderStatus` the HUD needs. Everything the
 * HUD does not distinguish collapses to `"other"`, so the shell never mirrors
 * the full state machine.
 *
 * MUST stay identical to `HudStatus` in `src/lib/recording/types.ts`.
 */
export type HudStatus =
  | "idle"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "staging"
  | "rendering"
  | "error"
  | "other";

/** MUST stay identical to `HudState` in `src/lib/recording/types.ts`. */
export interface HudState {
  status: HudStatus;
  elapsedMs: number;
  countdown: number;
  /** A COUNT, not the marker array — this rides a ~4 Hz push. */
  markers: number;
}

/** A point in SCREEN coordinates — `PointerEvent.screenX/screenY`. */
export interface HudDragPoint {
  x: number;
  y: number;
}

export interface BubbleAppearance {
  shape: BubbleShape;
  size: BubbleSize;
  mirror: boolean;
  visible: boolean;
  /**
   * True when the web app's framed capture is on. Framed capture insets the
   * screen inside a larger canvas, so the composited bubble and the live
   * bubble window no longer occupy the same pixels and self-occlusion stops
   * working — `bubble.ts#shouldShow` hides the live window while recording.
   */
  framed: boolean;
  /**
   * The live camera track's width/height, when known. `rounded` bubbles
   * follow the camera's real aspect ratio rather than assuming 16:9, so the
   * floating window needs it too — otherwise a 4:3 webcam breaks
   * self-occlusion. See `src/lib/recording/types.ts` in the root repo.
   */
  cameraAspect?: number;
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
  /**
   * app renderer → main. Payload: ShareMode. Sticky, defaults to `"auto"`.
   * See `main/capture.ts`.
   */
  setShareMode: "yoom:set-share-mode",
  /**
   * app renderer → main. No payload. "Let me choose the source again": forces
   * the picker for the NEXT display-media request only, without changing the
   * sticky mode. Consumed when a source is actually resolved, so cancelling
   * the picker and pressing record again still opens it.
   */
  changeShare: "yoom:change-share",
  /**
   * main → app renderer. Payload: `ShareSource | null`. Sent after every
   * resolved capture source — auto-shared or picked — and `null` when the take
   * ends or the request is denied.
   */
  shareSource: "yoom:share-source",
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

  /** app renderer → main. Payload: HudState. ~4 Hz while a take is live. */
  setHudState: "yoom:hud-state",

  /**
   * main → app renderer. Payload: CursorSample[]. Batched every ~250 ms while
   * the take is `recording` and the capture is a display. See `main/cursor.ts`.
   */
  cursor: "yoom:cursor",

  /**
   * main → app renderer. Payload: InputSample[]. Batched every ~250 ms while
   * the take is `recording` and the native input hook is running. See
   * `main/input.ts`. Absent entirely when Input Monitoring is not granted.
   */
  input: "yoom:input",

  /** main → HUD renderer. Payload: HudState. */
  hudApply: "yoom:hud:apply",
  /** HUD renderer → main. Payload: DesktopShortcut. */
  hudAction: "yoom:hud:action",
  /**
   * HUD renderer → main. No payload. Resets the idle timer behind
   * YOOM_HUD_HIDE_WHILE_RECORDING. Sent on hover and on every click.
   */
  hudInteract: "yoom:hud:interact",

  /**
   * HUD renderer → main. Payload: `{ x, y }` in SCREEN coordinates.
   *
   * The pill is dragged by the app, not by the window server: see
   * `main/hud.ts#installHudIpc` for why `-webkit-app-region: drag` never
   * worked here. `hudDragStart` latches the window's bounds and the grab
   * point, `hudDragMove` moves the window by the delta since that point, and
   * `hudDragEnd` (no payload) drops the latch.
   */
  hudDragStart: "yoom:hud:drag-start",
  /** HUD renderer → main. Payload: `{ x, y }` in screen coordinates. */
  hudDragMove: "yoom:hud:drag-move",
  /** HUD renderer → main. No payload. */
  hudDragEnd: "yoom:hud:drag-end",

  /** main → bubble renderer. Payload: BubbleAppearance. */
  bubbleApply: "yoom:bubble:apply",
  /** main → bubble renderer. Payload: string | null (deviceId). */
  bubbleCamera: "yoom:bubble:camera",

  /**
   * main → bubble renderer. No payload. "Stop the camera NOW."
   *
   * Hiding the window is not enough: a hidden renderer keeps its
   * `getUserMedia` tracks live, which keeps the macOS camera indicator lit
   * after the recording is over. The renderer stops every track and clears
   * `srcObject`; the next `bubbleCamera` re-acquires.
   */
  bubbleRelease: "yoom:bubble:release",
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

/**
 * One sampled cursor position, for the staging editor's mouse-follow zoom.
 *
 * MUST stay identical to `CursorSample` in `src/lib/recording/types.ts` (and
 * to the copy in `main/cursor-track.ts`).
 */
export interface CursorSample {
  /** Milliseconds of RECORDED material since the take started, paused time excluded. */
  t: number;
  /** 0..1 across the captured display, clamped to [-0.1, 1.1]. */
  x: number;
  y: number;
}

/**
 * One global mouse click, for the staging editor's Clicks lane.
 *
 * MUST stay identical to `ClickSample` in `src/lib/recording/types.ts` (and to
 * the copy in `main/input-track.ts`).
 */
export interface ClickSample {
  /** Milliseconds of RECORDED material since the take started, paused time excluded. */
  t: number;
  /** 0..1 across the captured display, clamped to [-0.1, 1.1] — same space as `CursorSample`. */
  x: number;
  y: number;
  /** 0 = left, 1 = right, 2 = middle. */
  button: number;
}

/** MUST stay identical to `KeyMod` in `src/lib/recording/types.ts`. */
export type KeyMod = "meta" | "ctrl" | "alt" | "shift";

/**
 * One global key press. `key` is a NAME ("K", "Enter", "ArrowLeft"), never the
 * character the key produced — see the privacy note in `main/input.ts`.
 *
 * MUST stay identical to `KeySample` in `src/lib/recording/types.ts`.
 */
export interface KeySample {
  t: number;
  key: string;
  mods: KeyMod[];
}

/**
 * What travels on `IPC.input`: one mixed, time-ordered batch, so a click and
 * the key pressed with it keep their relative order.
 *
 * MUST stay identical to `InputSample` in `src/lib/recording/types.ts`.
 */
export type InputSample =
  | ({ kind: "click" } & ClickSample)
  | ({ kind: "key" } & KeySample);

export interface PickerPayload {
  sources: SourceInfo[];
  /** Which tab to open on, derived from the last `setSurfacePref`. */
  tab: "screen" | "window";
  /** True when the page asked for audio, so the picker can say so. */
  audioRequested: boolean;
  /**
   * The source recorded last time, if it is still in `sources`. Preselected
   * and badged "Last time" — the picker is never skipped (macOS wants a
   * deliberate choice every take), but the previous pick is the default.
   */
  lastSourceId?: string | null;
}

export interface BubbleApi {
  onApply(cb: (appearance: BubbleAppearance) => void): void;
  onCamera(cb: (deviceId: string | null) => void): void;
  onRelease(cb: () => void): void;
  requestHide(): void;
  cycleShape(): void;
}

export interface PickerApi {
  onSources(cb: (payload: PickerPayload) => void): void;
  choose(id: string): void;
  cancel(): void;
}

export interface HudApi {
  onApply(cb: (state: HudState) => void): void;
  action(action: DesktopShortcut): void;
  interact(): void;
  /** Manual window drag — see `IPC.hudDragStart`. Screen coordinates. */
  dragStart(point: HudDragPoint): void;
  dragMove(point: HudDragPoint): void;
  dragEnd(): void;
}

declare global {
  interface Window {
    __yoomBubble?: BubbleApi;
    __yoomPicker?: PickerApi;
    __yoomHud?: HudApi;
  }
}
