"use client";

import { useActionState, useState } from "react";
import { updateSlug, type SlugState } from "@/app/(owner)/actions";
import { normalizeSlug } from "@/lib/slug";

type SlugEditorProps = {
  videoId: string;
  slug: string;
  /** Everything before the slug, e.g. "https://jtylerray.com/v/". */
  prefix: string;
};

const INITIAL: SlugState = {};

export function SlugEditor({ videoId, slug, prefix }: SlugEditorProps) {
  const [state, formAction, pending] = useActionState(updateSlug, INITIAL);
  const [draft, setDraft] = useState(slug);
  const [lastState, setLastState] = useState(state);

  // Adopt the saved slug once the action confirms it (it may differ from the
  // raw draft, e.g. trimmed/lowercased). Adjusting state during render is the
  // supported pattern here — see editable-text.tsx — so it keeps lint's
  // `react-hooks/set-state-in-effect` rule happy.
  if (state !== lastState) {
    setLastState(state);
    if (state.ok && state.slug) setDraft(state.slug);
  }

  const normalized = normalizeSlug(draft);
  const showPreview = normalized !== draft && normalized.length > 0;

  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="id" value={videoId} />
      <label htmlFor="slug-input" className="block text-xs text-muted-dim">
        Share link
      </label>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-lg border border-border bg-surface px-3 py-2">
          <span className="shrink-0 select-all text-sm text-muted-dim">{prefix}</span>
          <input
            id="slug-input"
            name="slug"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={pending}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={40}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending || normalized === slug}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {showPreview && (
        <p className="px-0.5 text-xs text-muted-dim">
          Will save as <span className="text-muted">{normalized}</span>
        </p>
      )}
      <p aria-live="polite" className="min-h-4 text-xs">
        {state.error ? (
          <span className="text-red-400/90">{state.error}</span>
        ) : state.ok ? (
          <span className="text-muted-dim">
            Saved — the old link now redirects here.
          </span>
        ) : (
          <span className="text-muted-dim">
            3–40 lowercase letters, numbers or hyphens.
          </span>
        )}
      </p>
    </form>
  );
}
