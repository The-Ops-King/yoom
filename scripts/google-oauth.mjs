#!/usr/bin/env node
// One-shot Google OAuth consent for Yoom.
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-oauth.mjs
//
// Opens the consent screen, catches the code on http://localhost:3000/oauth/callback,
// exchanges it for a refresh token, creates the "Yoom" Drive folder (the drive.file
// scope can only see files this app created, so the folder must be made here), and
// prints the env lines to paste into .env.local and Vercel.
//
// `next dev` must NOT be running on port 3000 while this script runs — it binds
// its own server on that port to catch the OAuth callback.
//
// The OAuth app must be published to "In production" — refresh tokens issued by a
// "Testing" app expire after 7 days.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth/callback";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = process.env.YOOM_DRIVE_FOLDER_NAME || "Yoom";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before running this script.",
  );
  process.exit(1);
}

const state = randomBytes(16).toString("hex");

const consentUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    // Fall through to the printed URL.
  }
}

function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://localhost:3000");
      if (url.pathname !== "/oauth/callback") {
        res.writeHead(404).end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const stateMismatch = returnedState !== state;
      const failed = Boolean(error) || stateMismatch;

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#1a1a1e;color:#f0f0f2;padding:48px">` +
          `<h1 style="font-size:18px">${failed ? "Authorization failed" : "Authorized"}</h1>` +
          `<p style="color:#8b8b96">You can close this tab and return to the terminal.</p></body>`,
      );

      server.close();

      if (error) return reject(new Error(`Google returned: ${error}`));
      if (stateMismatch) return reject(new Error("State mismatch"));
      if (!code) return reject(new Error("No authorization code in the callback"));
      resolve(code);
    });

    server.on("error", reject);
    server.listen(3000, () => {
      console.log(
        "Listening on http://localhost:3000/oauth/callback (make sure `next dev` is not running on port 3000)",
      );
      console.log("\nOpen this URL if a browser did not launch:\n");
      console.log(consentUrl + "\n");
      openBrowser(consentUrl);
    });
  });
}

async function exchangeCode(code) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  }
  if (!json.refresh_token) {
    throw new Error(
      "No refresh_token returned. Revoke the app at myaccount.google.com/permissions and rerun.",
    );
  }
  return json;
}

async function createFolder(accessToken) {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      }),
    },
  );

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Folder creation failed: ${JSON.stringify(json)}`);
  }
  return json;
}

try {
  const code = await waitForCode();
  const tokens = await exchangeCode(code);
  const folder = await createFolder(tokens.access_token);

  console.log("\n--- Add these to .env.local and to the Vercel project ---\n");
  console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
  console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(`GOOGLE_DRIVE_FOLDER_ID=${folder.id}`);
  console.log(`\nCreated Drive folder "${folder.name}" (${folder.id}).`);
  console.log(
    "Reminder: publish the OAuth consent screen to production or this refresh token expires in 7 days.\n",
  );
  process.exit(0);
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
