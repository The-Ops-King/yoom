"use client";

import { useState } from "react";
import { YoomLogo } from "./logo";
import { DeviceSelector } from "./device-selector";
import { AudioControls } from "./recorder/audio-controls";
import { BackgroundPicker } from "./recorder/background-picker";
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
    canvasRef,
    screenVideoRef,
    reviewUrl,
    thumbnailUrl,
    dimensions,
    getLevel,
    actions,
  } = useRecorder();
  const [copied, setCopied] = useState(false);

  const live = state.status === "recording" || state.status === "paused";
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
        canvasRef={canvasRef}
        screenVideoRef={screenVideoRef}
        bubble={state.bubble}
        canvasWidth={dimensions.canvasWidth}
        canvasHeight={dimensions.canvasHeight}
        cameraWidth={dimensions.cameraWidth}
        cameraHeight={dimensions.cameraHeight}
        onBubbleMove={(pos) => actions.setBubble({ pos })}
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

          {configuring && (
            <ModePicker
              mode={state.mode}
              surfacePref={state.surfacePref}
              surface={state.surface}
              disabled={state.status !== "idle"}
              onModeChange={actions.selectMode}
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
            <>
              <CameraBubbleControls
                bubble={state.bubble}
                shapeLocked={state.mode === "camera"}
                onChange={actions.setBubble}
              />
              <BackgroundPicker
                background={state.background}
                onChange={actions.setBackground}
              />
            </>
          )}

          {(state.status === "setup" || live) && state.mode === "screen+camera" && (
            <FramePicker frame={state.frame} locked={live} onChange={actions.setFrame} />
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

            {live && (
              <>
                <button
                  type="button"
                  onClick={state.status === "paused" ? actions.resume : actions.pause}
                  className="rounded-lg border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:brightness-110"
                >
                  {state.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={actions.restart}
                  className="rounded-lg border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Restart
                </button>
                <button
                  type="button"
                  onClick={actions.stop}
                  className="rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-hover"
                >
                  Stop
                </button>
              </>
            )}
          </div>

          {(state.status === "setup" || live) && (
            <p className="text-center text-[11px] text-muted-dim">
              ⌘⇧L start / stop · ⌘⇧P pause
            </p>
          )}
        </div>
      )}
    </main>
  );
}
