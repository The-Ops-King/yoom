# Yoom desktop (macOS)

An Electron shell around the deployed Yoom web recorder. It exists for three
things a browser on macOS cannot do:

1. **System audio for screens and windows.** Chrome on macOS only gives system
   audio for *tab* captures. The shell answers `getDisplayMedia` in the main
   process and returns `audio: 'loopback'`, which Chromium services with
   Apple's CoreAudio Tap API on macOS 14.2+.
2. **Global hotkeys.** ⌘⇧L start/stop, ⌘⇧P pause, ⌘⇧M mark, ⌘⇧K restart,
   ⌘⇧X cancel — they fire while another app is focused, which is exactly when
   you need them during a screen recording.
3. **A camera bubble placed after the take.** Screen and camera record to two
   separate raw files; no bubble window is shown over the desktop during a
   take. Once you stop, staging is where you drag the camera preview into
   position, resize it, and add keyframes — that position and size are what
   get composited into the bubble burned into the export.
4. **A recording HUD.** During a take the recorder window hides entirely and a
   small always-on-top pill — timer, pause, stop, mark, discard — is the whole
   UI. This is the "make the app disappear" behaviour.

There is no dock icon; the app lives in the menu bar.

## Requirements

macOS 14.2 or newer (Apple silicon), Node 20+, and a running Yoom web app —
either the deployment or `npm run dev` in the repo root.

## Dev

```sh
cd desktop
npm install
npm run icons     # once, generates the tray template PNGs
npm run dev       # YOOM_DEV=1 → loads http://localhost:3000
```

Point it somewhere else with `YOOM_APP_URL=https://staging.example.com npm run dev`.
With neither variable set the app loads `https://yoom.jtylerray.com`.

## Sign-in

**The app never asks for the password.** The shell holds a shared secret and
attaches it as `x-yoom-desktop-token` on every request to the app origin
(`src/main/auth.ts`); the web app treats a matching token as the owner. Because
the recorder page's own fetches — the RSC payloads, every `/api/*` call — run in
the same Electron session, they carry the header too, so nothing is left for a
password gate to catch. The header is only ever added to the app origin, checked
exactly in the listener rather than trusted to the match pattern.

The token comes from, in order:

1. `YOOM_DESKTOP_TOKEN` in the environment — easiest under `npm run dev`:
   ```sh
   YOOM_DESKTOP_TOKEN="$(grep '^DESKTOP_TOKEN=' ../.env.local | cut -d= -f2-)" npm run dev
   ```
2. the file `~/Library/Application Support/yoom-desktop/desktop-token`
   (contents trimmed) — the packaged app's path, since it has no environment to
   inherit. Tray → Developer → **Reveal desktop token file** opens it in Finder.
   ```sh
   printf %s 'the-token' > ~/Library/Application\ Support/yoom-desktop/desktop-token
   ```

**It must be byte-identical to the server's `DESKTOP_TOKEN`** (`.env.local` in
dev, the Vercel env var in production). Comparison is constant-time and exact —
no trailing newline, no whitespace. If the token is missing the app logs one
warning and carries on; you then get the ordinary password gate. If the server
has no `DESKTOP_TOKEN` set at all the header path is disabled outright, which is
what keeps the public website password-gated.

## Build

```sh
npm run build     # → dist/Yoom-0.1.0-arm64.dmg and …-mac.zip
```

The build is **unsigned** (`identity: null`, ad-hoc). Gatekeeper will refuse a
double-click on first launch: right-click the app → Open → Open.

## Permissions (TCC)

| Permission | When it is asked | Notes |
|---|---|---|
| Screen Recording | First real capture (`desktopCapturer.getSources`) | Cannot be prompted from code. Grant it in System Settings → Privacy & Security → Screen Recording, then **relaunch**. |
| Camera | `systemPreferences.askForMediaAccess('camera')`, from the tray's Permissions… item, or on first camera use | |
| Microphone | Same | |
| System Audio Recording | macOS 14.2+ only, on first loopback capture | **No status API exists.** The only symptom of a missing grant is a silent audio track with no error. |

Two things that will waste your afternoon if you do not know them:

- **Unsigned builds re-prompt on every rebuild.** macOS keys TCC grants to the
  binary's cdhash, and an ad-hoc signature produces a new one each build. Every
  `npm run build` is a fresh app as far as privacy is concerned.
- **`npm run dev` is not the packaged app.** In dev, the running binary is
  `node_modules/electron/dist/Electron.app`, whose Info.plist has none of our
  usage strings, so system audio can be dead in dev and fine in the packaged
  build. Verify loopback audio against a packaged build.

If Chromium's CoreAudio tap misbehaves, `YOOM_LEGACY_AUDIO=1` forces the older
"Screen & System Audio Recording" permission path via the
`MacCatapLoopbackAudioForScreenShare` feature flag.

## The recording HUD

Entering the 3-2-1 countdown **hides** the recorder window (it is not closed —
the encoder, the compositor and the unsaved-work guard all live in that
renderer) and puts a 320×48 pill at the top centre of the screen:

| Control | Action | Hotkey |
|---|---|---|
| ⏸ / ▶ | Pause / resume | ⌘⇧P |
| ■ | Stop and go to staging | ⌘⇧L |
| ⚑ | Drop a marker | ⌘⇧M |
| 🗑 | Discard the take | ⌘⇧X |

Drag the pill anywhere by its body. The recorder window comes back — shown and
focused — as soon as the take reaches staging, error or idle. The tray mirrors
the same controls, and ⌘⇧L works throughout.

**The HUD will appear in a full-screen recording.** `setContentProtection(true)`
is applied, but macOS ≥ 14's ScreenCaptureKit — which Chromium uses — ignores
it. Two answers:

- Drag the pill onto a second display, or onto the part of the screen you are
  not capturing. This is what Loom users do with Loom's control bar, which has
  the same limitation.
- Run with `YOOM_HUD_HIDE_WHILE_RECORDING=1`. The pill hides itself 1 s after
  your last interaction with it and reappears for 2 s whenever a hotkey fires,
  the status changes, or you use the tray's "Show/hide controls".

## Debugging

There is no menu bar (`LSUIElement: true`), so the usual View → Toggle
Developer Tools is not there.

- **Recorder window DevTools:** tray → Developer → Developer tools. Opens
  detached, so it does not resize the page mid-recording.
- **Hard reload the web app:** tray → Developer → Reload recorder
  (`reloadIgnoringCache`). Use it after a deploy rather than restarting the shell.
- **HUD / bubble / picker renderers:** they have no menu either. In dev they are
  served by electron-vite, so the quickest path is `console.log` plus the
  terminal running `npm run dev`, which carries renderer console output. To
  attach real DevTools, temporarily add `win.webContents.openDevTools({ mode: "detach" })`
  next to the window's `loadURL`/`loadFile` call.
- **Main-process logs:** the terminal running `npm run dev`. In a packaged
  build, launch from a terminal — `/Applications/Yoom.app/Contents/MacOS/Yoom` —
  to see them.
- **IPC not arriving?** Check `desktop/src/preload/channels.test.ts` first
  (`npm --prefix desktop test`). A preload silently missing its bridge is
  almost always a channel-string drift or a sandbox chunking regression — see
  the header comment in `app.channels.ts`.
- **Permissions:** tray → Permissions… shows all three statuses and offers the
  deep links. Remember that an unsigned rebuild is a new app to macOS TCC.
- **"Terminal has access to my camera":** under `npm run dev` macOS attributes
  camera and microphone use to the **launching process** — your terminal —
  because the running binary is `node_modules/electron/dist/Electron.app` and
  the privacy indicator follows the responsible process. The packaged app shows
  up as "Yoom". So the scary Terminal entry in Control Centre is a dev-only
  artefact of *who launched it*, not of *what is holding the device*. To check
  whether the camera is genuinely still open, watch the green LED / menu-bar
  dot: it should go out within ~2 s of a take reaching staging (see "Camera
  release" below).

## Camera release

The floating bubble is a second, independent `getUserMedia` in its own
renderer. Hiding that window does **not** stop its tracks, so the shell sends
the renderer an explicit release on every hide path — it stops every track and
clears `srcObject` — and destroys the window entirely if it stays unwanted for
2 s. Recreating it is cheap. `before-quit` destroys it while it still exists,
so the indicator goes out when you quit rather than when the process exits.

The recorder page's *own* camera is separate and stays live through
`staging → setup` on purpose: you are about to shoot another take, and
re-acquiring would re-prompt and re-flash the camera. Loom behaves the same
way. It is released by `teardown()` on upload, reset, idle and error.

## The floating bubble

The bubble window is a **live camera preview positioned over the desktop**, not
the pixels that end up in the recording. Dragging it sends its centre —
normalized to the display it sits on — to the web app, which repositions the
burned-in bubble to match.

The live window and the composited bubble are deliberately the same size and in
the same place. That matters: `setContentProtection(true)` is applied, but on
modern macOS ScreenCaptureKit-based capturers (Chromium's included) capture the
window anyway, so the real defence against seeing the bubble twice is that the
composited bubble is drawn *over* the captured pixels of the live one. If you
still see doubling, run with `YOOM_BUBBLE_HIDE_WHILE_RECORDING=1`, which hides
the live window once recording starts.

The bubble's own hover strip has two controls: cycle shape and hide. Both echo
back into the web app so the setting persists.

## Known limits (v1)

- **The HUD is captured in full-screen recordings on macOS ≥ 14.** See
  "The recording HUD" above for the two workarounds.
- **The HUD's position is not remembered across launches.** It returns to the
  top centre of the primary display every time.

- **The live bubble hides itself while recording a window, and with framed
  capture on.** Self-occlusion only works when the composited bubble covers the
  same pixels the capture picked up of the live window, which is only true for a
  whole-display capture with framing off. A `window:` source, or framed capture
  (which insets the screen inside a larger canvas), moves the two rectangles
  apart, so the shell hides the live window for the duration of the recording.
  The in-page bubble and the burned-in bubble are unaffected — you just lose the
  desktop preview while the encoder runs. `YOOM_BUBBLE_HIDE_WHILE_RECORDING=1`
  makes this the behaviour for every capture.
- **Window captures.** `desktopCapturer` gives no bounds for foreign windows, so
  the bubble position is always normalized to the *display*, never to the
  captured window. When you capture a single window, the burned-in bubble
  tracks the bubble's position on the screen, which only lines up with the
  recording if that window fills the display. Capture a whole screen for exact
  alignment.
- **The in-page drag handle and the floating window are independent.** Both
  write the same bubble position, so they agree after either one moves, but
  dragging the in-page handle does not move the floating window.
- No code signing, no notarization, no auto-update, arm64 only.
- macOS only. The main process is written to be portable, but nothing here has
  been run on Windows or Linux.
