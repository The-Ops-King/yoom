import type { BubbleAppearance, BubbleShape } from "../../shared/ipc";

// Duplicated from desktop/src/main/mapping.ts: the renderer is bundled for the
// DOM and must not pull the main-process module (and its electron import) in.
// The values are asserted in mapping.test.ts.
const BUBBLE_RADIUS_PERCENT = 14;

function shapeToCss(
  shape: BubbleShape,
  mirror: boolean,
): { borderRadius: string; transform: string } {
  const borderRadius =
    shape === "circle"
      ? "50%"
      : shape === "square"
        ? "0px"
        : `${BUBBLE_RADIUS_PERCENT}%`;
  return { borderRadius, transform: mirror ? "scaleX(-1)" : "none" };
}

const api = window.__yoomBubble;
const video = document.getElementById("cam") as HTMLVideoElement;
const shape = document.getElementById("shape") as HTMLDivElement;
const cycleButton = document.getElementById("cycle") as HTMLButtonElement;
const hideButton = document.getElementById("hide") as HTMLButtonElement;

let stream: MediaStream | null = null;
/**
 * The device the live stream belongs to, or `undefined` when there is no live
 * stream. Reset by `release()` so the next `onCamera` for the SAME device still
 * re-acquires instead of short-circuiting on "already open".
 */
let openingFor: string | null | undefined;
/** The last device main asked for, so `release()` → show can re-acquire it. */
let lastDeviceId: string | null = null;

function stopStream(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

/**
 * Hard release: stop every track AND clear `srcObject`. Chromium keeps the
 * capture device open for a `<video>` still pointing at a stopped stream, which
 * is what keeps the macOS camera indicator lit after the bubble is hidden.
 */
function release(): void {
  stopStream();
  video.srcObject = null;
  openingFor = undefined;
}

async function openCamera(deviceId: string | null): Promise<void> {
  lastDeviceId = deviceId;
  if (openingFor === deviceId && stream) return;
  openingFor = deviceId;
  stopStream();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    document.body.classList.remove("no-camera");
    await video.play().catch(() => {});
  } catch {
    // The recorder itself already owns the camera on some macOS setups, or the
    // device is gone. Show the placeholder rather than an empty transparent hole.
    document.body.classList.add("no-camera");
  }
}

function apply(appearance: BubbleAppearance): void {
  const css = shapeToCss(appearance.shape, appearance.mirror);
  shape.style.borderRadius = css.borderRadius;
  // Mirror the pixels only — the control strip lives outside #shape so it never
  // ends up reversed.
  video.style.transform = css.transform;
}

cycleButton.addEventListener("click", () => api?.cycleShape());
hideButton.addEventListener("click", () => api?.requestHide());
window.addEventListener("pagehide", release);

api?.onApply(apply);
api?.onCamera((deviceId) => void openCamera(deviceId));
// Main sends this on every hide path. `lastDeviceId` is what makes the
// re-acquire on the next show transparent to the user.
api?.onRelease(release);
