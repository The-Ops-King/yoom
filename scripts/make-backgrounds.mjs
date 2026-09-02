#!/usr/bin/env node
// Generates the gradient preset backgrounds. Run once; output is committed.
//   node scripts/make-backgrounds.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "backgrounds");

/** id → [from, via, to] stops, 135° linear gradient. */
const PRESETS = {
  sunset: ["#f5734c", "#e8465a", "#7a2a6b"],
  ocean: ["#1e3a8a", "#0ea5b7", "#67e8c3"],
  graphite: ["#2c2c32", "#1a1a1e", "#0c0c0f"],
  mint: ["#0f766e", "#34d399", "#d9f99d"],
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
