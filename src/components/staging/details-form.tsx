"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatElapsed } from "@/components/recorder/preview-stage";
import { MAX_DESCRIPTION, MAX_TITLE } from "@/lib/limits";
import { normalizeSlug, SLUG_RE } from "@/lib/slug";
import type { Details, StagingContext } from "./types";

/** How long the slug input rests before the availability check fires. */
const DEBOUNCE_MS = 400;

const FORMAT_HINT = "3–40 lowercase letters, numbers or hyphens.";

// `select-text`: the staging chrome sets `select-none`, and `user-select`
// inherits into form controls — typing still works, but the caret cannot
// select anything, which makes editing a title feel broken.
const field =
  "w-full select-text rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-dim focus:border-accent/50 focus:ring-1 focus:ring-accent/20";

const label = "block text-[11px] uppercase tracking-wider text-muted-dim";

type SlugStatus = "auto" | "checking" | "unchecked" | "available" | "taken" | "invalid" | "error";

type SlugResponse = { slug?: string; valid?: boolean; available?: boolean };

/**
 * What a slug reads as before this mount has checked it — a draft restored
 * from session storage, or the section being re-expanded. A well-formed slug
 * is "unchecked" whatever `slugOk` says: a stored verdict may be stale, so it
 * is never reported as available or taken until the check answers again.
 */
function statusFor(details: Details): SlugStatus {
  if (details.slug === "") return "auto";
  if (!SLUG_RE.test(details.slug)) return "invalid";
  return "unchecked";
}

/** Seed for `status`: an unchecked slug is re-checked on mount, so say so. */
function initialStatus(details: Details): SlugStatus {
  const status = statusFor(details);
  return status === "unchecked" ? "checking" : status;
}

function hintFor(status: SlugStatus, slug: string): { text: string; tone: string } {
  switch (status) {
    case "auto":
      return { text: "Auto — a random link is generated.", tone: "text-muted-dim" };
    case "checking":
      return { text: "Checking…", tone: "text-muted-dim" };
    case "unchecked":
      return { text: `${slug} — not checked yet.`, tone: "text-muted-dim" };
    case "available":
      return { text: `${slug} is available.`, tone: "text-emerald-400/90" };
    case "taken":
      return { text: `${slug} is taken.`, tone: "text-red-400/90" };
    case "error":
      return { text: "Could not check that link — try again.", tone: "text-red-400/90" };
    default:
      return { text: FORMAT_HINT, tone: "text-red-400/90" };
  }
}

/**
 * Title, description, share link and thumbnail frame. The slug is normalised
 * into `details.slug` as it is typed and checked against `/api/slug` 400 ms
 * after the last keystroke; the verdict lands in `details.slugOk`, which the
 * upload section reads to gate its button. `slugOk` is false while a check is
 * in flight, so upload stays disabled until the answer is in.
 */
export function DetailsForm({ ctx }: { ctx: StagingContext }) {
  const { details, setDetails, player } = ctx;
  const [draft, setDraft] = useState(details.slug);
  const [status, setStatus] = useState<SlugStatus>(() => initialStatus(details));
  // Frozen at mount, so the effect below runs once and never on a keystroke.
  const [initialSlug] = useState(details.slug);

  // The check outlives a keystroke but not a newer one: `seq` stamps each
  // request so a slow answer for an old slug is dropped.
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounced = useRef<{ slug: string; id: number } | null>(null);
  const alive = useRef(true);

  const check = useCallback(
    async (slug: string, id: number) => {
      try {
        const res = await fetch(`/api/slug?slug=${encodeURIComponent(slug)}`);
        const json: SlugResponse = res.ok ? await res.json() : {};
        if (id !== seq.current) return;
        const ok = res.ok && json.valid === true && json.available === true;
        setDetails((d) => (d.slug === slug ? { ...d, slugOk: ok } : d));
        if (alive.current) {
          setStatus(res.ok ? (json.valid === false ? "invalid" : ok ? "available" : "taken") : "error");
        }
      } catch {
        if (id !== seq.current) return;
        setDetails((d) => (d.slug === slug ? { ...d, slugOk: false } : d));
        if (alive.current) setStatus("error");
      }
    },
    [setDetails],
  );

  // Verify the slug this mount inherited — a restored draft, or the section
  // re-expanded while a check was in flight — so `slugOk` is never a stale
  // yes. `status` is already seeded "checking", so nothing is set here.
  // Collapsing the section unmounts the form: the cleanup drops the pending
  // timer and runs its check straight away so `slugOk` still resolves.
  useEffect(() => {
    alive.current = true;
    if (initialSlug !== "" && SLUG_RE.test(initialSlug)) {
      // Through the same timer the debounce uses, so the cleanup below owns
      // it and the request never fires during the render pass.
      const id = ++seq.current;
      debounced.current = { slug: initialSlug, id };
      timer.current = setTimeout(() => {
        timer.current = null;
        debounced.current = null;
        void check(initialSlug, id);
      }, 0);
    }
    return () => {
      alive.current = false;
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const pending = debounced.current;
      debounced.current = null;
      if (pending !== null) void check(pending.slug, pending.id);
    };
  }, [check, initialSlug]);

  function onSlugChange(raw: string) {
    setDraft(raw);
    const slug = normalizeSlug(raw);
    const id = ++seq.current;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    debounced.current = null;

    if (slug === "") {
      setDetails((d) => ({ ...d, slug, slugOk: true }));
      setStatus("auto");
      return;
    }
    // Unverified until the check answers, so upload cannot run ahead of it.
    setDetails((d) => ({ ...d, slug, slugOk: false }));
    if (!SLUG_RE.test(slug)) {
      setStatus("invalid");
      return;
    }
    setStatus("checking");
    debounced.current = { slug, id };
    timer.current = setTimeout(() => {
      timer.current = null;
      debounced.current = null;
      void check(slug, id);
    }, DEBOUNCE_MS);
  }

  const normalized = normalizeSlug(draft);
  const hint = hintFor(status, normalized);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className={label} htmlFor="staging-title">
          Title
        </label>
        <input
          id="staging-title"
          value={details.title}
          maxLength={MAX_TITLE}
          placeholder="Untitled recording"
          onChange={(e) => setDetails((d) => ({ ...d, title: e.target.value }))}
          className={field}
        />
      </div>

      <div className="space-y-1">
        <label className={label} htmlFor="staging-description">
          Description
        </label>
        <textarea
          id="staging-description"
          value={details.description}
          maxLength={MAX_DESCRIPTION}
          rows={3}
          placeholder="Optional"
          onChange={(e) => setDetails((d) => ({ ...d, description: e.target.value }))}
          className={`${field} resize-y`}
        />
      </div>

      <div className="space-y-1">
        <label className={label} htmlFor="staging-slug">
          Share link
        </label>
        <input
          id="staging-slug"
          value={draft}
          onChange={(e) => onSlugChange(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={40}
          placeholder="auto"
          className={field}
        />
        <p aria-live="polite" className={`min-h-4 text-[11px] ${hint.tone}`}>
          {hint.text}
        </p>
        {normalized !== draft && normalized !== "" && (
          <p className="text-[11px] text-muted-dim">
            Saved as <span className="text-muted">{normalized}</span>
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">
          Thumbnail at {formatElapsed(details.thumbnailAt * 1000)}
        </span>
        <button
          type="button"
          onClick={() => setDetails((d) => ({ ...d, thumbnailAt: player.editedTime }))}
          className="rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground"
        >
          Use this frame for the thumbnail
        </button>
      </div>
    </div>
  );
}
