"use client";

import type { VideoSort } from "@/lib/db";

type LibraryToolbarProps = {
  q: string;
  sort: VideoSort;
  count: number;
};

const SORTS: { value: VideoSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "views", label: "Most viewed" },
  { value: "title", label: "Title A–Z" },
];

/**
 * A plain GET form: search and sort live in the URL, so the page stays a
 * server component and the state is shareable and back-button friendly.
 */
export function LibraryToolbar({ q, sort, count }: LibraryToolbarProps) {
  return (
    <form
      action="/library"
      method="get"
      className="flex flex-wrap items-center gap-2"
    >
      <label htmlFor="library-search" className="sr-only">
        Search recordings
      </label>
      <input
        id="library-search"
        name="q"
        defaultValue={q}
        placeholder="Search title, description or slug"
        className="min-w-56 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder-muted-dim outline-none transition-all focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
      />
      <label htmlFor="library-sort" className="sr-only">
        Sort
      </label>
      <select
        id="library-sort"
        name="sort"
        defaultValue={sort}
        className="device-select appearance-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
      >
        {SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
      >
        Apply
      </button>
      <span className="ml-auto text-xs text-muted-dim">
        {count} {count === 1 ? "recording" : "recordings"}
      </span>
    </form>
  );
}
