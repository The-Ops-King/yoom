import type { Metadata } from "next";
import { listVideos, type VideoSort } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { LibraryToolbar } from "@/components/library/library-toolbar";
import { VideoCard } from "@/components/library/video-card";

export const metadata: Metadata = { title: "Library · Yoom" };

// searchParams is a request-time API, so this page always renders dynamically.
type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const SORTS: VideoSort[] = ["newest", "oldest", "views", "title"];

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function parseSort(value: string): VideoSort {
  return (SORTS as string[]).includes(value) ? (value as VideoSort) : "newest";
}

export default async function LibraryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = first(params.q).slice(0, 100);
  const sort = parseSort(first(params.sort));

  const videos = await listVideos({ q: q || undefined, sort });
  const base = appUrl();

  return (
    <main className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold text-foreground">Library</h1>

      <LibraryToolbar q={q} sort={sort} count={videos.length} />

      {videos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted">
          {q
            ? `No recordings match “${q}”.`
            : "No recordings yet. Hit Record to make your first one."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} apiBase={base} />
          ))}
        </div>
      )}
    </main>
  );
}
