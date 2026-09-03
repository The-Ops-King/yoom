"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { YoomLogo } from "./logo";
import { DeviceSelector } from "./device-selector";
import { AudioControls } from "./recorder/audio-controls";
import { Countdown } from "./recorder/countdown";
import { PreviewStage } from "./recorder/preview-stage";
import { useRecorder } from "@/lib/recording/use-recorder";
import type { RecordingMode } from "@/lib/recording/types";

/** Bare `screen` is deliberately absent — see the picker below. */
const MODE_OPTIONS: { id: RecordingMode; label: string }[] = [
  { id: "screen+camera", label: "Screen" },
  { id: "camera", label: "Camera only" },
];

// The editor tree is only worth its bundle once there is a take to stage.
const Staging = dynamic(() => import("./staging/staging").then((m) => m.Staging), {
  ssr: false,
});

export function Recorder() {
  const {
    state,
    capabilities,
    desktop,
    screenVideoRef,
    cameraVideoRef,
    staging,
    getLevel,
    actions,
  } = useRecorder();
  const [copied, setCopied] = useState(false);
  const [markFlash, setMarkFlash] = useState(false);
  const markFlashTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (markFlashTimer.current) window.clearTimeout(markFlashTimer.current);
    },
    [],
  );

  // The marker itself is reducer state; this is only the acknowledgement, so
  // it lives here rather than in the machine.
  function mark() {
    actions.mark();
    if (markFlashTimer.current) window.clearTimeout(markFlashTimer.current);
    setMarkFlash(true);
    markFlashTimer.current = window.setTimeout(() => setMarkFlash(false), 300);
  }

  const live = state.status === "recording" || state.status === "paused";
  // Restart and Cancel are reachable from the countdown too; Pause and Stop
  // only make sense once the encoder is actually running.
  const capturing = live || state.status === "countdown";
  // Setup and the take itself share one two-column layout: preview left,
  // controls right. Everything else is a single centred column.
  const twoColumn = state.status === "setup" || capturing;
  const stagingView = state.status === "staging" && staging !== null;

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(state.shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Insecure context — the input is selectable as a fallback.
    }
  }

  if (state.status === "done") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8.5L6.5 12L13 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Recording uploaded</h2>
            <p className="text-sm text-muted">Share the link below</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2.5">
            <input
              readOnly
              aria-label="Share link"
              value={state.shareUrl}
              className="flex-1 truncate bg-transparent text-sm text-muted outline-none"
            />
            <button
              type="button"
              onClick={copyShareUrl}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-accent-hover"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={actions.reset}
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            Record another
          </button>
        </div>
      </main>
    );
  }

  if (state.status === "rendering" || state.status === "uploading") {
    const rendering = state.status === "rendering";
    const progress = rendering ? state.renderProgress : state.uploadProgress;
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-5 text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-dim">
            {rendering ? "Rendering" : "Uploading"}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="progress-bar h-1.5 rounded-full bg-accent transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="font-mono text-sm tabular-nums text-muted">{progress}%</p>
          {rendering && (
            <button
              type="button"
              onClick={actions.cancelRender}
              className="rounded-lg border border-border bg-surface-raised px-5 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main
      className={
        stagingView
          ? "flex min-h-screen flex-col items-center gap-6 p-8"
          : twoColumn
            ? "flex h-screen gap-6 overflow-hidden p-6"
            : "flex h-screen items-center justify-center overflow-hidden p-8"
      }
    >
      {state.status === "countdown" && (
        <Countdown value={state.countdown} onSkip={actions.skipCountdown} />
      )}

      {/*
        A direct child of <main> in every state, and never unmounted: it hides
        itself outside a take so the hook's raw preview refs survive each
        transition. In the two-column layout it *is* the left column.
      */}
      <PreviewStage
        status={state.status}
        elapsedMs={state.elapsedMs}
        markFlash={markFlash}
        screenVideoRef={screenVideoRef}
        cameraVideoRef={cameraVideoRef}
        mirror={state.bubble.mirror}
        // p-6 top+bottom = 3rem; the video is object-contain inside it, so the
        // page itself never scrolls.
        className="h-[calc(100vh-3rem)] min-w-0 flex-1"
      />

      {stagingView && staging ? (
        <Staging
          mode={state.mode}
          screenUrl={staging.screenUrl}
          cameraUrl={staging.cameraUrl}
          durationMs={state.durationMs}
          cameraOffsetMs={state.cameraOffsetMs}
          markers={state.markers}
          cursor={staging.cursor}
          defaults={{ bubble: state.bubble, frame: state.frame }}
          error={state.error}
          onFinish={actions.finish}
          onDiscard={actions.discard}
        />
      ) : (
        <div
          className={
            twoColumn
              ? "flex w-[21rem] shrink-0 flex-col gap-4 overflow-y-auto"
              : "w-full max-w-md space-y-4"
          }
        >
          {state.status === "idle" && (
            <div className="flex justify-center">
              <YoomLogo size="sm" />
            </div>
          )}

          {(state.status === "idle" || state.status === "setup") &&
            desktop &&
            capabilities.systemAudio === "full" && (
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-dim">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Desktop app · System audio: on
              </p>
            )}

          {/*
            Two takes only: "Screen" is screen + camera (the camera is hidden
            in post, never at capture), "Camera only" records the camera alone.
            Bare screen is not offered.
          */}
          {(state.status === "idle" || state.status === "error") && (
            <div
              role="radiogroup"
              aria-label="What to record"
              className="flex gap-1 rounded-lg border border-border bg-surface p-1"
            >
              {MODE_OPTIONS.map((option) => {
                const on = state.mode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => actions.setMode(option.id)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      on
                        ? "bg-surface-raised text-foreground"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}

          {(state.status === "idle" || state.status === "error") && (
            <DeviceSelector
              kind="audioinput"
              label="Microphone"
              value={state.micId}
              onChange={(id) => actions.setDevice("mic", id)}
            />
          )}

          {(state.status === "setup" || live) && (
            <AudioControls
              micOn={state.micOn}
              systemOn={state.systemOn}
              micId={state.micId}
              hasSystemAudio={state.hasSystemAudio}
              live={live}
              capabilities={capabilities}
              getLevel={getLevel}
              onToggleMic={() => actions.toggleMic()}
              onToggleSystem={() => actions.toggleSystem()}
              onMicChange={(id) => actions.setDevice("mic", id)}
            />
          )}

          {(state.status === "idle" ||
            state.status === "error" ||
            state.status === "setup" ||
            live) && (
            <DeviceSelector
              kind="videoinput"
              label="Camera"
              value={state.cameraId}
              onChange={(id) => actions.setDevice("camera", id)}
              disabled={live}
            />
          )}

          {state.error && (
            <p className="text-center text-sm text-red-400/90">{state.error}</p>
          )}
          {state.notice && (
            <p className="text-center text-sm text-muted">{state.notice}</p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2">
            {(state.status === "idle" || state.status === "error") && (
              <button
                type="button"
                onClick={actions.acquire}
                className="rounded-lg bg-accent px-8 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-accent/30"
              >
                {state.mode === "camera" ? "Set up camera" : "Choose what to share"}
              </button>
            )}

            {state.status === "acquiring" && (
              <span className="text-sm text-muted">Waiting for permission…</span>
            )}

            {state.status === "setup" && (
              <>
                <button
                  type="button"
                  onClick={actions.start}
                  className="rounded-lg bg-accent px-8 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover"
                >
                  Start recording
                </button>
                <button
                  type="button"
                  onClick={actions.reset}
                  className="rounded-lg border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </>
            )}

            {capturing && (
              <>
                {live && (
                  <button
                    type="button"
                    onClick={state.status === "paused" ? actions.resume : actions.pause}
                    className="rounded-lg border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:brightness-110"
                  >
                    {state.status === "paused" ? "Resume" : "Pause"}
                  </button>
                )}
                {state.status === "recording" && (
                  <button
                    type="button"
                    onClick={mark}
                    title="Drop a marker (⌘⇧M)"
                    aria-label="Drop a marker"
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium text-foreground transition-all hover:brightness-110"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M4 2v12M4 2.75h7.5l-1.75 2.5 1.75 2.5H4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Mark
                    {state.markers.length > 0 && (
                      <span className="font-mono text-xs tabular-nums text-muted">
                        {state.markers.length}
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={actions.restartNow}
                  title="Restart now (⌘⇧K)"
                  aria-label="Restart recording"
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M13.5 8a5.5 5.5 0 1 1-1.9-4.16M13.5 2.5V6H10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Restart
                </button>
                <button
                  type="button"
                  onClick={actions.cancel}
                  title="Cancel recording (⌘⇧X)"
                  aria-label="Cancel recording"
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-2.5 text-sm font-medium text-red-400/90 transition-colors hover:bg-red-500/10 hover:text-red-300"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9a1 1 0 0 0 1 .95h4.8a1 1 0 0 0 1-.95L12 4M6.5 6.75v4.5M9.5 6.75v4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Cancel
                </button>
                {live && (
                  <button
                    type="button"
                    onClick={actions.stop}
                    className="rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-hover"
                  >
                    Stop
                  </button>
                )}
              </>
            )}
          </div>

          <p className="text-center text-[11px] leading-relaxed text-muted-dim">
            ⌘⇧L start / stop · ⌘⇧P pause · ⌘⇧M mark · ⌘⇧K restart · ⌘⇧X cancel
            {desktop && " · this window hides while recording — use the controls pill"}
          </p>
        </div>
      )}
    </main>
  );
}
