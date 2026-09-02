import Link from "next/link";
import type { VideoListItem } from "@/lib/db";
import { fmtDuration, fmtRelative } from "@/lib/format";
import { shareUrl } from "@/lib/share";
import { CopyLinkButton } from "@/components/library/copy-link-button";

type VideoCardProps = {
  video: VideoListItem;
  /** Absolute app origin, used for the thumbnail URL. */
  apiBase: string;
  /** Show the selection checkbox and route plain clicks to `onToggle`. */
  selectable: boolean;
  selected: boolean;
  /** True while any card in the grid is selected: pins every checkbox visible. */
  anySelected: boolean;
  onToggle(shift: boolean): void;
};

export function VideoCard({
  video,
  apiBase,
  selectable,
  selected,
  anySelected,
  onToggle,
}: VideoCardProps) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-surface transition-colors ${
        selected
          ? "border-accent ring-2 ring-accent/40"
          : "border-border hover:border-accent/40"
      }`}
    >
      {/* Sibling of the <Link>, not a child: a button inside an anchor is
          invalid HTML and unreachable for screen readers. */}
      {selectable && (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`Select “${video.title}”`}
          onClick={(event) => onToggle(event.shiftKey)}
          className={`absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
            selected
              ? "border-accent bg-accent text-black"
              : "border-border bg-black/60 text-transparent hover:text-muted"
          } ${anySelected || selected ? "opacity-100" : "opacity-0"}`}
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8.5 6.5 12 13 4.5" />
          </svg>
        </button>
      )}
      <Link
        href={`/library/${video.id}`}
        className="flex flex-col"
        onClick={(event) => {
          // While a selection is active the card is a selection target, not a
          // link: clicking it extends or narrows the selection instead.
          if (selectable && anySelected) {
            event.preventDefault();
            onToggle(event.shiftKey);
          }
        }}
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
