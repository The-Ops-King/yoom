# Yoom

A personal Loom: record your screen and camera in the browser, store the video in
your own Google Drive, and share it as `https://jtylerray.com/v/<slug>` with view
tracking and email alerts.

- **App**: Next.js 16 (App Router) on Vercel
- **Storage**: Google Drive (`drive.file` scope, one app-created folder)
- **Metadata**: Supabase Postgres (service-role key, RLS with no policies)
- **Alerts**: Resend
- **Share links**: `jtylerray.com/v/:slug`, rewritten to this app

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put it in `SESSION_SECRET`. It signs the `yoom_session` cookie and salts viewer IP
hashes — changing it logs you out and breaks viewer de-duplication.

### 2. Google Drive

1. In Google Cloud, create an **OAuth client ID** of type *Web application* with the
   redirect URI `http://localhost:3000/oauth/callback`.
2. Enable the **Google Drive API**.
3. Publish the OAuth consent screen to **In production**. Refresh tokens from a
   "Testing" app expire after 7 days.
4. Run the one-shot setup script:

```bash
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-oauth.mjs
```

It opens the consent screen, exchanges the code, creates a Drive folder named
"Yoom", and prints `GOOGLE_REFRESH_TOKEN` and `GOOGLE_DRIVE_FOLDER_ID`. Paste all
four Google variables into `.env.local` and into the Vercel project.

The `drive.file` scope only grants access to files this app created, which is why
the folder is created by the script rather than picked in the Drive UI.

### 3. Supabase

Create a project, then apply the migration:

```bash
supabase link --project-ref <ref>
supabase db push
```

Phase 3 adds `supabase/migrations/20260902000000_phase3.sql` (the `videos.edits` column
and a view-session index). `supabase db push` applies both migrations in order.

Or paste `supabase/migrations/20260901000000_init.sql` into the SQL editor. Copy the
project URL into `SUPABASE_URL` and the **service role** key into
`SUPABASE_SERVICE_ROLE_KEY`. The service role key is server-only — it must never be
exposed to the browser and must never be prefixed with `NEXT_PUBLIC_`.

### 4. Resend

Verify a sending domain (for example `jtylerray.com`), then set `RESEND_API_KEY`,
`ALERT_FROM_EMAIL=alerts@jtylerray.com` and `ALERT_TO_EMAIL=jt@jtylerray.com`.
Alerts are opt-out per type via the `settings` row (`alert_on_first_view`,
`alert_on_completion`); a UI for it arrives in Phase 3.

### 5. Share links from jtylerray.com

In the `jtylerray.com` repo, add these two rewrites to `vercel.json` **before** the
`/(.*)` catch-all:

```json
{ "source": "/v/:slug", "destination": "https://<app>.vercel.app/v/:slug" },
{ "source": "/v/:slug/:path*", "destination": "https://<app>.vercel.app/v/:slug/:path*" }
```

Because the page then runs cross-origin, this app sets `assetPrefix` to
`NEXT_PUBLIC_APP_URL` in production and opens CORS on `/_next/static/*`. All client
fetches and the `<video src>` on the watch page use the absolute app origin.

## Environment

**`NEXT_PUBLIC_APP_URL` must be set in the Vercel project** (Production and Preview).
Without it the production build omits `assetPrefix` and the watch page served from
jtylerray.com loads no JS or CSS.

| Variable | Purpose |
|---|---|
| `UPLOAD_PASSWORD` | Shared password for the recorder |
| `SESSION_SECRET` | Signs `yoom_session`; salts viewer IP hashes |
| `NEXT_PUBLIC_APP_URL` | Absolute origin this app is served from |
| `NEXT_PUBLIC_SHARE_BASE_URL` | Origin used to build share links (`https://jtylerray.com`) |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the public API routes |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client |
| `GOOGLE_REFRESH_TOKEN` | Long-lived Drive credential |
| `GOOGLE_DRIVE_FOLDER_ID` | Destination folder for uploads |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Metadata database |
| `RESEND_API_KEY` | Email transport |
| `ALERT_FROM_EMAIL` / `ALERT_TO_EMAIL` | Alert sender and recipient |

## Scripts

```bash
npm run dev     # local development
npm run build   # production build
npm run lint    # eslint
npm test        # vitest (unit tests for the pure modules)
```

## How it works

1. **Record** — `recorder.tsx` captures screen and/or camera, compositing to a canvas
   when both are used, and produces one WebM blob.
2. **Upload** — `POST /api/upload` mints a Drive resumable session URI;
   `src/lib/upload-client.ts` PUTs 8 MiB chunks straight to Google, resuming from the
   committed offset after an error. `/api/upload/chunk` is a server-side proxy kept for
   the case where Drive refuses CORS on browser PUTs; the recorder does not use it by
   default (switch by passing `{ proxyUrl: "/api/upload/chunk" }` to `uploadToDrive`).
3. **Save** — `POST /api/upload/complete` verifies the Drive file and inserts a
   `videos` row with a fresh 8-character slug; a JPEG thumbnail follows via
   `/api/upload/thumbnail`.
4. **Watch** — `/v/[slug]` looks up the video (falling back to `slug_history` and a
   308 redirect) and plays `/api/stream/[videoId]`, which proxies Drive bytes and
   clamps open-ended Range requests to 32 MiB per invocation.
5. **Track** — the player posts to `/api/view/start` and `/api/view/heartbeat`;
   `claimAlert` guarantees at most one first-play email and one summary email per
   view session, sent from `after()` so they never delay the response.

## Recorder

- **Modes** — *Screen + Cam*, *Screen*, or *Camera*. Screen capture takes a surface
  hint: *Entire screen*, *Window*, or *Tab*.
- **Camera bubble** — drag it anywhere on the preview (arrow keys nudge, ⇧ for a
  bigger step); circle / rounded / square / portrait shapes, three sizes, mirror
  toggle, and on/off. Shape, size, position and hide/show ease over 300 ms in the
  compositor; dragging snaps so it tracks the pointer. In *Camera* mode the bubble
  fills the frame. Virtual backgrounds behind the bubble were removed in Phase 2.1.
- **Framed capture** — inset the screen in a padded canvas with rounded corners, a
  drop shadow, and its own background.
- **Audio** — mic and system audio are mixed into one track, each independently
  toggleable with a live level meter. On macOS, Chrome only offers system audio for
  *Tab* captures.
- **Mode switching** — the mode and capture-surface pickers stay live in *setup*:
  changing either tears the capture down and re-acquires with the new choice.
- **Flow** — 3-second countdown (skippable) before the first take, pause/resume,
  **Restart** (immediate — no second countdown), **Cancel** (trash: discards the take
  and returns to setup with the capture still live), then a review screen to play
  back, discard, or upload. 30-minute cap; Safari records `video/mp4`.
- **Markers** — ⌘⇧M (or the **Mark** button next to Pause) drops a timestamp at the
  current elapsed time; the REC chip flashes to acknowledge it. Markers upload with the
  recording into `videos.edits.markers` and show as ticks on `/library/[id]`. They are
  cleared by Restart, Cancel and Discard, i.e. whenever the take is thrown away.
- **Hotkeys** — ⌘⇧L start/stop, ⌘⇧P pause/resume, ⌘⇧M mark, ⌘⇧K restart now, ⌘⇧X cancel
  (⌃ on Windows/Linux).

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
  download the Drive original, and delete. Recorder markers appear as clickable ticks
  under the player and as a timestamped list beside it. On the right: views / unique
  viewers / average watched %, a ten-bucket retention histogram, and the last 50 viewers
  with location, device, relative time and watched %.
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
editor. Markers are the first thing that actually lands in the column.

After an upload the recorder copies the share URL to the clipboard and pushes to
`/library/<id>?new=1`, which focuses the title and shows a "Link copied" toast. The slug
is reserved by `/api/upload` before the bytes go up, so the copy happens inside the
click's transient activation rather than minutes later when it would silently fail.

## Known limits

- All video bytes flow through Vercel functions; 206 responses are not CDN-cached.
  Fine for personal volume, worth revisiting if traffic grows.
- MediaRecorder WebM has no cues index. The duration header is patched client-side
  (`fix-webm-duration`) so the seek bar works, but seeking still relies on the
  browser scanning clusters, so it is coarser than a remuxed file. Watch
  percentages fall back to the stored `duration_ms` when the header is missing.
- Old `/watch/<uuid>.webm` links from the R2 era no longer resolve.
