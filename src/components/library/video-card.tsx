import Link from "next/link";
import type { VideoListItem } from "@/lib/db";
import { fmtDuration, fmtRelative } from "@/lib/format";
import { shareUrl } from "@/lib/share";
import { CopyLinkButton } from "@/components/library/copy-link-button";

type VideoCardProps = {
  video: VideoListItem;
  /** Absolute app origin, used for the thumbnail URL. */
  apiBase: string;
};

export function VideoCard({ video, apiBase }: VideoCardProps) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-accent/40">
      <Link href={`/library/${video.id}`} className="flex flex-col">
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
        <div className="space-y-1 p-3 pb-2">
          <h2 className="truncate text-sm font-medium text-foreground group-hover:text-accent">
            {video.title}
          </h2>
          <p className="text-xs text-muted-dim">
            {video.views} {video.views === 1 ? "view" : "views"} ·{" "}
            {video.uniqueViewers} {video.uniqueViewers === 1 ? "viewer" : "viewers"} ·{" "}
            {fmtRelative(video.created_at)}
          </p>
          <p className="text-xs text-muted-dim">
            {video.lastViewedAt
              ? `viewed ${fmtRelative(video.lastViewedAt)}`
              : "never viewed"}
          </p>
        </div>
      </Link>
      <div className="flex items-center justify-end border-t border-border px-3 py-2">
        <CopyLinkButton
          url={shareUrl(video.slug)}
          label="Copy link"
          className="rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
        />
      </div>
    </div>
  );
}
