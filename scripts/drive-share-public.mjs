#!/usr/bin/env node
// Grant "anyone with the link can view" on the Drive files behind live videos.
//
//   node scripts/drive-share-public.mjs            # dry run, changes nothing
//   node scripts/drive-share-public.mjs --apply    # actually grants access
//   node scripts/drive-share-public.mjs --revoke   # removes the anyone grant
//
// The watch page's Drive fallback renders https://drive.google.com/file/d/<id>/preview
// in an iframe. Drive only plays that for a viewer who can open the file, so a
// private file shows a sign-in page instead of the recording. This grants the
// link-readable permission those embeds need.
//
// READ THIS BEFORE --apply: afterwards, anyone holding a Drive file id can view
// that recording without going through the Yoom share link. The ids are not
// secret — the watch page ships them to the browser so the fallback can work.
// Only run this if link-level access is acceptable for every listed recording.
//
// Reads credentials from .env.local.

import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--revoke")
    ? "revoke"
    : "dry-run";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const need = (k) => {
  const v = env[k];
  if (!v) throw new Error(`Missing ${k} in .env.local`);
  return v;
};

async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: need("GOOGLE_CLIENT_ID"),
      client_secret: need("GOOGLE_CLIENT_SECRET"),
      refresh_token: need("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

async function supabase(path) {
  const res = await fetch(`${need("SUPABASE_URL")}/rest/v1/${path}`, {
    headers: {
      apikey: need("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${need("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
  });
  if (!res.ok) throw new Error(`supabase: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const drive = (token) => async (path, init = {}) => {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
};

const token = await accessToken();
const api = drive(token);

const videos = (await supabase("videos?select=id,slug,title,drive_file_id,deleted_at"))
  .filter((v) => !v.deleted_at);

console.log(`mode: ${MODE}   live videos: ${videos.length}\n`);

let changed = 0;
let already = 0;
let failed = 0;

for (const v of videos) {
  const perms = await api(`files/${v.drive_file_id}/permissions?fields=permissions(id,type,role)`);
  if (!perms.ok) {
    console.log(`  FAIL  ${v.slug.padEnd(26)} cannot read permissions: ${perms.status} ${JSON.stringify(perms.body?.error?.message ?? "")}`);
    failed++;
    continue;
  }

  const anyone = (perms.body.permissions ?? []).find((p) => p.type === "anyone");

  if (MODE === "revoke") {
    if (!anyone) { console.log(`  skip  ${v.slug.padEnd(26)} no anyone-grant`); already++; continue; }
    const del = await api(`files/${v.drive_file_id}/permissions/${anyone.id}`, { method: "DELETE" });
    console.log(`  ${del.ok ? "REVOKED" : "FAIL   "} ${v.slug}`);
    if (del.ok) changed++;
    else failed++;
    continue;
  }

  if (anyone) { console.log(`  ok    ${v.slug.padEnd(26)} already link-readable (${anyone.role})`); already++; continue; }

  if (MODE === "dry-run") {
    console.log(`  WOULD GRANT  ${v.slug.padEnd(26)} "${v.title}"`);
    changed++;
    continue;
  }

  const res = await api(`files/${v.drive_file_id}/permissions`, {
    method: "POST",
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (res.ok) { console.log(`  GRANTED  ${v.slug}`); changed++; }
  else { console.log(`  FAIL     ${v.slug}: ${res.status} ${JSON.stringify(res.body?.error?.message ?? "")}`); failed++; }
}

console.log(
  `\n${MODE}: ${changed} ${MODE === "dry-run" ? "would change" : "changed"}, ${already} already in the desired state, ${failed} failed`,
);
if (MODE === "dry-run") console.log("Nothing was modified. Re-run with --apply to grant.");
