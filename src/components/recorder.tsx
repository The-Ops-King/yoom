"use client";

import { useState, useRef, useCallback } from "react";
import fixWebmDuration from "fix-webm-duration";
import { DeviceSelector } from "./device-selector";
import { RecordingPreview } from "./recording-preview";
import { YoomLogo } from "./logo";
import { uploadToDrive } from "@/lib/upload-client";

type RecordingMode = "screen" | "camera" | "screen+camera";
type RecorderState = "idle" | "recording" | "uploading" | "done";

export function Recorder() {
  const [mode, setMode] = useState<RecordingMode>("screen");
  const [micId, setMicId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const thumbnailTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number>(0);
  const screenVideoElRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoElRef = useRef<HTMLVideoElement | null>(null);
  const recordStartedAtRef = useRef<number>(0);
  const recordEndedAtRef = useRef<number>(0);
  const thumbnailRef = useRef<Blob | null>(null);

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const stopAllStreams = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    cameraStreamRef.current = null;
    setScreenStream(null);
    setCameraStream(null);
    if (timerRef.current) clearInterval(timerRef.current);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    screenVideoElRef.current = null;
    cameraVideoElRef.current = null;
    if (thumbnailTimerRef.current) {
      window.clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = null;
    }
  }, []);

  function startCanvasCompositing(
    canvas: HTMLCanvasElement,
    screen: MediaStream,
    camera: MediaStream,
  ): Promise<void> {
    const screenVideo = document.createElement("video");
    screenVideo.srcObject = screen;
    screenVideo.muted = true;
    screenVideo.playsInline = true;
    screenVideo.play();
    screenVideoElRef.current = screenVideo;

    const cameraVideo = document.createElement("video");
    cameraVideo.srcObject = camera;
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    cameraVideo.play();
    cameraVideoElRef.current = cameraVideo;

    const ctx = canvas.getContext("2d")!;

    return new Promise<void>((resolve) => {
      let resolved = false;
      let lastW = 0;
      let lastH = 0;
      let lastCamW = 0;
      let lastCamH = 0;
      let clipPath: Path2D | null = null;
      let strokePath: Path2D | null = null;
      let camX = 0;
      let camY = 0;
      let camWidth = 0;
      let camHeight = 0;

      function rebuildOverlay(w: number, h: number, cw: number, ch: number) {
        camWidth = Math.round(w * 0.2);
        camHeight = Math.round(camWidth * (ch / (cw || 1)));
        const padding = 20;
        camX = w - camWidth - padding;
        camY = h - camHeight - padding;
        const r = 12;

        const p = new Path2D();
        p.moveTo(camX + r, camY);
        p.lineTo(camX + camWidth - r, camY);
        p.quadraticCurveTo(camX + camWidth, camY, camX + camWidth, camY + r);
        p.lineTo(camX + camWidth, camY + camHeight - r);
        p.quadraticCurveTo(camX + camWidth, camY + camHeight, camX + camWidth - r, camY + camHeight);
        p.lineTo(camX + r, camY + camHeight);
        p.quadraticCurveTo(camX, camY + camHeight, camX, camY + camHeight - r);
        p.lineTo(camX, camY + r);
        p.quadraticCurveTo(camX, camY, camX + r, camY);
        p.closePath();
        clipPath = p;
        strokePath = new Path2D(p);

        lastW = w;
        lastH = h;
        lastCamW = cw;
        lastCamH = ch;
      }

      function draw() {
        const sw = screenVideo.videoWidth;
        const sh = screenVideo.videoHeight;

        if (sw > 0) {
          if (canvas.width !== sw || canvas.height !== sh) {
            canvas.width = sw;
            canvas.height = sh;
          }

          const cw = cameraVideo.videoWidth;
          const ch = cameraVideo.videoHeight;
          if (sw !== lastW || sh !== lastH || cw !== lastCamW || ch !== lastCamH) {
            rebuildOverlay(sw, sh, cw, ch);
          }

          ctx.drawImage(screenVideo, 0, 0, sw, sh);

          if (clipPath && camWidth > 0 && camHeight > 0) {
            ctx.save();
            ctx.clip(clipPath);
            ctx.drawImage(cameraVideo, camX, camY, camWidth, camHeight);
            ctx.restore();

            ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
            ctx.lineWidth = 2;
            ctx.stroke(strokePath!);
          }

          if (!resolved) {
            resolved = true;
            resolve();
          }
        }

        animationRef.current = requestAnimationFrame(draw);
      }

      draw();
    });
  }

  async function startRecording() {
    setError("");
    chunksRef.current = [];

    try {
      let recordStream: MediaStream;

      if (mode === "screen" || mode === "screen+camera") {
        const screen = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 60 },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: true,
        });
        screenStreamRef.current = screen;
        setScreenStream(screen);

        screen.getVideoTracks()[0].addEventListener("ended", () => {
          stopRecording();
        });
      }

      if (mode === "camera" || mode === "screen+camera") {
        const cameraConstraints: MediaTrackConstraints = {
          frameRate: { ideal: 60, min: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        };
        if (cameraId) {
          cameraConstraints.deviceId = { exact: cameraId };
        }
        const camera = await navigator.mediaDevices.getUserMedia({
          video: cameraConstraints,
          audio: mode === "camera" ? (micId ? { deviceId: { exact: micId } } : true) : false,
        });
        cameraStreamRef.current = camera;
        setCameraStream(camera);
      }

      if (mode === "screen") {
        recordStream = screenStreamRef.current!;
        if (micId) {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: micId } },
          });
          micStream.getAudioTracks().forEach((t) => recordStream.addTrack(t));
        }
      } else if (mode === "camera") {
        recordStream = cameraStreamRef.current!;
        if (micId) {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: micId } },
          });
          cameraStreamRef.current!.getAudioTracks().forEach((t) => t.stop());
          recordStream = new MediaStream([
            ...cameraStreamRef.current!.getVideoTracks(),
            ...micStream.getAudioTracks(),
          ]);
        }
      } else {
        const canvas = canvasRef.current!;
        await startCanvasCompositing(canvas, screenStreamRef.current!, cameraStreamRef.current!);
        const canvasStream = canvas.captureStream(60);

        if (micId) {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: micId } },
          });
          micStream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
        } else if (screenStreamRef.current!.getAudioTracks().length > 0) {
          screenStreamRef.current!.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
        }

        recordStream = canvasStream;
      }

      const codecs = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp8",
        "video/webm",
        "",
      ];
      const mimeType = codecs.find((c) => c === "" || MediaRecorder.isTypeSupported(c)) || "";

      const videoBitsPerSecond = mode === "camera" ? 5_000_000 : 10_000_000;

      const recorderOptions: MediaRecorderOptions = {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond,
      };
      const mediaRecorder = new MediaRecorder(recordStream, recorderOptions);

      mediaRecorder.ondataavailable = (e) => {
        console.log(`[Yoom] chunk received: ${e.data.size} bytes`);
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onerror = (e) => {
        console.error("[Yoom] MediaRecorder error:", e);
      };

      mediaRecorder.onstop = () => {
        console.log(`[Yoom] recording stopped, ${chunksRef.current.length} chunks, total ${chunksRef.current.reduce((a, b) => a + b.size, 0)} bytes`);
        handleRecordingComplete();
      };

      console.log(`[Yoom] starting MediaRecorder with mimeType: "${mediaRecorder.mimeType}", stream tracks:`, recordStream.getTracks().map(t => `${t.kind}:${t.readyState}`));
      recordStartedAtRef.current = performance.now();
      recordEndedAtRef.current = 0;
      thumbnailRef.current = null;
      thumbnailTimerRef.current = window.setTimeout(() => {
        void captureThumbnail().then((blob) => {
          thumbnailRef.current = blob;
        });
      }, 1000);
      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      setState("recording");

      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      stopAllStreams();
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Permission denied. Please allow screen/camera access.");
      } else {
        setError("Failed to start recording. Check your device permissions.");
      }
    }
  }

  function stopRecording() {
    if (recordEndedAtRef.current === 0) {
      recordEndedAtRef.current = performance.now();
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function frameToJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(source, 0, 0, width, height);
    return new Promise((resolve) =>
      scratch.toBlob((blob) => resolve(blob), "image/jpeg", 0.8),
    );
  }

  async function captureThumbnail(): Promise<Blob | null> {
    // Screen+camera: the composited canvas is the exact recorded frame.
    const canvas = canvasRef.current;
    if (canvas && canvas.width > 0) {
      return new Promise((resolve) =>
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8),
      );
    }

    // Screen-only / camera-only: read one frame from the live stream.
    const stream = screenStreamRef.current ?? cameraStreamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return null;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);

    const ready = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 2000);
      video.onloadeddata = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
    });

    try {
      await video.play();
      if (!(await ready) || !video.videoWidth) return null;
      return await frameToJpeg(video, video.videoWidth, video.videoHeight);
    } catch {
      return null;
    } finally {
      video.pause();
      video.srcObject = null;
    }
  }

  function readTrackDimensions(): { width: number | null; height: number | null } {
    const canvas = canvasRef.current;
    if (canvas) return { width: canvas.width, height: canvas.height };

    const stream = screenStreamRef.current ?? cameraStreamRef.current;
    const settings = stream?.getVideoTracks()[0]?.getSettings();
    return {
      width: settings?.width ?? null,
      height: settings?.height ?? null,
    };
  }

  async function handleRecordingComplete() {
    setState("uploading");
    setUploadProgress(0);

    const { width, height } = readTrackDimensions();
    const durationMs = Math.max(
      0,
      Math.round(recordEndedAtRef.current - recordStartedAtRef.current),
    );

    stopAllStreams();

    const rawBlob = new Blob(chunksRef.current, { type: "video/webm" });

    if (rawBlob.size === 0) {
      setError("Recording captured no data. Please try again.");
      setState("idle");
      return;
    }

    // Patch the EBML duration header so players get a real seek bar and
    // `video.duration` is finite. If patching fails, upload the raw blob.
    let blob = rawBlob;
    try {
      blob = await fixWebmDuration(rawBlob, durationMs, { logger: false });
    } catch (patchError) {
      console.warn("[Yoom] could not patch WebM duration", patchError);
    }

    try {
      const sessionRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mimeType: blob.type || "video/webm",
          sizeBytes: blob.size,
          filename: `yoom-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
        }),
      });
      if (!sessionRes.ok) throw new Error("Failed to start the upload");

      const { sessionUri } = (await sessionRes.json()) as { sessionUri: string };

      const { id: driveFileId } = await uploadToDrive(
        blob,
        sessionUri,
        setUploadProgress,
      );

      const completeRes = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveFileId,
          durationMs,
          width,
          height,
          // Generated client-side so the default title reflects the recorder's
          // local time zone rather than the server's (UTC on Vercel).
          title: `Recording — ${new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date())}`,
        }),
      });
      if (!completeRes.ok) throw new Error("Failed to save the recording");

      const { id, url } = (await completeRes.json()) as {
        id: string;
        slug: string;
        url: string;
      };

      const thumbnail = thumbnailRef.current;
      if (thumbnail) {
        const form = new FormData();
        form.set("videoId", id);
        form.set("file", thumbnail, "thumbnail.jpg");
        // A missing thumbnail is not fatal.
        await fetch("/api/upload/thumbnail", { method: "POST", body: form }).catch(
          () => undefined,
        );
      }

      setShareUrl(url);
      setState("done");
    } catch (uploadError) {
      console.error(uploadError);
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Upload failed. Please try again.",
      );
      setState("idle");
    }
  }

  function reset() {
    setState("idle");
    setShareUrl("");
    setElapsed(0);
    setUploadProgress(0);
    setError("");
    chunksRef.current = [];
    thumbnailRef.current = null;
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for insecure contexts
    }
  }

  // ----- RENDER -----

  if (state === "done") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="rounded-full w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Recording uploaded</h2>
            <p className="text-sm text-muted">Share the link below</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2.5">
            <input
              readOnly
              value={shareUrl}
              className="flex-1 bg-transparent text-sm text-muted outline-none truncate"
            />
            <button
              onClick={copyToClipboard}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover transition-all"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            onClick={reset}
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Record another
          </button>
        </div>
      </main>
    );
  }

  if (state === "uploading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-5 text-center">
          <p className="text-xs font-medium text-muted-dim uppercase tracking-wider">Uploading</p>
          <div className="w-full rounded-full bg-surface h-1.5 overflow-hidden">
            <div
              className="h-1.5 rounded-full bg-accent progress-bar transition-all duration-500 ease-out"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-sm font-mono text-muted tabular-nums">{uploadProgress}%</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      {/* Canvas for screen+camera compositing */}
      {mode === "screen+camera" && (
        <canvas
          ref={canvasRef}
          className={state === "recording"
            ? "w-full max-w-2xl aspect-video rounded-xl overflow-hidden bg-surface border border-border shadow-lg shadow-black/30"
            : "hidden"}
        />
      )}

      {/* Preview (for screen-only and camera-only modes) */}
      {state === "recording" && mode !== "screen+camera" && (
        <RecordingPreview
          mode={mode}
          screenStream={screenStream}
          cameraStream={cameraStream}
        />
      )}

      <div className="w-full max-w-md space-y-6">
        {state === "idle" && (
          <>
            {/* Brand */}
            <div className="flex justify-center">
              <YoomLogo size="sm" />
            </div>

            {/* Mode selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-dim uppercase tracking-wider">
                Mode
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1">
                {([
                  { value: "screen", label: "Screen" },
                  { value: "camera", label: "Camera" },
                  { value: "screen+camera", label: "Screen + Cam" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setMode(opt.value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                      mode === opt.value
                        ? "bg-accent text-white shadow-sm"
                        : "text-muted hover:text-foreground hover:bg-surface-raised"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Device selectors */}
            <DeviceSelector
              kind="audioinput"
              label="Microphone"
              value={micId}
              onChange={setMicId}
            />
            {(mode === "camera" || mode === "screen+camera") && (
              <DeviceSelector
                kind="videoinput"
                label="Camera"
                value={cameraId}
                onChange={setCameraId}
              />
            )}
          </>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400/90 text-center">{error}</p>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          {state === "idle" && (
            <button
              onClick={startRecording}
              className="rounded-lg bg-accent px-8 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all"
            >
              Start Recording
            </button>
          )}

          {state === "recording" && (
            <>
              <span className="flex items-center gap-2 text-sm font-mono text-muted tabular-nums">
                <span className="h-2 w-2 rounded-full bg-accent recording-dot" />
                {formatTime(elapsed)}
              </span>
              <button
                onClick={stopRecording}
                className="rounded-lg border border-border bg-surface-raised px-6 py-2.5 text-sm font-medium text-foreground hover:bg-surface-raised hover:brightness-110 transition-all"
              >
                Stop
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
