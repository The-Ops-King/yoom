import type { HudState } from "../../shared/ipc";

/**
 * Duplicated from `src/components/recorder/preview-stage.tsx#formatElapsed` in
 * the web app — the two must agree, because during a take the HUD's timer is
 * the ONLY one on screen and it has to match the review page afterwards.
 */
function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const api = window.__yoomHud;
const time = document.getElementById("time") as HTMLSpanElement;
const markers = document.getElementById("markers") as HTMLSpanElement;
const countdown = document.getElementById("countdown") as HTMLDivElement;
const pause = document.getElementById("pause") as HTMLButtonElement;

const PAUSE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>';
const PLAY_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z"/></svg>';

/**
 * What the countdown shows. Purely presentational — the web app still counts
 * in whole seconds, this only decides the wording.
 *
 * Every take counts from 2 and reads "Ready? · Go!" — no number at all: you
 * are not waiting for the app, you are waiting for yourself. A longer count
 * would show its leading ticks as digits.
 */
export function countdownLabel(seconds: number): string {
  const n = Math.max(1, Math.round(seconds));
  if (n === 1) return "Go!";
  if (n === 2) return "Ready?";
  return String(n);
}

function apply(state: HudState): void {
  const counting = state.status === "countdown";
  document.body.classList.toggle("counting", counting);
  document.body.classList.toggle("paused", state.status === "paused");

  countdown.hidden = !counting;
  if (counting) {
    const label = countdownLabel(state.countdown);
    countdown.textContent = label;
    // A word needs to fit where a single digit did.
    countdown.classList.toggle("word", label.length > 1);
    return;
  }

  time.textContent = formatElapsed(state.elapsedMs);
  markers.hidden = state.markers === 0;
  markers.textContent = state.markers === 1 ? "1 mark" : `${state.markers} marks`;

  const paused = state.status === "paused";
  pause.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
  pause.title = paused ? "Resume (⌘⇧P)" : "Pause (⌘⇧P)";
  pause.setAttribute("aria-label", paused ? "Resume" : "Pause");
}

// `toggle` is "stop" here: the recorder is always mid-take when the HUD is up,
// and the web app's toggle handler maps recording/paused → STOP.
const ACTIONS = [
  ["stop", "toggle"],
  ["pause", "pause"],
  ["mark", "mark"],
  ["restart", "restart"],
  ["cancel", "cancel"],
] as const;

for (const [id, action] of ACTIONS) {
  document.getElementById(id)?.addEventListener("click", () => {
    api?.interact();
    api?.action(action);
  });
}

// Feeds the YOOM_HUD_HIDE_WHILE_RECORDING idle timer in the main process.
// Throttled: a pointermove fires per frame, and the idle timer only needs to
// know "still being used" at a fraction of that rate.
const INTERACT_THROTTLE_MS = 200;
let lastInteract = 0;
function noteInteract(): void {
  const now = Date.now();
  if (now - lastInteract < INTERACT_THROTTLE_MS) return;
  lastInteract = now;
  api?.interact();
}

document.addEventListener("pointerenter", () => noteInteract(), true);
document.addEventListener("pointermove", () => noteInteract(), { passive: true });

/**
 * Dragging the pill.
 *
 * `-webkit-app-region: drag` is deliberately absent from `hud.css`: it never
 * moved this window (see `main/hud.ts#installHudIpc` for why) and leaving it in
 * would mean two mechanisms fighting over the same mouse-down. The gesture is
 * ours end to end — screen coordinates go to main, main calls `setPosition`.
 */
const pill = document.getElementById("pill") as HTMLDivElement;

let dragPointer: number | null = null;
/** The latest un-sent screen point, coalesced to one IPC per animation frame. */
let pendingMove: { x: number; y: number } | null = null;
let moveFrame = 0;

function flushMove(): void {
  moveFrame = 0;
  if (!pendingMove || dragPointer === null) return;
  api?.dragMove(pendingMove);
  pendingMove = null;
}

function endDrag(event: PointerEvent): void {
  if (dragPointer !== event.pointerId) return;
  dragPointer = null;
  pendingMove = null;
  if (moveFrame) {
    cancelAnimationFrame(moveFrame);
    moveFrame = 0;
  }
  if (pill.hasPointerCapture(event.pointerId)) pill.releasePointerCapture(event.pointerId);
  document.body.classList.remove("dragging");
  api?.dragEnd();
}

pill.addEventListener("pointerdown", (event: PointerEvent) => {
  // Left button only, and never on a control: the buttons are the pill's whole
  // point and a drag that starts on one would eat the click.
  if (event.button !== 0 || dragPointer !== null) return;
  if ((event.target as Element | null)?.closest("#controls")) return;

  dragPointer = event.pointerId;
  // Capture so the drag survives the pointer leaving the 284×48 pill — which
  // it always does, because the window moves to follow the cursor.
  pill.setPointerCapture(event.pointerId);
  document.body.classList.add("dragging");
  api?.dragStart({ x: event.screenX, y: event.screenY });
});

pill.addEventListener("pointermove", (event: PointerEvent) => {
  if (dragPointer !== event.pointerId) return;
  // A pointermove can outrun the window server; only the newest point matters.
  pendingMove = { x: event.screenX, y: event.screenY };
  if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
});

pill.addEventListener("pointerup", endDrag);
pill.addEventListener("pointercancel", endDrag);
// Belt and braces: a capture lost to a window change would otherwise strand the
// main process holding a live drag.
pill.addEventListener("lostpointercapture", endDrag);

api?.onApply(apply);
