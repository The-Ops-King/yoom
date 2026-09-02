# Overnight report — 2026-09-02 → 03

Tyler went to sleep after Phase 3 merged and the Phase 2.1 recorder patch shipped. Instruction: build everything unblocked, list what's blocked, no pauses. This file is the morning briefing. Sections are appended as work lands.

## Shipped (live at https://yoom.jtylerray.com)
- Phase 1 — Drive storage, Supabase, `/v/<slug>` via jtylerray.com, view tracking, Resend alerts.
- Phase 2 + 2.1 — new recorder: modes/surfaces, draggable animated bubble, shapes/sizes, mirror, on/off, framed capture, mic + system audio mixing, countdown, pause, restart-now (⌘⇧K), cancel (⌘⇧X), review, markers (⌘⇧M). Camera virtual backgrounds removed at Tyler's request.
- Phase 3 — owner dashboard (`/library`, `/library/[id]`, `/settings`), inline title/description/slug editing with old-slug redirects, download, delete, analytics, share-link copied at Upload click (slug reserved up front), `edits jsonb` + `EditPlayer` foundations for the Phase 5 editor.

## Verified overnight
- **Production auth gate:** unauthenticated `/library`, `/library/<id>`, `/settings` render only the password gate (no titles/analytics in the HTML); `/api/videos/*` → 401. This closed a real leak the final review caught: a route-group layout gate is not an auth boundary in Next 16, so every owner page now checks `isOwner()` itself and the proxy rewrites owner URLs to the gate.
- **Dashboard, driven in Chrome against the real DB (local dev + throwaway password):** library grid (3 recordings, views/unique/last-viewed), detail page (player + poster, stats, retention, recent viewers), inline title rename (saved, tab title updated), slug editor with live normalization ("Finder Demo!" → `finder-demo`), settings toggles save/persist (restored to both ON).
- **Slug change bug found and fixed:** the `change_video_slug` DB function had a PL/pgSQL variable named `old_slug` that collided with the `slug_history.old_slug` column, so every slug change failed ("Could not change the link"). New migration `20260902010000_fix_change_video_slug.sql` applied to Supabase; retried in the UI → success. Old slug `/v/10brfcdl` now 308s to `/v/finder-demo` locally, on `yoom.jtylerray.com`, and through `jtylerray.com`.
- **Download route:** authenticated download streams `finder-demo.webm` (987 KB) with `Content-Disposition: attachment`; non-UUID ids now 404 (was 500).
- **Junk test video** (slug `uunrv7zm`, random bytes from Phase 1 verification) soft-deleted and its Drive file trashed via API — the Delete button's `window.confirm` blocks browser automation, so the UI delete path is on your list.
- **Renamed your 9-second recording** to "Finder walkthrough (renamed overnight)" with slug `finder-demo` as the test subject — rename it back if you like.

## Blocked — needs Tyler
- **Recorder handoff end to end** (record → Upload → clipboard has the link → lands on `/library/<id>?new=1` with title focused): needs a real recording in your browser. Also ⌘⇧M markers appearing as ticks on the detail page.
- **Delete from the UI** (confirm dialog → soft delete → Drive trash → `/v/<slug>` 404s).
- **Phase 2.1 re-test** you started: drag ghost gone, mode switching in setup, ⌘⇧K restart-now, ⌘⇧X cancel, animated bubble transitions.

## Decisions made without you
- Your Mac went to sleep at ~02:30 and killed a running planner. I started `caffeinate -dims -t 28800` (keeps the Mac awake for 8 h, then expires on its own) so the overnight build could continue. Kill it early with `pkill caffeinate` if you want.

## Follow-ups / known rough edges
- Library card thumbnails load through `/api/thumb/<id>` (Drive proxy, ~400 KB JPEG each) so the grid shows black boxes for a beat before they paint; the detail page poster is fine. Cheap win later: cache thumbs on Vercel (`Cache-Control: public` is already set) or generate smaller ones at upload.
- If an upload fails after the link was copied at click time, the clipboard holds a link to a video that never saved (`/v/<slug>` → 404). The review screen shows the error; a "link not live" note could be added.
- `/api/upload/complete` fallback slug on a collision isn't checked against `slug_history` (vanishingly unlikely).
- `viewers-table` shows raw `max_percent` (e.g. 33.33%) vs one-decimal rounding elsewhere.
- No tests cover the page-level auth boundary (which is how the leak slipped past unit tests); an integration test hitting `/library` without a cookie would catch regressions.
- Both Phase 2/2.1 reviews' non-blocking items remain listed in `docs/for-later.md`.
