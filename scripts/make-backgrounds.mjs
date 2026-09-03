#!/usr/bin/env node
// Generates the gradient preset backgrounds. Run once; output is committed.
//   node scripts/make-backgrounds.mjs
//
// The catalogue is keyed `g01…g16` so the ids stay stable while the palette
// is retuned. The four original ids (sunset/ocean/graphite/mint) are still
// written as ALIAS files with identical content: `DEFAULT_FRAME` ships
// `/backgrounds/mint.svg` + `presetId: "mint"`, and a settings object stored
// by any earlier build points at one of them.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "backgrounds");

/** id → [from, via, to] stops, 135° linear gradient. Keep in step with FRAME_PRESETS. */
export const PRESETS = {
  g01: ["#0f2027", "#2c7d7a", "#7be0c0"], // Aurora
  g02: ["#ffb997", "#f4826c", "#d95f6e"], // Peach
  g03: ["#8e7bd6", "#a78bfa", "#e0d4ff"], // Lavender
  g04: ["#0b1020", "#141a35", "#2b1e5c"], // Midnight
  g05: ["#0b3d2e", "#1f7a4d", "#8fd694"], // Forest
  g06: ["#f5734c", "#e8465a", "#7a2a6b"], // Sunrise (was `sunset`)
  g07: ["#1e3a8a", "#0ea5b7", "#67e8c3"], // Ocean
  g08: ["#2c2c32", "#1a1a1e", "#0c0c0f"], // Graphite
  g09: ["#0f766e", "#34d399", "#d9f99d"], // Mint
  g10: ["#7a1f4b", "#d6467f", "#ffc4d6"], // Rose
  g11: ["#7c3a00", "#e0891a", "#fcd34d"], // Amber
  g12: ["#1e293b", "#475569", "#94a3b8"], // Slate
  g13: ["#ff6a3d", "#ff9068", "#ffd0b5"], // Coral
  g14: ["#1e1b4b", "#4338ca", "#818cf8"], // Indigo
  g15: ["#3f5540", "#7c9a72", "#cfe0b8"], // Sage
  g16: ["#f5f5f7", "#d8d8dd", "#b4b4bc"], // Mono
};

/** Legacy filename → catalogue id. Written as a byte-identical copy. */
export const ALIASES = {
  sunset: "g06",
  ocean: "g07",
  graphite: "g08",
  mint: "g09",
};

const W = 1920;
const H = 1080;

function svg([from, via, to]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="55%" stop-color="${via}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>
`;
}

await mkdir(OUT_DIR, { recursive: true });
for (const [id, stops] of Object.entries(PRESETS)) {
  const file = path.join(OUT_DIR, `${id}.svg`);
  await writeFile(file, svg(stops), "utf8");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
for (const [alias, id] of Object.entries(ALIASES)) {
  const file = path.join(OUT_DIR, `${alias}.svg`);
  await writeFile(file, svg(PRESETS[id]), "utf8");
  console.log(`wrote ${path.relative(process.cwd(), file)} (alias of ${id})`);
}
