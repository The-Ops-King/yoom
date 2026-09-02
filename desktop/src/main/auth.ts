import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app, type Session } from "electron";
import { appOrigin } from "./windows";

/** Header the web app reads (`desktopTokenMatches` in src/lib/session.ts). */
export const DESKTOP_TOKEN_HEADER = "x-yoom-desktop-token";

/**
 * Where the token lives when it is not in the environment:
 * `~/Library/Application Support/yoom-desktop/desktop-token` on macOS.
 * A plain file, contents trimmed, so provisioning is one `echo … >` away.
 */
export function desktopTokenFile(): string {
  return join(app.getPath("userData"), "desktop-token");
}

let cached: string | null | undefined;

/**
 * The shared secret that signs this shell in without a password.
 * `YOOM_DESKTOP_TOKEN` wins (handy under `npm run dev`), otherwise the file.
 * Cached: it is read on every request otherwise, and it cannot change without
 * a relaunch anyway.
 */
export function desktopToken(): string | null {
  if (cached !== undefined) return cached;

  const fromEnv = process.env.YOOM_DESKTOP_TOKEN?.trim();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  try {
    const fromFile = readFileSync(desktopTokenFile(), "utf8").trim();
    cached = fromFile || null;
  } catch {
    cached = null;
  }

  if (!cached) {
    // Not fatal: the app still works, the web page just shows the password
    // gate the way a browser does.
    console.warn(
      `[yoom] no desktop token (set YOOM_DESKTOP_TOKEN or write ${desktopTokenFile()}); the recorder will ask for the password`,
    );
  }
  return cached;
}

/**
 * Attach the token to every request this session makes to the app origin —
 * top-level navigations, the RSC payload fetches the page makes on its own, and
 * every `/api/*` XHR, because they all travel through this same session.
 *
 * The filter pattern is a Chromium match pattern, whose host carries no port,
 * so `http://localhost:3000` narrows to `http://localhost/*`. That is looser
 * than we want, which is why the listener re-checks the exact origin: the token
 * must never be sent to another host.
 */
export function installDesktopAuthHeader(ses: Session): void {
  const token = desktopToken();
  if (!token) return;

  const origin = appOrigin();
  const { protocol, hostname } = new URL(origin);

  ses.webRequest.onBeforeSendHeaders(
    { urls: [`${protocol}//${hostname}/*`] },
    (details, callback) => {
      let requestOrigin = "";
      try {
        requestOrigin = new URL(details.url).origin;
      } catch {
        requestOrigin = "";
      }
      if (requestOrigin !== origin) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          [DESKTOP_TOKEN_HEADER]: token,
        },
      });
    },
  );
}
