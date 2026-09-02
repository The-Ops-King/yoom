# Phase 3: Owner dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Give the single owner a private dashboard at `/library`, `/library/[id]` and `/settings`:
browse every recording, rename it, edit its description and slug (old slugs keep
308-redirecting), copy the share link, download the original Drive file, delete it
(soft delete + Drive trash), read per-video analytics (views, unique viewers, average
watched %, a 10-bucket retention histogram, a recent-viewers table), and toggle the two
email alerts. After an upload the recorder now hands off to `/library/[id]?new=1` with
the share link already on the clipboard, exactly like Loom.

Phase 3 also lays the three foundations the proposed Phase 5 post-recording editor needs
(`docs/for-later.md`): an `edits jsonb` column on `videos`, a typed + validated
`VideoEdits` shape in `src/lib/edits.ts`, and a canvas-capable `EditPlayer` component
used by **both** the owner detail page and the public watch page. In Phase 3 the canvas
draws nothing — the plumbing exists, the pixels do not.

## Architecture

- **Route group `src/app/(owner)/`** — no URL segment. Its `layout.tsx` calls
  `isOwner()` and renders `<PasswordGate />` instead of children when false (the same
  pattern `src/app/page.tsx` already uses), so `/library` and `/settings` are gated by a
  server render, not a redirect. `src/proxy.ts` keeps gating the API surface.
- **Server Components fetch, Client Components mutate.** Pages are async server
  components reading `src/lib/db.ts` directly. Every mutation is a Server Action in
  `src/app/(owner)/actions.ts` (`'use server'` at the top of the file), each one
  re-checking `isOwner()` because — per the Next docs — "Server Functions are reachable
  via direct POST requests, not just through your application's UI". Actions return
  `{ error }` objects consumed by `useActionState(action, initialState)`; they never
  throw for expected validation failures.
- **Stats without PostgREST joins.** `video_stats` is a *view*, and PostgREST cannot
  infer an embedding relationship from `videos` to it. `listVideos` therefore issues two
  queries (`videos`, then `video_stats`) and merges them in JS, sorting `views` in JS.
  Personal-scale data; correctness beats cleverness.
- **Retention buckets in JS.** `getVideoStats` selects the `max_percent` column for the
  video and bins it (`Math.min(9, Math.floor(max_percent / 10))`) rather than adding a
  second SQL view.
- **Downloads go through the app**, not Drive: `GET /api/videos/[id]/download` streams
  `fetchMedia(drive_file_id)`'s upstream body straight through with
  `Content-Disposition: attachment`. It is owner-only via the `proxy.ts` matcher.
- **Editor seam.** `parseEdits(unknown): VideoEdits` is a pure, total validator: any
  malformed jsonb degrades to the empty edit list. `EditPlayer` accepts `edits` and a
  `videoRef` prop so `useViewTracker` keeps owning the `<video>` element on the watch
  page.

## Tech Stack

Next.js 16.2.3 App Router (route groups, `'use server'`, `useActionState`,
`revalidatePath`, `redirect`, `searchParams` as a Promise, route-handler `params` as a
Promise, `src/proxy.ts` + `config.matcher`), React 19.2.4, TypeScript, Tailwind v4
(`@theme inline` tokens in `src/app/globals.css`), Supabase JS (service role),
Vitest 4 (`npm test`, `src/**/*.test.ts`, node environment).

---

## File Structure

### Created

| File | Responsibility |
|---|---|
| `supabase/migrations/20260902000000_phase3.sql` | Adds `videos.edits jsonb not null default '{}'`, a `view_sessions (video_id, last_seen_at desc)` index, and re-asserts the `video_stats` view. |
| `src/lib/edits.ts` | `VideoEdits` type + pure total `parseEdits(unknown)` validator (Phase 5 foundation). |
| `src/lib/edits.test.ts` | Unit tests for `parseEdits`. |
| `src/lib/format.ts` | `fmtDuration`, `fmtBytes`, `fmtRelative`; re-exports `deviceFromUserAgent` from `alerts.ts`. |
| `src/lib/format.test.ts` | Unit tests for the formatters. |
| `src/lib/db-phase3.test.ts` | Unit tests for the Phase 3 `db.ts` functions (own `chain()` stub). |
| `src/app/(owner)/layout.tsx` | Owner gate (`isOwner()` → `<PasswordGate/>`) + Record / Library / Settings nav. |
| `src/app/(owner)/library/page.tsx` | Library grid; reads `?q=` and `?sort=`. |
| `src/app/(owner)/library/[id]/page.tsx` | Video detail: player, metadata editors, share/download/delete, analytics. |
| `src/app/(owner)/library/[id]/not-found.tsx` | 404 for a missing/deleted video id. |
| `src/app/(owner)/settings/page.tsx` | Alert-toggle settings page. |
| `src/app/(owner)/actions.ts` | `'use server'` — `updateTitle`, `updateDescription`, `updateSlug`, `deleteVideo`, `saveSettings`. |
| `src/app/api/videos/[id]/download/route.ts` | Owner-only `GET` streaming the Drive original as an attachment. |
| `src/components/library/video-card.tsx` | One library grid card (thumb, title, duration, views, age). |
| `src/components/library/library-toolbar.tsx` | Search box + sort select (GET form to `/library`). |
| `src/components/library/copy-link-button.tsx` | Client copy-to-clipboard button with a "Copied!" state. |
| `src/components/video/editable-text.tsx` | Client inline title/description editor bound to a server action. |
| `src/components/video/slug-editor.tsx` | Client slug editor showing the `jtylerray.com/v/` prefix; inline errors. |
| `src/components/video/delete-button.tsx` | Client delete button with a `window.confirm` guard. |
| `src/components/video/new-toast.tsx` | Client "Link copied" toast shown when `?new=1`. |
| `src/components/video/edit-player.tsx` | Client `<video>` + absolutely-positioned `<canvas>` overlay sized by `ResizeObserver`; accepts `edits` and `videoRef`. |
| `src/components/analytics/stat-tiles.tsx` | Views / unique viewers / avg watched % tiles. |
| `src/components/analytics/retention-bars.tsx` | Inline-SVG 10-bucket retention histogram. |
| `src/components/analytics/viewers-table.tsx` | Recent viewers table (name, location, device, when, watched %). |
| `src/components/settings/alert-toggles.tsx` | Client form for the two alert booleans. |

### Modified

| File | Change |
|---|---|
| `src/lib/db.ts` | Adds `edits` to `Video`, plus `listVideos`, `updateVideoMeta`, `isSlugTaken`, `changeSlug`, `softDeleteVideo`, `setVideoEdits`, `getVideoStats`, `listRecentViewers`, `updateSettings` and their types. |
| `src/lib/slug.ts` | Adds pure `normalizeSlug(input)` used by the slug editor action. |
| `src/lib/slug.test.ts` | Tests for `normalizeSlug`. |
| `src/proxy.ts` | Matcher gains `"/api/videos/:path*"`. |
| `src/components/watch-view.tsx` | Bare `<video>` replaced by `<EditPlayer videoRef={videoRef} edits={edits} />`. |
| `src/app/v/[slug]/page.tsx` | Passes `parseEdits(video.edits)` into `WatchView`. |
| `src/lib/recording/use-recorder.ts` | After a successful upload: copy the share URL, then `router.push('/library/'+id+'?new=1')`. |
| `README.md` | New "Dashboard" section; migration list mentions the Phase 3 file. |
| `docs/for-later.md` | Strikes the "Foundations to lay in Phase 3" bullet as shipped. |

### Deleted

| File | Reason |
|---|---|
| `src/components/video-player.tsx` | Unused since Phase 1; superseded by `edit-player.tsx`. |

---

### Task 1: Phase 3 migration SQL

**Files:** `supabase/migrations/20260902000000_phase3.sql`

- [ ] Write `supabase/migrations/20260902000000_phase3.sql`:

```sql
-- Phase 3: owner dashboard.
-- Adds the non-destructive edit-decision-list column (Phase 5 foundation) and
-- the index the library's "recently viewed" ordering needs.

alter table public.videos
  add column if not exists edits jsonb not null default '{}'::jsonb;

create index if not exists view_sessions_video_last_seen_idx
  on public.view_sessions (video_id, last_seen_at desc);

-- Re-asserted verbatim from the Phase 1 migration so a fresh database that runs
-- only this file still gets the columns the dashboard reads:
--   video_id, view_count, unique_viewers, avg_max_percent, last_viewed_at
create or replace view public.video_stats as
select
  v.id as video_id,
  count(s.id)::int as view_count,
  count(distinct coalesce(s.viewer_name, s.ip_hash, s.id::text))::int as unique_viewers,
  coalesce(avg(s.max_percent), 0)::numeric(5,2) as avg_max_percent,
  max(s.last_seen_at) as last_viewed_at
from public.videos v
left join public.view_sessions s on s.video_id = v.id
group by v.id;

alter view public.video_stats set (security_invoker = on);
revoke all on public.video_stats from anon, authenticated;
```

- [ ] **CONTROLLER-ONLY:** apply this migration to the live Supabase project with the
      Management API helper script in the session scratchpad (or `supabase db push`).
      An implementing subagent must **not** attempt this — it has no credentials. Stop
      and report if the column is missing when a later task needs it.
- [ ] Verify the columns afterwards (controller):
      `select column_name from information_schema.columns where table_name = 'videos' and column_name = 'edits';`
- [ ] Commit:

```bash
git add supabase/migrations/20260902000000_phase3.sql
git commit -m "$(cat <<'EOF'
feat(db): add videos.edits and the Phase 3 view index

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 2: `src/lib/edits.ts` — the edit-decision-list type and validator

**Files:** `src/lib/edits.test.ts`, `src/lib/edits.ts`

- [ ] Write the failing test `src/lib/edits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_EDITS, isEmptyEdits, parseEdits } from "@/lib/edits";

describe("parseEdits", () => {
  it("returns the empty list for junk input", () => {
    for (const junk of [null, undefined, 1, "x", [], {}, { version: 2 }]) {
      expect(parseEdits(junk)).toEqual(EMPTY_EDITS);
    }
  });

  it("keeps well-formed cuts and drops malformed ones", () => {
    const parsed = parseEdits({
      version: 1,
      cuts: [
        { start: 1, end: 2 },
        { start: 5, end: 5 },
        { start: "a", end: 2 },
        null,
      ],
    });
    expect(parsed.cuts).toEqual([{ start: 1, end: 2 }]);
  });

  it("keeps a valid crop and rejects a zero-area one", () => {
    expect(parseEdits({ version: 1, crop: { x: 0, y: 0, w: 1, h: 0.5 } }).crop).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 0.5,
    });
    expect(parseEdits({ version: 1, crop: { x: 0, y: 0, w: 0, h: 1 } }).crop).toBeNull();
  });

  it("keeps zooms with a valid rect", () => {
    const parsed = parseEdits({
      version: 1,
      zooms: [
        { start: 0, end: 3, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
        { start: 0, end: 3, rect: { x: 0.1, y: 0.1, w: 0 } },
      ],
    });
    expect(parsed.zooms).toHaveLength(1);
    expect(parsed.zooms[0].rect.w).toBe(0.5);
  });

  it("keeps only known overlay types and carries n/color", () => {
    const parsed = parseEdits({
      version: 1,
      overlays: [
        { type: "blur", start: 0, end: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
        { type: "callout", start: 1, end: 2, rect: { x: 0, y: 0, w: 1, h: 1 }, n: 3 },
        { type: "sparkle", start: 0, end: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
        {
          type: "highlight",
          start: 0,
          end: 1,
          rect: { x: 0, y: 0, w: 1, h: 1 },
          color: "#ff0",
        },
      ],
    });
    expect(parsed.overlays.map((o) => o.type)).toEqual([
      "blur",
      "callout",
      "highlight",
    ]);
    expect(parsed.overlays[1].n).toBe(3);
    expect(parsed.overlays[2].color).toBe("#ff0");
  });

  it("round-trips through JSON", () => {
    const source = {
      version: 1,
      cuts: [{ start: 0, end: 1 }],
      crop: null,
      zooms: [],
      overlays: [],
    };
    expect(parseEdits(JSON.parse(JSON.stringify(source)))).toEqual({
      version: 1,
      cuts: [{ start: 0, end: 1 }],
      crop: null,
      zooms: [],
      overlays: [],
    });
  });
});

describe("isEmptyEdits", () => {
  it("is true for the empty list and false once anything is set", () => {
    expect(isEmptyEdits(EMPTY_EDITS)).toBe(true);
    expect(
      isEmptyEdits({ ...EMPTY_EDITS, cuts: [{ start: 0, end: 1 }] }),
    ).toBe(false);
  });
});
```

- [ ] Run `npx vitest run src/lib/edits.test.ts` — expected failure:
      `Error: Failed to load url @/lib/edits` (module does not exist).
- [ ] Write `src/lib/edits.ts`:

```ts
/**
 * Non-destructive edit decision list stored in `videos.edits` (jsonb).
 *
 * Phase 3 only persists and plumbs this through; nothing renders it yet. The
 * proposed Phase 5 editor draws it on the canvas overlay in `edit-player.tsx`.
 *
 * All times are seconds from the start of the source video. All rects are
 * normalised to the video frame (0..1) so they survive any display size.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export type Cut = { start: number; end: number };

export type Zoom = { start: number; end: number; rect: Rect };

export type OverlayType = "blur" | "callout" | "underline" | "highlight";

export type Overlay = {
  type: OverlayType;
  start: number;
  end: number;
  rect: Rect;
  /** Callout number badge. */
  n?: number;
  /** CSS colour for underline/highlight. */
  color?: string;
};

export type VideoEdits = {
  version: 1;
  cuts: Cut[];
  crop: Rect | null;
  zooms: Zoom[];
  overlays: Overlay[];
};

export const EMPTY_EDITS: VideoEdits = {
  version: 1,
  cuts: [],
  crop: null,
  zooms: [],
  overlays: [],
};

const OVERLAY_TYPES: OverlayType[] = ["blur", "callout", "underline", "highlight"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) return null;
  const x = num(value.x);
  const y = num(value.y);
  const w = num(value.w);
  const h = num(value.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function parseSpan(value: unknown): { start: number; end: number } | null {
  if (!isRecord(value)) return null;
  const start = num(value.start);
  const end = num(value.end);
  if (start === null || end === null) return null;
  if (start < 0 || end <= start) return null;
  return { start, end };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Total validator: never throws, never returns a partially-valid shape.
 * Anything unrecognised is dropped, so a hand-edited or future-versioned
 * jsonb blob degrades to "no edits" rather than breaking playback.
 */
export function parseEdits(input: unknown): VideoEdits {
  if (!isRecord(input)) return EMPTY_EDITS;
  if (input.version !== 1) return EMPTY_EDITS;

  const cuts: Cut[] = [];
  for (const raw of asArray(input.cuts)) {
    const span = parseSpan(raw);
    if (span) cuts.push(span);
  }

  const zooms: Zoom[] = [];
  for (const raw of asArray(input.zooms)) {
    const span = parseSpan(raw);
    const rect = isRecord(raw) ? parseRect(raw.rect) : null;
    if (span && rect) zooms.push({ ...span, rect });
  }

  const overlays: Overlay[] = [];
  for (const raw of asArray(input.overlays)) {
    if (!isRecord(raw)) continue;
    const type = raw.type;
    if (typeof type !== "string") continue;
    if (!OVERLAY_TYPES.includes(type as OverlayType)) continue;
    const span = parseSpan(raw);
    const rect = parseRect(raw.rect);
    if (!span || !rect) continue;
    const overlay: Overlay = { type: type as OverlayType, ...span, rect };
    const n = num(raw.n);
    if (n !== null) overlay.n = n;
    if (typeof raw.color === "string") overlay.color = raw.color;
    overlays.push(overlay);
  }

  return {
    version: 1,
    cuts,
    crop: parseRect(input.crop),
    zooms,
    overlays,
  };
}

export function isEmptyEdits(edits: VideoEdits): boolean {
  return (
    edits.cuts.length === 0 &&
    edits.crop === null &&
    edits.zooms.length === 0 &&
    edits.overlays.length === 0
  );
}
```

- [ ] Run `npx vitest run src/lib/edits.test.ts` — expected: PASS (7 tests).
- [ ] Commit:

```bash
git add src/lib/edits.ts src/lib/edits.test.ts
git commit -m "$(cat <<'EOF'
feat(edits): add the VideoEdits type and a total parseEdits validator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 3: `src/lib/format.ts` — display formatters

**Files:** `src/lib/format.test.ts`, `src/lib/format.ts`

- [ ] Write the failing test `src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deviceFromUserAgent, fmtBytes, fmtDuration, fmtRelative } from "@/lib/format";

describe("fmtDuration", () => {
  it("formats m:ss under an hour", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(9_000)).toBe("0:09");
    expect(fmtDuration(75_000)).toBe("1:15");
  });

  it("formats h:mm:ss at an hour and over", () => {
    expect(fmtDuration(3_600_000)).toBe("1:00:00");
    expect(fmtDuration(3_725_000)).toBe("1:02:05");
  });

  it("renders an em dash for unknown durations", () => {
    expect(fmtDuration(null)).toBe("—");
    expect(fmtDuration(-1)).toBe("—");
  });
});

describe("fmtBytes", () => {
  it("scales to the nearest unit", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(999)).toBe("999 B");
    expect(fmtBytes(1024)).toBe("1.0 KB");
    expect(fmtBytes(1024 * 1024 * 3.5)).toBe("3.5 MB");
    expect(fmtBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("renders an em dash for unknown sizes", () => {
    expect(fmtBytes(null)).toBe("—");
  });
});

describe("fmtRelative", () => {
  const now = new Date("2026-09-02T12:00:00Z");

  it("describes recent times", () => {
    expect(fmtRelative("2026-09-02T11:59:30Z", now)).toBe("just now");
    expect(fmtRelative("2026-09-02T11:45:00Z", now)).toBe("15m ago");
    expect(fmtRelative("2026-09-02T09:00:00Z", now)).toBe("3h ago");
    expect(fmtRelative("2026-08-30T12:00:00Z", now)).toBe("3d ago");
    expect(fmtRelative("2026-08-05T12:00:00Z", now)).toBe("4w ago");
    expect(fmtRelative("2025-09-02T12:00:00Z", now)).toBe("1y ago");
  });

  it("renders an em dash for missing or unparsable input", () => {
    expect(fmtRelative(null, now)).toBe("—");
    expect(fmtRelative("not-a-date", now)).toBe("—");
  });
});

describe("deviceFromUserAgent", () => {
  it("is re-exported from alerts so there is one implementation", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (Macintosh) Chrome/120")).toBe(
      "Mac · Chrome",
    );
    expect(deviceFromUserAgent(null)).toBe("Unknown device");
  });
});
```

- [ ] Run `npx vitest run src/lib/format.test.ts` — expected failure:
      `Error: Failed to load url @/lib/format`.
- [ ] Write `src/lib/format.ts`:

```ts
/** Display formatters shared by the owner dashboard. */

// One implementation of UA parsing lives in alerts.ts (it is used by the emails);
// re-export rather than duplicate it.
export { deviceFromUserAgent } from "@/lib/alerts";

const DASH = "—";

export function fmtDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return DASH;
  const total = Math.round(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function fmtBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return DASH;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

export function fmtRelative(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return DASH;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return DASH;

  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 52) return `${weeks}w ago`;
  return `${Math.round(days / 365)}y ago`;
}
```

- [ ] Run `npx vitest run src/lib/format.test.ts` — expected: PASS (8 tests).
- [ ] Commit:

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "$(cat <<'EOF'
feat(format): add duration, byte and relative-time formatters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 4: `listVideos` + the `edits` column on `Video`

**Files:** `src/lib/db-phase3.test.ts`, `src/lib/db.ts`

- [ ] Write the failing test `src/lib/db-phase3.test.ts` (its own `chain()` stub,
      extended with the query methods Phase 3 needs):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from, rpc }),
}));

import { listVideos } from "@/lib/db";

type AnyRecord = Record<string, unknown>;

/** Chainable Supabase query-builder stub that resolves to `result`. */
function chain(result: AnyRecord) {
  const calls: Record<string, unknown[][]> = {};
  const builder: AnyRecord = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "is",
    "in",
    "gte",
    "ilike",
    "or",
    "order",
    "limit",
    "range",
  ]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return builder;
    });
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: AnyRecord) => unknown) => resolve(result);
  builder.__calls = calls;
  return builder;
}

const ROW_A = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  slug: "alpha",
  title: "Alpha",
  description: null,
  drive_file_id: "drive-a",
  mime: "video/webm",
  size_bytes: 100,
  duration_ms: 5000,
  width: 1280,
  height: 720,
  thumbnail_drive_file_id: "thumb-a",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  deleted_at: null,
  edits: {},
};

const ROW_B = {
  ...ROW_A,
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  slug: "bravo",
  title: "Bravo",
  drive_file_id: "drive-b",
  created_at: "2026-09-02T00:00:00Z",
};

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
});

describe("listVideos", () => {
  it("filters out deleted rows and merges video_stats", async () => {
    const videos = chain({ data: [ROW_B, ROW_A], error: null });
    const stats = chain({
      data: [
        {
          video_id: ROW_A.id,
          view_count: 7,
          unique_viewers: 3,
          avg_max_percent: "42.50",
          last_viewed_at: "2026-09-02T10:00:00Z",
        },
      ],
      error: null,
    });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : stats,
    );

    const rows = await listVideos({ sort: "newest" });

    expect(videos.is).toHaveBeenCalledWith("deleted_at", null);
    expect(from).toHaveBeenCalledWith("video_stats");
    expect(rows.map((r) => r.slug)).toEqual(["bravo", "alpha"]);
    expect(rows[1].views).toBe(7);
    expect(rows[1].uniqueViewers).toBe(3);
    expect(rows[1].avgMaxPercent).toBe(42.5);
    // No stats row at all still yields zeros, never undefined.
    expect(rows[0].views).toBe(0);
    expect(rows[0].avgMaxPercent).toBe(0);
    expect(rows[0].lastViewedAt).toBeNull();
  });

  it("applies a search filter across title, description and slug", async () => {
    const videos = chain({ data: [], error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: [], error: null }),
    );

    await listVideos({ q: "demo", sort: "newest" });

    expect(videos.or).toHaveBeenCalledWith(
      "title.ilike.%demo%,description.ilike.%demo%,slug.ilike.%demo%",
    );
  });

  it("escapes PostgREST metacharacters in the search term", async () => {
    const videos = chain({ data: [], error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: [], error: null }),
    );

    await listVideos({ q: "a,b(c)", sort: "newest" });

    expect(videos.or).toHaveBeenCalledWith(
      "title.ilike.%a b c %,description.ilike.%a b c %,slug.ilike.%a b c %".replace(
        / /g,
        "",
      ),
    );
  });

  it("orders oldest-first when asked", async () => {
    const videos = chain({ data: [], error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: [], error: null }),
    );

    await listVideos({ sort: "oldest" });

    expect(videos.order).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  it("sorts by view count in JS for sort=views", async () => {
    const videos = chain({ data: [ROW_A, ROW_B], error: null });
    const stats = chain({
      data: [
        { video_id: ROW_A.id, view_count: 1, unique_viewers: 1, avg_max_percent: 0, last_viewed_at: null },
        { video_id: ROW_B.id, view_count: 9, unique_viewers: 2, avg_max_percent: 0, last_viewed_at: null },
      ],
      error: null,
    });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : stats,
    );

    const rows = await listVideos({ sort: "views" });
    expect(rows.map((r) => r.slug)).toEqual(["bravo", "alpha"]);
  });

  it("throws on a database error", async () => {
    from.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    await expect(listVideos({ sort: "newest" })).rejects.toThrow("boom");
  });
});
```

- [ ] Run `npx vitest run src/lib/db-phase3.test.ts` — expected failure:
      `SyntaxError: The requested module '@/lib/db' does not provide an export named 'listVideos'`.
- [ ] In `src/lib/db.ts`, add `edits: Record<string, unknown>;` to the `Video` type
      (immediately after `deleted_at`), then append:

```ts
export type VideoSort = "newest" | "oldest" | "views" | "title";

export type VideoStatsRow = {
  video_id: string;
  view_count: number;
  unique_viewers: number;
  avg_max_percent: number | string;
  last_viewed_at: string | null;
};

export type VideoListItem = Video & {
  views: number;
  uniqueViewers: number;
  avgMaxPercent: number;
  lastViewedAt: string | null;
};

/**
 * PostgREST's `or=` filter is comma/parenthesis delimited, so those characters
 * cannot appear inside a value. Strip them rather than escape them: the search
 * box is a convenience, not a query language.
 */
function sanitizeSearch(term: string): string {
  return term.replace(/[,()*\\]/g, "").trim();
}

/**
 * Live videos with their aggregates. `video_stats` is a view, so PostgREST
 * cannot embed it from `videos`; two queries are merged in JS instead.
 */
export async function listVideos(options: {
  q?: string;
  sort: VideoSort;
}): Promise<VideoListItem[]> {
  const { q, sort } = options;

  let query = getSupabase().from("videos").select("*").is("deleted_at", null);

  const term = q ? sanitizeSearch(q) : "";
  if (term) {
    query = query.or(
      `title.ilike.%${term}%,description.ilike.%${term}%,slug.ilike.%${term}%`,
    );
  }

  if (sort === "oldest") query = query.order("created_at", { ascending: true });
  else if (sort === "title") query = query.order("title", { ascending: true });
  else query = query.order("created_at", { ascending: false });

  const videos = unwrap((await query) as QueryResult<Video[] | null>) ?? [];
  if (videos.length === 0) return [];

  const statsResult = (await getSupabase()
    .from("video_stats")
    .select("*")
    .in(
      "video_id",
      videos.map((video) => video.id),
    )) as QueryResult<VideoStatsRow[] | null>;
  const stats = unwrap(statsResult) ?? [];
  const byId = new Map(stats.map((row) => [row.video_id, row]));

  const merged: VideoListItem[] = videos.map((video) => {
    const row = byId.get(video.id);
    return {
      ...video,
      views: row?.view_count ?? 0,
      uniqueViewers: row?.unique_viewers ?? 0,
      avgMaxPercent: row ? Number(row.avg_max_percent) || 0 : 0,
      lastViewedAt: row?.last_viewed_at ?? null,
    };
  });

  // view_count lives in the view, so this ordering cannot be pushed into SQL
  // without a join PostgREST will not infer. Personal-scale row counts.
  if (sort === "views") merged.sort((a, b) => b.views - a.views);

  return merged;
}
```

- [ ] Run `npx vitest run src/lib/db-phase3.test.ts` — expected: PASS (6 tests).
- [ ] Run `npx vitest run src/lib/db.test.ts` — expected: PASS (existing suite unaffected).
- [ ] Commit:

```bash
git add src/lib/db.ts src/lib/db-phase3.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add listVideos with merged video_stats aggregates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 5: `updateVideoMeta`, `isSlugTaken`, `changeSlug`

**Files:** `src/lib/db-phase3.test.ts`, `src/lib/db.ts`

- [ ] Append the failing tests to `src/lib/db-phase3.test.ts` (add
      `changeSlug, isSlugTaken, updateVideoMeta` to the existing import from `@/lib/db`):

```ts
describe("updateVideoMeta", () => {
  it("writes only the provided fields and returns the row", async () => {
    const builder = chain({ data: { ...ROW_A, title: "New" }, error: null });
    from.mockReturnValue(builder);

    const row = await updateVideoMeta(ROW_A.id, { title: "New" });

    expect(from).toHaveBeenCalledWith("videos");
    expect(builder.update).toHaveBeenCalledWith({ title: "New" });
    expect(builder.eq).toHaveBeenCalledWith("id", ROW_A.id);
    expect(row.title).toBe("New");
  });

  it("normalises an empty description to null", async () => {
    const builder = chain({ data: ROW_A, error: null });
    from.mockReturnValue(builder);
    await updateVideoMeta(ROW_A.id, { description: "   " });
    expect(builder.update).toHaveBeenCalledWith({ description: null });
  });

  it("is a no-op read when nothing changed", async () => {
    const builder = chain({ data: ROW_A, error: null });
    from.mockReturnValue(builder);
    await updateVideoMeta(ROW_A.id, {});
    expect(builder.update).not.toHaveBeenCalled();
    expect(builder.select).toHaveBeenCalled();
  });
});

describe("isSlugTaken", () => {
  it("is true when a live video already owns the slug", async () => {
    const videos = chain({ data: { id: ROW_B.id }, error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: null, error: null }),
    );
    await expect(isSlugTaken("alpha")).resolves.toBe(true);
  });

  it("ignores the excluded video's own slug", async () => {
    const videos = chain({ data: { id: ROW_A.id }, error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: null, error: null }),
    );
    await expect(isSlugTaken("alpha", ROW_A.id)).resolves.toBe(false);
  });

  it("is true when slug_history points at another video", async () => {
    from.mockImplementation((table: string) =>
      table === "videos"
        ? chain({ data: null, error: null })
        : chain({ data: { video_id: ROW_B.id }, error: null }),
    );
    await expect(isSlugTaken("alpha", ROW_A.id)).resolves.toBe(true);
  });

  it("lets a video reclaim its own old slug", async () => {
    from.mockImplementation((table: string) =>
      table === "videos"
        ? chain({ data: null, error: null })
        : chain({ data: { video_id: ROW_A.id }, error: null }),
    );
    await expect(isSlugTaken("alpha", ROW_A.id)).resolves.toBe(false);
  });
});

describe("changeSlug", () => {
  it("calls the change_video_slug RPC", async () => {
    rpc.mockResolvedValue({ data: { ...ROW_A, slug: "my-demo" }, error: null });
    const row = await changeSlug(ROW_A.id, "my-demo");
    expect(rpc).toHaveBeenCalledWith("change_video_slug", {
      p_video_id: ROW_A.id,
      p_new_slug: "my-demo",
    });
    expect(row?.slug).toBe("my-demo");
  });

  it("returns null when the video does not exist", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(changeSlug(ROW_A.id, "my-demo")).resolves.toBeNull();
  });

  it("throws on a database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(changeSlug(ROW_A.id, "my-demo")).rejects.toThrow("nope");
  });
});
```

- [ ] Run `npx vitest run src/lib/db-phase3.test.ts` — expected failure:
      `does not provide an export named 'updateVideoMeta'`.
- [ ] Append to `src/lib/db.ts`:

```ts
export type VideoMetaPatch = { title?: string; description?: string | null };

export async function updateVideoMeta(
  id: string,
  patch: VideoMetaPatch,
): Promise<Video> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.description !== undefined) {
    const trimmed = (patch.description ?? "").trim();
    update.description = trimmed === "" ? null : trimmed;
  }

  const table = getSupabase().from("videos");
  const query =
    Object.keys(update).length === 0
      ? table.select("*").eq("id", id).single()
      : table.update(update).eq("id", id).select("*").single();

  return unwrap((await query) as QueryResult<Video>);
}

/**
 * True when `slug` is already in use by another video, either as its current
 * slug or as one of its historical slugs (which still 308-redirect).
 */
export async function isSlugTaken(
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const videoResult = (await getSupabase()
    .from("videos")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()) as QueryResult<{ id: string } | null>;
  const video = unwrap(videoResult);
  if (video && video.id !== excludeId) return true;

  const historyResult = (await getSupabase()
    .from("slug_history")
    .select("video_id")
    .eq("old_slug", slug)
    .maybeSingle()) as QueryResult<{ video_id: string } | null>;
  const history = unwrap(historyResult);
  if (history && history.video_id !== excludeId) return true;

  return false;
}

/** One transaction: record the old slug in slug_history and swap the new one in. */
export async function changeSlug(
  id: string,
  newSlug: string,
): Promise<Video | null> {
  const result = (await getSupabase().rpc("change_video_slug", {
    p_video_id: id,
    p_new_slug: newSlug,
  })) as QueryResult<Video | null>;
  const row = unwrap(result);
  return row && row.id ? row : null;
}
```

- [ ] Run `npx vitest run src/lib/db-phase3.test.ts` — expected: PASS (16 tests).
- [ ] Commit:

```bash
git add src/lib/db.ts src/lib/db-phase3.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add updateVideoMeta, isSlugTaken and changeSlug

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 6: `softDeleteVideo`, `setVideoEdits`, `updateSettings`

**Files:** `src/lib/db-phase3.test.ts`, `src/lib/db.ts`

- [ ] Append the failing tests to `src/lib/db-phase3.test.ts` (add
      `setVideoEdits, softDeleteVideo, updateSettings` to the `@/lib/db` import):

```ts
describe("softDeleteVideo", () => {
  it("stamps deleted_at and returns the row for Drive cleanup", async () => {
    const builder = chain({
      data: { ...ROW_A, deleted_at: "2026-09-02T00:00:00Z" },
      error: null,
    });
    from.mockReturnValue(builder);

    const row = await softDeleteVideo(ROW_A.id);

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }),
    );
    expect(builder.eq).toHaveBeenCalledWith("id", ROW_A.id);
    expect(builder.is).toHaveBeenCalledWith("deleted_at", null);
    expect(row?.drive_file_id).toBe("drive-a");
  });

  it("returns null when the video was already deleted", async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    await expect(softDeleteVideo(ROW_A.id)).resolves.toBeNull();
  });
});

describe("setVideoEdits", () => {
  it("writes the edit list as jsonb", async () => {
    const builder = chain({ data: null, error: null });
    from.mockReturnValue(builder);

    await setVideoEdits(ROW_A.id, {
      version: 1,
      cuts: [],
      crop: null,
      zooms: [],
      overlays: [],
    });

    expect(builder.update).toHaveBeenCalledWith({
      edits: { version: 1, cuts: [], crop: null, zooms: [], overlays: [] },
    });
    expect(builder.eq).toHaveBeenCalledWith("id", ROW_A.id);
  });
});

describe("updateSettings", () => {
  it("patches the single settings row and returns it", async () => {
    const builder = chain({
      data: {
        id: 1,
        alert_on_first_view: false,
        alert_on_completion: true,
        updated_at: "2026-09-02T00:00:00Z",
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const settings = await updateSettings({ alert_on_first_view: false });

    expect(from).toHaveBeenCalledWith("settings");
    expect(builder.update).toHaveBeenCalledWith({ alert_on_first_view: false });
    expect(builder.eq).toHaveBeenCalledWith("id", 1);
    expect(settings.alert_on_first_view).toBe(false);
  });

  it("throws on a database error", async () => {
    from.mockReturnValue(chain({ data: null, error: { message: "nope" } }));
    await expect(updateSettings({ alert_on_completion: true })).rejects.toThrow(
      "nope",
    );
  });
});
```

- [ ] Run `npx vitest run src/lib/db-phase3.test.ts` — expected failure:
      `does not provide an export named 'softDeleteVideo'`.
- [ ] Add the import `import type { VideoEdits } from "@/lib/edits";` at the top of
      `src/lib/db.ts`, then append:

```ts
/**
 * Soft delete. Returns the row (so the caller can trash the Drive files) or
 * null when it was already deleted — which makes the action idempotent.
 */
export async function softDeleteVideo(id: string): Promise<Video | null> {
  const result = (await getSupabase()
    .from("videos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle()) as QueryResult<Video | null>;
  return unwrap(result);
}

/** Persist the non-destructive edit decision list (Phase 5 writes it; Phase 3 plumbs it). */
export async function setVideoEdits(id: string, edits: VideoEdits): Promise<void> {
  const result = (await getSupabase()
    .from("videos")
    .update({ edits })
    .eq("id", id)) as QueryResult<unknown>;
  unwrap(result);
}

export type SettingsPatch = {
  alert_on_first_view?: boolean;
  alert_on_completion?: boolean;
};

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const result = (await getSupabase()
    .from("settings")
    .update(patch)
    .eq("id", 1)
    .select("*")
    .single()) as QueryResult<Settings>;
  return unwrap(result);
}
```

- [ ] Run `npx vitest run src/lib/db-phase3.test.ts` — expected: PASS (21 tests).
- [ ] Commit:

```bash
git add src/lib/db.ts src/lib/db-phase3.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add softDeleteVideo, setVideoEdits and updateSettings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 7: `getVideoStats` + `listRecentViewers`

**Files:** `src/lib/db-phase3.test.ts`, `src/lib/db.ts`

- [ ] Append the failing tests to `src/lib/db-phase3.test.ts` (add
      `getVideoStats, listRecentViewers` to the `@/lib/db` import):

```ts
describe("getVideoStats", () => {
  it("bins max_percent into ten buckets and averages them", async () => {
    const builder = chain({
      data: [
        { max_percent: 0, viewer_name: null, ip_hash: "a" },
        { max_percent: 5, viewer_name: null, ip_hash: "a" },
        { max_percent: 55, viewer_name: "Jo", ip_hash: "b" },
        { max_percent: 100, viewer_name: null, ip_hash: "c" },
      ],
      error: null,
    });
    from.mockReturnValue(builder);

    const stats = await getVideoStats(ROW_A.id);

    expect(from).toHaveBeenCalledWith("view_sessions");
    expect(builder.eq).toHaveBeenCalledWith("video_id", ROW_A.id);
    expect(stats.views).toBe(4);
    expect(stats.unique).toBe(3);
    expect(stats.avgMaxPercent).toBe(40);
    expect(stats.buckets).toHaveLength(10);
    // 0 and 5 both land in bucket 0; 55 in bucket 5; 100 clamps into bucket 9.
    expect(stats.buckets).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("returns zeroed stats with ten empty buckets when there are no views", async () => {
    from.mockReturnValue(chain({ data: [], error: null }));
    const stats = await getVideoStats(ROW_A.id);
    expect(stats).toEqual({
      views: 0,
      unique: 0,
      avgMaxPercent: 0,
      buckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  });
});

describe("listRecentViewers", () => {
  it("orders by start time and applies the limit", async () => {
    const builder = chain({
      data: [
        {
          id: "s1",
          viewer_name: "Jo",
          city: "Austin",
          country: "US",
          user_agent: "Mozilla/5.0 (Macintosh) Chrome/120",
          started_at: "2026-09-02T10:00:00Z",
          last_seen_at: "2026-09-02T10:05:00Z",
          max_percent: 80,
        },
      ],
      error: null,
    });
    from.mockReturnValue(builder);

    const rows = await listRecentViewers(ROW_A.id);

    expect(builder.order).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(50);
    expect(rows[0].viewer_name).toBe("Jo");
  });

  it("honours an explicit limit", async () => {
    const builder = chain({ data: [], error: null });
    from.mockReturnValue(builder);
    await listRecentViewers(ROW_A.id, 5);
    expect(builder.limit).toHaveBeenCalledWith(5);
  });
});
```

- [ ] Run `npx vitest run src/lib/db-phase3.test.ts` — expected failure:
      `does not provide an export named 'getVideoStats'`.
- [ ] Append to `src/lib/db.ts`:

```ts
export type VideoStats = {
  views: number;
  unique: number;
  avgMaxPercent: number;
  /** Ten retention buckets: 0–10%, 10–20% … 90–100%. */
  buckets: number[];
};

export type ViewerRow = Pick<
  ViewSession,
  | "id"
  | "viewer_name"
  | "city"
  | "country"
  | "user_agent"
  | "started_at"
  | "last_seen_at"
  | "max_percent"
>;

const VIEWER_COLUMNS =
  "id,viewer_name,city,country,user_agent,started_at,last_seen_at,max_percent";

/**
 * Per-video analytics. The histogram is computed here rather than in SQL so the
 * dashboard needs exactly one round trip and no extra view.
 */
export async function getVideoStats(videoId: string): Promise<VideoStats> {
  const result = (await getSupabase()
    .from("view_sessions")
    .select("max_percent,viewer_name,ip_hash")
    .eq("video_id", videoId)) as QueryResult<
    { max_percent: number; viewer_name: string | null; ip_hash: string | null }[] | null
  >;
  const rows = unwrap(result) ?? [];

  const buckets = new Array<number>(10).fill(0);
  const viewers = new Set<string>();
  let total = 0;

  for (const [index, row] of rows.entries()) {
    const percent = Math.max(0, Math.min(100, Number(row.max_percent) || 0));
    buckets[Math.min(9, Math.floor(percent / 10))] += 1;
    total += percent;
    viewers.add(row.viewer_name ?? row.ip_hash ?? `session-${index}`);
  }

  return {
    views: rows.length,
    unique: viewers.size,
    avgMaxPercent: rows.length === 0 ? 0 : Math.round(total / rows.length),
    buckets,
  };
}

export async function listRecentViewers(
  videoId: string,
  limit = 50,
): Promise<ViewerRow[]> {
  const result = (await getSupabase()
    .from("view_sessions")
    .select(VIEWER_COLUMNS)
    .eq("video_id", videoId)
    .order("started_at", { ascending: false })
    .limit(limit)) as QueryResult<ViewerRow[] | null>;
  return unwrap(result) ?? [];
}
```

- [ ] Run `npx vitest run src/lib/db-phase3.test.ts` — expected: PASS (25 tests).
- [ ] Run `npm test` — expected: PASS (whole suite).
- [ ] Commit:

```bash
git add src/lib/db.ts src/lib/db-phase3.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add getVideoStats retention buckets and listRecentViewers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 8: `normalizeSlug` in `slug.ts`

**Files:** `src/lib/slug.test.ts`, `src/lib/slug.ts`

- [ ] Append the failing test to `src/lib/slug.test.ts` (add `normalizeSlug` to the
      existing `@/lib/slug` import):

```ts
describe("normalizeSlug", () => {
  it("lowercases, trims and collapses separators", () => {
    expect(normalizeSlug("  My Demo  ")).toBe("my-demo");
    expect(normalizeSlug("My___Demo")).toBe("my-demo");
    expect(normalizeSlug("my--demo")).toBe("my-demo");
    expect(normalizeSlug("-my-demo-")).toBe("my-demo");
  });

  it("drops characters that SLUG_RE would reject", () => {
    expect(normalizeSlug("my.demo!")).toBe("mydemo");
  });

  it("produces something SLUG_RE accepts, or an unusable short string", () => {
    expect(SLUG_RE.test(normalizeSlug("My Demo"))).toBe(true);
    expect(SLUG_RE.test(normalizeSlug("AB"))).toBe(false);
  });
});
```

- [ ] Run `npx vitest run src/lib/slug.test.ts` — expected failure:
      `does not provide an export named 'normalizeSlug'`.
- [ ] Append to `src/lib/slug.ts`:

```ts
/**
 * Best-effort tidy-up of a hand-typed slug. Deliberately does NOT validate —
 * the caller still tests the result against SLUG_RE so the user sees an error
 * for input that cannot be rescued (e.g. "AB" is too short).
 */
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

- [ ] Run `npx vitest run src/lib/slug.test.ts` — expected: PASS.
- [ ] Commit:

```bash
git add src/lib/slug.ts src/lib/slug.test.ts
git commit -m "$(cat <<'EOF'
feat(slug): add normalizeSlug for the dashboard slug editor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 9: Owner route group layout and nav

**Files:** `src/app/(owner)/layout.tsx`

- [ ] There is no unit test for a server layout; the verification is
      `npm run build` plus the manual check in Task 22. Create
      `src/app/(owner)/layout.tsx`:

```tsx
import Link from "next/link";
import { isOwner } from "@/lib/auth";
import { PasswordGate } from "@/components/password-gate";
import { YoomLogo } from "@/components/logo";

/**
 * Everything under `(owner)` is private. The group adds no URL segment, so the
 * routes stay `/library` and `/settings`.
 *
 * Rendering the gate (rather than redirecting to `/`) matches `src/app/page.tsx`
 * and keeps the URL intact, so signing in lands the owner back where they were.
 */
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isOwner())) {
    return <PasswordGate />;
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between border-b border-border-subtle pb-4">
        <Link href="/" aria-label="Yoom home">
          <YoomLogo size="sm" />
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            Record
          </Link>
          <Link
            href="/library"
            className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            Library
          </Link>
          <Link
            href="/settings"
            className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            Settings
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
```

- [ ] Run `npx tsc --noEmit` — expected: PASS (no page exists under the group yet, which
      is fine; a route group without a page renders nothing).
- [ ] Commit:

```bash
git add "src/app/(owner)/layout.tsx"
git commit -m "$(cat <<'EOF'
feat(owner): add the gated owner route group and nav

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 10: Library components — card, toolbar, copy button

**Files:** `src/components/library/video-card.tsx`,
`src/components/library/library-toolbar.tsx`,
`src/components/library/copy-link-button.tsx`

- [ ] Create `src/components/library/copy-link-button.tsx`:

```tsx
"use client";

import { useState } from "react";

type CopyLinkButtonProps = {
  url: string;
  label?: string;
  className?: string;
};

export function CopyLinkButton({
  url,
  label = "Copy link",
  className,
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Insecure context; the URL is always shown next to the button.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        className ??
        "shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover"
      }
    >
      <span aria-live="polite">{copied ? "Copied!" : label}</span>
    </button>
  );
}
```

- [ ] Create `src/components/library/library-toolbar.tsx`:

```tsx
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
```

- [ ] Create `src/components/library/video-card.tsx`:

```tsx
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
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Commit:

```bash
git add src/components/library
git commit -m "$(cat <<'EOF'
feat(library): add the video card, toolbar and copy-link components

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 11: `/library` grid page

**Files:** `src/app/(owner)/library/page.tsx`

- [ ] Create `src/app/(owner)/library/page.tsx`:

```tsx
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
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Run `npm run lint` — expected: PASS.
- [ ] Commit:

```bash
git add "src/app/(owner)/library/page.tsx"
git commit -m "$(cat <<'EOF'
feat(library): add the /library grid with search and sort

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 12: Server actions

**Files:** `src/app/(owner)/actions.ts`

- [ ] Create `src/app/(owner)/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isOwner } from "@/lib/auth";
import {
  changeSlug,
  getVideoById,
  isSlugTaken,
  softDeleteVideo,
  updateSettings,
  updateVideoMeta,
} from "@/lib/db";
import { trashFile } from "@/lib/google-drive";
import { SLUG_RE, normalizeSlug } from "@/lib/slug";

export type ActionState = { error?: string; ok?: boolean };
export type SlugState = ActionState & { slug?: string };

const UNAUTHORIZED: ActionState = { error: "Not signed in." };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function revalidateVideo(id: string): void {
  revalidatePath("/library");
  revalidatePath(`/library/${id}`);
}

export async function updateTitle(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Server Functions are reachable by direct POST, so every one re-checks auth.
  if (!(await isOwner())) return UNAUTHORIZED;

  const id = field(formData, "id");
  const title = field(formData, "title").trim();
  if (!id) return { error: "Missing video." };
  if (title.length === 0) return { error: "Title cannot be empty." };
  if (title.length > 200) return { error: "Title is too long (200 max)." };

  try {
    await updateVideoMeta(id, { title });
  } catch {
    return { error: "Could not save the title." };
  }

  revalidateVideo(id);
  return { ok: true };
}

export async function updateDescription(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await isOwner())) return UNAUTHORIZED;

  const id = field(formData, "id");
  const description = field(formData, "description");
  if (!id) return { error: "Missing video." };
  if (description.length > 5000) return { error: "Description is too long." };

  try {
    await updateVideoMeta(id, { description });
  } catch {
    return { error: "Could not save the description." };
  }

  revalidateVideo(id);
  return { ok: true };
}

export async function updateSlug(
  _prevState: SlugState,
  formData: FormData,
): Promise<SlugState> {
  if (!(await isOwner())) return UNAUTHORIZED;

  const id = field(formData, "id");
  if (!id) return { error: "Missing video." };

  const raw = field(formData, "slug");
  const slug = normalizeSlug(raw);
  if (!SLUG_RE.test(slug)) {
    return {
      error: "Use 3–40 lowercase letters, numbers or hyphens.",
      slug: raw,
    };
  }

  const video = await getVideoById(id);
  if (!video) return { error: "Recording not found." };
  if (video.slug === slug) return { ok: true, slug };

  if (await isSlugTaken(slug, id)) {
    return { error: "That link is already taken.", slug: raw };
  }

  let updated;
  try {
    updated = await changeSlug(id, slug);
  } catch {
    return { error: "Could not change the link.", slug: raw };
  }
  if (!updated) return { error: "Recording not found.", slug: raw };

  revalidateVideo(id);
  revalidatePath(`/v/${video.slug}`);
  revalidatePath(`/v/${updated.slug}`);
  return { ok: true, slug: updated.slug };
}

export async function deleteVideo(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await isOwner())) return UNAUTHORIZED;

  const id = field(formData, "id");
  if (!id) return { error: "Missing video." };

  let deleted;
  try {
    deleted = await softDeleteVideo(id);
  } catch {
    return { error: "Could not delete the recording." };
  }

  if (deleted) {
    // Drive trash is best-effort: the row is already gone from the dashboard,
    // and a failed trash must not strand the owner on an error screen.
    for (const fileId of [deleted.drive_file_id, deleted.thumbnail_drive_file_id]) {
      if (!fileId) continue;
      try {
        await trashFile(fileId);
      } catch (error) {
        console.error("Drive trash failed", fileId, error);
      }
    }
    revalidatePath(`/v/${deleted.slug}`);
  }

  revalidateVideo(id);
  // redirect() throws NEXT_REDIRECT, so nothing after this line runs.
  redirect("/library");
}

export async function saveSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await isOwner())) return UNAUTHORIZED;

  try {
    await updateSettings({
      alert_on_first_view: formData.get("alert_on_first_view") === "on",
      alert_on_completion: formData.get("alert_on_completion") === "on",
    });
  } catch {
    return { error: "Could not save settings." };
  }

  revalidatePath("/settings");
  return { ok: true };
}
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Commit:

```bash
git add "src/app/(owner)/actions.ts"
git commit -m "$(cat <<'EOF'
feat(owner): add the dashboard server actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 13: `EditPlayer` — the canvas-capable player (Phase 5 foundation)

**Files:** `src/components/video/edit-player.tsx`

- [ ] Create `src/components/video/edit-player.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { isEmptyEdits, type VideoEdits } from "@/lib/edits";

export type EditPlayerProps = {
  src: string;
  poster?: string;
  edits: VideoEdits;
  /**
   * Supplied by the watch page so `useViewTracker` keeps owning the element.
   * When omitted the component uses its own internal ref.
   */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  className?: string;
  autoPlay?: boolean;
};

/**
 * A `<video>` with a pixel-accurate `<canvas>` layered over its rendered box.
 *
 * Phase 3 draws nothing — `edits` is always the empty list — but the sizing,
 * the ref plumbing and the per-frame draw loop are in place so the proposed
 * Phase 5 editor only has to fill in `drawEdits`.
 */
export function EditPlayer({
  src,
  poster,
  edits,
  videoRef,
  className,
  autoPlay,
}: EditPlayerProps) {
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? internalRef;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const editsRef = useRef(edits);
  editsRef.current = edits;

  // Keep the canvas backing store matched to the element's rendered box and
  // the device pixel ratio, so future overlays land on the right pixels.
  useEffect(() => {
    const video = ref.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const resize = () => {
      const rect = video.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(video);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [ref]);

  // Draw loop. It only runs while there is something to draw, so an unedited
  // video costs nothing.
  useEffect(() => {
    const video = ref.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    if (isEmptyEdits(editsRef.current)) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let frame = 0;
    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      // Phase 5: render editsRef.current at video.currentTime here.
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [ref, edits]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <video
        ref={ref}
        src={src}
        poster={poster}
        controls
        preload="metadata"
        playsInline
        autoPlay={autoPlay}
        className="w-full rounded-xl border border-border bg-black shadow-lg shadow-black/30"
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 rounded-xl"
      />
    </div>
  );
}
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Commit:

```bash
git add src/components/video/edit-player.tsx
git commit -m "$(cat <<'EOF'
feat(video): add the canvas-capable EditPlayer (Phase 5 foundation)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 14: Detail-page editing components

**Files:** `src/components/video/editable-text.tsx`,
`src/components/video/slug-editor.tsx`, `src/components/video/delete-button.tsx`,
`src/components/video/new-toast.tsx`

- [ ] Create `src/components/video/editable-text.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/app/(owner)/actions";

type EditableTextProps = {
  videoId: string;
  /** Form field name; also the action's expected key. */
  name: "title" | "description";
  value: string;
  placeholder: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  multiline?: boolean;
  autoFocus?: boolean;
  className?: string;
};

const INITIAL: ActionState = {};

/**
 * Click-to-edit text bound to a server action. Saves on blur or ⌘/Ctrl+Enter,
 * reverts on Escape.
 */
export function EditableText({
  videoId,
  name,
  value,
  placeholder,
  action,
  multiline = false,
  autoFocus = false,
  className,
}: EditableTextProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [draft, setDraft] = useState(value);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Adopt server-rendered changes (e.g. after a revalidate) unless the field is
  // currently focused, which would yank text out from under the cursor.
  useEffect(() => {
    if (document.activeElement !== fieldRef.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (autoFocus) {
      const field = fieldRef.current;
      field?.focus();
      field?.select();
    }
  }, [autoFocus]);

  function submitIfChanged() {
    if (draft.trim() === value.trim()) return;
    formRef.current?.requestSubmit();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setDraft(value);
      fieldRef.current?.blur();
      return;
    }
    if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitIfChanged();
    }
  }

  const shared =
    "w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-foreground outline-none transition-all hover:border-border focus:border-accent/50 focus:bg-surface focus:ring-1 focus:ring-accent/20";

  return (
    <form ref={formRef} action={formAction} className="space-y-1">
      <input type="hidden" name="id" value={videoId} />
      <label htmlFor={`field-${name}`} className="sr-only">
        {name === "title" ? "Title" : "Description"}
      </label>
      {multiline ? (
        <textarea
          id={`field-${name}`}
          ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
          name={name}
          rows={3}
          value={draft}
          placeholder={placeholder}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={submitIfChanged}
          onKeyDown={onKeyDown}
          className={`${shared} resize-y text-sm ${className ?? ""}`}
        />
      ) : (
        <input
          id={`field-${name}`}
          ref={fieldRef as React.RefObject<HTMLInputElement>}
          name={name}
          value={draft}
          placeholder={placeholder}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={submitIfChanged}
          onKeyDown={onKeyDown}
          className={`${shared} text-lg font-semibold ${className ?? ""}`}
        />
      )}
      <p aria-live="polite" className="min-h-4 px-2 text-xs">
        {state.error ? (
          <span className="text-red-400/90">{state.error}</span>
        ) : pending ? (
          <span className="text-muted-dim">Saving…</span>
        ) : state.ok ? (
          <span className="text-muted-dim">Saved</span>
        ) : null}
      </p>
    </form>
  );
}
```

- [ ] Create `src/components/video/slug-editor.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { updateSlug, type SlugState } from "@/app/(owner)/actions";

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
          disabled={pending || draft === slug}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
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
```

- [ ] Create `src/components/video/delete-button.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { deleteVideo, type ActionState } from "@/app/(owner)/actions";

type DeleteButtonProps = {
  videoId: string;
  title: string;
};

const INITIAL: ActionState = {};

export function DeleteButton({ videoId, title }: DeleteButtonProps) {
  const [state, formAction, pending] = useActionState(deleteVideo, INITIAL);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Delete “${title}”? The share link stops working and the Drive file moves to Trash.`,
          )
        ) {
          event.preventDefault();
        }
      }}
      className="space-y-1"
    >
      <input type="hidden" name="id" value={videoId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-400/90 transition-colors hover:bg-red-500/10 disabled:opacity-40"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state.error && (
        <p aria-live="polite" className="text-xs text-red-400/90">
          {state.error}
        </p>
      )}
    </form>
  );
}
```

- [ ] Create `src/components/video/new-toast.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

/** Shown once after an upload redirect (`?new=1`); the link is already copied. */
export function NewToast({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
    >
      {message}
    </div>
  );
}
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Commit:

```bash
git add src/components/video
git commit -m "$(cat <<'EOF'
feat(video): add inline metadata, slug, delete and toast components

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 15: Analytics components

**Files:** `src/components/analytics/stat-tiles.tsx`,
`src/components/analytics/retention-bars.tsx`,
`src/components/analytics/viewers-table.tsx`

- [ ] Create `src/components/analytics/stat-tiles.tsx`:

```tsx
import type { VideoStats } from "@/lib/db";

export function StatTiles({ stats }: { stats: VideoStats }) {
  const tiles = [
    { label: "Views", value: String(stats.views) },
    { label: "Unique viewers", value: String(stats.unique) },
    { label: "Avg watched", value: `${stats.avgMaxPercent}%` },
  ];

  return (
    <dl className="grid grid-cols-3 gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-border bg-surface px-3 py-3"
        >
          <dt className="text-[11px] uppercase tracking-wider text-muted-dim">
            {tile.label}
          </dt>
          <dd className="mt-1 text-xl font-semibold text-foreground">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] Create `src/components/analytics/retention-bars.tsx`:

```tsx
const WIDTH = 300;
const HEIGHT = 90;
const GAP = 3;

/**
 * Ten buckets of "furthest point reached": 0–10%, 10–20% … 90–100%.
 * Inline SVG so there is no chart dependency and it renders on the server.
 */
export function RetentionBars({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets);
  const barWidth = (WIDTH - GAP * (buckets.length - 1)) / buckets.length;

  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <h2 className="text-[11px] uppercase tracking-wider text-muted-dim">
        Retention
      </h2>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Retention histogram: ${buckets
          .map((count, index) => `${index * 10}–${index * 10 + 10}%: ${count}`)
          .join(", ")}`}
        className="mt-2 w-full"
      >
        {buckets.map((count, index) => {
          const height = Math.max(2, (count / max) * (HEIGHT - 8));
          return (
            <rect
              key={index}
              x={index * (barWidth + GAP)}
              y={HEIGHT - height}
              width={barWidth}
              height={height}
              rx={2}
              fill={count === 0 ? "#2e2e35" : "#e85a4f"}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-dim">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </section>
  );
}
```

- [ ] Create `src/components/analytics/viewers-table.tsx`:

```tsx
import type { ViewerRow } from "@/lib/db";
import { deviceFromUserAgent, fmtRelative } from "@/lib/format";

function location(row: ViewerRow): string {
  if (row.city && row.country) return `${row.city}, ${row.country}`;
  return row.country ?? row.city ?? "Unknown";
}

export function ViewersTable({ viewers }: { viewers: ViewerRow[] }) {
  if (viewers.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface p-3">
        <h2 className="text-[11px] uppercase tracking-wider text-muted-dim">
          Recent viewers
        </h2>
        <p className="mt-2 text-sm text-muted">No views yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <h2 className="text-[11px] uppercase tracking-wider text-muted-dim">
        Recent viewers
      </h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-dim">
            <tr>
              <th scope="col" className="py-1 pr-3 font-normal">Viewer</th>
              <th scope="col" className="py-1 pr-3 font-normal">Location</th>
              <th scope="col" className="py-1 pr-3 font-normal">Device</th>
              <th scope="col" className="py-1 pr-3 font-normal">When</th>
              <th scope="col" className="py-1 text-right font-normal">Watched</th>
            </tr>
          </thead>
          <tbody className="text-muted">
            {viewers.map((row) => (
              <tr key={row.id} className="border-t border-border-subtle">
                <td className="py-1.5 pr-3 text-foreground">
                  {row.viewer_name?.trim() || "Someone"}
                </td>
                <td className="py-1.5 pr-3">{location(row)}</td>
                <td className="py-1.5 pr-3">{deviceFromUserAgent(row.user_agent)}</td>
                <td className="py-1.5 pr-3">{fmtRelative(row.started_at)}</td>
                <td className="py-1.5 text-right tabular-nums">{row.max_percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Commit:

```bash
git add src/components/analytics
git commit -m "$(cat <<'EOF'
feat(analytics): add stat tiles, retention bars and the viewers table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 16: `/library/[id]` detail page

**Files:** `src/app/(owner)/library/[id]/page.tsx`,
`src/app/(owner)/library/[id]/not-found.tsx`

- [ ] Create `src/app/(owner)/library/[id]/not-found.tsx`:

```tsx
import Link from "next/link";

export default function VideoNotFound() {
  return (
    <main className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-lg font-semibold text-foreground">Recording not found</h1>
      <p className="text-sm text-muted">
        It may have been deleted, or the link is wrong.
      </p>
      <Link href="/library" className="text-sm text-accent hover:underline">
        Back to the library
      </Link>
    </main>
  );
}
```

- [ ] Create `src/app/(owner)/library/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getVideoById, getVideoStats, listRecentViewers } from "@/lib/db";
import { parseEdits } from "@/lib/edits";
import { appUrl, shareBaseUrl } from "@/lib/env";
import { fmtBytes, fmtDuration, fmtRelative } from "@/lib/format";
import { shareUrl } from "@/lib/share";
import { updateDescription, updateTitle } from "@/app/(owner)/actions";
import { CopyLinkButton } from "@/components/library/copy-link-button";
import { RetentionBars } from "@/components/analytics/retention-bars";
import { StatTiles } from "@/components/analytics/stat-tiles";
import { ViewersTable } from "@/components/analytics/viewers-table";
import { DeleteButton } from "@/components/video/delete-button";
import { EditPlayer } from "@/components/video/edit-player";
import { EditableText } from "@/components/video/editable-text";
import { NewToast } from "@/components/video/new-toast";
import { SlugEditor } from "@/components/video/slug-editor";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Recording · Yoom" };
  const video = await getVideoById(id);
  return { title: video ? `${video.title} · Yoom` : "Recording · Yoom" };
}

export default async function VideoDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const video = await getVideoById(id);
  if (!video) notFound();

  const query = await searchParams;
  const isNew = (Array.isArray(query.new) ? query.new[0] : query.new) === "1";

  const [stats, viewers] = await Promise.all([
    getVideoStats(video.id),
    listRecentViewers(video.id),
  ]);

  const base = appUrl();
  const link = shareUrl(video.slug);
  const prefix = `${shareBaseUrl()}/v/`;

  return (
    <main className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {isNew && <NewToast message="Uploaded. Share link copied to your clipboard." />}

        <EditPlayer
          src={`${base}/api/stream/${video.id}`}
          poster={
            video.thumbnail_drive_file_id
              ? `${base}/api/thumb/${video.id}`
              : undefined
          }
          edits={parseEdits(video.edits)}
        />

        <EditableText
          videoId={video.id}
          name="title"
          value={video.title}
          placeholder="Untitled recording"
          action={updateTitle}
          autoFocus={isNew}
        />

        <EditableText
          videoId={video.id}
          name="description"
          value={video.description ?? ""}
          placeholder="Add a description…"
          action={updateDescription}
          multiline
        />

        <SlugEditor videoId={video.id} slug={video.slug} prefix={prefix} />

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2">
            <span className="block truncate text-sm text-muted">{link}</span>
          </div>
          <CopyLinkButton url={link} />
          <a
            href={`/api/videos/${video.id}/download`}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Download
          </a>
          <DeleteButton videoId={video.id} title={video.title} />
        </div>

        <p className="text-xs text-muted-dim">
          {fmtDuration(video.duration_ms)} · {fmtBytes(video.size_bytes)} ·{" "}
          {video.width && video.height ? `${video.width}×${video.height} · ` : ""}
          recorded {fmtRelative(video.created_at)}
        </p>
      </div>

      <aside className="space-y-3">
        <StatTiles stats={stats} />
        <RetentionBars buckets={stats.buckets} />
        <ViewersTable viewers={viewers} />
      </aside>
    </main>
  );
}
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Run `npm run lint` — expected: PASS.
- [ ] Commit:

```bash
git add "src/app/(owner)/library/[id]"
git commit -m "$(cat <<'EOF'
feat(library): add the video detail page with analytics and editing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 17: Settings page and alert toggles

**Files:** `src/components/settings/alert-toggles.tsx`,
`src/app/(owner)/settings/page.tsx`

- [ ] Create `src/components/settings/alert-toggles.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { saveSettings, type ActionState } from "@/app/(owner)/actions";
import type { Settings } from "@/lib/db";

const INITIAL: ActionState = {};

const FIELDS: {
  name: "alert_on_first_view" | "alert_on_completion";
  label: string;
  hint: string;
}[] = [
  {
    name: "alert_on_first_view",
    label: "Email me when someone starts watching",
    hint: "One email per view session, sent on first play.",
  },
  {
    name: "alert_on_completion",
    label: "Email me a summary when they finish",
    hint: "Sent once when a viewer reaches the end or closes the tab.",
  },
];

export function AlertToggles({ settings }: { settings: Settings }) {
  const [state, formAction, pending] = useActionState(saveSettings, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      {FIELDS.map((field) => (
        <label
          key={field.name}
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3"
        >
          <input
            type="checkbox"
            name={field.name}
            defaultChecked={settings[field.name]}
            className="mt-0.5 h-4 w-4 accent-[#e85a4f]"
          />
          <span>
            <span className="block text-sm text-foreground">{field.label}</span>
            <span className="block text-xs text-muted-dim">{field.hint}</span>
          </span>
        </label>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        <p aria-live="polite" className="text-xs">
          {state.error ? (
            <span className="text-red-400/90">{state.error}</span>
          ) : state.ok ? (
            <span className="text-muted-dim">Saved</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
```

- [ ] Create `src/app/(owner)/settings/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getSettings } from "@/lib/db";
import { AlertToggles } from "@/components/settings/alert-toggles";

export const metadata: Metadata = { title: "Settings · Yoom" };

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <main className="max-w-xl space-y-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted">
          View alerts are sent to <code>ALERT_TO_EMAIL</code> via Resend.
        </p>
      </div>
      <AlertToggles settings={settings} />
    </main>
  );
}
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Commit:

```bash
git add src/components/settings "src/app/(owner)/settings"
git commit -m "$(cat <<'EOF'
feat(settings): add the alert-toggle settings page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 18: Owner-only download route

**Files:** `src/app/api/videos/[id]/download/route.ts`, `src/proxy.ts`

- [ ] Add `"/api/videos/:path*"` to the matcher in `src/proxy.ts`:

```ts
export const config = {
  matcher: ["/api/upload/:path*", "/api/videos/:path*"],
};
```

- [ ] Create `src/app/api/videos/[id]/download/route.ts`:

```ts
import { getVideoById } from "@/lib/db";
import { fetchMedia } from "@/lib/google-drive";

// Large files stream through this function; give it the same headroom as
// /api/stream.
export const maxDuration = 300;

function extensionFor(mime: string): string {
  if (mime.startsWith("video/mp4")) return "mp4";
  if (mime.startsWith("video/quicktime")) return "mov";
  return "webm";
}

/**
 * Owner-only original download. `src/proxy.ts` gates `/api/videos/*` on the
 * session cookie, so this handler only has to find the file.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const video = await getVideoById(id);
  if (!video) {
    return new Response("Not found", { status: 404 });
  }

  const upstream = await fetchMedia(video.drive_file_id);
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream error", { status: 502 });
  }

  const filename = `${video.slug}.${extensionFor(video.mime || "video/webm")}`;
  const headers = new Headers();
  headers.set("Content-Type", video.mime || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "private, no-store");
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { status: 200, headers });
}
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Verify the gate manually later (Task 22 step 7); there is no unit harness for
      route handlers in this repo.
- [ ] Commit:

```bash
git add "src/app/api/videos/[id]/download/route.ts" src/proxy.ts
git commit -m "$(cat <<'EOF'
feat(api): add the owner-only original download route

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 19: Watch page uses `EditPlayer`; delete `video-player.tsx`

**Files:** `src/components/watch-view.tsx`, `src/app/v/[slug]/page.tsx`,
`src/components/video-player.tsx` (deleted)

- [ ] In `src/components/watch-view.tsx`, add the imports:

```tsx
import { EMPTY_EDITS, type VideoEdits } from "@/lib/edits";
import { EditPlayer } from "@/components/video/edit-player";
```

- [ ] Add `edits` to the props type and default it, so the component stays usable
      without the prop:

```tsx
type WatchViewProps = {
  video: WatchVideo;
  /** Absolute app origin; the page may be served from jtylerray.com. */
  apiBase: string;
  shareUrl: string;
  /** Non-destructive edit list; empty until the Phase 5 editor ships. */
  edits?: VideoEdits;
};

export function WatchView({
  video,
  apiBase,
  shareUrl,
  edits = EMPTY_EDITS,
}: WatchViewProps) {
```

- [ ] Replace the bare `<video>` element (the whole `<video ref={videoRef} … />` block)
      with the player, keeping `videoRef` in `useViewTracker`'s hands:

```tsx
        <EditPlayer
          src={`${apiBase}/api/stream/${video.id}`}
          poster={video.hasThumbnail ? `${apiBase}/api/thumb/${video.id}` : undefined}
          edits={edits}
          videoRef={videoRef}
        />
```

- [ ] In `src/app/v/[slug]/page.tsx`, import `parseEdits` and pass it through:

```tsx
import { parseEdits } from "@/lib/edits";
```

```tsx
      apiBase={appUrl()}
      shareUrl={shareUrl(video.slug)}
      edits={parseEdits(video.edits)}
```

- [ ] Delete the dead Phase 1 component and confirm nothing referenced it:

```bash
grep -rn "video-player" src && echo "STILL REFERENCED" || rm src/components/video-player.tsx
```

Expected: `grep` finds nothing and the file is removed.

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Run `npm test` — expected: PASS.
- [ ] Commit:

```bash
git add src/components/watch-view.tsx "src/app/v/[slug]/page.tsx" src/components/video-player.tsx
git commit -m "$(cat <<'EOF'
refactor(watch): render through EditPlayer and drop the unused VideoPlayer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 20: Recorder handoff to the library

**Files:** `src/lib/recording/use-recorder.ts`

- [ ] Add the router import at the top of `src/lib/recording/use-recorder.ts`:

```ts
import { useRouter } from "next/navigation";
```

- [ ] Inside the `useRecorder` hook body, next to the other hook calls, add:

```ts
  const router = useRouter();
```

- [ ] Replace the `UPLOAD_DONE` dispatch in `upload()` (and its Phase 3 TODO comment)
      with the Loom-style handoff:

```ts
      // Loom behaviour: the link is on the clipboard before the page changes,
      // so a paste right after "Upload" always works. Clipboard access can
      // fail (insecure context, denied permission) — that must not block the
      // navigation, and the detail page shows the link either way.
      let copied = false;
      try {
        await navigator.clipboard.writeText(result.url);
        copied = true;
      } catch {
        copied = false;
      }

      dispatch({ type: "UPLOAD_DONE", videoId: result.id, shareUrl: result.url });
      router.push(`/library/${result.id}${copied ? "?new=1" : ""}`);
```

- [ ] Add `router` to the `useCallback` dependency array of `upload`:

```ts
  }, [router, teardown]);
```

- [ ] Run `npx tsc --noEmit` — expected: PASS.
- [ ] Run `npm run lint` — expected: PASS (the `done` branch of `recorder.tsx` stays as
      the fallback UI that flashes before the route change and after a failed push).
- [ ] Commit:

```bash
git add src/lib/recording/use-recorder.ts
git commit -m "$(cat <<'EOF'
feat(recorder): copy the share link and hand off to /library/[id]?new=1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 21: Docs — README "Dashboard" section and `for-later.md` update

**Files:** `README.md`, `docs/for-later.md`

- [ ] In `README.md`, in the Supabase section (step 3), add after the `supabase db push`
      block:

```markdown
Phase 3 adds `supabase/migrations/20260902000000_phase3.sql` (the `videos.edits` column
and a view-session index). `supabase db push` applies both migrations in order.
```

- [ ] In `README.md`, insert a new section between "Recorder" and "Known limits":

```markdown
## Dashboard

Everything under `/library` and `/settings` lives in the `src/app/(owner)/` route group.
Its layout calls `isOwner()` and renders the password gate in place of the page when the
`yoom_session` cookie is missing, so the URL survives signing in.

- **`/library`** — grid of every live recording with thumbnail, duration, view count and
  age. `?q=` searches title, description and slug; `?sort=` is `newest` (default),
  `oldest`, `views` or `title`. Both live in the URL, so the page stays a server
  component and the view is shareable.
- **`/library/[id]`** — the player, click-to-edit title and description (saved on blur or
  ⌘/Ctrl+Enter), the slug editor showing the full `jtylerray.com/v/` prefix, copy link,
  download the Drive original, and delete. On the right: views / unique viewers / average
  watched %, a ten-bucket retention histogram, and the last 50 viewers with location,
  device, relative time and watched %.
- **`/settings`** — the two alert toggles. `alerts.ts` reads the same `settings` row
  before sending, so switching one off silences that email immediately.

Mutations are Server Actions in `src/app/(owner)/actions.ts`. Every one re-checks
`isOwner()`, because Server Actions are reachable by direct POST and not only through the
UI. Changing a slug goes through the `change_video_slug` Postgres function, which records
the old slug in `slug_history` in the same transaction, so old links keep 308-redirecting.
Delete is a soft delete (`deleted_at`) plus a Drive trash for the video and its thumbnail.

`GET /api/videos/[id]/download` streams the Drive original with a
`Content-Disposition: attachment` header. `src/proxy.ts` gates `/api/videos/*` on the
session cookie alongside `/api/upload/*`.

**Editor foundation.** `videos.edits` (jsonb) holds a non-destructive edit decision list
typed and validated by `src/lib/edits.ts` (`parseEdits` is total: bad data degrades to
"no edits"). `src/components/video/edit-player.tsx` wraps the `<video>` with a
ResizeObserver-sized `<canvas>` overlay and is used by both the detail page and the public
watch page. It draws nothing today — the seam exists for the proposed post-recording
editor.

After an upload the recorder copies the share URL to the clipboard and pushes to
`/library/<id>?new=1`, which focuses the title and shows a "Link copied" toast.
```

- [ ] In `docs/for-later.md`, replace the "Foundations to lay in Phase 3" bullet with a
      struck-through, shipped version:

```markdown
- ~~**Foundations to lay in Phase 3:** give the detail page a canvas-capable player component (not the bare `<video>`), keep `video-player.tsx` or replace it with one that accepts an `edits` prop; add `edits jsonb` to `videos` in the Phase 3 migration so the column exists; make the watch page read the same `edits` and render them (initially empty).~~ **Shipped in Phase 3:** `videos.edits jsonb` (migration `20260902000000_phase3.sql`), the `VideoEdits` type + total `parseEdits` validator in `src/lib/edits.ts`, `db.setVideoEdits`, and `src/components/video/edit-player.tsx` (canvas overlay sized by `ResizeObserver`, `edits` and `videoRef` props) used by both `/library/[id]` and `/v/[slug]`. It renders nothing for an empty edit list; Phase 5 fills in the draw loop. `src/components/video-player.tsx` was deleted.
```

- [ ] In `docs/for-later.md`, also strike the two Phase 1 follow-ups Phase 3 closed:

```markdown
- ~~`src/components/video-player.tsx` is currently unused; Phase 3's detail page should either reuse it or delete it.~~ Deleted in Phase 3, replaced by `edit-player.tsx`.
```

and, once Task 22 step 8 is done, the verification-artefact bullet:

```markdown
- ~~Verification artefact: video `bc040bca-a0fd-44aa-a8f3-f5843685eeb5` (slug `uunrv7zm`, 700 KB of random bytes named `yoom-verify.webm`) exists in Drive + DB; delete it from the Phase 3 dashboard once that exists, or via SQL + Drive trash.~~ Deleted from the Phase 3 dashboard.
```

- [ ] Commit:

```bash
git add README.md docs/for-later.md
git commit -m "$(cat <<'EOF'
docs: describe the owner dashboard and mark the Phase 3 foundations shipped

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

### Task 22: Full verification (build, lint, tests) and the manual Phase 3 checklist

**Files:** none (verification only)

- [ ] Run `npm test` — expected: PASS, every suite including `db-phase3`, `edits`,
      `format`, `slug`.
- [ ] Run `npm run lint` — expected: PASS with no errors.
- [ ] Run `npm run build` — expected: PASS. Confirm the route list contains
      `/library`, `/library/[id]`, `/settings` and `/api/videos/[id]/download`, and that
      the `(owner)` group does **not** appear in any URL.
- [ ] Run `grep -rn "TODO\|FIXME\|placeholder" src/app/\(owner\) src/components/library src/components/video src/components/analytics src/components/settings src/lib/edits.ts src/lib/format.ts`
      — expected: no output.
- [ ] **Manual, mirroring the spec's Phase 3 checklist.** Start `npm run dev`, sign in,
      then walk:
  1. Record a short clip → after upload the browser lands on `/library/<id>?new=1`, the
     title field is focused and selected, the toast reads "Uploaded. Share link copied to
     your clipboard.", and pasting gives `https://jtylerray.com/v/<slug>`.
  2. Edit the title and description inline, reload → both persist; `/library` shows the
     new title on the card.
  3. Change the slug to `my-demo` → the old `/v/<old>` 308-redirects to `/v/my-demo`.
     Then try `AB` (too short), `my_demo` (normalises to `my-demo`, which is now its own
     slug → saves as a no-op), and a slug already owned by another video → inline
     "That link is already taken."
  4. Open `/v/my-demo` in three incognito windows, watching different amounts (a few
     seconds, halfway, to the end) → the detail page shows 3 views, three populated
     retention buckets, and three viewer rows with device and relative time.
  5. Click Download → the browser saves `my-demo.webm` and it plays locally.
  6. Delete the video (confirm the dialog) → redirected to `/library`, the card is gone,
     `/v/my-demo` 404s, and the file plus its thumbnail are in Drive's Trash.
  7. Toggle both settings off, save, reload → still off. Watch a video → no email
     arrives. Toggle back on → emails resume.
  8. Delete the Phase 1 verification artefact (slug `uunrv7zm`, video
     `bc040bca-a0fd-44aa-a8f3-f5843685eeb5`) from the dashboard, then strike its bullet
     in `docs/for-later.md` per Task 21.
  9. Sign out (`curl -X DELETE http://localhost:3000/api/auth` or clear the cookie) →
     `/library` and `/settings` render the password gate;
     `curl -i http://localhost:3000/api/videos/<id>/download` returns 401; a raw
     `curl -X POST` at the detail page with a `Next-Action` header is rejected (the action
     returns `{ error: "Not signed in." }` and nothing is written).
- [ ] Commit any fixes the walkthrough surfaced:

```bash
git commit -am "$(cat <<'EOF'
fix(owner): address Phase 3 manual verification findings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
EOF
)"
```

---

## Self-review

**Spec coverage.** Every line of the spec's Phase 3 section maps to a task. Files:
`(owner)/layout.tsx` → Task 9; `library/page.tsx` → Task 11; `library/[id]/page.tsx` +
`not-found.tsx` → Task 16; `settings/page.tsx` → Task 17; `(owner)/actions.ts` →
Task 12; `api/videos/[id]/download/route.ts` → Task 18; `format.ts` → Task 3;
library components → Task 10; video components → Tasks 13–14; analytics components →
Task 15; `settings/alert-toggles.tsx` → Task 17; the migration → Task 1. `db.ts`
additions: `listVideos` (4), `getVideo` (reuses the existing `getVideoById`, noted in
Task 16), `updateVideoMeta`/`isSlugTaken`/`changeSlug` (5),
`softDeleteVideo`/`setVideoEdits`/`updateSettings` (6), `getVideoStats`/
`listRecentViewers` (7); `getSettings` already exists from Phase 1 and is reused
unchanged. Server actions `updateTitle`, `updateDescription`, `updateSlug`,
`deleteVideo`, `saveSettings` → Task 12. Recorder handoff → Task 20. Detail-page layout
(left column player/metadata/slug/share/download/delete, right column tiles/retention/
viewers) → Task 16. `alerts.ts` needs no change: `sendFirstPlayEmail` and
`sendSummaryEmail` already call `getSettings()` and bail. The seven-step Phase 3
verification list is Task 22's steps 1–7, with the artefact cleanup as step 8 and the
auth checks as step 9. The `for-later.md` editor foundations — `edits jsonb` (Task 1),
the `edits`-accepting canvas player (Task 13), and the watch page reading `edits`
(Task 19) — are all covered, plus the parked `video-player.tsx` decision (deleted,
Task 19). README "Dashboard" section and `for-later.md` strikes → Task 21.

**Placeholder scan.** No step says "implement X" or elides a body: every file is given
in full, including the SQL, all four `db.ts` blocks, both pages per route, all eleven
components, the route handler and the proxy matcher. The only deliberately empty body is
the `draw()` loop's `// Phase 5:` comment inside `edit-player.tsx`, which is the point of
the foundation — and Task 22 greps for `TODO|FIXME|placeholder` to catch anything else.
The one step an implementing agent must not perform is the Task 1 migration apply, which
is explicitly marked controller-only.

**Type consistency.** `VideoSort` is defined once in `db.ts` and imported by
`library-toolbar.tsx` and `library/page.tsx`. `ActionState`/`SlugState` are defined once
in `actions.ts` and imported by `editable-text.tsx`, `slug-editor.tsx`,
`delete-button.tsx` and `alert-toggles.tsx`; every action's shape is
`(prevState, formData) => Promise<State>`, matching `useActionState(action, initialState)`
as the Next 16 forms guide specifies. `EditableText`'s `action` prop type is exactly the
signature of `updateTitle`/`updateDescription`. `VideoEdits`, `EMPTY_EDITS`,
`isEmptyEdits` and `parseEdits` live only in `edits.ts` and are consumed by `db.ts`
(`setVideoEdits`), `edit-player.tsx`, `watch-view.tsx` and both pages. `VideoStats` and
`ViewerRow` come from `db.ts` and are consumed by `stat-tiles.tsx` and
`viewers-table.tsx`; `RetentionBars` takes only `buckets: number[]`. `deviceFromUserAgent`
has one implementation (in `alerts.ts`) re-exported through `format.ts`, per the spec's
"don't duplicate". `params` and `searchParams` are typed as Promises everywhere (pages and
the route handler), matching Next 16.2.3. `normalizeSlug` and `SLUG_RE` are both imported
from `slug.ts` by `actions.ts`, so validation has one source of truth.

## Amendment (Tyler, 2026-09-02): recording markers

Add to the scope before implementation — fold into the existing tasks rather than adding new ones:
- **Task 2 (`src/lib/edits.ts`)**: `VideoEdits.markers: { t: number; label?: string }[]` (seconds, sorted ascending; `parseEdits` drops invalid entries and sorts). Add tests.
- **Recorder (Task 20 area, `src/lib/recording/recorder-machine.ts` + `use-recorder.ts` + `src/components/recorder.tsx`)**: reducer event `MARK` — in `recording` only, appends `{ t: elapsedMs / 1000 }` to `state.markers` (new field, `[]` initially, reset on `RESTART`/`RESTART_NOW`/`CANCEL`/`RESET`); hotkey ⌘⇧M in the hook; a "Mark" button next to Pause with a 300 ms flash on the REC chip; `uploadRecording()` gains `markers` and `/api/upload/complete` accepts `markers` and stores `edits: { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers }` via `insertVideo` (extend `NewVideo` with optional `edits`). Add reducer tests.
- **Detail page (Task 16)**: render markers as ticks under `EditPlayer` (a thin bar with clickable ticks that seek the video); list them in a small "Markers" panel with timestamps.
- **README (Task 21)**: mention ⌘⇧M.
