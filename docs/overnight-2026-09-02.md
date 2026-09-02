# Overnight report — 2026-09-02 → 03

Tyler went to sleep after Phase 3 merged and the Phase 2.1 recorder patch shipped. Instruction: build everything unblocked, list what's blocked, no pauses. This file is the morning briefing. Sections are appended as work lands.

## TL;DR
All four phases are merged to `main`. Web app is live with the dashboard and the desktop-bridge wiring (inert in a browser). The Electron app is built (`desktop/dist/Yoom-0.1.0-arm64.dmg`, unsigned, 122 MB) but **never launched** — that's your first job this morning (checklist at the bottom). One production bug found and fixed overnight (slug changes failed at the DB layer). Nothing destructive was done; your two real recordings are intact (one renamed as a test).

## Shipped (live at https://yoom.jtylerray.com)
- Phase 1 — Drive storage, Supabase, `/v/<slug>` via jtylerray.com, view tracking, Resend alerts.
- Phase 2 + 2.1 — new recorder: modes/surfaces, draggable animated bubble, shapes/sizes, mirror, on/off, framed capture, mic + system audio mixing, countdown, pause, restart-now (⌘⇧K), cancel (⌘⇧X), review, markers (⌘⇧M). Camera virtual backgrounds removed at Tyler's request.
- Phase 4 — Electron desktop shell in `desktop/` (merged, built, unlaunched): tray, global ⌘⇧L/P/K/X/M, native screen/window picker, macOS loopback system audio, floating always-on-top camera bubble that drives the recorded bubble position.
- Phase 3 — owner dashboard (`/library`, `/library/[id]`, `/settings`), inline title/description/slug editing with old-slug redirects, download, delete, analytics, share-link copied at Upload click (slug reserved up front), `edits jsonb` + `EditPlayer` foundations for the Phase 5 editor.

## Verified overnight
- **Production auth gate:** unauthenticated `/library`, `/library/<id>`, `/settings` render only the password gate (no titles/analytics in the HTML); `/api/videos/*` → 401. This closed a real leak the final review caught: a route-group layout gate is not an auth boundary in Next 16, so every owner page now checks `isOwner()` itself and the proxy rewrites owner URLs to the gate.
- **Dashboard, driven in Chrome against the real DB (local dev + throwaway password):** library grid (3 recordings, views/unique/last-viewed), detail page (player + poster, stats, retention, recent viewers), inline title rename (saved, tab title updated), slug editor with live normalization ("Finder Demo!" → `finder-demo`), settings toggles save/persist (restored to both ON).
- **Slug change bug found and fixed:** the `change_video_slug` DB function had a PL/pgSQL variable named `old_slug` that collided with the `slug_history.old_slug` column, so every slug change failed ("Could not change the link"). New migration `20260902010000_fix_change_video_slug.sql` applied to Supabase; retried in the UI → success. Old slug `/v/10brfcdl` now 308s to `/v/finder-demo` locally, on `yoom.jtylerray.com`, and through `jtylerray.com`.
- **Download route:** authenticated download streams `finder-demo.webm` (987 KB) with `Content-Disposition: attachment`; non-UUID ids now 404 (was 500).
- **Junk test video** (slug `uunrv7zm`, random bytes from Phase 1 verification) soft-deleted and its Drive file trashed via API — the Delete button's `window.confirm` blocks browser automation, so the UI delete path is on your list.
- **Renamed your 9-second recording** to "Finder walkthrough (renamed overnight)" with slug `finder-demo` as the test subject — rename it back if you like.

- **Phase 4 (Electron desktop shell) built end to end on `phase4-electron`, never launched.** All 22 plan tasks are committed. Gates that ran: root `npm test` (21 files, 333 tests), `npm run lint`, `npm run build` (Next build clean), `npx tsc --noEmit` (only the three pre-existing errors in `src/lib/db.test.ts` and `src/lib/upload-client.test.ts`, unchanged from before this branch); desktop `npm run typecheck`, `npm test` (2 files, 24 tests), `electron-vite build`, and electron-builder → `desktop/dist/Yoom-0.1.0-arm64.dmg` and `Yoom-0.1.0-arm64-mac.zip` (122 MB each). The packaged `Info.plist` carries all four TCC usage strings and `LSUIElement => true`, and the tray PNGs ship under `Contents/Resources/build/`.
- **Four pre-build fixes folded in from the review:** sandboxed preloads are now self-contained (they could not `require` the shared Rollup chunk, so the bridge would never have appeared in the packaged app — `out/preload/` is three files and no `chunks/`); the bubble's own hide/shape-cycle now reaches the web app (`onBubbleAppearance`); framed capture joins window captures in auto-hiding the live bubble while recording; and `bubbleWindowSize` clamps width first so the minimum size keeps the aspect ratio.
## Blocked — needs Tyler
- **Recorder handoff end to end** (record → Upload → clipboard has the link → lands on `/library/<id>?new=1` with title focused): needs a real recording in your browser. Also ⌘⇧M markers appearing as ticks on the detail page.
- **Delete from the UI** (confirm dialog → soft delete → Drive trash → `/v/<slug>` 404s).
- **Phase 2.1 re-test** you started: drag ghost gone, mode switching in setup, ⌘⇧K restart-now, ⌘⇧X cancel, animated bubble transitions.

- **Phase 4 manual verification matrix (Task 22, sections B–I) — every line needs the app running, which means TCC prompts only you can answer.** Section A (automated gates) is done. What is left, one line each:
  - **B. Dev shell** — tray icon and no dock icon, the four-item tray menu, the recorder window at `localhost:3000`, `window.__yoomDesktop` reporting version 1 / `systemAudio: 'full'`, and the green "Desktop app · System audio: on" badge.
  - **C. Login persistence** — sign in, quit from the tray, relaunch, still signed in (the `yoom_session` cookie in the `persist:yoom` partition).
  - **D. Shortcuts** — ⌘⇧L/P/M/K/X all firing while another app is focused, and ⌘⇧L reopening a closed recorder window.
  - **E. Picker** — the native picker instead of Chrome's sheet, tab switching with thumbnails and app icons, arrow/Enter/Esc keys, the Windows tab preselected for the window surface pref, and the "System audio will be included" line.
  - **F. System audio** — the reason this shell exists: record the screen with music playing from the **packaged** build, then `ffprobe` for an Opus stream and `ffmpeg -af volumedetect` for a `mean_volume` above −60 dB (−91 dB means a silent track).
  - **G. Floating bubble** — appears in Screen+Cam setup, drags with no tween lag, the hover strip's shape and hide buttons move the in-page bubble too, exactly one bubble in the finished recording, gone at `review`, absent in screen-only and camera-only, correctly re-based with framed capture on, and sane on a second display.
  - **H. Browser regression** — plain Chrome at `localhost:3000` shows no badge, the tab-only system-audio notice is back, Chrome's own picker appears, and `window.__yoomDesktop` is `undefined`.
  - **I. Artefacts** — mount the dmg, drag to Applications, launch from there (right-click → Open the first time) and repeat C–G.
## Decisions made without you
- Your Mac went to sleep at ~02:30 and killed a running planner. I started `caffeinate -dims -t 28800` (keeps the Mac awake for 8 h, then expires on its own) so the overnight build could continue. Kill it early with `pkill caffeinate` if you want.
- **Phase 4 (Electron) started on branch `phase4-electron`.** Plan reviewed; I added four amendments: auto-hide the live desktop bubble during *window/tab* captures (self-occlusion only lines up for full-display captures), pin the bubble window's sizing to the compositor's exact fractions with a drift test, grant camera permission to the bubble window's own origin, and **never launch the app overnight** (TCC prompts are yours). Overnight goal: root tests green, desktop typecheck + unit tests green, `electron-vite build` and an unsigned `dmg`/`zip` in `desktop/dist/`.
- The plan corrected the spec's Electron feature-flag name to `MacCatapLoopbackAudioForScreenShare` (verified in the Electron 44 docs).

## Ready for your review (not built)
- **Phase 5 editor**: design `docs/superpowers/specs/2026-09-03-phase5-editor-design.md` and a 26-task plan `docs/superpowers/plans/2026-09-03-phase5-editor.md`. Key calls to confirm: non-destructive edit list first, burned-in export as sub-phase 5b; cuts stored as removed ranges in source time; coordinates normalized to the source frame; blur fails closed to a solid redact; editor loads lazily so the public watch page stays light.

## Follow-ups / known rough edges
- Library card thumbnails load through `/api/thumb/<id>` (Drive proxy, ~400 KB JPEG each) so the grid shows black boxes for a beat before they paint; the detail page poster is fine. Cheap win later: cache thumbs on Vercel (`Cache-Control: public` is already set) or generate smaller ones at upload.
- If an upload fails after the link was copied at click time, the clipboard holds a link to a video that never saved (`/v/<slug>` → 404). The review screen shows the error; a "link not live" note could be added.
- `/api/upload/complete` fallback slug on a collision isn't checked against `slug_history` (vanishingly unlikely).
- `viewers-table` shows raw `max_percent` (e.g. 33.33%) vs one-decimal rounding elsewhere.
- No tests cover the page-level auth boundary (which is how the leak slipped past unit tests); an integration test hitting `/library` without a cookie would catch regressions.
- Both Phase 2/2.1 reviews' non-blocking items remain listed in `docs/for-later.md`.

## Phase 4 desktop app — morning launch checklist (in the order things are most likely to fail)
The app was built but never launched overnight (macOS permission prompts are yours). From `desktop/`: `npm run dev` (against `localhost:3000` with `YOOM_DEV=1`) or open the unsigned dmg in `desktop/dist/` (right-click → Open the first time).
1. **Picker and bubble render** — if either window is blank, check its DevTools console for CSP violations (the `file://` CSP was patched overnight; this is the first thing to confirm).
2. **Tray icon appears** — if the app dies at startup, the tray image didn't ship (`extraResources`).
3. **First capture** — macOS asks for Screen Recording; grant, then relaunch. Then Camera, Microphone, and (14.2+) System Audio Recording.
4. **Picker doesn't self-cancel** — a capture that fails instantly with "Permission denied" means the picker lost focus (blur-cancel); report it.
5. **System audio is real** — record a full-screen clip with music playing; play it back. If silent, tell me which macOS version you're on.
6. **Floating bubble** — appears in Screen+Cam setup, follows your drag, and the burned-in bubble in the recording sits where the live one was. ✕ and the shape button on the bubble should change the in-page bubble too.
7. **Hotkeys work when the app isn't focused** — ⌘⇧L / P / K / X / M.
8. **Login persists** across quit/relaunch.

## Phase 4.1 — what to test
The HUD, the disappearing recorder window and the launch-time permission prompts are all built but never launched (that is your first run). Full matrix: `docs/superpowers/plans/2026-09-02-phase4.1-recording-hud.md` § Task 16.
- **A. Permissions (the reported bug)** — launching should now raise the mic and camera prompts by itself, a missing Screen Recording grant gets a dialog with the deep link, and the microphone picker should finally list real devices.
- **B. The disappearing act** — pressing Start hides the recorder window and the pill counts 3-2-1; Stop or Discard brings the window back, focused, on review or setup.
- **C. HUD controls** — pause/resume, mark ×3, camera toggle, dragging the pill, and it surviving a Space switch and a native full-screen app.
- **D. Content protection / auto-hide** — the pill IS in a full-screen recording on macOS 14+ (documented); `YOOM_HUD_HIDE_WHILE_RECORDING=1` hides it 1 s after you stop touching it and flashes it back on a hotkey.
- **E. Camera hygiene** — the green indicator goes out within ~2 s of reaching review, and immediately on quit; the packaged build attributes the camera to "Yoom", not Terminal.
- **F. Regressions** — system audio still lands, bubble drag still drives the burned-in bubble with the window hidden, the picker still opens on the right tab, the beforeunload guard still challenges a close mid-take, and plain Chrome is unchanged.
- **G. Dev ergonomics** — tray → Developer → Developer tools (detached) and Reload recorder.
