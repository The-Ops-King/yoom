#!/usr/bin/env node
/**
 * Copies the MediaPipe vision WASM out of node_modules into public/, so it is
 * served same-origin. Same-origin matters: a cross-origin model or WASM taints
 * nothing, but the preset backgrounds and the thumbnail canvas must never be
 * tainted, and keeping every asset local also means the recorder works offline
 * in Electron.
 *
 * Asset policy:
 *   - WASM  (`public/mediapipe/`)  — GENERATED at build from node_modules, and
 *     therefore gitignored. It is versioned with @mediapipe/tasks-vision, so
 *     committing it would just be a stale copy of a dependency.
 *   - Model (`public/models/selfie_segmenter.tflite`) — COMMITTED (249 KB).
 *     It is a fixed, versionless artefact behind a Google CDN URL, so a build
 *     must not depend on that CDN being up (or reachable at all, on an air-
 *     gapped or Electron build box). The download below stays only as a
 *     fallback for the case where the file is somehow missing.
 *
 * Runs from `predev` and `prebuild`; it is a no-op when the files are current.
 * Every failure here is warn-only — the recorder degrades to "no virtual
 * backgrounds" rather than breaking `npm run dev` / `npm run build`.
 */
import { createRequire } from "node:module";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function copyWasm() {
  // The package's "exports" map hides ./package.json, so resolve the main
  // entry point instead and walk up to the package root from there.
  const entry = require.resolve("@mediapipe/tasks-vision");
  const srcDir = path.join(path.dirname(entry), "wasm");
  const outDir = path.join(process.cwd(), "public", "mediapipe", "wasm");
  await mkdir(outDir, { recursive: true });

  for (const file of WASM_FILES) {
    const from = path.join(srcDir, file);
    const to = path.join(outDir, file);
    if (!(await exists(from))) {
      throw new Error(`Missing ${from} — did @mediapipe/tasks-vision change layout?`);
    }
    if (await exists(to)) continue;
    await cp(from, to);
    console.log(`copied ${file}`);
  }
}

async function fetchModel() {
  const outDir = path.join(process.cwd(), "public", "models");
  const out = path.join(outDir, "selfie_segmenter.tflite");
  await mkdir(outDir, { recursive: true });
  // Normal path: the model is committed, so this returns immediately.
  if (await exists(out)) return;

  console.log(`downloading ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(`Model download failed: ${res.status} ${res.statusText}`);
  }
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log("downloaded selfie_segmenter.tflite");
}

// Each step is warn-only and independent: a WASM copy failure must not stop
// the model fallback from running, and neither may break dev/build.
function warn(err) {
  console.warn(`[copy-mediapipe] ${err instanceof Error ? err.message : err}`);
}

try {
  await copyWasm();
} catch (err) {
  warn(err);
}

try {
  await fetchModel();
} catch (err) {
  warn(err);
}
