"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { VideoListItem } from "@/lib/db";
import { deleteVideos } from "@/app/(owner)/actions";
import { VideoCard } from "@/components/library/video-card";
import { SelectionBar } from "@/components/library/selection-bar";

type LibraryGridProps = {
  videos: VideoListItem[];
  apiBase: string;
  /** Public share origin, resolved on the server (see VideoCard). */
  shareBase: string;
  /** Rendered in place of the selection bar while nothing is selected. */
  toolbar: ReactNode;
};

type Failure = { id: string; title: string; error: string };

export function LibraryGrid({ videos, apiBase, shareBase, toolbar }: LibraryGridProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<string | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();

  // A router.refresh() can drop rows from `videos` while their ids are still in
  // `selected`, so the live selection is always the intersection with what is
  // on screen. The count, the bar and the delete set then never name a row the
  // user cannot see.
  const visible = videos.filter((v) => selected.has(v.id)).map((v) => v.id);

  const toggle = (id: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      // `last` can name a row a refresh has since removed, so findIndex may
      // return -1; fall back to a plain toggle rather than walking off the end.
      const anchor = shift && last ? videos.findIndex((v) => v.id === last) : -1;
      const to = videos.findIndex((v) => v.id === id);
      if (anchor >= 0 && to >= 0) {
        for (let i = Math.min(anchor, to); i <= Math.max(anchor, to); i++) {
          next.add(videos[i].id);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLast(id);
  };

  const remove = () => {
    const ids = visible;
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} recording${ids.length === 1 ? "" : "s"}? Share links stop working and the Drive files move to Trash.`,
      )
    ) {
      return;
    }
    setFailures([]);
    start(async () => {
      const result = await deleteVideos(ids);
      const byId = new Map(videos.map((v) => [v.id, v.title]));
      setFailures(result.failed.map((f) => ({ ...f, title: byId.get(f.id) ?? f.id })));
      // Keep only what could not be deleted selected, so a retry is one click.
      setSelected(new Set(result.failed.map((f) => f.id)));
      setLast(null);
      router.refresh();
    });
  };

  return (
    <>
      {visible.length > 0 ? (
        <SelectionBar
          count={visible.length}
          total={videos.length}
          pending={pending}
          failures={failures}
          onAll={() => setSelected(new Set(videos.map((v) => v.id)))}
          onClear={() => {
            setSelected(new Set());
            setFailures([]);
            setLast(null);
          }}
          onDelete={remove}
        />
      ) : (
        toolbar
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-4">
        {videos.map((video) => (
          <VideoCard
            key={video.id}
            video={video}
            apiBase={apiBase}
            shareBase={shareBase}
            selectable
            selected={selected.has(video.id)}
            anySelected={visible.length > 0}
            onToggle={(shift) => toggle(video.id, shift)}
          />
        ))}
      </div>
    </>
  );
}
