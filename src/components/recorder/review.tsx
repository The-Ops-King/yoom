"use client";

import { formatElapsed } from "./preview-stage";

interface ReviewProps {
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationMs: number;
  error: string;
  onUpload: () => void;
  onDiscard: () => void;
}

export function Review({
  videoUrl,
  thumbnailUrl,
  durationMs,
  error,
  onUpload,
  onDiscard,
}: ReviewProps) {
  return (
    <div className="w-full max-w-3xl space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/30">
        {videoUrl && (
          <video
            src={videoUrl}
            poster={thumbnailUrl ?? undefined}
            controls
            playsInline
            className="aspect-video w-full bg-black"
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt="Thumbnail preview"
              className="h-10 w-16 rounded-md border border-border object-cover"
            />
          )}
          <span className="font-mono text-sm tabular-nums text-muted">
            {formatElapsed(durationMs)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="rounded-lg bg-accent px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover"
          >
            Upload
          </button>
        </div>
      </div>

      {error && <p className="text-center text-sm text-red-400/90">{error}</p>}
    </div>
  );
}
