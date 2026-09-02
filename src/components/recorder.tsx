"use client";

import { useEffect, useRef, useState } from "react";
import { YoomLogo } from "./logo";
import { DeviceSelector } from "./device-selector";
import { AudioControls } from "./recorder/audio-controls";
import { CameraBubbleControls } from "./recorder/camera-bubble-controls";
import { Countdown } from "./recorder/countdown";
import { FramePicker } from "./recorder/frame-picker";
import { ModePicker } from "./recorder/mode-picker";
import { PreviewStage } from "./recorder/preview-stage";
import { Review } from "./recorder/review";
import { useRecorder } from "@/lib/recording/use-recorder";

export function Recorder() {
  const {
    state,
    capabilities,
    desktop,
    canvasRef,
    screenVideoRef,
    reviewUrl,
    thumbnailUrl,
    dimensions,
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
  const configuring = state.status === "idle" || state.status === "setup";
  const showsCamera = state.mode !== "screen";

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

  if (state.status === "uploading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-5 text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-dim">
            Uploading
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="progress-bar h-1.5 rounded-full bg-accent transition-all duration-500 ease-out"
              style={{ width: `${state.uploadProgress}%` }}
            />
          </div>
          <p className="font-mono text-sm tabular-nums text-muted">
            {state.uploadProgress}%
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      {state.status === "countdown" && (
        <Countdown value={state.countdown} onSkip={actions.skipCountdown} />
      )}

      <PreviewStage
        mode={state.mode}
        status={state.status}
        elapsedMs={state.elapsedMs}
        markFlash={markFlash}
        canvasRef={canvasRef}
        screenVideoRef={screenVideoRef}
        bubble={state.bubble}
        canvasWidth={dimensions.canvasWidth}
        canvasHeight={dimensions.canvasHeight}
        cameraWidth={dimensions.cameraWidth}
        cameraHeight={dimensions.cameraHeight}
        onBubbleMove={(pos, opts) => actions.setBubble({ pos }, opts)}
      />

      {state.status === "review" ? (
        <Review
          videoUrl={reviewUrl}
          thumbnailUrl={thumbnailUrl}
          durationMs={state.durationMs}
          error={state.error}
          onUpload={actions.upload}
          onDiscard={actions.discard}
        />
      ) : (
        <div className="w-full max-w-md space-y-4">
          {state.status === "idle" && (
            <div className="flex justify-center">
              <YoomLogo size="sm" />
            </div>
          )}

          {configuring && desktop && capabilities.systemAudio === "full" && (
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Desktop app · System audio: on
            </p>
          )}

          {configuring && (
            <ModePicker
              mode={state.mode}
              surfacePref={state.surfacePref}
              surface={state.surface}
              disabled={state.status !== "idle" && state.status !== "setup"}
              onModeChange={actions.switchMode}
              onSurfaceChange={actions.setSurfacePref}
            />
          )}

          {state.status === "idle" && showsCamera && (
            <DeviceSelector
              kind="videoinput"
              label="Camera"
              value={state.cameraId}
              onChange={(id) => actions.setDevice("camera", id)}
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

          {(state.status === "setup" || live) && showsCamera && (
            <CameraBubbleControls
              bubble={state.bubble}
              shapeLocked={state.mode === "camera"}
              onChange={actions.setBubble}
            />
          )}

          {(state.status === "setup" || live) && state.mode === "screen+camera" && (
            <FramePicker
              frame={state.frame}
              locked={live || state.status === "countdown"}
              onChange={actions.setFrame}
            />
          )}

          {state.error && (
            <p className="text-center text-sm text-red-400/90">{state.error}</p>
          )}
          {state.notice && (
            <p className="text-center text-sm text-muted">{state.notice}</p>
          )}

          <div className="flex items-center justify-center gap-3">
            {(state.status === "idle" || state.status === "error") && (
              <button
                type="button"
                onClick={actions.acquire}
                className="rounded-lg bg-accent px-8 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-accent/30"
              >
                Set up recording
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

          {(state.status === "setup" || capturing) && (
            <p className="text-center text-[11px] text-muted-dim">
              ⌘⇧L start / stop · ⌘⇧P pause · ⌘⇧M mark · ⌘⇧K restart · ⌘⇧X cancel
            </p>
          )}
        </div>
      )}
    </main>
  );
}
