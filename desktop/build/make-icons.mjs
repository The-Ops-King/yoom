// Renders the Yoom mark into the two icon families the build needs:
//
//   icon.png            1024×1024 app icon — electron-builder turns this into
//                       the .icns. Without it macOS shows the stock Electron
//                       diamond.
//   trayTemplate.png    16×16 (+ @2x) menu-bar icon. macOS template images are
//                       black + alpha only; the system recolours them for light
//                       and dark menu bars, so nothing here may carry colour.
//
// There is no SVG rasteriser on a stock macOS box (no rsvg/ImageMagick), but
// Electron is already a dependency — so we render in an offscreen window and
// capture the page. Run with `npm run icons`.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const here = dirname(fileURLToPath(import.meta.url));

const ACCENT = "#3f7d5c";
const INK = "#141312";
const INK_DEEP = "#0c0b0a";

/**
 * The mark from `src/components/logo.tsx`: two diagonals converging on a
 * vertical, with the record dot at the junction. Drawn on the same 48×48 grid
 * the component uses so the desktop icon and the web header stay in step.
 */
function mark({ colour, strokeWidth }) {
  return `
    <path d="M10 8L24 26L38 8" stroke="${colour}" stroke-width="${strokeWidth}"
          stroke-linecap="round" stroke-linejoin="round" fill="none" />
    <path d="M24 26L24 40" stroke="${colour}" stroke-width="${strokeWidth}"
          stroke-linecap="round" fill="none" />
    <circle cx="24" cy="26" r="${strokeWidth * 0.89}" fill="${colour}" />
  `;
}

/**
 * macOS icon geometry: the artwork sits in a rounded square inset from the
 * canvas edge, not bleeding to it. Apple's grid puts the square at 824/1024
 * with a ~185/824 corner radius; matching it keeps Yoom the same visual size as
 * its neighbours in the Dock and Finder.
 */
function appIconSvg(size) {
  const inset = size * (100 / 1024);
  const box = size - inset * 2;
  const radius = box * (185 / 824);
  // The mark is drawn at 60% of the tile so it breathes inside the rounded square.
  const markSize = box * 0.6;
  const markOffset = inset + (box - markSize) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${INK}" />
        <stop offset="100%" stop-color="${INK_DEEP}" />
      </linearGradient>
      <radialGradient id="lens" cx="50%" cy="0%" r="75%">
        <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.28" />
        <stop offset="70%" stop-color="${ACCENT}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="url(#ground)" />
    <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="url(#lens)" />
    <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}"
          fill="none" stroke="rgba(138,133,124,0.14)" stroke-width="${size / 512}" />
    <g transform="translate(${markOffset} ${markOffset}) scale(${markSize / 48})">
      ${mark({ colour: ACCENT, strokeWidth: 4.5 })}
    </g>
  </svg>`;
}

/**
 * The tray mark is the same Y, but heavier: at 16px the web stroke weight
 * thins out to about a pixel and reads as lint on the menu bar. Pure black —
 * `setTemplateImage(true)` in main/tray.ts hands the recolouring to macOS.
 */
function trayIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
    <g transform="translate(24 24) scale(0.86) translate(-24 -24)">
      ${mark({ colour: "#000000", strokeWidth: 6 })}
    </g>
  </svg>`;
}

// One window for every capture. A transparent offscreen window can only be
// loaded once per process — the second `loadURL` into a freshly created one
// fails with ERR_FAILED regardless of size — so the window is created once and
// each icon is rendered into it in turn, anchored top-left and captured by rect.
const CANVAS = 2048;
let canvas = null;

function surface() {
  if (canvas) return canvas;
  canvas = new BrowserWindow({
    width: CANVAS,
    height: CANVAS,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true },
  });
  return canvas;
}

async function capture(svg, size, scale) {
  const win = surface();

  const page = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block}</style>${svg}`;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  // One frame of settle: capturePage on a just-loaded offscreen window can
  // return the pre-paint (empty) buffer.
  await new Promise((resolve) => setTimeout(resolve, 250));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  const resized = scale && scale !== size ? image.resize({ width: scale, height: scale }) : image;
  const png = resized.toPNG();

  if (png.length === 0) throw new Error(`empty capture at ${size}px`);
  return png;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  // Render the app icon at 2× and downsample: the offscreen compositor
  // antialiases the rounded corners far better with the extra headroom.
  const appIcon = await capture(appIconSvg(2048), 2048, 1024);
  writeFileSync(join(here, "icon.png"), appIcon);
  console.log(`icon.png              1024×1024  ${appIcon.length} bytes`);

  for (const [name, size] of [["trayTemplate.png", 16], ["trayTemplate@2x.png", 32]]) {
    const png = await capture(trayIconSvg(size * 8), size * 8, size);
    writeFileSync(join(here, name), png);
    console.log(`${name.padEnd(22)}${size}×${size}      ${png.length} bytes`);
  }

  canvas?.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
