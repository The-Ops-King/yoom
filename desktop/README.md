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
3. **A floating camera bubble** over the desktop, draggable, whose position
   drives the bubble burned into the recording.

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
