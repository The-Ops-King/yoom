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
const camera = document.getElementById("camera") as HTMLButtonElement;

const PAUSE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>';
const PLAY_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z"/></svg>';

function apply(state: HudState): void {
  const counting = state.status === "countdown";
  document.body.classList.toggle("counting", counting);
  document.body.classList.toggle("paused", state.status === "paused");

  countdown.hidden = !counting;
  if (counting) {
    countdown.textContent = String(Math.max(1, state.countdown));
    return;
  }

  time.textContent = formatElapsed(state.elapsedMs);
  markers.hidden = state.markers === 0;
  markers.textContent = state.markers === 1 ? "1 mark" : `${state.markers} marks`;

  const paused = state.status === "paused";
  pause.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
  pause.title = paused ? "Resume (⌘⇧P)" : "Pause (⌘⇧P)";
  pause.setAttribute("aria-label", paused ? "Resume" : "Pause");

  camera.setAttribute("aria-pressed", state.bubbleVisible ? "true" : "false");
  camera.title = state.bubbleVisible ? "Hide camera bubble" : "Show camera bubble";
}

// `toggle` is "stop" here: the recorder is always mid-take when the HUD is up,
// and the web app's toggle handler maps recording/paused → STOP.
const ACTIONS = [
  ["stop", "toggle"],
  ["pause", "pause"],
  ["mark", "mark"],
  ["cancel", "cancel"],
  ["camera", "bubbleToggle"],
] as const;

for (const [id, action] of ACTIONS) {
  document.getElementById(id)?.addEventListener("click", () => {
    api?.interact();
    api?.action(action);
  });
}

// Feeds the YOOM_HUD_HIDE_WHILE_RECORDING idle timer in the main process.
document.addEventListener("pointerenter", () => api?.interact(), true);
document.addEventListener("pointermove", () => api?.interact(), { passive: true });

api?.onApply(apply);
