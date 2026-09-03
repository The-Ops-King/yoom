import { createRequire } from "node:module";
import { screen } from "electron";
import { IPC, type HudStatus } from "../shared/ipc";
import { captureDisplayId } from "./capture";
import { Clock, normalize } from "./cursor-track";
import {
  buildKeyNames,
  keyNameFor,
  modsOf,
  normalizeButton,
  shouldExplainInputPermission,
  type InputSample,
  type KeyNames,
} from "./input-track";
import { explainInputMonitoring, isTrustedForInput } from "./permissions";
import { sendToRecorder } from "./windows";

/**
 * Global click and key tracks, desktop half (spec addendum 2026-09-02, "Input
 * tracks (desktop only)").
 *
 * While a take is `recording`, a native hook (`uiohook-napi`, N-API — no
 * rebuild against Electron's ABI) reports every mouse press and key press on
 * the machine, not just the ones aimed at Yoom. Batches ship to the recorder
 * renderer on `IPC.input` every 250 ms; the recorder keeps them in memory and
 * hands them to staging, which seeds the Clicks lane and feeds the `keys`
 * overlay. Nothing is persisted: the raw tracks never land in `videos.edits`
 * and never leave the machine.
 *
 * This is the exact shape of `cursor.ts`, on purpose — same gating, same
 * pause-aware clock, same 250 ms flush — with three differences:
 *
 *  1. It can fail. The hook needs macOS Input Monitoring (Accessibility on
 *     older versions), which cannot be granted from inside the app. Every
 *     failure degrades SILENTLY to cursor-only; the one dialog it ever shows
 *     is capped at once per app run and, after a "Not now", once a week.
 *  2. Clicks need the captured display's bounds to normalize against, exactly
 *     like a cursor sample, so a WINDOW capture produces no clicks. Keys have
 *     no coordinates, so they are recorded for every capture kind.
 *  3. The module is loaded lazily. A missing or unloadable prebuilt binary
 *     must cost the shell nothing more than the feature.
 *
 * PRIVACY: only key NAMES travel ("K", "Enter", "ArrowLeft") plus the
 * modifiers held with them — never the character a key produced, never the
 * focused app, never the window title. That is a deliberate ceiling, not an
 * omission: the shell cannot tell a password field from a search box, so it
 * records nothing that could reconstruct typed text. See `desktop/README.md`,
 * "Input tracks".
 */

/** One IPC hop per batch; matches the cursor track's cadence. */
const FLUSH_MS = 250;
/**
 * Hard cap on the pending batch. A 250 ms window holds a handful of events even
 * under a keyboard-repeat storm; this only matters if the renderer is gone or
 * the event loop stalls, and it bounds what a wedged take can hold.
 */
const MAX_PENDING = 500;

type UiohookModule = typeof import("uiohook-napi");

let hookModule: UiohookModule | null = null;
/** Null until the first load attempt; false once an attempt has failed. */
let hookLoadable: boolean | null = null;
let keyNames: KeyNames | null = null;
let listenersBound = false;
let hookRunning = false;
/**
 * One explainer per app run, at most. `explainInputMonitoring` already caps a
 * declined dialog at one a week ACROSS runs; this caps it at one WITHIN a run,
 * including the case where the user granted nothing and starts take after take.
 */
let explained = false;

let flushTimer: ReturnType<typeof setInterval> | null = null;
let pending: InputSample[] = [];
let lastStatus: HudStatus = "idle";

/**
 * A SEPARATE `Clock` from the cursor track's, started from the same
 * `setHudState` call in the same synchronous block — so the two agree to
 * within the sub-millisecond it takes to run one `if`. Sharing one instance
 * would couple two independent features for no gain; the alignment that
 * actually matters is with the recorder's own `elapsedMs`, and both clocks
 * derive that the same way.
 */
const clock = new Clock();

/**
 * Load `uiohook-napi` on first use, never at import time.
 *
 * `createRequire` rather than a static import: the main bundle is CommonJS, a
 * static import would become a top-level `require` and a missing prebuilt
 * binary for this platform would then take the whole shell down at launch
 * instead of costing it one optional feature.
 */
function loadHook(): UiohookModule | null {
  if (hookLoadable !== null) return hookModule;
  try {
    const nodeRequire = createRequire(__filename);
    hookModule = nodeRequire("uiohook-napi") as UiohookModule;
    keyNames = buildKeyNames(hookModule.UiohookKey as Record<string, number>);
    hookLoadable = true;
  } catch (err) {
    // No prebuild for this platform, or a broken install. Logged once, then
    // the feature simply does not exist.
    console.warn("[yoom] uiohook-napi unavailable; no click or key track", err);
    hookModule = null;
    hookLoadable = false;
  }
  return hookModule;
}

/** The captured display's bounds, or null when the capture is not a display. */
function capturedBounds(): { x: number; y: number; width: number; height: number } | null {
  const id = captureDisplayId();
  if (id === null) return null;
  // Re-read per event rather than caching: a display can be moved, resized or
  // resolution-switched mid-take and a stale rectangle would skew every click.
  const display = screen.getAllDisplays().find((d) => d.id === id);
  return display ? display.bounds : null;
}

/** True only while the take is genuinely producing recorded material. */
function live(): boolean {
  return clock.isRunning && !clock.isPaused;
}

function push(sample: InputSample): void {
  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push(sample);
}

/**
 * Bound ONCE, on the singleton emitter `uiohook-napi` exports. `uIOhook.stop()`
 * does not remove listeners, and re-binding on every take would leak one set
 * per take — so the handlers stay put and gate on the clock instead.
 */
function bindListeners(hook: UiohookModule): void {
  if (listenersBound) return;
  listenersBound = true;

  hook.uIOhook.on("mousedown", (event) => {
    if (!live()) return;
    // Clicks are normalized against the captured display exactly like a cursor
    // sample, so the ripple lands where the pointer was in the frame. A window
    // capture has no fixed rectangle on screen, so it gets no clicks at all —
    // the same rule, and the same reason, as the cursor track.
    const bounds = capturedBounds();
    if (!bounds) return;
    const { x, y } = normalize({ x: event.x, y: event.y }, bounds);
    push({
      kind: "click",
      t: Math.round(clock.elapsed(Date.now())),
      x,
      y,
      button: normalizeButton(event.button),
    });
  });

  hook.uIOhook.on("keydown", (event) => {
    if (!live() || !keyNames) return;
    // A bare ⌘ or ⇧ is a prefix, not a keystroke: dropping it keeps the badge
    // showing "⌘ ⇧ K" once instead of flickering through its own prefixes.
    if (keyNames.modifiers.has(event.keycode)) return;
    push({
      kind: "key",
      t: Math.round(clock.elapsed(Date.now())),
      key: keyNameFor(keyNames.names, event.keycode),
      mods: modsOf(event),
    });
  });
}

function flush(): void {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  sendToRecorder(IPC.input, batch);
}

/**
 * Start the native hook. Every failure path ends in cursor-only behaviour.
 *
 * `uIOhook.start()` throwing is the ONLY permission signal acted on: libuiohook
 * fails the tap and the binding turns it into a `UIOHOOK_ERROR_AXAPI_DISABLED`
 * throw (uiohook-napi @ 1.5.5, `src/lib/addon.c#AddonStart`).
 *
 * `isTrustedForInput()` is logged as a diagnostic and NOTHING more. It reads
 * the Accessibility TCC entry, and the listen-only event tap this hook uses is
 * gated on **Input Monitoring** — a different entry. Gating the dialog on it
 * meant a Mac with Input Monitoring granted but Accessibility not would get the
 * explainer at the top of every single take, for a hook that was working fine.
 */
function startHook(): void {
  if (hookRunning) return;
  const hook = loadHook();
  if (!hook) return;
  bindListeners(hook);

  try {
    hook.uIOhook.start();
  } catch (err) {
    console.warn(
      `[yoom] uIOhook.start() failed; no click or key track (accessibility trusted: ${isTrustedForInput()})`,
      err,
    );
    if (shouldExplainInputPermission({ started: false, alreadyExplained: explained })) {
      // Latched BEFORE the await so two takes in quick succession cannot stack
      // two dialogs; `explainInputMonitoring` adds the once-a-week memory on
      // top, across runs. Fire-and-forget: a take must never wait on a dialog.
      explained = true;
      void explainInputMonitoring().catch(() => {});
    }
    return;
  }

  hookRunning = true;
}

function stopHook(): void {
  if (!hookRunning) return;
  hookRunning = false;
  try {
    hookModule?.uIOhook.stop();
  } catch (err) {
    console.warn("[yoom] uIOhook.stop() failed", err);
  }
}

function startFlush(): void {
  if (!flushTimer) flushTimer = setInterval(flush, FLUSH_MS);
}

function stopFlush(): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}

/**
 * Driven by `hud.ts#setHudState`, the shell's only view of the recorder's state
 * machine. Called on every 4 Hz push; only transitions do anything.
 *
 * Mirrors `cursor.ts#onRecorderStatus` exactly, except that the hook is
 * genuinely stopped while paused rather than merely ignored: a global keyboard
 * tap is not something to leave running over a pause a user may leave sitting
 * for minutes.
 */
export function updateInputTracking(status: HudStatus): void {
  if (status === lastStatus) return;
  const prev = lastStatus;
  lastStatus = status;

  if (status === "recording") {
    if (prev === "paused" && clock.isRunning) clock.resume(Date.now());
    else if (!clock.isRunning || prev === "countdown") {
      clock.start(Date.now());
      pending = [];
    }
    startHook();
    startFlush();
    return;
  }

  if (status === "paused") {
    clock.pause(Date.now());
    stopHook();
    stopFlush();
    flush();
    return;
  }

  stopHook();
  stopFlush();
  flush();
  clock.stop();
  pending = [];
}

/** Quit / teardown. Drops the pending batch: there is no renderer to take it. */
export function stopInputTracking(): void {
  stopHook();
  stopFlush();
  clock.stop();
  pending = [];
  lastStatus = "idle";
}
