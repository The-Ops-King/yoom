# Handoff — staging editor branch (2026-09-02, late)

**Branch:** `feat/staging-editor`, not merged, ~130 commits ahead of `main`. All gates green at
handoff: 665 web tests, 85 desktop tests, lint clean, `tsc` clean except 3 pre-existing
test-file errors (`db.test.ts`, `upload-client.test.ts`), `npm run build` succeeds.

**Spec:** `docs/superpowers/specs/2026-09-02-staging-editor-design.md` (base + three addenda).
**Plan (first wave only):** `docs/superpowers/plans/2026-09-02-staging-editor.md`. Later waves
were driven from Tyler's test feedback and are documented in the spec addenda and commit log.

## What the branch does

- Recording: always screen+camera (or camera-only), two raw files, no live compositing. Desktop
  shell auto-shares the last screen; page shows "Sharing … · Change", mic, camera, Record.
  Restart = 2 s "Ready? Go!". HUD: pause, stop, mark, restart, discard; manual drag.
- Desktop tracks while recording: cursor (30 Hz), clicks + keys (`uiohook-napi`, Input
  Monitoring permission). Memory only; clicks persist as `edits.clicks` after the user edits.
- Staging (`src/components/staging/`): trim/cut, camera keyframes (settle-by-t, shape, pan,
  hidden), frame (16 gradients + IndexedDB wallpapers), zoom (free aspect, letterbox, move/resize,
  chaining, static/follow), overlays (blur, blackout, ellipse, rect, line, arrow×4, step,
  underline, highlight, text, emoji, draw, image, keys), clicks lane, cursor/motion blur,
  details (slug check, thumbnail), upload = real-time render (`src/lib/editor/export.ts`).
- Library multi-select delete.

## How to run

```sh
npm run dev                                   # web, http://localhost:3000
cd desktop && ELECTRON_ENABLE_LOGGING=1 \
  YOOM_DESKTOP_TOKEN="$(grep '^DESKTOP_TOKEN=' ../.env.local | cut -d= -f2-)" npm run dev
```
Packaged build: `npm --prefix desktop run build` (unsigned dmg in `desktop/dist/`).
If the Next dev server ever eats memory: check for lockfiles ABOVE the repo (`~/package.json`
did this once); `turbopack.root` is pinned in `next.config.ts`.

## Not yet verified by a human

Tyler tested several rounds in the dev shell; the last round (input hook, clicks, key badges,
smooth cursor, motion blur, full overlay set, wallpapers, auto-share, Ready? Go!) has NOT been
tested by hand yet. Checklist: `docs/overnight-2026-09-02.md` → "Staging editor — manual test"
(extend it for the new features). Export quality (motion blur, ripples, key badges) needs eyes.

## Known gaps / follow-ups

- Electron 44 cannot hide the captured cursor; "Smooth" cursor overlays the real one.
- No animated preview of a change while paused (keyframes animate only across time).
- `edit-player.tsx` runs an idle rAF for videos with edits (draws nothing).
- Orphans: `desktop/src/main/bubble.ts`, `geometry.displayPosToCanvasPos`.
- No automated render smoke test (needs a browser); export is real-time.
- Pause bug reported once, then "works now"; never root-caused (trace reverted in `71365b5`).
- UI polish deliberately deferred ("functionality first"); CleanShot X bundle is the visual
  reference (`/Applications/CleanShot X.app/Contents/Resources`, see memory note).
- Wallpaper blobs live in the browser/Electron origin's IndexedDB; not synced anywhere.

## Process notes

- Implementation was done by parallel subagents in one checkout; every commit is by explicit
  pathspec to avoid index races. One commit had to be reworded afterwards.
- Merge choice pending Tyler: local merge to `main` or PR on The-Ops-King/yoom.
