import type { Metadata } from "next";
import { isOwner } from "@/lib/auth";
import { listVideos, type VideoSort } from "@/lib/db";
import { appUrl, shareBaseUrl } from "@/lib/env";
import { PasswordGate } from "@/components/password-gate";
import { LibraryToolbar } from "@/components/library/library-toolbar";
import { LibraryGrid } from "@/app/(owner)/library/library-grid";

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
  // The (owner) layout also gates, but a layout is not an auth boundary: the
  // page segment is still rendered into the RSC payload. Refuse before any
  // database read.
  if (!(await isOwner())) return <PasswordGate />;

  const params = await searchParams;
  const q = first(params.q).slice(0, 100);
  const sort = parseSort(first(params.sort));

  const videos = await listVideos({ q: q || undefined, sort });
  const base = appUrl();

  return (
    <main className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold text-foreground">Library</h1>

      {videos.length === 0 ? (
        <>
          <LibraryToolbar q={q} sort={sort} count={videos.length} />
          <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted">
            {q
              ? `No recordings match “${q}”.`
              : "No recordings yet. Hit Record to make your first one."}
          </p>
        </>
      ) : (
        // The toolbar is rendered on the server and passed through as a child,
        // so the client grid can swap it for the selection bar without pulling
        // it into the client bundle.
        <LibraryGrid
          // Remount on a new query or sort: the selection belongs to one list.
          key={`${q}-${sort}`}
          videos={videos}
          apiBase={base}
          shareBase={shareBaseUrl()}
          toolbar={<LibraryToolbar q={q} sort={sort} count={videos.length} />}
        />
      )}
    </main>
  );
}
