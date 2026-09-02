# Yoom → personal Loom: Google Drive storage, jtylerray.com share links, view alerts, Loom-grade recorder, Electron shell

## Context

`yoom_public` is a minimal Loom clone: Next.js 16.2.3 App Router, React 19, Tailwind v4, no DB, shared-password "auth" held in React state, one 530-line `src/components/recorder.tsx` that composites screen + camera on a canvas and uploads a single WebM blob to Cloudflare R2 via presigned PUT. Watch page plays a public R2 URL. No titles, views, or notifications.

Tyler wants his own Loom replacement that:
- records screen / window / tab / camera like Loom, with a draggable camera bubble in several shapes, virtual backgrounds (blur, color, image, looping video), and independent mic + Mac system-audio toggles (system audio ON by default);
- stores video bytes in **his Google Drive** (not Cloudflare);
- serves share links as **`https://jtylerray.com/v/<slug>`** with editable slugs, title, and description;
- tracks views and **emails him** when someone watches;
- works in the browser **and** as a Mac desktop app.

Research findings that shape the design:
- Loom.app (Electron 0.373.2, `/Applications/Loom.app`) features: 3 capture modes, bubble shapes/sizes, MediaPipe segmentation for backgrounds, system audio via a bundled audio driver, countdown, pause, drawing, trim, CTA, view insights, AI titles/chapters. We are cloning the recording + sharing + insights core, not the AI/editing tier.
- **macOS limit:** Chrome's `getDisplayMedia` only delivers system audio for *tab* sharing on macOS (OS restriction). Full-screen/window + system audio requires a desktop shell. Electron ≥39 provides macOS loopback audio via CoreAudio taps on macOS 14.2+ (`setDisplayMediaRequestHandler` → `audio: 'loopback'`), no driver needed.
- `jtylerray.com` is a Vite/React static site on Vercel (team `kravok`, repo `The-Ops-King/jtylerray.com`, local clone `~/jtylerray.com`) whose `vercel.json` already has a `rewrites` list ending in a `/(.*)` → `/index.html` catch-all. A `/v/:slug` rewrite to the video app, placed before the catch-all, is all that's needed there.

## Decisions (made with Tyler, do not re-open)

| Topic | Decision |
|---|---|
| Desktop | Electron wrapper around the deployed web UI; menu-bar launcher + loopback audio; unsigned local build, no auto-update (v1) |
| Metadata DB | Supabase Postgres, service-role key server-side only |
| Share URL | `jtylerray.com/v/<slug>` via Vercel rewrite; slug editable, old slugs redirect |
| Alerts | Email via Resend |
| Privacy | Anyone with link; optional one-time viewer name prompt |
| Sequencing | Four phases in one plan, each shippable: (1) storage + DB + watch + views + email, (2) recorder upgrades, (3) owner dashboard, (4) Electron |

Rejected: keep R2; Tauri; separate native recorder; subdomain.

## Next 16 conventions verified in `node_modules/next/dist/docs`

`middleware.ts` is deprecated → use `src/proxy.ts` exporting `proxy()` (Node runtime). Route-handler `params` is a Promise. `OPTIONS` is auto-generated unless exported. `permanentRedirect()` → 308. `after()` works in route handlers for post-response work. `assetPrefix` covers `/_next/static` only (not `/public`, not `/_next/image`).

---

## Phase 1 — Google Drive storage, Supabase, `/v/[slug]` watch page, view tracking, email alerts

### Deps / env
- `npm rm @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`; `npm i @supabase/supabase-js resend server-only`. Drive via raw `fetch` (no `googleapis`).
- `.env.example` replaces the R2 block with:
  `UPLOAD_PASSWORD, SESSION_SECRET, NEXT_PUBLIC_APP_URL (absolute app origin), NEXT_PUBLIC_SHARE_BASE_URL=https://jtylerray.com, ALLOWED_ORIGINS=https://jtylerray.com,https://www.jtylerray.com, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ALERT_TO_EMAIL, ALERT_FROM_EMAIL`
- `scripts/google-oauth.mjs`: one-shot local OAuth consent (scope `drive.file`, `access_type=offline&prompt=consent`), creates the "Yoom" Drive folder via API (required: `drive.file` only sees app-created files), prints `GOOGLE_REFRESH_TOKEN` + `GOOGLE_DRIVE_FOLDER_ID`. Publish the OAuth app to "production" or the refresh token expires in 7 days.

### `src/lib/` modules
- `env.ts` — `env(name)` throws if missing; exports `APP_URL`, `SHARE_BASE_URL`, `ALLOWED_ORIGINS`.
- `google-drive.ts` (delete `r2.ts`) — `getAccessToken()` (refresh-token grant, module cache with 60s margin); `createResumableSession({name, mimeType, sizeBytes, origin})` → Location URI (POST `upload/drive/v3/files?uploadType=resumable`, headers `Origin`, `X-Upload-Content-Type/Length`, body `{name, parents:[FOLDER]}`); `getFileMeta(id)`; `fetchMedia(id, range?)` → raw upstream `Response` (never buffered); `uploadSmall(name, mime, bytes)` multipart for thumbnails; `renameFile(id, name)`; `trashFile(id)`.
- `supabase.ts` — `import 'server-only'`; service-role singleton, `persistSession:false`.
- `db.ts` — `getVideoBySlug`, `getVideoIdByOldSlug`, `insertVideo`, `createViewSession`, `updateViewSession`, `claimAlert(sessionId, column)` (atomic `update … where column is null returning id`).
- `slug.ts` — `newSlug()` = 8 chars lowercase base36 via `crypto.getRandomValues`; `SLUG_RE = /^[a-z0-9-]{3,40}$/` (shared with the Phase 3 slug editor).
- `session.ts` — HMAC-signed `yoom_session` cookie (`ts.sig`, 30-day expiry, httpOnly/secure/lax); `signSession()`, `verifySession(cookie)` with `timingSafeEqual`.
- `cors.ts` — `corsHeaders(origin)` echoes origin if in `ALLOWED_ORIGINS` or `APP_URL`, `Vary: Origin`; `preflight(req)` → 204; `withCors(req, res)`.
- `alerts.ts` — `sendFirstPlayEmail(session, video)`, `sendSummaryEmail(session, video)` via Resend, subjects like "▶ {name ?? 'Someone'} started watching {title}" with location, device, watched %, share link. Called inside `after()`. (Phase 3 adds a settings check here.)
- `geo.ts` — `readViewerContext(req)` → `{ipHash (sha256 + SESSION_SECRET salt), userAgent, country, city}` from `x-forwarded-for`, `x-vercel-ip-country`, `x-vercel-ip-city`.

### Migration `supabase/migrations/20260901000000_init.sql`
Tables (RLS enabled with no policies = service-role only):
- `videos(id uuid pk default gen_random_uuid(), slug text unique not null, title text not null default 'Untitled recording', description text, drive_file_id text unique not null, mime text default 'video/webm', size_bytes bigint, duration_ms int, width int, height int, thumbnail_drive_file_id text, created_at timestamptz default now(), deleted_at timestamptz)`
- `slug_history(old_slug text pk, video_id uuid fk cascade, created_at)`
- `view_sessions(id uuid pk, video_id fk cascade, viewer_name, ip_hash, user_agent, country, city, started_at, last_seen_at, max_percent smallint 0..100 default 0, ended_at, alert_sent_at, summary_sent_at, milestones jsonb default '{}')` + index `(video_id, started_at desc)`
- `settings(id int pk default 1 check (id=1), alert_on_first_view bool default true, alert_on_completion bool default true, updated_at)` single row, seeded (Phase 3 UI; Phase 1 `alerts.ts` reads it)

### Auth
- `api/auth/route.ts` keeps `timingSafeEqual`; on success sets `yoom_session` cookie; add `DELETE` to clear.
- `src/proxy.ts` with `config.matcher = ['/', '/library/:path*', '/api/upload/:path*']`: no valid cookie → `/` and `/library*` render the gate (header `x-yoom-auth: 0`), `/api/upload*` → 401.
- `src/app/page.tsx` becomes a server component: `await cookies()` → `<PasswordGate/>` (calls `router.refresh()` on success) or `<Recorder/>` (drop the `password` prop).

### Upload → Drive
- `api/upload/route.ts` `POST {mimeType, sizeBytes, filename}` → `{sessionUri}` (origin = `APP_URL`; in dev use `request.headers.get('origin')`).
- `api/upload/complete/route.ts` `POST {driveFileId, title, durationMs, width, height}` → verify via `getFileMeta` → `insertVideo` with `newSlug()` (retry on unique violation) → `{id, slug, url}`.
- `api/upload/thumbnail/route.ts` `POST` JPEG ≤1MB → `uploadSmall` → set `thumbnail_drive_file_id`.
- `api/upload/chunk/route.ts` **fallback only** (≤4MB body, forwards `Content-Range`, relays 308/200 + `Range`) if Drive CORS fails.
- `src/lib/upload-client.ts` — `uploadToDrive(blob, sessionUri, onProgress)`: 8 MiB chunks (multiple of 256 KiB), `Content-Range: bytes s-e/total`, expect 308 until final 200/201 `{id}`; on error query offset with `Content-Range: bytes */total` and resume.
- `recorder.tsx` `handleRecordingComplete`: replace XHR with `uploadToDrive`; compute `durationMs` from start/stop timestamps, `width/height` from `track.getSettings()`; grab a JPEG thumbnail from the preview at ~1s; share URL = `${SHARE_BASE_URL}/v/${slug}`.
- **Do first:** verify Drive honors CORS on resumable PUTs from `localhost:3000` (2-chunk test). If preflight fails, point `upload-client.ts` at `/api/upload/chunk` with 4 MB chunks; the interface is identical.

### Streaming playback
- `api/stream/[videoId]/route.ts` `GET/HEAD`, `export const maxDuration = 300`: look up non-deleted video → `fetchMedia(drive_file_id, range)` → `new Response(upstream.body, {status 200|206, headers})` copying `Content-Range`, `Content-Length`, `Accept-Ranges: bytes`, `Content-Type`, `Cache-Control: public, max-age=31536000, immutable`, `ETag`, + CORS. Clamp open-ended ranges to a 32 MiB window so one invocation never runs long.
- `api/thumb/[videoId]/route.ts` same, `image/jpeg`, no Range.

### Watch page + view tracking
- `src/app/v/[slug]/page.tsx` (server): validate `SLUG_RE` → `getVideoBySlug` → else `getVideoIdByOldSlug` → `permanentRedirect('/v/'+current)` → else `notFound()`. `generateMetadata` with absolute `og:image`/`og:video`. Renders `<WatchView video apiBase={APP_URL}/>`. Move `not-found.tsx` here; delete `src/app/watch/`.
- `src/components/watch-view.tsx` ('use client'): title, description, `<video src={apiBase+'/api/stream/'+id} controls preload="metadata">`, copy link. Optional viewer-name prompt on first play (localStorage `yoom_viewer_name`, skippable).
- `src/hooks/use-view-tracker.ts`: first `play` → `POST /api/view/start` → `sessionId`; every 10s and on `ended` → `POST /api/view/heartbeat {sessionId, percent, ended?}`; on `pagehide`/hidden → `navigator.sendBeacon` with a `text/plain` Blob (no preflight). Percent uses `duration_ms` fallback because MediaRecorder WebM has no duration header.
- `api/view/start/route.ts` → `createViewSession` + `after(claimAlert('alert_sent_at') && sendFirstPlayEmail)`; explicit `OPTIONS`.
- `api/view/heartbeat/route.ts` → parse via `request.text()` (beacon bodies), `max_percent = greatest(...)`, `last_seen_at`, `ended_at`; when `percent>=100 || ended` → `after(claimAlert('summary_sent_at') && sendSummaryEmail)`. `claimAlert` is the debounce: max 2 emails per session.

### Cross-origin hosting (`jtylerray.com/v/slug`)
- `next.config.ts`: `assetPrefix = NEXT_PUBLIC_APP_URL` in production; `headers()` adds `Access-Control-Allow-Origin: *` on `/_next/static/:path*` (fonts load with `crossorigin`). Don't use `next/image` on the watch page.
- All client fetches / `<video src>` / `<img src>` on the watch page use the absolute `NEXT_PUBLIC_APP_URL`.
- `~/jtylerray.com/vercel.json`: insert before the catch-all:
  `{"source":"/v/:slug","destination":"https://<app>.vercel.app/v/:slug"}` and `{"source":"/v/:slug/:path*","destination":"https://<app>.vercel.app/v/:slug/:path*"}`. RSC navigations (`?_rsc=`) go through the same rewrite. Commit + deploy that repo separately (outward-facing: confirm with Tyler before pushing).
- CORS only on `/api/view/*`, `/api/stream/*`, `/api/thumb/*`.

### Cleanup
Delete `src/lib/r2.ts`, `src/app/watch/`; rewrite README (OAuth script, `supabase db push`, Resend domain, rewrite snippet, env table).

### Phase 1 verification
1. `node scripts/google-oauth.mjs` prints tokens; token refresh works.
2. Record 30s → Network shows PUTs to `googleapis.com/upload/...` (308s then 200); file in Drive folder; `videos` row exists, size matches.
3. `curl -I -H "Range: bytes=0-1023" $APP/api/stream/<id>` → 206 with correct `Content-Range`; open-ended range capped at 32 MiB.
4. `https://jtylerray.com/v/<slug>` loads assets from the app origin with no console CORS errors; `OPTIONS /api/view/start` → 204 with `Access-Control-Allow-Origin: https://jtylerray.com`.
5. Play → `view_sessions` row with geo; exactly one first-play email. Finish or close tab → `max_percent` updated, exactly one summary email.
6. Manually change a slug + insert `slug_history` → old URL 308s.
7. `POST /api/upload` without cookie → 401; `/` shows gate.
8. `npm run build` passes; `grep -r R2_ src` empty.

### Phase 1 risks
- Drive CORS on resumable PUTs (fallback route bounded by Vercel 4.5 MB body limit).
- All video egress flows through Vercel functions (Hobby: 100 GB/mo bandwidth, 300s max duration). 206 responses aren't CDN-cached. Acceptable for personal volume; revisit if it grows.
- Drive per-file download throttling on hot files.
- MediaRecorder WebM lacks cues → seeking is coarse. Phase 2 review step can remux client-side later if needed.
- Old `/watch/<uuid>.webm` links die with R2.

---

## Phase 2 — Recorder upgrades (Loom parity)

### Known defects in `recorder.tsx` fixed here
- Lines 222-229: mic **replaces** system audio (`if mic … else if screen audio`). MediaRecorder can't gain tracks after `start()`, so audio must be one pre-mixed track from the start.
- `device-selector.tsx:19-27` calls `navigator.mediaDevices` directly; must go through the provider so Electron can override.

### Modules `src/lib/recording/`
- **`desktop-bridge.ts`** — the Electron seam. `window.__yoomDesktop?: { version: 1; mediaSources?: Partial<MediaSourceProvider>; capabilities?: Partial<Capabilities>; onShortcut?(cb: (a: "toggle"|"pause") => void): () => void }`.
- **`media-sources.ts`** — only file touching `navigator.mediaDevices`. `MediaSourceProvider { getDisplay(pref: "monitor"|"window"|"browser"): Promise<{stream, surface, hasSystemAudio}>; getCamera(deviceId?); getMic(deviceId?); warmPermissions(kind); enumerateDevices(kind); capabilities(): {systemAudio: "full"|"tab-only"|"none"; nativePicker; surfaceHints} }`. `getProvider()` = `{...browserProvider, ...window.__yoomDesktop?.mediaSources}`. Display constraints: `displaySurface: pref`, 60fps/4K ideal, audio with processing off, `systemAudio:"include"`, `surfaceSwitching:"include"`, `selfBrowserSurface:"exclude"`, `preferCurrentTab:false`. Surface read from `track.getSettings().displaySurface`; `hasSystemAudio = audioTracks.length > 0`. Mic is always a separate stream.
- **`audio-mixer.ts`** — `class AudioMixer { addSource(id: "mic"|"system", stream); setEnabled(id, on); removeSource(id); getLevel(id): number; outputTrack: MediaStreamTrack; close() }`. Graph per source: `MediaStreamSource → Gain → MediaStreamDestination`, plus `→ Analyser(fftSize 256)` for meters. Disable = ramp gain to 0 over 20ms then disconnect (no click); enable = connect + ramp up. `outputTrack` always exists and is always on the record stream, so toggles never touch the recorder. Create `AudioContext` in the click handler and `resume()`.
- **`segmentation.ts`** — `class PersonSegmenter { static load(); start(video, {width=256, fps=30}); stop(); dispose(); mask: HTMLCanvasElement; ready }`. Own loop via `video.requestVideoFrameCallback` (skip while in flight): draw video into 256-wide scratch → `ImageSegmenter.segmentForVideo` (`runningMode:"VIDEO"`, `delegate:"GPU"`, `outputConfidenceMasks`) → float mask → alpha `ImageData` → `putImageData` to `mask` with temporal smoothing (`globalAlpha 0.7`) and `filter: blur(1px)` feather at low res. Load with `await import("@mediapipe/tasks-vision")`; WASM at `/mediapipe/wasm`, model `/models/selfie_segmenter.tflite` copied from node_modules by `scripts/copy-mediapipe.mjs` (`predev`/`prebuild`); jsdelivr fallback. CPU fallback → 15fps.
- **`compositor.ts`** — `BubbleShape = "circle"|"rounded"|"square"|"portrait"|"full"`; `BubbleConfig {shape, size: "small"|"medium"|"large", pos: normalized center, mirror}`; `BackgroundConfig {kind: "none"|"blur"|"color"|"image"|"video", color?, src?}`. `class Compositor { constructor(canvas, layout: "camera"|"screen+camera"); setSources({screen?, camera?, maskCanvas?, background?}); setBubble(); setBackground(); start(); stop(); captureStream(fps); bubbleRect(); snapshot(): Promise<Blob> }` plus pure `computeBubbleRect(W,H,camW,camH,cfg) → Rect & {crop}` and `bubblePath(rect, shape)`. Sizes 15/22/30% of width; aspect: circle/square 1:1, portrait 9:16, rounded = camera aspect, full = canvas; `crop` = object-fit-cover source rect. Canvas size locked at `start()` (surface switches are letterboxed, no encoder re-init).
  Per frame: (1) draw screen unless `full`; (2) recompute rect/path only when dirty; (3) build camera layer on a cached offscreen canvas: mirror transform → if no mask, draw camera; else background (`blur` = `ctx.filter blur(rect.w/50)` + camera; `color` = fill; `image`/`video` = cover draw) then person layer (camera → `destination-in` mask) composited on top; (4) `clip(path); drawImage(layer); stroke(path)`. ~6 drawImage calls; segmentation never blocks the loop.
- **`recorder-machine.ts`** — plain reducer. States `idle → acquiring → setup → countdown → recording ⇄ paused → stopping → review → uploading → done`, plus `error`. Events: `SELECT_MODE, SET_SURFACE_PREF, ACQUIRE, ACQUIRED, ACQUIRE_FAILED, START, COUNTDOWN_TICK, SKIP_COUNTDOWN, PAUSE, RESUME, STOP, RESTART, MAX_DURATION, STREAM_ENDED, BLOB_READY, DISCARD, UPLOAD, UPLOAD_PROGRESS, UPLOAD_DONE, UPLOAD_FAILED, RESET, TOGGLE_MIC, TOGGLE_SYSTEM, SET_BUBBLE, SET_BACKGROUND`. `RESTART` discards chunks, keeps streams → countdown. `STREAM_ENDED` in setup → idle, in recording → STOP. `DISCARD` → setup if streams alive. Elapsed via `performance.now()` deltas only while recording. Max duration 30 min.
- **`settings.ts`** — `localStorage["yoom.recorder.v1"]`: mode, surfacePref, micId, cameraId, micOn, systemOn (default true), bubble, background (kind/color/preset id; uploads aren't persisted).
- **`use-recorder.ts`** — single hook entry. Owns streams/mixer/compositor/segmenter/MediaRecorder/chunks refs, wires reducer + effects, hotkeys (`meta|ctrl+shift+R` toggle, `+P` pause), bridge `onShortcut`, thumbnail at 1s (`compositor.snapshot()`; screen-only snapshots the preview video), upload via Phase 1 `uploadToDrive` then thumbnail route (thumb failure non-fatal), then `router.push('/library/'+id)` (Phase 3). Screen-only bypasses the compositor: records `[screenVideoTrack, mixer.outputTrack]`.

### Components `src/components/recorder/`
`mode-picker.tsx` (Screen+Cam / Screen / Camera cards + Entire screen/Window/Tab control + surface badge), `preview-stage.tsx` (canvas or video + drag overlay + REC/paused chip), `bubble-drag-overlay.tsx` (pointer capture, writes normalized center, clamps), `camera-bubble-controls.tsx` (shape, size, mirror), `background-picker.tsx` (none/blur/color swatches/preset grid from `public/backgrounds/`/image upload/video upload; video bg = hidden looping muted `<video>`), `audio-controls.tsx` + `level-meter.tsx` (8-segment, 100ms poll; inline notice when `hasSystemAudio === false`: "System audio is available for tab recordings, or use the desktop app"), `countdown.tsx` (3-2-1, Skip), `review.tsx` (object-URL player, thumbnail, duration, Upload/Discard). `recorder.tsx` shrinks to a ~120-line shell; delete `recording-preview.tsx`; `device-selector.tsx` uses `getProvider()`.

### Step order
1. `desktop-bridge`, `media-sources`, `settings`; route recorder + DeviceSelector through the provider (no behaviour change); add surface hints.
2. `audio-mixer` + `audio-controls` + meters (fixes the mic/system bug).
3. `recorder-machine` + `use-recorder`; setup/countdown/pause/resume/restart/max/hotkeys; `review` + thumbnail.
4. Extract `compositor`; shapes/sizes/pos/mirror; drag overlay; persistence.
5. `@mediapipe/tasks-vision`, copy script, presets in `public/backgrounds/` + `public/models/`; `segmentation` + `background-picker`.
6. Mode-picker polish, delete dead files, lint.

### Phase 2 verification (manual, Chrome first)
- Modes × surface: {screen, screen+camera} × {monitor, window, tab} + camera-only. Badge matches choice; browser "Stop sharing" ends cleanly; tab switch mid-record doesn't break the encoder.
- Audio: {mic on/off} × {system on/off} × {tab (has audio), monitor on macOS (notice shown)}. Toggle mid-recording; both present when both on; meters independent; no clicks.
- Bubble: every shape × size in setup and while recording; drag both times; position survives reload; mirror flips camera pixels only; `full` hides screen.
- Backgrounds: none/blur/color/preset image/uploaded image/preset video/uploaded mp4 in both camera modes; DevTools FPS meter stays ~60 while segmenting; not-ready → plain camera.
- Flow: countdown skip; pause freezes timer; restart; hotkeys in setup/recording/paused; review → discard returns to setup; upload → Drive file + thumbnail + DB row.
- Cleanup: all tracks `ended`, AudioContext closed, no rAF after stop.

### Browser caveats
Chrome: tab audio everywhere, monitor/window audio only on Windows. Safari/Firefox: no system audio; Safari has no WebM MediaRecorder (codec fallback must include `video/mp4`, and `mime` is stored per video in Phase 1). `ctx.filter` blur needs Safari 18+ (fallback: downscale/upscale). Cmd+Shift+L only fires while the tab is focused (Electron bridge fixes that). Presets must be served from `public/` so thumbnail canvases stay untainted.

---

## Phase 3 — Owner dashboard (single user)

### Files
```
src/app/(owner)/layout.tsx              server; requireOwner() (session cookie) else redirect('/'); nav Record / Library / Settings
src/app/(owner)/library/page.tsx         grid, ?q=&sort=newest|oldest|views|title
src/app/(owner)/library/[id]/page.tsx    detail + analytics (+ not-found.tsx)
src/app/(owner)/settings/page.tsx
src/app/(owner)/actions.ts               'use server' — all mutations, each calls requireOwner()
src/app/api/videos/[id]/download/route.ts  GET: stream Drive file with Content-Disposition attachment (owner only)
src/lib/db.ts                            + list/stat functions below
src/lib/share.ts                         shareUrl(slug) = `${NEXT_PUBLIC_SHARE_BASE_URL}/v/${slug}`
src/lib/format.ts                        fmtDuration, fmtBytes, fmtRelative, deviceFromUA
src/components/library/{video-card,library-toolbar,copy-link-button}.tsx
src/components/video/{editable-text,slug-editor,delete-button}.tsx   (client; useActionState)
src/components/analytics/{stat-tiles,retention-bars (inline SVG),viewers-table}.tsx
src/components/settings/alert-toggles.tsx
supabase/migrations/0002_video_stats.sql  view video_stats(video_id, view_count, unique_viewers = count(distinct coalesce(viewer_name, ip_hash)), last_viewed_at = max(last_seen_at))
```

### `db.ts` additions
`listVideos({q?, sort})` (joins `video_stats`, `deleted_at is null`), `getVideo(id)`, `updateVideoMeta(id, {title?, description?})`, `isSlugTaken(slug, excludeId?)` (checks `videos.slug` and `slug_history.old_slug`), `changeSlug(id, newSlug)` (one RPC/transaction: insert old slug into `slug_history`, update `videos.slug`), `softDeleteVideo(id)`, `getVideoStats(id) → {views, unique, avgMaxPercent, buckets: number[10]}` (bucket = `floor(max_percent/10)` clamped 9), `listRecentViewers(id, 50)`, `getSettings()`, `updateSettings(patch)`.

### Server actions
`updateTitle`, `updateDescription` → `updateVideoMeta` + `revalidatePath`; `updateSlug(prev, formData)` → validate `SLUG_RE`, `isSlugTaken` → `{error}` | `{ok, slug}`; `deleteVideo(id)` → soft delete + `trashFile` (video + thumbnail) → `redirect('/library')`; `saveSettings(prev, formData)`. `alerts.ts` checks `alert_on_first_view` / `alert_on_completion` before sending.

### Recorder handoff (Loom behaviour)
After `/api/upload/complete` returns `{id, slug}`: `navigator.clipboard.writeText(shareUrl(slug))` (silent fallback), then `router.push('/library/'+id+'?new=1')`. Detail page reads `searchParams.new` → title `EditableText` gets `autoFocus`, toast "Link copied". Default title = `Recording — ${Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short'}).format(new Date())}`.

### Detail page layout
Left: player (`video-player.tsx` with `poster`), editable title/description, slug editor showing the full `jtylerray.com/v/` prefix, share row with copy, download, delete (confirm). Right: stat tiles (views, unique viewers, avg watched %), retention bars (10 SVG rects, 0–10% … 90–100%), recent viewers table (name, city/country, device from UA, relative time, watched %).

### Phase 3 verification
1. Record → lands on `/library/[id]` with the title focused; clipboard holds `https://jtylerray.com/v/<slug>`.
2. Inline edits persist after refresh; library card reflects them.
3. Slug → `my-demo`: old slug 308s; `AB`, `my_demo`, and a taken slug show inline errors.
4. Three incognito views with different scroll-through → stats show 3 views, buckets populated, viewer rows present.
5. Delete → `deleted_at` set, Drive file in Trash, `/v/<slug>` 404s, gone from library.
6. Settings toggles persist; email fires only when enabled.
7. Unauthenticated `/library` redirects; raw POST to an action is rejected.

---

## Phase 4 — Electron desktop shell (`desktop/`, macOS first)

### Files
```
desktop/package.json                 electron ^39, electron-vite, electron-builder, typescript; scripts: dev, build (electron-vite build && electron-builder --mac dmg zip --publish never)
desktop/electron.vite.config.ts      main / preload / renderer(picker) entries
desktop/electron-builder.yml         appId com.jtylerray.yoom, mac.target [dmg, zip], identity null (ad-hoc), extendInfo (plist keys below)
desktop/build/entitlements.mac.plist audio-input, camera, screen (used only if signed later)
desktop/build/trayTemplate{,@2x}.png
desktop/src/main/{index,tray,windows,capture,permissions}.ts
desktop/src/preload/{app,picker}.ts
desktop/src/renderer/picker/{index.html,picker.ts,picker.css}   plain DOM, no framework
desktop/src/shared/ipc.ts            channel names + types
desktop/README.md                    permissions, first run, build
```
Root: `tsconfig.json` exclude `["node_modules","desktop"]`; new `.vercelignore` with `desktop`; `src/types/desktop.d.ts` declares `window.__yoomDesktop`; recorder reads it (hide browser-picker hint, show "System audio: on" badge).

### Responsibilities
- **Main**: `app.dock.hide()` + `LSUIElement`; recorder `BrowserWindow` on `session.fromPartition('persist:yoom')` (cookie survives relaunch), `contextIsolation`, `sandbox`, no `nodeIntegration`; loads `NEXT_PUBLIC_APP_URL` (or `http://localhost:3000` when `YOOM_DEV=1`); `globalShortcut` `CommandOrControl+Shift+R` toggles the window; navigation restricted to the app origin, other links → `shell.openExternal`; `setPermissionRequestHandler` allows `media`/`display-capture` only for the app origin.
- **Preload (app)**: `exposeInMainWorld('__yoomDesktop', { isDesktop: true, version, pickSource: () => ipcRenderer.invoke('yoom:pick-source') })` — matches the Phase 2 `desktop-bridge.ts` shape.
- **Picker window**: 480×420 frameless, `vibrancy:'popover'`, tabs Screens / Windows, thumbnails as data URLs, Esc cancels, Enter/click chooses.

### `setDisplayMediaRequestHandler` flow (`capture.ts`)
1. Web recorder calls `getDisplayMedia({video, audio:true})` unchanged.
2. Handler: if a `pickSource()` preselection is <30s old, use it; else `desktopCapturer.getSources({types:['screen','window'], thumbnailSize:{320×180}, fetchWindowIcons:true})` → open picker → send `SourceInfo[]`.
3. On choose → `callback({ video: {id, name}, audio: request.audioRequested ? 'loopback' : undefined })`. Cancel → `callback({})` (web shows its existing NotAllowedError UI).
4. Guard: `systemPreferences.getMediaAccessStatus('screen') !== 'granted'` → notification + deep link `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`, `callback({})`.
5. Keep `useSystemPicker` off (bypasses the handler; loopback wiring unclear).

### IPC contract
```
'yoom:pick-source'    invoke  () => SourceInfo | null
'yoom:picker:sources' send    SourceInfo[]        (main → picker)
'yoom:picker:choose'  send    { id }              (picker → main)
'yoom:picker:cancel'  send    void
'yoom:shortcut'       send    void                (main → app renderer, optional)
SourceInfo = { id; name; kind: 'screen'|'window'; thumb; icon? }
```

### macOS permissions
- `extendInfo`: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSAudioCaptureUsageDescription` (**required** for CoreAudio taps on macOS 14.2+; missing key = silent dead audio track), `NSScreenCaptureUsageDescription`, `LSUIElement: true`.
- TCC: Screen Recording prompts on first `getSources`; mic/camera via `systemPreferences.askForMediaAccess`; 14.2+ adds a separate "System Audio Recording" entry.
- Unsigned builds key TCC on cdhash → every rebuild re-prompts. Document it. `electron-vite dev` may lack system audio (plist lives in node_modules' Electron.app); verify with the packaged build.
- No feature flag needed on Electron 39. Fallback if taps fail: `app.commandLine.appendSwitch('disable-features','MacCatapSystemAudioLoopbackCapture')` before `ready` (confirm exact name in the Electron desktopCapturer docs caveat).

### Phase 4 verification
1. `npm run dev` in `desktop/` with Next dev running: tray icon, no dock icon, ⌘⇧R toggles the window.
2. Log in, quit, relaunch → still logged in.
3. `window.__yoomDesktop.isDesktop === true`; UI shows "System audio: on".
4. Play music, start a full-screen recording → picker shows screens + windows; TCC prompts on first run.
5. Record 10s → `ffprobe out.webm` shows an audio stream; `ffmpeg -i out.webm -af volumedetect -f null -` mean_volume > −60 dB.
6. Mic + system both present when mic on.
7. `npm run build` → `desktop/dist/*.dmg`; packaged app repeats 2–5.
8. Root `next build` passes and Vercel ignores `desktop/`.

---

## What Tyler must provide (blocks Phase 1)
1. **Google Cloud**: OAuth client (Web application) with redirect `http://localhost:3000/oauth/callback` (used only by `scripts/google-oauth.mjs`), Drive API enabled, app published to production. → `GOOGLE_CLIENT_ID/SECRET`.
2. **Supabase**: a project (new or existing) → `SUPABASE_URL`, service role key. I can run the migration via the Supabase MCP or `supabase db push`.
3. **Resend**: API key + verified sending domain (e.g. `alerts@jtylerray.com`) → `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, `ALERT_TO_EMAIL=jt@jtylerray.com`.
4. **Vercel**: OK to create a new project `yoom` in team `kravok` linked to this repo, and to push the `/v/:slug` rewrite to `The-Ops-King/jtylerray.com` (outward-facing; I'll ask before pushing).

## Cross-phase order of work
Phase 1 (storage/DB/watch/views/email) → Phase 2 (recorder) → Phase 3 (dashboard) → Phase 4 (Electron). Each phase ends with its verification list, `npm run build`, lint, and a commit. Use a worktree branch per phase; TDD for pure modules (`slug`, `session`, `cors`, `computeBubbleRect`, `recorder-machine`, `db` helpers with a mocked client); manual matrix for media APIs.
