import Link from "next/link";
import type { VideoListItem } from "@/lib/db";
import { fmtDuration, fmtRelative } from "@/lib/format";

type VideoCardProps = {
  video: VideoListItem;
  /** Absolute app origin, used for the thumbnail URL. */
  apiBase: string;
};

export function VideoCard({ video, apiBase }: VideoCardProps) {
  return (
    <Link
      href={`/library/${video.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-accent/40"
    >
      <div className="relative aspect-video w-full bg-black">
        {video.thumbnail_drive_file_id ? (
          // Not next/image: this page shares components with a cross-origin
          // watch surface and the optimiser adds no value for a Drive proxy.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${apiBase}/api/thumb/${video.id}`}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-dim">
            No thumbnail
          </div>
        )}
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {fmtDuration(video.duration_ms)}
        </span>
      </div>
      <div className="space-y-1 p-3">
        <h2 className="truncate text-sm font-medium text-foreground group-hover:text-accent">
          {video.title}
        </h2>
        <p className="text-xs text-muted-dim">
          {video.views} {video.views === 1 ? "view" : "views"} ·{" "}
          {fmtRelative(video.created_at)}
        </p>
      </div>
    </Link>
  );
}
