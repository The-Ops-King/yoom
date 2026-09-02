"use client";

import { useEffect, useState } from "react";
import { YoomLogo } from "./logo";
import { useViewTracker } from "@/hooks/use-view-tracker";

const VIEWER_NAME_KEY = "yoom_viewer_name";

export type WatchVideo = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMs: number | null;
  hasThumbnail: boolean;
};

type WatchViewProps = {
  video: WatchVideo;
  /** Absolute app origin; the page may be served from jtylerray.com. */
  apiBase: string;
  shareUrl: string;
};

export function WatchView({ video, apiBase, shareUrl }: WatchViewProps) {
  const [viewerName, setViewerName] = useState<string | null>(null);
  const [nameResolved, setNameResolved] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEWER_NAME_KEY);
      if (stored !== null) {
        setViewerName(stored || null);
        setNameResolved(true);
      }
    } catch {
      setNameResolved(true);
    }
  }, []);

  const { videoRef } = useViewTracker({
    videoId: video.id,
    apiBase,
    durationMs: video.durationMs,
    viewerName,
  });

  function rememberName(name: string) {
    try {
      window.localStorage.setItem(VIEWER_NAME_KEY, name);
    } catch {
      // Private browsing; carry on without persisting.
    }
    setViewerName(name || null);
    setNameResolved(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Insecure context; the URL is shown in full next to the button.
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 px-4 py-8">
      <div className="flex items-center justify-between">
        <YoomLogo size="sm" />
        <span className="text-xs text-muted-dim">Shared recording</span>
      </div>

      <div className="relative">
        <video
          ref={videoRef}
          src={`${apiBase}/api/stream/${video.id}`}
          poster={video.hasThumbnail ? `${apiBase}/api/thumb/${video.id}` : undefined}
          controls
          preload="metadata"
          playsInline
          className="w-full rounded-xl border border-border bg-black shadow-lg shadow-black/30"
        />

        {!nameResolved && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                rememberName(nameDraft.trim());
              }}
              className="w-full max-w-xs space-y-3 rounded-2xl border border-border bg-surface/90 p-6"
            >
              <p className="text-sm text-foreground">Who&rsquo;s watching?</p>
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="Your name (optional)"
                maxLength={80}
                autoFocus
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder-muted-dim outline-none transition-all focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover"
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={() => rememberName("")}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-all hover:text-foreground"
                >
                  Skip
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">{video.title}</h1>
        {video.description && (
          <p className="whitespace-pre-wrap text-sm text-muted">{video.description}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-lg border border-border bg-surface px-3 py-2">
          <span className="block truncate text-sm text-muted">{shareUrl}</span>
        </div>
        <button
          onClick={copyLink}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
    </main>
  );
}
