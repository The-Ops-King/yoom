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
  /** Rendered in place of the selection bar while nothing is selected. */
  toolbar: ReactNode;
};

type Failure = { id: string; title: string; error: string };

export function LibraryGrid({ videos, apiBase, toolbar }: LibraryGridProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<string | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();

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
    const ids = [...selected];
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
      {selected.size > 0 ? (
        <SelectionBar
          count={selected.size}
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((video) => (
          <VideoCard
            key={video.id}
            video={video}
            apiBase={apiBase}
            selectable
            selected={selected.has(video.id)}
            anySelected={selected.size > 0}
            onToggle={(shift) => toggle(video.id, shift)}
          />
        ))}
      </div>
    </>
  );
}
