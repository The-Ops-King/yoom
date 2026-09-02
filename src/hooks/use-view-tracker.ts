"use client";

import { useCallback, useEffect, useRef } from "react";

const HEARTBEAT_MS = 10_000;

export type ViewTrackerOptions = {
  videoId: string;
  /** Absolute app origin, e.g. https://yoom.vercel.app */
  apiBase: string;
  /** Stored duration in ms; MediaRecorder WebM often reports Infinity. */
  durationMs: number | null;
  viewerName: string | null;
};

export type ViewTracker = {
  /** Attach to the <video> element's ref. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
};

function percentOf(video: HTMLVideoElement, durationMs: number | null): number {
  const fallbackSeconds = durationMs && durationMs > 0 ? durationMs / 1000 : 0;
  const duration =
    Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : fallbackSeconds;
  if (!duration) return 0;
  return Math.max(0, Math.min(100, Math.round((video.currentTime / duration) * 100)));
}

export function useViewTracker(options: ViewTrackerOptions): ViewTracker {
  const { videoId, apiBase, durationMs, viewerName } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const lastPercentRef = useRef(0);
  const finishedRef = useRef(false);

  const heartbeat = useCallback(
    (percent: number, ended: boolean, useBeacon: boolean) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      if (ended && finishedRef.current) return;
      if (ended) finishedRef.current = true;

      const url = `${apiBase}/api/view/heartbeat`;
      const payload = JSON.stringify({ sessionId, percent, ended });

      if (useBeacon && typeof navigator.sendBeacon === "function") {
        // A text/plain Blob keeps this a simple request: no CORS preflight.
        navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" }));
        return;
      }

      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    },
    [apiBase],
  );

  const start = useCallback(async () => {
    if (sessionIdRef.current || startingRef.current) return;
    startingRef.current = true;
    try {
      const response = await fetch(`${apiBase}/api/view/start`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ videoId, viewerName }),
      });
      if (!response.ok) return;
      const json = (await response.json()) as { sessionId: string };
      sessionIdRef.current = json.sessionId;
    } catch {
      // View tracking is best-effort; never break playback.
    } finally {
      startingRef.current = false;
    }
  }, [apiBase, videoId, viewerName]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      void start();
    };

    const onTimeUpdate = () => {
      lastPercentRef.current = Math.max(
        lastPercentRef.current,
        percentOf(video, durationMs),
      );
    };

    const onEnded = () => {
      heartbeat(100, true, false);
    };

    const onPageHide = () => {
      heartbeat(lastPercentRef.current, true, true);
    };

    // Tab switches are not the end of a session: persist progress only. Only
    // `pagehide` and the `ended` event close the session (and trigger the
    // summary email), otherwise a glance at another tab at 5% would claim it.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        heartbeat(lastPercentRef.current, false, true);
      }
    };

    const interval = window.setInterval(() => {
      if (!video.paused && !video.ended) {
        heartbeat(lastPercentRef.current, false, false);
      }
    }, HEARTBEAT_MS);

    video.addEventListener("play", onPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [durationMs, heartbeat, start]);

  return { videoRef };
}
