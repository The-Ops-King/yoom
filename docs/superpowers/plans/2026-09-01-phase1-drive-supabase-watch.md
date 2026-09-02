# Phase 1: Google Drive storage, Supabase, /v/[slug] watch page, view tracking, email alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** SHIPPED 2026-09-01 — merged to `main`, live at https://yoom.jtylerray.com, proxied at https://jtylerray.com/v/<slug>. All 28 tasks done (Task 28 verified against production; alerts confirmed after Resend verified jtylerray.com). Follow-ups in `docs/for-later.md`.

**Goal:** Replace Cloudflare R2 with Google Drive as the video store, add a Supabase Postgres metadata layer, serve share links at `https://jtylerray.com/v/<slug>` through a Vercel rewrite, track view sessions, and email Tyler on first play and on completion. The recorder keeps working end-to-end; `npm run build` passes at every commit.

**Architecture:**
- **Storage**: Google Drive (`drive.file` scope, one app-created "Yoom" folder). Browser uploads go straight to Drive's resumable endpoint in 8 MiB chunks using a session URI minted server-side; a `/api/upload/chunk` proxy exists as a CORS fallback. Playback never redirects to Drive — `/api/stream/[videoId]` streams the upstream `Response.body` through, clamping open-ended Range requests to a 32 MiB window.
- **Metadata**: Supabase Postgres, service-role key server-side only, RLS on with zero policies so nothing but the service role can read. Tables: `videos`, `slug_history`, `view_sessions`, `settings` (single row).
- **Auth**: shared password → HMAC-signed `yoom_session` cookie; `src/proxy.ts` (Next 16's replacement for the deprecated `middleware.ts`) guards `/`, `/library/*` and `/api/upload/*`.
- **Sharing**: `jtylerray.com/v/:slug` is rewritten to this app. The app therefore runs cross-origin: `assetPrefix` points `/_next/static` at the app origin, `next.config.ts` `headers()` opens CORS on those assets, and every client fetch/`<video src>` on the watch page uses the absolute `NEXT_PUBLIC_APP_URL`. CORS is applied only to `/api/view/*`, `/api/stream/*`, `/api/thumb/*`.
- **Alerts**: `after()` in the view routes runs `claimAlert(sessionId, column)` — an atomic `update … where <column> is null returning id` — so at most one first-play email and one summary email per view session, then sends via Resend.

**Tech Stack:** Next.js 16.2.3 (App Router, `proxy.ts`, `after()`, Promise `params`, `permanentRedirect`), React 19.2.4, TypeScript 5, Tailwind v4, `@supabase/supabase-js`, `resend`, `server-only`, Vitest (node environment), raw `fetch` for the Drive REST API (no `googleapis`), Node 20 for `scripts/google-oauth.mjs`.

**Verified Next 16 API names** (from `node_modules/next/dist/docs/01-app`):
- `src/proxy.ts` exports `proxy(request: NextRequest)` plus `export const config = { matcher: [...] }`. "The `middleware` file convention is deprecated and has been renamed to `proxy`."
- Route handler context: `{ params }: { params: Promise<{ slug: string }> }` — always `await params`.
- "If `OPTIONS` is not defined, Next.js will automatically implement `OPTIONS` and set the appropriate Response `Allow` header" — so we export `OPTIONS` explicitly wherever CORS preflight matters.
- `after(callback)` from `next/server`; usable in Route Handlers, and `cookies()`/`headers()` may be called inside the callback there.
- `permanentRedirect(path, type?)` from `next/navigation` → 308 outside Server Actions.
- `cookies()` returns a Promise: `const cookieStore = await cookies(); cookieStore.get(name); cookieStore.set(name, value, options); cookieStore.delete(name)`.
- `generateMetadata` async export in `page.tsx`.
- `assetPrefix` rewrites only `/_next/` (i.e. `.next/static`) URLs — not `/public`, not `/_next/image`.
- `next.config.ts` `async headers()` returns `[{ source, headers: [{ key, value }] }]`.

**Review amendments (Fable, 2026-09-01, applied inline):** thumbnail capture works in every mode (Task 18); `visibilitychange` no longer ends a session, only `pagehide`/`ended` do (Task 22); `update_view_progress` returns NULL for a missing session and `updateViewSession` guards an all-null row (Tasks 9, 10); stream route uses `Cache-Control: private` so no shared cache replays a 206 for a different Range (Task 20); auth verdict read from the cookie via `src/lib/auth.ts#isOwner()` instead of a proxy-set header (Tasks 15, 18); `fix-webm-duration` patches the WebM duration header before upload (Task 18); Phase 3 foundations in the single migration — `videos.updated_at`, `change_video_slug()` and the `video_stats` view (Task 9); `getViewSession()` added to `db.ts` (Task 10).

---

## File Structure

**Created**
| Path | Responsibility |
|---|---|
| `vitest.config.ts` | Vitest config: node environment, `src/**/*.test.ts`, `@/` alias. |
| `src/lib/env.ts` | `env(name)` (throws when missing) + `appUrl()`, `shareBaseUrl()`, `allowedOrigins()`. |
| `src/lib/env.test.ts` | Unit tests for env accessors. |
| `src/lib/slug.ts` | `newSlug()` (8-char lowercase base36) and `SLUG_RE`. |
| `src/lib/slug.test.ts` | Unit tests for slug shape and regex. |
| `src/lib/session.ts` | HMAC-signed `yoom_session` cookie: `signSession()`, `verifySession()`, `SESSION_COOKIE`, `SESSION_MAX_AGE`. |
| `src/lib/session.test.ts` | Unit tests: round trip, tamper, expiry. |
| `src/lib/cors.ts` | `corsHeaders(origin)`, `preflight(request)`, `withCors(request, response)`. |
| `src/lib/cors.test.ts` | Unit tests for origin echo / rejection / `Vary`. |
| `src/lib/geo.ts` | `readViewerContext(request)` → `{ ipHash, userAgent, country, city }`. |
| `src/lib/geo.test.ts` | Unit tests for header parsing and salted hashing. |
| `src/lib/range.ts` | Pure `clampRange(rangeHeader, size, windowBytes)` used by the stream route. |
| `src/lib/range.test.ts` | Unit tests for Range parsing and 32 MiB clamping. |
| `src/lib/supabase.ts` | `import 'server-only'`; service-role client singleton, `persistSession: false`. |
| `src/lib/db.ts` | Typed data access: videos, slug history, view sessions, `claimAlert`, settings. |
| `src/lib/db.test.ts` | Unit tests with `vi.mock('@/lib/supabase')`. |
| `src/lib/alerts.ts` | Email template renderers + `sendFirstPlayEmail` / `sendSummaryEmail` via Resend. |
| `src/lib/alerts.test.ts` | Unit tests for subject/body rendering. |
| `src/lib/google-drive.ts` | Drive REST helpers over `fetch` (replaces `r2.ts`). |
| `src/lib/upload-client.ts` | Browser-side `uploadToDrive(blob, sessionUri, onProgress)` chunked resumable PUTs. |
| `src/lib/upload-client.test.ts` | Unit tests with a mocked `fetch`. |
| `src/lib/share.ts` | `shareUrl(slug)` = `${NEXT_PUBLIC_SHARE_BASE_URL}/v/${slug}`. |
| `src/proxy.ts` | Auth gate for `/`, `/library/*`, `/api/upload/*`. |
| `src/app/api/upload/complete/route.ts` | Verify Drive file, insert `videos` row, return `{ id, slug, url }`. |
| `src/app/api/upload/thumbnail/route.ts` | Accept JPEG ≤ 1 MB, `uploadSmall`, set `thumbnail_drive_file_id`. |
| `src/app/api/upload/chunk/route.ts` | CORS fallback proxy for resumable chunks (≤ 4 MB bodies). |
| `src/app/api/stream/[videoId]/route.ts` | `GET`/`HEAD` byte-range video streaming from Drive. |
| `src/app/api/thumb/[videoId]/route.ts` | `GET` JPEG thumbnail from Drive. |
| `src/app/api/view/start/route.ts` | Create a view session; `after()` → first-play email. |
| `src/app/api/view/heartbeat/route.ts` | Update progress; `after()` → summary email. |
| `src/app/v/[slug]/page.tsx` | Server watch page: slug lookup, old-slug 308, `generateMetadata`. |
| `src/app/v/[slug]/not-found.tsx` | 404 for the watch route (moved from `src/app/watch/[key]/`). |
| `src/components/watch-view.tsx` | Client watch UI: player, copy link, optional viewer-name prompt. |
| `src/hooks/use-view-tracker.ts` | Play/heartbeat/beacon view tracking hook. |
| `supabase/migrations/20260901000000_init.sql` | Full Phase 1 schema. |
| `scripts/google-oauth.mjs` | One-shot local OAuth consent + Drive folder creation. |

**Modified**
| Path | Change |
|---|---|
| `package.json` | Drop AWS SDKs; add `@supabase/supabase-js`, `resend`, `server-only`, `vitest`; add `"test"` script. |
| `.env.example` | Replace the R2 block with the Phase 1 env table. |
| `src/app/api/auth/route.ts` | Set `yoom_session` on success; add `DELETE` to clear. |
| `src/app/api/upload/route.ts` | Return a Drive resumable `sessionUri` instead of an R2 presigned URL. |
| `src/app/page.tsx` | Server component reading `cookies()` → gate or recorder. |
| `src/components/password-gate.tsx` | Drop the `password` payload; call `router.refresh()` on success. |
| `src/components/recorder.tsx` (lines 11-23, 292-340) | Drop the `password` prop; upload via `uploadToDrive`; complete + thumbnail; share URL from `shareUrl(slug)`. |
| `next.config.ts` | `assetPrefix` + `headers()` for `/_next/static/:path*`. |
| `README.md` | Full rewrite for the Drive/Supabase/Resend/rewrite setup. |
| `~/jtylerray.com/vercel.json` | Two `/v/:slug` rewrites before the catch-all (local commit only, needs Tyler's OK). |

**Deleted**
| Path | Reason |
|---|---|
| `src/lib/r2.ts` | R2 removed. |
| `src/app/watch/[key]/page.tsx` | Replaced by `/v/[slug]`. |
| `src/app/watch/[key]/not-found.tsx` | Moved to `src/app/v/[slug]/not-found.tsx`. |

---

### Task 1: Add the Vitest test runner

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/smoke.test.ts` (temporary; deleted at the end of this task)
- Modify: `package.json` (lines 5-10 scripts, lines 18-27 devDependencies)

- [ ] Install Vitest: `npm i -D vitest`
- [ ] Create `vitest.config.ts`:
  ```ts
  import { defineConfig } from "vitest/config";
  import { fileURLToPath } from "node:url";

  export default defineConfig({
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  });
  ```
- [ ] Add the script to `package.json` `"scripts"` (keep the existing entries):
  ```json
  "test": "vitest run"
  ```
- [ ] Write a failing smoke test at `src/lib/smoke.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";

  describe("vitest wiring", () => {
    it("runs node-environment tests", () => {
      expect(typeof process.versions.node).toBe("string");
    });
  });
  ```
- [ ] Run `npm test` — expect PASS (1 test). If Vitest is not wired up the command fails with `vitest: not found` or "No test files found".
- [ ] Delete the smoke test: `rm src/lib/smoke.test.ts`
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  test: add vitest runner with node environment and @ alias

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 2: Swap dependencies and rewrite `.env.example`

**Files:**
- Modify: `package.json` (lines 11-17 dependencies)
- Modify: `.env.example` (whole file)

- [ ] Remove the R2 SDKs: `npm rm @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
  (this leaves `src/lib/r2.ts` broken at type-check time; `src/lib/r2.ts` and the `watch` route are deleted in Task 19 — until then, **do not run `npm run build`** for this task's verification, use `npx tsc --noEmit` expectations noted below. To keep the tree buildable, this task also stubs `r2.ts`.)
- [ ] Install the new runtime deps: `npm i @supabase/supabase-js resend server-only`
- [ ] Replace `src/lib/r2.ts` entirely with a dependency-free stub so the old watch route still compiles until Task 19 deletes both:
  ```ts
  // Deprecated: R2 storage. Retained only so the legacy /watch route compiles
  // until it is deleted in the "Remove R2" task. No AWS SDK dependency.
  export async function videoExists(_key: string): Promise<boolean> {
    return false;
  }

  export function getPublicVideoUrl(key: string): string {
    return `${process.env.R2_PUBLIC_URL ?? ""}/${key}`;
  }
  ```
- [ ] Replace `src/app/api/upload/route.ts`'s import of `createPresignedUploadUrl` — not yet; Task 16 rewrites that file. For now delete the presigned call so the tree compiles: replace the whole file body with a 501 placeholder:
  ```ts
  import { NextResponse } from "next/server";

  export async function POST() {
    return NextResponse.json({ error: "Upload not configured" }, { status: 501 });
  }
  ```
- [ ] Replace `.env.example` with:
  ```
  # Shared password for the recorder + owner surfaces
  UPLOAD_PASSWORD=
  # 32+ random bytes; signs the yoom_session cookie and salts viewer IP hashes
  SESSION_SECRET=

  # Absolute origin this Next app is served from (no trailing slash)
  NEXT_PUBLIC_APP_URL=https://yoom.vercel.app
  # Public share origin that rewrites /v/:slug to the app
  NEXT_PUBLIC_SHARE_BASE_URL=https://jtylerray.com
  # Comma-separated origins allowed to call /api/view/*, /api/stream/*, /api/thumb/*
  ALLOWED_ORIGINS=https://jtylerray.com,https://www.jtylerray.com

  # Google Drive (see scripts/google-oauth.mjs)
  GOOGLE_CLIENT_ID=
  GOOGLE_CLIENT_SECRET=
  GOOGLE_REFRESH_TOKEN=
  GOOGLE_DRIVE_FOLDER_ID=

  # Supabase (service role key is server-only, never expose it)
  SUPABASE_URL=
  SUPABASE_SERVICE_ROLE_KEY=

  # Resend
  RESEND_API_KEY=
  ALERT_TO_EMAIL=jt@jtylerray.com
  ALERT_FROM_EMAIL=alerts@jtylerray.com
  ```
- [ ] Run `npm test` — expect PASS (no test files yet is an error, so expect "No test files found"; that is acceptable at this commit — if it fails the run, temporarily keep `--passWithNoTests`: set the script to `vitest run --passWithNoTests` and leave it that way for the rest of the plan).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  chore: drop AWS SDKs, add supabase/resend/server-only, rewrite .env.example

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 3: `src/lib/env.ts`

**Files:**
- Create: `src/lib/env.ts`
- Test: `src/lib/env.test.ts`

- [ ] Write `src/lib/env.test.ts`:
  ```ts
  import { afterEach, describe, expect, it } from "vitest";
  import { allowedOrigins, env, appUrl, shareBaseUrl } from "@/lib/env";

  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  describe("env", () => {
    it("returns the value when set", () => {
      process.env.SOME_KEY = "value";
      expect(env("SOME_KEY")).toBe("value");
    });

    it("throws when missing", () => {
      delete process.env.SOME_KEY;
      expect(() => env("SOME_KEY")).toThrow("Missing environment variable: SOME_KEY");
    });

    it("throws when empty", () => {
      process.env.SOME_KEY = "";
      expect(() => env("SOME_KEY")).toThrow("Missing environment variable: SOME_KEY");
    });
  });

  describe("appUrl", () => {
    it("strips a trailing slash", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://yoom.vercel.app/";
      expect(appUrl()).toBe("https://yoom.vercel.app");
    });

    it("falls back to localhost when unset", () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      delete process.env.VERCEL_URL;
      expect(appUrl()).toBe("http://localhost:3000");
    });
  });

  describe("shareBaseUrl", () => {
    it("defaults to the app origin", () => {
      delete process.env.NEXT_PUBLIC_SHARE_BASE_URL;
      process.env.NEXT_PUBLIC_APP_URL = "https://yoom.vercel.app";
      expect(shareBaseUrl()).toBe("https://yoom.vercel.app");
    });

    it("uses the configured share origin", () => {
      process.env.NEXT_PUBLIC_SHARE_BASE_URL = "https://jtylerray.com/";
      expect(shareBaseUrl()).toBe("https://jtylerray.com");
    });
  });

  describe("allowedOrigins", () => {
    it("splits, trims and drops empties", () => {
      process.env.ALLOWED_ORIGINS = "https://a.com, https://b.com ,";
      expect(allowedOrigins()).toEqual(["https://a.com", "https://b.com"]);
    });

    it("returns an empty list when unset", () => {
      delete process.env.ALLOWED_ORIGINS;
      expect(allowedOrigins()).toEqual([]);
    });
  });
  ```
- [ ] Run `npm test` — expect FAIL: `Failed to resolve import "@/lib/env"`.
- [ ] Create `src/lib/env.ts`:
  ```ts
  export function env(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
  }

  export function optionalEnv(name: string): string | undefined {
    const value = process.env[name];
    return value ? value : undefined;
  }

  function stripTrailingSlash(url: string): string {
    return url.endsWith("/") ? url.slice(0, -1) : url;
  }

  /** Absolute origin this Next app is served from. */
  export function appUrl(): string {
    const explicit = optionalEnv("NEXT_PUBLIC_APP_URL");
    if (explicit) return stripTrailingSlash(explicit);
    const prod = optionalEnv("VERCEL_PROJECT_PRODUCTION_URL");
    if (prod) return `https://${prod}`;
    const preview = optionalEnv("VERCEL_URL");
    if (preview) return `https://${preview}`;
    return "http://localhost:3000";
  }

  /** Public origin that share links are built from. */
  export function shareBaseUrl(): string {
    const explicit = optionalEnv("NEXT_PUBLIC_SHARE_BASE_URL");
    return explicit ? stripTrailingSlash(explicit) : appUrl();
  }

  /** Extra origins permitted to call the public view/stream/thumb routes. */
  export function allowedOrigins(): string[] {
    const raw = optionalEnv("ALLOWED_ORIGINS");
    if (!raw) return [];
    return raw
      .split(",")
      .map((origin) => stripTrailingSlash(origin.trim()))
      .filter((origin) => origin.length > 0);
  }
  ```
- [ ] Run `npm test` — expect PASS (9 tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add env accessors for app/share origins and allowed origins

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 4: `src/lib/slug.ts`

**Files:**
- Create: `src/lib/slug.ts`
- Test: `src/lib/slug.test.ts`

- [ ] Write `src/lib/slug.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { SLUG_RE, newSlug } from "@/lib/slug";

  describe("newSlug", () => {
    it("returns 8 lowercase base36 characters", () => {
      for (let i = 0; i < 200; i++) {
        const slug = newSlug();
        expect(slug).toHaveLength(8);
        expect(slug).toMatch(/^[0-9a-z]{8}$/);
      }
    });

    it("passes SLUG_RE", () => {
      expect(SLUG_RE.test(newSlug())).toBe(true);
    });

    it("is not trivially repeating", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 100; i++) seen.add(newSlug());
      expect(seen.size).toBeGreaterThan(95);
    });
  });

  describe("SLUG_RE", () => {
    it.each(["abc", "my-demo", "a-b-c-1", "a".repeat(40)])("accepts %s", (slug) => {
      expect(SLUG_RE.test(slug)).toBe(true);
    });

    it.each(["ab", "AB", "my_demo", "a".repeat(41), "my demo", "", "my.demo"])(
      "rejects %s",
      (slug) => {
        expect(SLUG_RE.test(slug)).toBe(false);
      },
    );
  });
  ```
- [ ] Run `npm test` — expect FAIL: `Failed to resolve import "@/lib/slug"`.
- [ ] Create `src/lib/slug.ts`:
  ```ts
  export const SLUG_RE = /^[a-z0-9-]{3,40}$/;

  const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
  const SLUG_LENGTH = 8;

  /** 8-character lowercase base36 slug from a CSPRNG. */
  export function newSlug(): string {
    const bytes = new Uint8Array(SLUG_LENGTH);
    crypto.getRandomValues(bytes);
    let out = "";
    for (const byte of bytes) {
      out += ALPHABET[byte % ALPHABET.length];
    }
    return out;
  }
  ```
- [ ] Run `npm test` — expect PASS (env 9 + slug tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add slug generation and validation

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 5: `src/lib/session.ts`

**Files:**
- Create: `src/lib/session.ts`
- Test: `src/lib/session.test.ts`

- [ ] Write `src/lib/session.test.ts`:
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import {
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    signSession,
    verifySession,
  } from "@/lib/session";

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-value-0123456789abcdef";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("session", () => {
    it("exposes the cookie name and 30-day max age", () => {
      expect(SESSION_COOKIE).toBe("yoom_session");
      expect(SESSION_MAX_AGE).toBe(60 * 60 * 24 * 30);
    });

    it("round trips a freshly signed cookie", () => {
      expect(verifySession(signSession())).toBe(true);
    });

    it("produces a ts.sig shape", () => {
      const [ts, sig] = signSession().split(".");
      expect(Number.isInteger(Number(ts))).toBe(true);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects undefined", () => {
      expect(verifySession(undefined)).toBe(false);
    });

    it("rejects a malformed cookie", () => {
      expect(verifySession("nodot")).toBe(false);
      expect(verifySession("123.")).toBe(false);
      expect(verifySession(".abc")).toBe(false);
    });

    it("rejects a tampered signature", () => {
      const [ts] = signSession().split(".");
      expect(verifySession(`${ts}.${"0".repeat(64)}`)).toBe(false);
    });

    it("rejects a tampered timestamp", () => {
      const [ts, sig] = signSession().split(".");
      expect(verifySession(`${Number(ts) + 1}.${sig}`)).toBe(false);
    });

    it("rejects an expired cookie", () => {
      const cookie = signSession();
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + (SESSION_MAX_AGE + 60) * 1000);
      expect(verifySession(cookie)).toBe(false);
    });

    it("rejects a cookie signed with a different secret", () => {
      const cookie = signSession();
      process.env.SESSION_SECRET = "a-completely-different-secret-value";
      expect(verifySession(cookie)).toBe(false);
    });
  });
  ```
- [ ] Run `npm test` — expect FAIL: `Failed to resolve import "@/lib/session"`.
- [ ] Create `src/lib/session.ts`:
  ```ts
  import { createHmac, timingSafeEqual } from "node:crypto";
  import { env } from "@/lib/env";

  export const SESSION_COOKIE = "yoom_session";
  /** 30 days, in seconds. */
  export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

  export type SessionCookieOptions = {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };

  function sign(timestamp: number): string {
    return createHmac("sha256", env("SESSION_SECRET"))
      .update(String(timestamp))
      .digest("hex");
  }

  /** Returns a `<issuedAtSeconds>.<hexHmac>` cookie value. */
  export function signSession(): string {
    const issuedAt = Math.floor(Date.now() / 1000);
    return `${issuedAt}.${sign(issuedAt)}`;
  }

  export function verifySession(cookie: string | undefined | null): boolean {
    if (!cookie) return false;
    const dot = cookie.indexOf(".");
    if (dot <= 0 || dot === cookie.length - 1) return false;

    const timestampPart = cookie.slice(0, dot);
    const signaturePart = cookie.slice(dot + 1);
    if (!/^\d+$/.test(timestampPart)) return false;
    if (!/^[0-9a-f]{64}$/.test(signaturePart)) return false;

    const issuedAt = Number(timestampPart);
    const now = Math.floor(Date.now() / 1000);
    if (issuedAt > now + 60) return false;
    if (now - issuedAt > SESSION_MAX_AGE) return false;

    let expected: string;
    try {
      expected = sign(issuedAt);
    } catch {
      return false;
    }

    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signaturePart, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  export function sessionCookieOptions(): SessionCookieOptions {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    };
  }
  ```
- [ ] Run `npm test` — expect PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add HMAC-signed yoom_session cookie helpers

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 6: `src/lib/cors.ts`

**Files:**
- Create: `src/lib/cors.ts`
- Test: `src/lib/cors.test.ts`

- [ ] Write `src/lib/cors.test.ts`:
  ```ts
  import { beforeEach, describe, expect, it } from "vitest";
  import { corsHeaders, preflight, withCors } from "@/lib/cors";

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://yoom.vercel.app";
    process.env.ALLOWED_ORIGINS = "https://jtylerray.com,https://www.jtylerray.com";
  });

  describe("corsHeaders", () => {
    it("echoes an allowed origin", () => {
      const headers = corsHeaders("https://jtylerray.com");
      expect(headers["Access-Control-Allow-Origin"]).toBe("https://jtylerray.com");
      expect(headers["Vary"]).toBe("Origin");
    });

    it("echoes the app origin", () => {
      expect(corsHeaders("https://yoom.vercel.app")["Access-Control-Allow-Origin"]).toBe(
        "https://yoom.vercel.app",
      );
    });

    it("omits the allow-origin header for a foreign origin", () => {
      const headers = corsHeaders("https://evil.example");
      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
      expect(headers["Vary"]).toBe("Origin");
    });

    it("omits the allow-origin header when there is no Origin", () => {
      expect(corsHeaders(null)["Access-Control-Allow-Origin"]).toBeUndefined();
    });

    it("advertises the methods and headers the view routes need", () => {
      const headers = corsHeaders("https://jtylerray.com");
      expect(headers["Access-Control-Allow-Methods"]).toBe("GET, HEAD, POST, OPTIONS");
      expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type, Range");
      expect(headers["Access-Control-Expose-Headers"]).toBe(
        "Content-Range, Content-Length, Accept-Ranges, ETag",
      );
    });
  });

  describe("preflight", () => {
    it("returns 204 with CORS headers", () => {
      const res = preflight(
        new Request("https://yoom.vercel.app/api/view/start", {
          method: "OPTIONS",
          headers: { origin: "https://jtylerray.com" },
        }),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("https://jtylerray.com");
      expect(res.headers.get("access-control-max-age")).toBe("86400");
    });
  });

  describe("withCors", () => {
    it("copies CORS headers onto an existing response", () => {
      const req = new Request("https://yoom.vercel.app/api/view/start", {
        headers: { origin: "https://jtylerray.com" },
      });
      const res = withCors(req, Response.json({ ok: true }));
      expect(res.headers.get("access-control-allow-origin")).toBe("https://jtylerray.com");
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("leaves the body intact", async () => {
      const req = new Request("https://yoom.vercel.app/api/view/start");
      const res = withCors(req, Response.json({ ok: true }));
      await expect(res.json()).resolves.toEqual({ ok: true });
    });
  });
  ```
- [ ] Run `npm test` — expect FAIL: `Failed to resolve import "@/lib/cors"`.
- [ ] Create `src/lib/cors.ts`:
  ```ts
  import { allowedOrigins, appUrl } from "@/lib/env";

  export function isAllowedOrigin(origin: string | null): boolean {
    if (!origin) return false;
    if (origin === appUrl()) return true;
    return allowedOrigins().includes(origin);
  }

  export function corsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
      "Access-Control-Expose-Headers":
        "Content-Range, Content-Length, Accept-Ranges, ETag",
    };
    if (isAllowedOrigin(origin)) {
      headers["Access-Control-Allow-Origin"] = origin as string;
    }
    return headers;
  }

  /** 204 preflight response for an OPTIONS request. */
  export function preflight(request: Request): Response {
    const headers = corsHeaders(request.headers.get("origin"));
    headers["Access-Control-Max-Age"] = "86400";
    return new Response(null, { status: 204, headers });
  }

  /** Copy CORS headers onto an existing response, preserving status and body. */
  export function withCors(request: Request, response: Response): Response {
    const headers = corsHeaders(request.headers.get("origin"));
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  }
  ```
- [ ] Run `npm test` — expect PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add CORS helpers for the public view/stream/thumb routes

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 7: `src/lib/geo.ts`

**Files:**
- Create: `src/lib/geo.ts`
- Test: `src/lib/geo.test.ts`

- [ ] Write `src/lib/geo.test.ts`:
  ```ts
  import { beforeEach, describe, expect, it } from "vitest";
  import { readViewerContext } from "@/lib/geo";

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-value-0123456789abcdef";
  });

  function req(headers: Record<string, string>): Request {
    return new Request("https://yoom.vercel.app/api/view/start", { headers });
  }

  describe("readViewerContext", () => {
    it("hashes the first x-forwarded-for entry", () => {
      const a = readViewerContext(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }));
      const b = readViewerContext(req({ "x-forwarded-for": "1.2.3.4" }));
      expect(a.ipHash).toBe(b.ipHash);
      expect(a.ipHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces different hashes for different IPs", () => {
      const a = readViewerContext(req({ "x-forwarded-for": "1.2.3.4" }));
      const b = readViewerContext(req({ "x-forwarded-for": "5.6.7.8" }));
      expect(a.ipHash).not.toBe(b.ipHash);
    });

    it("salts with SESSION_SECRET", () => {
      const a = readViewerContext(req({ "x-forwarded-for": "1.2.3.4" }));
      process.env.SESSION_SECRET = "another-secret-entirely-000000000";
      const b = readViewerContext(req({ "x-forwarded-for": "1.2.3.4" }));
      expect(a.ipHash).not.toBe(b.ipHash);
    });

    it("returns null ipHash when there is no forwarded IP", () => {
      expect(readViewerContext(req({})).ipHash).toBeNull();
    });

    it("reads user agent and Vercel geo headers", () => {
      const ctx = readViewerContext(
        req({
          "user-agent": "Mozilla/5.0 (Macintosh)",
          "x-vercel-ip-country": "US",
          "x-vercel-ip-city": "Salt%20Lake%20City",
        }),
      );
      expect(ctx.userAgent).toBe("Mozilla/5.0 (Macintosh)");
      expect(ctx.country).toBe("US");
      expect(ctx.city).toBe("Salt Lake City");
    });

    it("returns nulls for absent geo headers", () => {
      const ctx = readViewerContext(req({}));
      expect(ctx.userAgent).toBeNull();
      expect(ctx.country).toBeNull();
      expect(ctx.city).toBeNull();
    });

    it("falls back to x-real-ip", () => {
      expect(readViewerContext(req({ "x-real-ip": "9.9.9.9" })).ipHash).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });
  });
  ```
- [ ] Run `npm test` — expect FAIL: `Failed to resolve import "@/lib/geo"`.
- [ ] Create `src/lib/geo.ts`:
  ```ts
  import { createHash } from "node:crypto";
  import { env } from "@/lib/env";

  export type ViewerContext = {
    ipHash: string | null;
    userAgent: string | null;
    country: string | null;
    city: string | null;
  };

  function decode(value: string | null): string | null {
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  export function readViewerContext(request: Request): ViewerContext {
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded
      ? forwarded.split(",")[0]?.trim() || null
      : request.headers.get("x-real-ip");

    const ipHash = ip
      ? createHash("sha256").update(`${env("SESSION_SECRET")}:${ip}`).digest("hex")
      : null;

    return {
      ipHash,
      userAgent: request.headers.get("user-agent"),
      country: decode(request.headers.get("x-vercel-ip-country")),
      city: decode(request.headers.get("x-vercel-ip-city")),
    };
  }
  ```
- [ ] Run `npm test` — expect PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add viewer context extraction with salted IP hashing

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 8: `src/lib/range.ts` — `clampRange`

**Files:**
- Create: `src/lib/range.ts`
- Test: `src/lib/range.test.ts`

- [ ] Write `src/lib/range.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { RANGE_WINDOW_BYTES, clampRange } from "@/lib/range";

  const MB = 1024 * 1024;

  describe("RANGE_WINDOW_BYTES", () => {
    it("is 32 MiB", () => {
      expect(RANGE_WINDOW_BYTES).toBe(32 * MB);
    });
  });

  describe("clampRange", () => {
    it("returns null when there is no Range header", () => {
      expect(clampRange(null, 1000, RANGE_WINDOW_BYTES)).toBeNull();
    });

    it("returns null for a non-bytes unit", () => {
      expect(clampRange("items=0-10", 1000, RANGE_WINDOW_BYTES)).toBeNull();
    });

    it("returns null for a malformed header", () => {
      expect(clampRange("bytes=", 1000, RANGE_WINDOW_BYTES)).toBeNull();
      expect(clampRange("bytes=abc-def", 1000, RANGE_WINDOW_BYTES)).toBeNull();
    });

    it("parses a closed range", () => {
      expect(clampRange("bytes=0-1023", 10_000, RANGE_WINDOW_BYTES)).toEqual({
        start: 0,
        end: 1023,
      });
    });

    it("clamps a closed range to the last byte", () => {
      expect(clampRange("bytes=0-999999", 500, RANGE_WINDOW_BYTES)).toEqual({
        start: 0,
        end: 499,
      });
    });

    it("clamps an open-ended range to the window", () => {
      expect(clampRange("bytes=0-", 100 * MB, RANGE_WINDOW_BYTES)).toEqual({
        start: 0,
        end: 32 * MB - 1,
      });
    });

    it("does not pad a small open-ended range past the file", () => {
      expect(clampRange("bytes=0-", 1000, RANGE_WINDOW_BYTES)).toEqual({
        start: 0,
        end: 999,
      });
    });

    it("clamps a wide closed range to the window", () => {
      expect(clampRange("bytes=0-99999999", 100 * MB, RANGE_WINDOW_BYTES)).toEqual({
        start: 0,
        end: 32 * MB - 1,
      });
    });

    it("handles a suffix range", () => {
      expect(clampRange("bytes=-500", 10_000, RANGE_WINDOW_BYTES)).toEqual({
        start: 9500,
        end: 9999,
      });
    });

    it("clamps an oversized suffix range to the whole file", () => {
      expect(clampRange("bytes=-99999", 1000, RANGE_WINDOW_BYTES)).toEqual({
        start: 0,
        end: 999,
      });
    });

    it("returns unsatisfiable for a start past the end of the file", () => {
      expect(clampRange("bytes=5000-", 1000, RANGE_WINDOW_BYTES)).toEqual({
        unsatisfiable: true,
      });
    });

    it("returns unsatisfiable when start is greater than end", () => {
      expect(clampRange("bytes=800-100", 1000, RANGE_WINDOW_BYTES)).toEqual({
        unsatisfiable: true,
      });
    });

    it("returns null for a zero-size file", () => {
      expect(clampRange("bytes=0-", 0, RANGE_WINDOW_BYTES)).toBeNull();
    });
  });
  ```
- [ ] Run `npm test` — expect FAIL: `Failed to resolve import "@/lib/range"`.
- [ ] Create `src/lib/range.ts`:
  ```ts
  /** One stream invocation never serves more than this many bytes. */
  export const RANGE_WINDOW_BYTES = 32 * 1024 * 1024;

  export type ClampedRange =
    | { start: number; end: number }
    | { unsatisfiable: true };

  /**
   * Parse a single-range `Range` header and clamp it to the file size and to a
   * maximum window. Returns null when the header is absent or unparseable, in
   * which case the caller should serve the whole file (200).
   */
  export function clampRange(
    rangeHeader: string | null | undefined,
    size: number,
    windowBytes: number,
  ): ClampedRange | null {
    if (!rangeHeader || size <= 0) return null;

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) return null;

    const [, rawStart, rawEnd] = match;
    if (rawStart === "" && rawEnd === "") return null;

    let start: number;
    let end: number;

    if (rawStart === "") {
      // Suffix range: last N bytes.
      const suffix = Number(rawEnd);
      if (!Number.isFinite(suffix) || suffix <= 0) return null;
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(rawStart);
      end = rawEnd === "" ? size - 1 : Number(rawEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      if (start >= size) return { unsatisfiable: true };
      if (end < start) return { unsatisfiable: true };
      end = Math.min(end, size - 1);
    }

    // Never serve more than the window in a single invocation.
    end = Math.min(end, start + windowBytes - 1);
    return { start, end };
  }
  ```
- [ ] Run `npm test` — expect PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add Range parsing clamped to a 32 MiB window

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 9: Supabase migration and client

**Files:**
- Create: `supabase/migrations/20260901000000_init.sql`
- Create: `src/lib/supabase.ts`

- [ ] Create `supabase/migrations/20260901000000_init.sql` with exactly this content:
  ```sql
  -- Phase 1 schema for Yoom.
  -- RLS is enabled with no policies on every table: only the service role can read
  -- or write, which is the only key the server holds.

  create extension if not exists pgcrypto;

  -- videos ---------------------------------------------------------------------
  create table if not exists public.videos (
    id uuid primary key default gen_random_uuid(),
    slug text unique not null,
    title text not null default 'Untitled recording',
    description text,
    drive_file_id text unique not null,
    mime text not null default 'video/webm',
    size_bytes bigint,
    duration_ms int,
    width int,
    height int,
    thumbnail_drive_file_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
  );

  create index if not exists videos_created_at_idx
    on public.videos (created_at desc);

  alter table public.videos enable row level security;

  -- slug_history ---------------------------------------------------------------
  create table if not exists public.slug_history (
    old_slug text primary key,
    video_id uuid not null references public.videos (id) on delete cascade,
    created_at timestamptz not null default now()
  );

  create index if not exists slug_history_video_id_idx
    on public.slug_history (video_id);

  alter table public.slug_history enable row level security;

  -- view_sessions --------------------------------------------------------------
  create table if not exists public.view_sessions (
    id uuid primary key default gen_random_uuid(),
    video_id uuid not null references public.videos (id) on delete cascade,
    viewer_name text,
    ip_hash text,
    user_agent text,
    country text,
    city text,
    started_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    max_percent smallint not null default 0
      check (max_percent >= 0 and max_percent <= 100),
    ended_at timestamptz,
    alert_sent_at timestamptz,
    summary_sent_at timestamptz,
    milestones jsonb not null default '{}'::jsonb
  );

  create index if not exists view_sessions_video_started_idx
    on public.view_sessions (video_id, started_at desc);

  alter table public.view_sessions enable row level security;

  -- settings (single row) ------------------------------------------------------
  create table if not exists public.settings (
    id int primary key default 1 check (id = 1),
    alert_on_first_view boolean not null default true,
    alert_on_completion boolean not null default true,
    updated_at timestamptz not null default now()
  );

  insert into public.settings (id) values (1)
    on conflict (id) do nothing;

  alter table public.settings enable row level security;

  -- progress update ------------------------------------------------------------
  -- Monotonic max_percent, touch last_seen_at, optionally close the session.
  -- Returns NULL (not an all-null row) when the session does not exist.
  create or replace function public.update_view_progress(
    p_session_id uuid,
    p_percent smallint,
    p_ended boolean
  )
  returns public.view_sessions
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    result public.view_sessions;
  begin
    update public.view_sessions
       set max_percent = greatest(
             max_percent,
             least(100, greatest(0, coalesce(p_percent, 0)))
           ),
           last_seen_at = now(),
           ended_at = case
             when p_ended then coalesce(ended_at, now())
             else ended_at
           end
     where id = p_session_id
     returning * into result;

    if not found then
      return null;
    end if;

    return result;
  end;
  $$;

  -- slug change (Phase 3 uses this; created now so there is one migration) -----
  -- Records the old slug in slug_history and swaps the slug in one transaction.
  create or replace function public.change_video_slug(
    p_video_id uuid,
    p_new_slug text
  )
  returns public.videos
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    old_slug text;
    result public.videos;
  begin
    select slug into old_slug from public.videos where id = p_video_id;
    if old_slug is null then
      return null;
    end if;
    if old_slug = p_new_slug then
      select * into result from public.videos where id = p_video_id;
      return result;
    end if;

    insert into public.slug_history (old_slug, video_id)
    values (old_slug, p_video_id)
    on conflict (old_slug) do update set video_id = excluded.video_id;

    -- If the new slug was a previous slug of this or another video, free it.
    delete from public.slug_history where old_slug = p_new_slug;

    update public.videos
       set slug = p_new_slug, updated_at = now()
     where id = p_video_id
     returning * into result;

    return result;
  end;
  $$;

  -- per-video aggregates (Phase 3 library/detail pages) ------------------------
  create or replace view public.video_stats as
  select
    v.id as video_id,
    count(s.id)::int as view_count,
    count(distinct coalesce(s.viewer_name, s.ip_hash, s.id::text))::int as unique_viewers,
    coalesce(avg(s.max_percent), 0)::numeric(5,2) as avg_max_percent,
    max(s.last_seen_at) as last_viewed_at
  from public.videos v
  left join public.view_sessions s on s.video_id = v.id
  group by v.id;
  ```
- [ ] Apply it: `supabase db push` (or run the file through the Supabase SQL editor / MCP). Verify with `select * from public.settings;` → one row `(1, true, true, …)`.
- [ ] Create `src/lib/supabase.ts`:
  ```ts
  import "server-only";
  import { createClient, type SupabaseClient } from "@supabase/supabase-js";
  import { env } from "@/lib/env";

  let client: SupabaseClient | null = null;

  /** Service-role Supabase client. Server-only; bypasses RLS by design. */
  export function getSupabase(): SupabaseClient {
    if (client) return client;
    client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return client;
  }
  ```
- [ ] Run `npm test` — expect PASS (unchanged count; no new tests).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add Phase 1 Supabase schema and service-role client

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 10: `src/lib/db.ts`

**Files:**
- Create: `src/lib/db.ts`
- Test: `src/lib/db.test.ts`

- [ ] Write `src/lib/db.test.ts`:
  ```ts
  import { beforeEach, describe, expect, it, vi } from "vitest";

  const from = vi.fn();
  const rpc = vi.fn();

  vi.mock("@/lib/supabase", () => ({
    getSupabase: () => ({ from, rpc }),
  }));

  import {
    claimAlert,
    createViewSession,
    getSettings,
    getVideoById,
    getVideoBySlug,
    getVideoIdByOldSlug,
    getViewSession,
    insertVideo,
    setVideoThumbnail,
    updateViewSession,
  } from "@/lib/db";

  type AnyRecord = Record<string, unknown>;

  /** A chainable Supabase query-builder stub that resolves to `result`. */
  function chain(result: AnyRecord) {
    const calls: Record<string, unknown[][]> = {};
    const builder: AnyRecord = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "eq",
      "is",
      "order",
      "limit",
    ]) {
      builder[method] = vi.fn((...args: unknown[]) => {
        (calls[method] ??= []).push(args);
        return builder;
      });
    }
    builder.single = vi.fn(async () => result);
    builder.maybeSingle = vi.fn(async () => result);
    builder.then = (resolve: (value: AnyRecord) => unknown) => resolve(result);
    builder.__calls = calls;
    return builder;
  }

  const VIDEO = {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "abc12345",
    title: "Demo",
    description: null,
    drive_file_id: "drive-1",
    mime: "video/webm",
    size_bytes: 100,
    duration_ms: 5000,
    width: 1280,
    height: 720,
    thumbnail_drive_file_id: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    deleted_at: null,
  };

  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
  });

  describe("getVideoBySlug", () => {
    it("selects a live video by slug", async () => {
      const builder = chain({ data: VIDEO, error: null });
      from.mockReturnValue(builder);

      await expect(getVideoBySlug("abc12345")).resolves.toEqual(VIDEO);
      expect(from).toHaveBeenCalledWith("videos");
      expect(builder.eq).toHaveBeenCalledWith("slug", "abc12345");
      expect(builder.is).toHaveBeenCalledWith("deleted_at", null);
    });

    it("returns null when absent", async () => {
      from.mockReturnValue(chain({ data: null, error: null }));
      await expect(getVideoBySlug("nope")).resolves.toBeNull();
    });

    it("throws on a database error", async () => {
      from.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
      await expect(getVideoBySlug("abc12345")).rejects.toThrow("boom");
    });
  });

  describe("getVideoById", () => {
    it("selects by id", async () => {
      const builder = chain({ data: VIDEO, error: null });
      from.mockReturnValue(builder);
      await expect(getVideoById(VIDEO.id)).resolves.toEqual(VIDEO);
      expect(builder.eq).toHaveBeenCalledWith("id", VIDEO.id);
    });
  });

  describe("getVideoIdByOldSlug", () => {
    it("returns the mapped video id", async () => {
      const builder = chain({ data: { video_id: VIDEO.id }, error: null });
      from.mockReturnValue(builder);
      await expect(getVideoIdByOldSlug("old-slug")).resolves.toBe(VIDEO.id);
      expect(from).toHaveBeenCalledWith("slug_history");
      expect(builder.eq).toHaveBeenCalledWith("old_slug", "old-slug");
    });

    it("returns null when there is no history row", async () => {
      from.mockReturnValue(chain({ data: null, error: null }));
      await expect(getVideoIdByOldSlug("old-slug")).resolves.toBeNull();
    });
  });

  describe("insertVideo", () => {
    it("inserts and returns the row", async () => {
      const builder = chain({ data: VIDEO, error: null });
      from.mockReturnValue(builder);

      await expect(
        insertVideo({
          slug: "abc12345",
          title: "Demo",
          drive_file_id: "drive-1",
          mime: "video/webm",
          size_bytes: 100,
          duration_ms: 5000,
          width: 1280,
          height: 720,
        }),
      ).resolves.toEqual(VIDEO);
      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "abc12345", drive_file_id: "drive-1" }),
      );
    });

    it("reports a unique violation as a typed error code", async () => {
      from.mockReturnValue(
        chain({ data: null, error: { code: "23505", message: "duplicate key" } }),
      );
      await expect(
        insertVideo({
          slug: "abc12345",
          title: "Demo",
          drive_file_id: "drive-1",
          mime: "video/webm",
          size_bytes: null,
          duration_ms: null,
          width: null,
          height: null,
        }),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  describe("createViewSession", () => {
    it("inserts a view session and returns its id", async () => {
      const builder = chain({ data: { id: "session-1" }, error: null });
      from.mockReturnValue(builder);

      await expect(
        createViewSession({
          video_id: VIDEO.id,
          viewer_name: "Ada",
          ip_hash: "hash",
          user_agent: "UA",
          country: "US",
          city: "SLC",
        }),
      ).resolves.toBe("session-1");
      expect(from).toHaveBeenCalledWith("view_sessions");
    });
  });

  describe("updateViewSession", () => {
    it("calls the update_view_progress RPC", async () => {
      rpc.mockResolvedValue({
        data: { ...VIDEO, id: "session-1", max_percent: 55 },
        error: null,
      });
      const row = await updateViewSession("session-1", 55, false);
      expect(rpc).toHaveBeenCalledWith("update_view_progress", {
        p_session_id: "session-1",
        p_percent: 55,
        p_ended: false,
      });
      expect(row?.max_percent).toBe(55);
    });

    it("returns null when the session is gone", async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      await expect(updateViewSession("nope", 10, false)).resolves.toBeNull();
    });

    it("treats an all-null composite row as absent", async () => {
      rpc.mockResolvedValue({ data: { id: null, video_id: null }, error: null });
      await expect(updateViewSession("nope", 10, false)).resolves.toBeNull();
    });
  });

  describe("getViewSession", () => {
    it("selects a session by id", async () => {
      const builder = chain({ data: { id: "session-1", video_id: VIDEO.id }, error: null });
      from.mockReturnValue(builder);
      const row = await getViewSession("session-1");
      expect(from).toHaveBeenCalledWith("view_sessions");
      expect(builder.eq).toHaveBeenCalledWith("id", "session-1");
      expect(row?.id).toBe("session-1");
    });

    it("returns null when absent", async () => {
      from.mockReturnValue(chain({ data: null, error: null }));
      await expect(getViewSession("nope")).resolves.toBeNull();
    });
  });

  describe("claimAlert", () => {
    it("returns true when a row was claimed", async () => {
      const builder = chain({ data: [{ id: "session-1" }], error: null });
      from.mockReturnValue(builder);

      await expect(claimAlert("session-1", "alert_sent_at")).resolves.toBe(true);
      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ alert_sent_at: expect.any(String) }),
      );
      expect(builder.is).toHaveBeenCalledWith("alert_sent_at", null);
    });

    it("returns false when the alert was already claimed", async () => {
      from.mockReturnValue(chain({ data: [], error: null }));
      await expect(claimAlert("session-1", "summary_sent_at")).resolves.toBe(false);
    });

    it("returns false on error rather than throwing", async () => {
      from.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
      await expect(claimAlert("session-1", "alert_sent_at")).resolves.toBe(false);
    });
  });

  describe("setVideoThumbnail", () => {
    it("updates the thumbnail column", async () => {
      const builder = chain({ data: null, error: null });
      from.mockReturnValue(builder);
      await setVideoThumbnail(VIDEO.id, "thumb-1");
      expect(builder.update).toHaveBeenCalledWith({
        thumbnail_drive_file_id: "thumb-1",
      });
      expect(builder.eq).toHaveBeenCalledWith("id", VIDEO.id);
    });
  });

  describe("getSettings", () => {
    it("returns the single settings row", async () => {
      const builder = chain({
        data: {
          id: 1,
          alert_on_first_view: true,
          alert_on_completion: false,
          updated_at: "2026-09-01T00:00:00Z",
        },
        error: null,
      });
      from.mockReturnValue(builder);
      const settings = await getSettings();
      expect(settings.alert_on_completion).toBe(false);
      expect(builder.eq).toHaveBeenCalledWith("id", 1);
    });

    it("defaults both alerts to on when the row is missing", async () => {
      from.mockReturnValue(chain({ data: null, error: null }));
      const settings = await getSettings();
      expect(settings).toEqual({
        id: 1,
        alert_on_first_view: true,
        alert_on_completion: true,
        updated_at: null,
      });
    });
  });
  ```
- [ ] Run `npm test` — expect FAIL: `Failed to resolve import "@/lib/db"`.
- [ ] Create `src/lib/db.ts`:
  ```ts
  import { getSupabase } from "@/lib/supabase";

  export type Video = {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    drive_file_id: string;
    mime: string;
    size_bytes: number | null;
    duration_ms: number | null;
    width: number | null;
    height: number | null;
    thumbnail_drive_file_id: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };

  export type ViewSession = {
    id: string;
    video_id: string;
    viewer_name: string | null;
    ip_hash: string | null;
    user_agent: string | null;
    country: string | null;
    city: string | null;
    started_at: string;
    last_seen_at: string;
    max_percent: number;
    ended_at: string | null;
    alert_sent_at: string | null;
    summary_sent_at: string | null;
    milestones: Record<string, unknown>;
  };

  export type Settings = {
    id: number;
    alert_on_first_view: boolean;
    alert_on_completion: boolean;
    updated_at: string | null;
  };

  export type NewVideo = {
    slug: string;
    title: string;
    drive_file_id: string;
    mime: string;
    size_bytes: number | null;
    duration_ms: number | null;
    width: number | null;
    height: number | null;
  };

  export type NewViewSession = {
    video_id: string;
    viewer_name: string | null;
    ip_hash: string | null;
    user_agent: string | null;
    country: string | null;
    city: string | null;
  };

  export type AlertColumn = "alert_sent_at" | "summary_sent_at";

  export class DbError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.name = "DbError";
      this.code = code;
    }
  }

  /** Postgres unique-violation code, used to retry slug generation. */
  export const UNIQUE_VIOLATION = "23505";

  type QueryResult<T> = { data: T; error: { message: string; code?: string } | null };

  function unwrap<T>(result: QueryResult<T>): T {
    if (result.error) throw new DbError(result.error.message, result.error.code);
    return result.data;
  }

  export async function getVideoBySlug(slug: string): Promise<Video | null> {
    const result = (await getSupabase()
      .from("videos")
      .select("*")
      .eq("slug", slug)
      .is("deleted_at", null)
      .maybeSingle()) as QueryResult<Video | null>;
    return unwrap(result);
  }

  export async function getVideoById(id: string): Promise<Video | null> {
    const result = (await getSupabase()
      .from("videos")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()) as QueryResult<Video | null>;
    return unwrap(result);
  }

  export async function getVideoIdByOldSlug(oldSlug: string): Promise<string | null> {
    const result = (await getSupabase()
      .from("slug_history")
      .select("video_id")
      .eq("old_slug", oldSlug)
      .maybeSingle()) as QueryResult<{ video_id: string } | null>;
    const row = unwrap(result);
    return row ? row.video_id : null;
  }

  export async function insertVideo(input: NewVideo): Promise<Video> {
    const result = (await getSupabase()
      .from("videos")
      .insert({
        slug: input.slug,
        title: input.title,
        drive_file_id: input.drive_file_id,
        mime: input.mime,
        size_bytes: input.size_bytes,
        duration_ms: input.duration_ms,
        width: input.width,
        height: input.height,
      })
      .select("*")
      .single()) as QueryResult<Video>;
    return unwrap(result);
  }

  export async function setVideoThumbnail(
    videoId: string,
    thumbnailDriveFileId: string,
  ): Promise<void> {
    const result = (await getSupabase()
      .from("videos")
      .update({ thumbnail_drive_file_id: thumbnailDriveFileId })
      .eq("id", videoId)) as QueryResult<unknown>;
    unwrap(result);
  }

  export async function createViewSession(input: NewViewSession): Promise<string> {
    const result = (await getSupabase()
      .from("view_sessions")
      .insert(input)
      .select("id")
      .single()) as QueryResult<{ id: string }>;
    return unwrap(result).id;
  }

  export async function getViewSession(sessionId: string): Promise<ViewSession | null> {
    const result = (await getSupabase()
      .from("view_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle()) as QueryResult<ViewSession | null>;
    return unwrap(result);
  }

  export async function updateViewSession(
    sessionId: string,
    percent: number,
    ended: boolean,
  ): Promise<ViewSession | null> {
    const result = (await getSupabase().rpc("update_view_progress", {
      p_session_id: sessionId,
      p_percent: percent,
      p_ended: ended,
    })) as QueryResult<ViewSession | null>;
    const row = unwrap(result);
    // PostgREST can surface a missing composite as an all-null row; treat it as absent.
    return row && row.id ? row : null;
  }

  /**
   * Atomically claim the right to send one alert for a view session.
   * `update … where <column> is null returning id` — a second caller gets zero
   * rows back and therefore false, which is the email debounce.
   */
  export async function claimAlert(
    sessionId: string,
    column: AlertColumn,
  ): Promise<boolean> {
    const result = (await getSupabase()
      .from("view_sessions")
      .update({ [column]: new Date().toISOString() })
      .eq("id", sessionId)
      .is(column, null)
      .select("id")) as QueryResult<{ id: string }[] | null>;
    if (result.error) return false;
    return Array.isArray(result.data) && result.data.length > 0;
  }

  export async function getSettings(): Promise<Settings> {
    const result = (await getSupabase()
      .from("settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle()) as QueryResult<Settings | null>;
    const row = unwrap(result);
    return (
      row ?? {
        id: 1,
        alert_on_first_view: true,
        alert_on_completion: true,
        updated_at: null,
      }
    );
  }
  ```
- [ ] Run `npm test` — expect PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add typed Supabase data access with atomic claimAlert

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 11: `src/lib/share.ts` and `src/lib/alerts.ts`

**Files:**
- Create: `src/lib/share.ts`
- Create: `src/lib/alerts.ts`
- Test: `src/lib/alerts.test.ts`

- [ ] Write `src/lib/alerts.test.ts`:
  ```ts
  import { beforeEach, describe, expect, it } from "vitest";
  import type { Video, ViewSession } from "@/lib/db";
  import {
    deviceFromUserAgent,
    locationLabel,
    renderFirstPlayEmail,
    renderSummaryEmail,
  } from "@/lib/alerts";

  const video: Video = {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "abc12345",
    title: "Q3 walkthrough",
    description: null,
    drive_file_id: "drive-1",
    mime: "video/webm",
    size_bytes: 1000,
    duration_ms: 60_000,
    width: 1280,
    height: 720,
    thumbnail_drive_file_id: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    deleted_at: null,
  };

  const session: ViewSession = {
    id: "22222222-2222-2222-2222-222222222222",
    video_id: video.id,
    viewer_name: "Ada",
    ip_hash: "hash",
    user_agent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    country: "US",
    city: "Salt Lake City",
    started_at: "2026-09-01T12:00:00Z",
    last_seen_at: "2026-09-01T12:00:30Z",
    max_percent: 64,
    ended_at: null,
    alert_sent_at: null,
    summary_sent_at: null,
    milestones: {},
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SHARE_BASE_URL = "https://jtylerray.com";
  });

  describe("deviceFromUserAgent", () => {
    it("recognises a Mac desktop", () => {
      expect(deviceFromUserAgent(session.user_agent)).toBe("Mac · Chrome");
    });

    it("recognises an iPhone", () => {
      expect(
        deviceFromUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1",
        ),
      ).toBe("iPhone · Safari");
    });

    it("falls back to Unknown device", () => {
      expect(deviceFromUserAgent(null)).toBe("Unknown device");
    });
  });

  describe("locationLabel", () => {
    it("joins city and country", () => {
      expect(locationLabel(session)).toBe("Salt Lake City, US");
    });

    it("uses the country alone", () => {
      expect(locationLabel({ ...session, city: null })).toBe("US");
    });

    it("falls back when there is no geo", () => {
      expect(locationLabel({ ...session, city: null, country: null })).toBe(
        "Unknown location",
      );
    });
  });

  describe("renderFirstPlayEmail", () => {
    it("names the viewer in the subject", () => {
      const { subject } = renderFirstPlayEmail(session, video);
      expect(subject).toBe("▶ Ada started watching Q3 walkthrough");
    });

    it("says Someone when the viewer is anonymous", () => {
      const { subject } = renderFirstPlayEmail(
        { ...session, viewer_name: null },
        video,
      );
      expect(subject).toBe("▶ Someone started watching Q3 walkthrough");
    });

    it("includes location, device and the share link", () => {
      const { html, text } = renderFirstPlayEmail(session, video);
      expect(html).toContain("Salt Lake City, US");
      expect(html).toContain("Mac · Chrome");
      expect(html).toContain("https://jtylerray.com/v/abc12345");
      expect(text).toContain("https://jtylerray.com/v/abc12345");
    });

    it("escapes HTML in untrusted fields", () => {
      const { html } = renderFirstPlayEmail(
        { ...session, viewer_name: "<script>x</script>" },
        video,
      );
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("renderSummaryEmail", () => {
    it("reports the watched percentage in the subject", () => {
      const { subject } = renderSummaryEmail({ ...session, max_percent: 100 }, video);
      expect(subject).toBe("✅ Ada watched 100% of Q3 walkthrough");
    });

    it("includes the watched percentage in the body", () => {
      const { html, text } = renderSummaryEmail(session, video);
      expect(html).toContain("64%");
      expect(text).toContain("64%");
    });
  });
  ```
- [ ] Run `npm test` — expect FAIL: `Failed to resolve import "@/lib/alerts"`.
- [ ] Create `src/lib/share.ts`:
  ```ts
  import { shareBaseUrl } from "@/lib/env";

  /** Public share URL for a slug, e.g. https://jtylerray.com/v/abc12345 */
  export function shareUrl(slug: string): string {
    return `${shareBaseUrl()}/v/${slug}`;
  }
  ```
- [ ] Create `src/lib/alerts.ts`:
  ```ts
  import { Resend } from "resend";
  import { env, optionalEnv } from "@/lib/env";
  import { getSettings, type Video, type ViewSession } from "@/lib/db";
  import { shareUrl } from "@/lib/share";

  export type RenderedEmail = {
    subject: string;
    html: string;
    text: string;
  };

  export function escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  export function deviceFromUserAgent(userAgent: string | null): string {
    if (!userAgent) return "Unknown device";

    let platform = "Unknown device";
    if (/iPhone/i.test(userAgent)) platform = "iPhone";
    else if (/iPad/i.test(userAgent)) platform = "iPad";
    else if (/Android/i.test(userAgent)) platform = "Android";
    else if (/Macintosh|Mac OS X/i.test(userAgent)) platform = "Mac";
    else if (/Windows/i.test(userAgent)) platform = "Windows";
    else if (/Linux/i.test(userAgent)) platform = "Linux";

    let browser = "";
    if (/Edg\//i.test(userAgent)) browser = "Edge";
    else if (/OPR\//i.test(userAgent)) browser = "Opera";
    else if (/Chrome\//i.test(userAgent)) browser = "Chrome";
    else if (/Firefox\//i.test(userAgent)) browser = "Firefox";
    else if (/Safari\//i.test(userAgent)) browser = "Safari";

    if (platform === "Unknown device") return "Unknown device";
    return browser ? `${platform} · ${browser}` : platform;
  }

  export function locationLabel(session: ViewSession): string {
    if (session.city && session.country) return `${session.city}, ${session.country}`;
    if (session.country) return session.country;
    if (session.city) return session.city;
    return "Unknown location";
  }

  export function viewerLabel(session: ViewSession): string {
    return session.viewer_name?.trim() || "Someone";
  }

  function layout(headline: string, rows: [string, string][], link: string): string {
    const cells = rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#8b8b96;font-size:13px;">${escapeHtml(
            label,
          )}</td><td style="padding:4px 0;color:#f0f0f2;font-size:13px;">${escapeHtml(
            value,
          )}</td></tr>`,
      )
      .join("");

    return [
      `<div style="background:#1a1a1e;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">`,
      `<h1 style="margin:0 0 16px;color:#f0f0f2;font-size:18px;font-weight:600;">${escapeHtml(
        headline,
      )}</h1>`,
      `<table style="border-collapse:collapse;margin-bottom:20px;">${cells}</table>`,
      `<a href="${escapeHtml(link)}" style="display:inline-block;background:#e85a4f;color:#ffffff;`,
      `text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">Open the recording</a>`,
      `<p style="margin:16px 0 0;color:#5c5c66;font-size:12px;">${escapeHtml(link)}</p>`,
      `</div>`,
    ].join("");
  }

  function plain(headline: string, rows: [string, string][], link: string): string {
    return [headline, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", link].join("\n");
  }

  export function renderFirstPlayEmail(
    session: ViewSession,
    video: Video,
  ): RenderedEmail {
    const link = shareUrl(video.slug);
    const headline = `${viewerLabel(session)} started watching ${video.title}`;
    const rows: [string, string][] = [
      ["Viewer", viewerLabel(session)],
      ["Location", locationLabel(session)],
      ["Device", deviceFromUserAgent(session.user_agent)],
      ["Video", video.title],
    ];
    return {
      subject: `▶ ${headline}`,
      html: layout(headline, rows, link),
      text: plain(headline, rows, link),
    };
  }

  export function renderSummaryEmail(
    session: ViewSession,
    video: Video,
  ): RenderedEmail {
    const link = shareUrl(video.slug);
    const percent = Math.max(0, Math.min(100, session.max_percent));
    const headline = `${viewerLabel(session)} watched ${percent}% of ${video.title}`;
    const rows: [string, string][] = [
      ["Viewer", viewerLabel(session)],
      ["Watched", `${percent}%`],
      ["Location", locationLabel(session)],
      ["Device", deviceFromUserAgent(session.user_agent)],
      ["Video", video.title],
    ];
    return {
      subject: `✅ ${headline}`,
      html: layout(headline, rows, link),
      text: plain(headline, rows, link),
    };
  }

  let resend: Resend | null = null;

  function getResend(): Resend {
    if (!resend) resend = new Resend(env("RESEND_API_KEY"));
    return resend;
  }

  async function send(email: RenderedEmail): Promise<void> {
    if (!optionalEnv("RESEND_API_KEY")) return;
    await getResend().emails.send({
      from: env("ALERT_FROM_EMAIL"),
      to: env("ALERT_TO_EMAIL"),
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }

  export async function sendFirstPlayEmail(
    session: ViewSession,
    video: Video,
  ): Promise<void> {
    const settings = await getSettings();
    if (!settings.alert_on_first_view) return;
    await send(renderFirstPlayEmail(session, video));
  }

  export async function sendSummaryEmail(
    session: ViewSession,
    video: Video,
  ): Promise<void> {
    const settings = await getSettings();
    if (!settings.alert_on_completion) return;
    await send(renderSummaryEmail(session, video));
  }
  ```
- [ ] Run `npm test` — expect PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add share URL helper and Resend view-alert emails

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 12: `src/lib/google-drive.ts`

**Files:**
- Create: `src/lib/google-drive.ts`

Drive is exercised end-to-end in the manual verification task; the pure helpers here are thin wrappers over `fetch` and are covered by the Task 28 checklist rather than unit tests.

- [ ] Create `src/lib/google-drive.ts`:
  ```ts
  import "server-only";
  import { env } from "@/lib/env";

  const TOKEN_URL = "https://oauth2.googleapis.com/token";
  const FILES_URL = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

  export type DriveFileMeta = {
    id: string;
    name: string;
    mimeType: string;
    size: number | null;
    parents: string[];
    trashed: boolean;
  };

  export class DriveError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "DriveError";
      this.status = status;
    }
  }

  let cachedToken: { value: string; expiresAt: number } | null = null;

  /** Refresh-token grant with a 60s expiry margin, cached per server instance. */
  export async function getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

    const body = new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });

    if (!response.ok) {
      cachedToken = null;
      throw new DriveError(
        `Token refresh failed: ${await response.text()}`,
        response.status,
      );
    }

    const json = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    };
    return cachedToken.value;
  }

  /** Test seam: drop the cached access token. */
  export function resetAccessTokenCache(): void {
    cachedToken = null;
  }

  export type ResumableSessionInput = {
    name: string;
    mimeType: string;
    sizeBytes: number;
    origin: string;
  };

  /**
   * Start a resumable upload and return the session URI the browser PUTs to.
   * `Origin` must be sent so Google includes CORS headers on the session URI.
   */
  export async function createResumableSession(
    input: ResumableSessionInput,
  ): Promise<string> {
    const token = await getAccessToken();
    const response = await fetch(`${UPLOAD_URL}?uploadType=resumable&fields=id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        Origin: input.origin,
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.sizeBytes),
      },
      body: JSON.stringify({
        name: input.name,
        parents: [env("GOOGLE_DRIVE_FOLDER_ID")],
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new DriveError(
        `Failed to start resumable upload: ${await response.text()}`,
        response.status,
      );
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new DriveError("Drive did not return a resumable session URI", 502);
    }
    return location;
  }

  export async function getFileMeta(fileId: string): Promise<DriveFileMeta> {
    const token = await getAccessToken();
    const url = `${FILES_URL}/${encodeURIComponent(
      fileId,
    )}?fields=id,name,mimeType,size,parents,trashed`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new DriveError(
        `Failed to read file metadata: ${await response.text()}`,
        response.status,
      );
    }

    const json = (await response.json()) as {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      parents?: string[];
      trashed?: boolean;
    };

    return {
      id: json.id,
      name: json.name,
      mimeType: json.mimeType,
      size: json.size ? Number(json.size) : null,
      parents: json.parents ?? [],
      trashed: json.trashed ?? false,
    };
  }

  /**
   * Fetch file bytes. The upstream Response is returned untouched so the caller
   * can pipe `response.body` straight through without buffering.
   */
  export async function fetchMedia(
    fileId: string,
    range?: string,
  ): Promise<Response> {
    const token = await getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (range) headers.Range = range;

    return fetch(`${FILES_URL}/${encodeURIComponent(fileId)}?alt=media`, {
      headers,
      cache: "no-store",
    });
  }

  /** Multipart upload for small payloads such as thumbnails. */
  export async function uploadSmall(
    name: string,
    mimeType: string,
    bytes: ArrayBuffer,
  ): Promise<string> {
    const token = await getAccessToken();
    const boundary = `yoom-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({
      name,
      parents: [env("GOOGLE_DRIVE_FOLDER_ID")],
    });

    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const payload = new Uint8Array(head.length + bytes.byteLength + tail.length);
    payload.set(head, 0);
    payload.set(new Uint8Array(bytes), head.length);
    payload.set(tail, head.length + bytes.byteLength);

    const response = await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: payload,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new DriveError(
        `Thumbnail upload failed: ${await response.text()}`,
        response.status,
      );
    }

    const json = (await response.json()) as { id: string };
    return json.id;
  }

  export async function renameFile(fileId: string, name: string): Promise<void> {
    const token = await getAccessToken();
    const response = await fetch(
      `${FILES_URL}/${encodeURIComponent(fileId)}?fields=id`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      throw new DriveError(`Rename failed: ${await response.text()}`, response.status);
    }
  }

  export async function trashFile(fileId: string): Promise<void> {
    const token = await getAccessToken();
    const response = await fetch(
      `${FILES_URL}/${encodeURIComponent(fileId)}?fields=id`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trashed: true }),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      throw new DriveError(`Trash failed: ${await response.text()}`, response.status);
    }
  }
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add Google Drive REST helpers over fetch

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 13: `scripts/google-oauth.mjs`

**Files:**
- Create: `scripts/google-oauth.mjs`

- [ ] Create `scripts/google-oauth.mjs` (Node 20, zero dependencies):
  ```js
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

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#1a1a1e;color:#f0f0f2;padding:48px">` +
            `<h1 style="font-size:18px">${error ? "Authorization failed" : "Authorized"}</h1>` +
            `<p style="color:#8b8b96">You can close this tab and return to the terminal.</p></body>`,
        );

        server.close();

        if (error) return reject(new Error(`Google returned: ${error}`));
        if (returnedState !== state) return reject(new Error("State mismatch"));
        if (!code) return reject(new Error("No authorization code in the callback"));
        resolve(code);
      });

      server.on("error", reject);
      server.listen(3000, "127.0.0.1", () => {
        console.log("Listening on http://localhost:3000/oauth/callback");
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
  ```
- [ ] Make it executable: `chmod +x scripts/google-oauth.mjs`
- [ ] Run it once with Tyler's client credentials (requires the Google Cloud OAuth client from "What Tyler must provide"): `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/google-oauth.mjs` — expect four printed env lines and a new "Yoom" folder in Drive. Paste them into `.env.local`.
- [ ] Run `npm test` — expect PASS (unchanged count; `*.mjs` is outside `src/**/*.test.ts`).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add one-shot Google OAuth setup script

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 14: Cookie-based auth route

**Files:**
- Modify: `src/app/api/auth/route.ts` (whole file, lines 1-25)
- Modify: `src/components/password-gate.tsx` (lines 1-32)

- [ ] Replace `src/app/api/auth/route.ts` with:
  ```ts
  import { NextResponse } from "next/server";
  import { timingSafeEqual } from "node:crypto";
  import { cookies } from "next/headers";
  import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

  function passwordMatches(input: string, expected: string): boolean {
    const a = Buffer.from(input);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  export async function POST(request: Request) {
    let body: { password?: string };
    try {
      body = (await request.json()) as { password?: string };
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const expected = process.env.UPLOAD_PASSWORD;
    if (!body.password || !expected || !passwordMatches(body.password, expected)) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, signSession(), sessionCookieOptions());

    return NextResponse.json({ success: true });
  }

  export async function DELETE() {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
    return NextResponse.json({ success: true });
  }
  ```
- [ ] Replace the props and submit handler in `src/components/password-gate.tsx` (lines 1-32) with:
  ```tsx
  "use client";

  import { useState } from "react";
  import { useRouter } from "next/navigation";
  import { YoomLogo } from "./logo";

  export function PasswordGate() {
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault();
      setLoading(true);
      setError("");

      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.refresh();
      } else {
        setError("Invalid password");
        setLoading(false);
      }
    }
  ```
  Leave the returned JSX (the `<div className="flex min-h-screen …">` block onward) exactly as it is — the styling and `YoomLogo` usage do not change.
- [ ] Update `src/app/page.tsx` so it still compiles with the new prop-less gate — temporarily:
  ```tsx
  "use client";

  import { useState } from "react";
  import { PasswordGate } from "@/components/password-gate";
  import { Recorder } from "@/components/recorder";

  export default function Home() {
    const [authed] = useState(false);

    if (!authed) {
      return <PasswordGate />;
    }

    return <Recorder password="" />;
  }
  ```
  (Task 18 replaces this file with the server component; this keeps the tree compiling in between.)
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS.
- [ ] Manual check: `npm run dev`, submit the wrong password → "Invalid password"; submit `UPLOAD_PASSWORD` → DevTools › Application › Cookies shows `yoom_session` with an `HttpOnly` flag and a `ts.sig` value.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: issue a signed yoom_session cookie on password auth

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 15: `src/proxy.ts` auth gate

**Files:**
- Create: `src/proxy.ts`

Next 16 deprecates `middleware.ts` in favour of `proxy.ts` exporting `proxy()`. The proxy only hard-rejects the owner API routes; pages decide for themselves by reading the cookie through `isOwner()` (Task 18), so there is no trust-me request header to forge or forget. Phase 3 adds `/api/videos/:path*` to the matcher.

- [ ] Create `src/proxy.ts`:
  ```ts
  import { NextResponse, type NextRequest } from "next/server";
  import { SESSION_COOKIE, verifySession } from "@/lib/session";

  export function proxy(request: NextRequest) {
    const authed = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!authed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  export const config = {
    matcher: ["/api/upload/:path*"],
  };
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS, and the build output lists `Proxy` in the route table.
- [ ] Manual check: `curl -i -X POST http://localhost:3000/api/upload` → `401 {"error":"Unauthorized"}`.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: gate app and upload routes behind the session cookie in proxy.ts

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 16: Upload routes (session, complete, thumbnail, chunk)

**Files:**
- Modify: `src/app/api/upload/route.ts` (whole file, the 501 placeholder from Task 2)
- Create: `src/app/api/upload/complete/route.ts`
- Create: `src/app/api/upload/thumbnail/route.ts`
- Create: `src/app/api/upload/chunk/route.ts`

All four sit under `/api/upload/*` and are therefore already authenticated by `proxy.ts`. No CORS here — these are same-origin only.

- [ ] Replace `src/app/api/upload/route.ts`:
  ```ts
  import { NextResponse } from "next/server";
  import { appUrl } from "@/lib/env";
  import { createResumableSession } from "@/lib/google-drive";

  const MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

  export async function POST(request: Request) {
    let body: { mimeType?: string; sizeBytes?: number; filename?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const mimeType = body.mimeType || "video/webm";
    const sizeBytes = Number(body.sizeBytes);
    const filename = body.filename?.trim() || `yoom-${Date.now()}.webm`;

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "Invalid sizeBytes" }, { status: 400 });
    }

    // In dev the browser origin is http://localhost:3000; in production it must be
    // the deployed app origin so Google echoes the right CORS headers.
    const origin =
      process.env.NODE_ENV === "production"
        ? appUrl()
        : request.headers.get("origin") || appUrl();

    try {
      const sessionUri = await createResumableSession({
        name: filename,
        mimeType,
        sizeBytes,
        origin,
      });
      return NextResponse.json({ sessionUri });
    } catch (error) {
      console.error("createResumableSession failed", error);
      return NextResponse.json(
        { error: "Could not start the upload" },
        { status: 502 },
      );
    }
  }
  ```
- [ ] Create `src/app/api/upload/complete/route.ts`:
  ```ts
  import { NextResponse } from "next/server";
  import { DbError, UNIQUE_VIOLATION, insertVideo } from "@/lib/db";
  import { getFileMeta } from "@/lib/google-drive";
  import { newSlug } from "@/lib/slug";
  import { shareUrl } from "@/lib/share";

  function defaultTitle(): string {
    return `Recording — ${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date())}`;
  }

  export async function POST(request: Request) {
    let body: {
      driveFileId?: string;
      title?: string;
      durationMs?: number;
      width?: number;
      height?: number;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const driveFileId = body.driveFileId?.trim();
    if (!driveFileId) {
      return NextResponse.json({ error: "driveFileId is required" }, { status: 400 });
    }

    let meta;
    try {
      meta = await getFileMeta(driveFileId);
    } catch (error) {
      console.error("getFileMeta failed", error);
      return NextResponse.json({ error: "Drive file not found" }, { status: 404 });
    }

    if (meta.trashed) {
      return NextResponse.json({ error: "Drive file is trashed" }, { status: 404 });
    }

    const title = body.title?.trim() || defaultTitle();
    const toInt = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    };

    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = newSlug();
      try {
        const video = await insertVideo({
          slug,
          title,
          drive_file_id: meta.id,
          mime: meta.mimeType || "video/webm",
          size_bytes: meta.size,
          duration_ms: toInt(body.durationMs),
          width: toInt(body.width),
          height: toInt(body.height),
        });
        return NextResponse.json({
          id: video.id,
          slug: video.slug,
          url: shareUrl(video.slug),
        });
      } catch (error) {
        if (error instanceof DbError && error.code === UNIQUE_VIOLATION) {
          // Either the slug collided (retry) or this Drive file is already
          // recorded (surface it as a conflict rather than looping).
          if (error.message.includes("drive_file_id")) {
            return NextResponse.json(
              { error: "This recording was already saved" },
              { status: 409 },
            );
          }
          continue;
        }
        console.error("insertVideo failed", error);
        return NextResponse.json({ error: "Could not save the recording" }, {
          status: 500,
        });
      }
    }

    return NextResponse.json({ error: "Could not allocate a slug" }, { status: 500 });
  }
  ```
- [ ] Create `src/app/api/upload/thumbnail/route.ts`:
  ```ts
  import { NextResponse } from "next/server";
  import { getVideoById, setVideoThumbnail } from "@/lib/db";
  import { uploadSmall } from "@/lib/google-drive";

  const MAX_THUMBNAIL_BYTES = 1024 * 1024;

  export async function POST(request: Request) {
    const form = await request.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Expected multipart form data" }, {
        status: 400,
      });
    }

    const videoId = String(form.get("videoId") ?? "").trim();
    const file = form.get("file");

    if (!videoId || !(file instanceof File)) {
      return NextResponse.json({ error: "videoId and file are required" }, {
        status: 400,
      });
    }
    if (file.size === 0 || file.size > MAX_THUMBNAIL_BYTES) {
      return NextResponse.json({ error: "Thumbnail must be 1 MB or less" }, {
        status: 413,
      });
    }

    const video = await getVideoById(videoId);
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    try {
      const bytes = await file.arrayBuffer();
      const thumbnailId = await uploadSmall(
        `${video.slug}-thumb.jpg`,
        "image/jpeg",
        bytes,
      );
      await setVideoThumbnail(video.id, thumbnailId);
      return NextResponse.json({ thumbnailDriveFileId: thumbnailId });
    } catch (error) {
      console.error("thumbnail upload failed", error);
      return NextResponse.json({ error: "Thumbnail upload failed" }, { status: 502 });
    }
  }
  ```
- [ ] Create `src/app/api/upload/chunk/route.ts`:
  ```ts
  import { NextResponse } from "next/server";

  // Fallback path used only when Drive refuses CORS on resumable PUTs from the
  // browser. Vercel caps request bodies at 4.5 MB, so upload-client.ts switches to
  // 4 MB chunks when it targets this route.
  export const maxDuration = 60;

  const MAX_BODY_BYTES = 4 * 1024 * 1024;

  export async function PUT(request: Request) {
    const sessionUri = request.headers.get("x-upload-session-uri");
    const contentRange = request.headers.get("x-upload-content-range");

    if (!sessionUri || !sessionUri.startsWith("https://")) {
      return NextResponse.json({ error: "Missing upload session URI" }, {
        status: 400,
      });
    }
    if (!contentRange) {
      return NextResponse.json({ error: "Missing content range" }, { status: 400 });
    }

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Chunk too large" }, { status: 413 });
    }

    const upstream = await fetch(sessionUri, {
      method: "PUT",
      headers: {
        "Content-Range": contentRange,
        "Content-Type": "application/octet-stream",
      },
      body: body.byteLength > 0 ? body : undefined,
      cache: "no-store",
    });

    const headers = new Headers();
    const range = upstream.headers.get("range");
    if (range) headers.set("Range", range);
    headers.set("Content-Type", "application/json");

    const text = await upstream.text();
    const payload = text.length > 0 ? text : "{}";

    return new NextResponse(payload, { status: upstream.status, headers });
  }
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS; the route table lists `/api/upload`, `/api/upload/complete`, `/api/upload/thumbnail`, `/api/upload/chunk`.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add Drive resumable upload, complete, thumbnail and chunk routes

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 17: `src/lib/upload-client.ts`

**Files:**
- Create: `src/lib/upload-client.ts`
- Test: `src/lib/upload-client.test.ts`

- [ ] Write `src/lib/upload-client.test.ts`:
  ```ts
  import { afterEach, describe, expect, it, vi } from "vitest";
  import {
    CHUNK_SIZE_BYTES,
    PROXY_CHUNK_SIZE_BYTES,
    uploadToDrive,
  } from "@/lib/upload-client";

  const SESSION_URI = "https://www.googleapis.com/upload/drive/v3/files?upload_id=x";

  function blobOf(size: number): Blob {
    return new Blob([new Uint8Array(size)], { type: "video/webm" });
  }

  function resumeIncomplete(rangeEnd: number): Response {
    return new Response(null, { status: 308, headers: { Range: `bytes=0-${rangeEnd}` } });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("chunk sizes", () => {
    it("are multiples of 256 KiB", () => {
      expect(CHUNK_SIZE_BYTES).toBe(8 * 1024 * 1024);
      expect(CHUNK_SIZE_BYTES % (256 * 1024)).toBe(0);
      expect(PROXY_CHUNK_SIZE_BYTES).toBe(4 * 1024 * 1024);
      expect(PROXY_CHUNK_SIZE_BYTES % (256 * 1024)).toBe(0);
    });
  });

  describe("uploadToDrive", () => {
    it("uploads a single small blob and returns the file id", async () => {
      const fetchMock = vi.fn(async () =>
        Response.json({ id: "drive-abc" }, { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await uploadToDrive(blobOf(1024), SESSION_URI);
      expect(result).toEqual({ id: "drive-abc" });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(init.method).toBe("PUT");
      expect(headers["Content-Range"]).toBe("bytes 0-1023/1024");
    });

    it("sends sequential chunks and reports progress", async () => {
      const size = CHUNK_SIZE_BYTES + 1024;
      const ranges: string[] = [];
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        ranges.push(headers["Content-Range"]);
        return ranges.length === 1
          ? resumeIncomplete(CHUNK_SIZE_BYTES - 1)
          : Response.json({ id: "drive-abc" }, { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const progress: number[] = [];
      await uploadToDrive(blobOf(size), SESSION_URI, (p) => progress.push(p));

      expect(ranges).toEqual([
        `bytes 0-${CHUNK_SIZE_BYTES - 1}/${size}`,
        `bytes ${CHUNK_SIZE_BYTES}-${size - 1}/${size}`,
      ]);
      expect(progress.at(-1)).toBe(100);
      expect(progress.every((p) => p >= 0 && p <= 100)).toBe(true);
    });

    it("accepts 201 as a successful final response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ id: "drive-201" }, { status: 201 })),
      );
      await expect(uploadToDrive(blobOf(512), SESSION_URI)).resolves.toEqual({
        id: "drive-201",
      });
    });

    it("queries the committed offset and resumes after a transport error", async () => {
      const size = 2048;
      const calls: (string | undefined)[] = [];
      let attempt = 0;
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        calls.push(headers["Content-Range"]);
        attempt += 1;
        if (attempt === 1) throw new TypeError("network error");
        if (attempt === 2) return resumeIncomplete(1023); // offset query
        return Response.json({ id: "drive-resumed" }, { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(uploadToDrive(blobOf(size), SESSION_URI)).resolves.toEqual({
        id: "drive-resumed",
      });
      expect(calls[1]).toBe(`bytes */${size}`);
      expect(calls[2]).toBe(`bytes 1024-2047/${size}`);
    });

    it("treats a 404 on the offset query as a dead session", async () => {
      let attempt = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          attempt += 1;
          if (attempt === 1) throw new TypeError("network error");
          return new Response("gone", { status: 404 });
        }),
      );
      await expect(uploadToDrive(blobOf(512), SESSION_URI)).rejects.toThrow(
        "Upload session expired",
      );
    });

    it("rejects an empty blob", async () => {
      vi.stubGlobal("fetch", vi.fn());
      await expect(uploadToDrive(blobOf(0), SESSION_URI)).rejects.toThrow(
        "Nothing to upload",
      );
    });

    it("gives up after the retry budget", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("server error", { status: 500 })),
      );
      await expect(uploadToDrive(blobOf(512), SESSION_URI)).rejects.toThrow(
        "Upload failed",
      );
    });
  });
  ```
- [ ] Run `npm test` — expect FAIL: `Failed to resolve import "@/lib/upload-client"`.
- [ ] Create `src/lib/upload-client.ts`:
  ```ts
  /** Drive requires chunk sizes that are multiples of 256 KiB. */
  export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
  /** Used when routing through /api/upload/chunk (Vercel caps bodies at 4.5 MB). */
  export const PROXY_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;

  const MAX_ATTEMPTS = 5;

  export type UploadResult = { id: string };
  export type ProgressCallback = (percent: number) => void;

  export type UploadOptions = {
    /** Chunk size in bytes; must be a multiple of 256 KiB. */
    chunkSize?: number;
    /** Route chunks through the server proxy instead of straight to Drive. */
    proxyUrl?: string;
    signal?: AbortSignal;
  };

  function putInit(
    sessionUri: string,
    contentRange: string,
    body: BodyInit | undefined,
    options: UploadOptions,
  ): [string, RequestInit] {
    if (options.proxyUrl) {
      return [
        options.proxyUrl,
        {
          method: "PUT",
          headers: {
            "x-upload-session-uri": sessionUri,
            "x-upload-content-range": contentRange,
            "Content-Type": "application/octet-stream",
          },
          body,
          signal: options.signal,
        },
      ];
    }
    return [
      sessionUri,
      {
        method: "PUT",
        headers: { "Content-Range": contentRange },
        body,
        signal: options.signal,
      },
    ];
  }

  /** Parse `Range: bytes=0-N` into the next byte offset to send. */
  function offsetFromRange(header: string | null): number {
    if (!header) return 0;
    const match = /bytes=0-(\d+)/.exec(header);
    return match ? Number(match[1]) + 1 : 0;
  }

  async function queryOffset(
    sessionUri: string,
    total: number,
    options: UploadOptions,
  ): Promise<number> {
    const [url, init] = putInit(sessionUri, `bytes */${total}`, undefined, options);
    const response = await fetch(url, init);

    if (response.status === 404 || response.status === 410) {
      throw new Error("Upload session expired. Please try recording again.");
    }
    if (response.status === 200 || response.status === 201) {
      return total;
    }
    if (response.status !== 308) {
      throw new Error(`Upload failed while resuming (${response.status})`);
    }
    return offsetFromRange(response.headers.get("range"));
  }

  /**
   * Upload a blob to a Drive resumable session URI in fixed-size chunks.
   * Resolves with the created Drive file id.
   */
  export async function uploadToDrive(
    blob: Blob,
    sessionUri: string,
    onProgress?: ProgressCallback,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const total = blob.size;
    if (total === 0) throw new Error("Nothing to upload");

    const chunkSize =
      options.chunkSize ??
      (options.proxyUrl ? PROXY_CHUNK_SIZE_BYTES : CHUNK_SIZE_BYTES);

    let offset = 0;
    let attempts = 0;

    onProgress?.(0);

    while (offset < total) {
      const end = Math.min(offset + chunkSize, total);
      const contentRange = `bytes ${offset}-${end - 1}/${total}`;
      const [url, init] = putInit(
        sessionUri,
        contentRange,
        blob.slice(offset, end),
        options,
      );

      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          throw new Error("Upload failed after repeated network errors");
        }
        offset = await queryOffset(sessionUri, total, options);
        onProgress?.(Math.round((offset / total) * 100));
        continue;
      }

      if (response.status === 200 || response.status === 201) {
        const json = (await response.json()) as { id?: string };
        if (!json.id) throw new Error("Upload finished without a Drive file id");
        onProgress?.(100);
        return { id: json.id };
      }

      if (response.status === 308) {
        const next = offsetFromRange(response.headers.get("range"));
        offset = next > offset ? next : end;
        onProgress?.(Math.round((offset / total) * 100));
        continue;
      }

      if (response.status === 404 || response.status === 410) {
        throw new Error("Upload session expired. Please try recording again.");
      }

      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        throw new Error(`Upload failed (${response.status})`);
      }
      offset = await queryOffset(sessionUri, total, options);
      onProgress?.(Math.round((offset / total) * 100));
    }

    // Every byte was acknowledged by a 308 but Drive never returned the file id.
    throw new Error("Upload failed: Drive never confirmed the file");
  }
  ```
- [ ] Run `npm test` — expect PASS.
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add chunked resumable Drive upload client with offset recovery

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 18: Wire the recorder to Drive and make `page.tsx` a server component

**Files:**
- Create: `src/lib/auth.ts`
- Modify: `src/components/recorder.tsx` (lines 1-35 imports/props/refs, lines 292-340 `handleRecordingComplete`)
- Modify: `src/app/page.tsx` (whole file)

MediaRecorder writes WebM with no duration in the EBML header, so `<video>` shows no seek bar and `video.duration` is `Infinity`. `fix-webm-duration` patches the header in the browser before upload; it is a ~4 KB dependency-free package. Check its exact export shape in `node_modules/fix-webm-duration/` (recent versions export `fixWebmDuration(blob, durationMs, options?) => Promise<Blob>` as the default export; older ones take a callback) and adapt the one call site below if needed.

- [ ] Install: `npm i fix-webm-duration`
- [ ] Create `src/lib/auth.ts` (server-only helper shared by `/` now and `/library` in Phase 3):
  ```ts
  import "server-only";
  import { cookies } from "next/headers";
  import { SESSION_COOKIE, verifySession } from "@/lib/session";

  /** True when the request carries a valid owner session cookie. */
  export async function isOwner(): Promise<boolean> {
    const cookieStore = await cookies();
    return verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  }
  ```
- [ ] In `src/components/recorder.tsx`, replace the import block and props (lines 1-23) with:
  ```tsx
  "use client";

  import { useState, useRef, useCallback } from "react";
  import fixWebmDuration from "fix-webm-duration";
  import { DeviceSelector } from "./device-selector";
  import { RecordingPreview } from "./recording-preview";
  import { YoomLogo } from "./logo";
  import { uploadToDrive } from "@/lib/upload-client";

  type RecordingMode = "screen" | "camera" | "screen+camera";
  type RecorderState = "idle" | "recording" | "uploading" | "done";

  export function Recorder() {
    const [mode, setMode] = useState<RecordingMode>("screen");
    const [micId, setMicId] = useState("");
    const [cameraId, setCameraId] = useState("");
    const [state, setState] = useState<RecorderState>("idle");
    const [elapsed, setElapsed] = useState(0);
    const [shareUrl, setShareUrl] = useState("");
    const [error, setError] = useState("");
    const [uploadProgress, setUploadProgress] = useState(0);
  ```
- [ ] Immediately after the existing `const cameraVideoElRef = useRef<HTMLVideoElement | null>(null);` line, add three refs:
  ```tsx
  const recordStartedAtRef = useRef<number>(0);
  const recordEndedAtRef = useRef<number>(0);
  const thumbnailRef = useRef<Blob | null>(null);
  ```
- [ ] In `startRecording`, immediately before `mediaRecorderRef.current.start(...)` (the call that begins recording), add:
  ```tsx
  recordStartedAtRef.current = performance.now();
  thumbnailRef.current = null;
  window.setTimeout(() => {
    void captureThumbnail().then((blob) => {
      thumbnailRef.current = blob;
    });
  }, 1000);
  ```
- [ ] In `stopRecording`, as the first statement inside the function body, add:
  ```tsx
  recordEndedAtRef.current = performance.now();
  ```
- [ ] Add these two helpers directly above `handleRecordingComplete`. Note that `screenVideoElRef`/`cameraVideoElRef` are only populated in screen+camera mode (the compositor creates them); in screen-only and camera-only modes the preview lives inside `RecordingPreview`, so the thumbnail is taken from the live stream through a throwaway `<video>`:
  ```tsx
  function frameToJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(source, 0, 0, width, height);
    return new Promise((resolve) =>
      scratch.toBlob((blob) => resolve(blob), "image/jpeg", 0.8),
    );
  }

  async function captureThumbnail(): Promise<Blob | null> {
    // Screen+camera: the composited canvas is the exact recorded frame.
    const canvas = canvasRef.current;
    if (canvas && canvas.width > 0) {
      return new Promise((resolve) =>
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8),
      );
    }

    // Screen-only / camera-only: read one frame from the live stream.
    const stream = screenStreamRef.current ?? cameraStreamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return null;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);

    const ready = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 2000);
      video.onloadeddata = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
    });

    try {
      await video.play();
      if (!(await ready) || !video.videoWidth) return null;
      return await frameToJpeg(video, video.videoWidth, video.videoHeight);
    } catch {
      return null;
    } finally {
      video.pause();
      video.srcObject = null;
    }
  }

  function readTrackDimensions(): { width: number | null; height: number | null } {
    const canvas = canvasRef.current;
    if (canvas) return { width: canvas.width, height: canvas.height };

    const stream = screenStreamRef.current ?? cameraStreamRef.current;
    const settings = stream?.getVideoTracks()[0]?.getSettings();
    return {
      width: settings?.width ?? null,
      height: settings?.height ?? null,
    };
  }
  ```
- [ ] Replace `handleRecordingComplete` (lines 292-340) with:
  ```tsx
  async function handleRecordingComplete() {
    setState("uploading");
    setUploadProgress(0);

    const { width, height } = readTrackDimensions();
    const durationMs = Math.max(
      0,
      Math.round(recordEndedAtRef.current - recordStartedAtRef.current),
    );

    stopAllStreams();

    const rawBlob = new Blob(chunksRef.current, { type: "video/webm" });

    if (rawBlob.size === 0) {
      setError("Recording captured no data. Please try again.");
      setState("idle");
      return;
    }

    // Patch the EBML duration header so players get a real seek bar and
    // `video.duration` is finite. If patching fails, upload the raw blob.
    let blob = rawBlob;
    try {
      blob = await fixWebmDuration(rawBlob, durationMs, { logger: false });
    } catch (patchError) {
      console.warn("[Yoom] could not patch WebM duration", patchError);
    }

    try {
      const sessionRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mimeType: blob.type || "video/webm",
          sizeBytes: blob.size,
          filename: `yoom-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
        }),
      });
      if (!sessionRes.ok) throw new Error("Failed to start the upload");

      const { sessionUri } = (await sessionRes.json()) as { sessionUri: string };

      const { id: driveFileId } = await uploadToDrive(
        blob,
        sessionUri,
        setUploadProgress,
      );

      const completeRes = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveFileId, durationMs, width, height }),
      });
      if (!completeRes.ok) throw new Error("Failed to save the recording");

      const { id, url } = (await completeRes.json()) as {
        id: string;
        slug: string;
        url: string;
      };

      const thumbnail = thumbnailRef.current;
      if (thumbnail) {
        const form = new FormData();
        form.set("videoId", id);
        form.set("file", thumbnail, "thumbnail.jpg");
        // A missing thumbnail is not fatal.
        await fetch("/api/upload/thumbnail", { method: "POST", body: form }).catch(
          () => undefined,
        );
      }

      setShareUrl(url);
      setState("done");
    } catch (uploadError) {
      console.error(uploadError);
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Upload failed. Please try again.",
      );
      setState("idle");
    }
  }
  ```
- [ ] In `reset()`, add `thumbnailRef.current = null;` alongside `chunksRef.current = [];`.
- [ ] Replace `src/app/page.tsx` entirely with the server component:
  ```tsx
  import { isOwner } from "@/lib/auth";
  import { PasswordGate } from "@/components/password-gate";
  import { Recorder } from "@/components/recorder";

  export default async function Home() {
    if (!(await isOwner())) {
      return <PasswordGate />;
    }

    return <Recorder />;
  }
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS.
- [ ] Run `grep -rn "password" src/components/recorder.tsx` — expect no matches.
- [ ] Manual check (`npm run dev`, any mode): after a short recording the browser Network tab shows a `POST /api/upload/thumbnail` in **screen-only, camera-only and screen+camera** modes; and playing the uploaded file locally (`URL.createObjectURL(blob)` in the console, or the watch page later) shows a finite duration and a working seek bar.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: upload recordings to Google Drive and gate the recorder server-side

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 19: Remove R2 and the legacy watch route

Nothing imports `src/lib/r2.ts` except `src/app/watch/[key]/page.tsx`, which is superseded by `/v/[slug]` (Task 24). Both go now so no later task can accidentally reintroduce the dependency.

**Files:**
- Delete: `src/lib/r2.ts`
- Delete: `src/app/watch/[key]/page.tsx`
- Delete: `src/app/watch/[key]/not-found.tsx`

- [ ] Save the 404 markup for Task 24: `cp "src/app/watch/[key]/not-found.tsx" /tmp/yoom-not-found.tsx`
- [ ] Delete the files:
  ```bash
  rm -rf src/lib/r2.ts src/app/watch
  ```
- [ ] Run `grep -rn "R2_\|r2\b\|aws-sdk" src package.json` — expect no matches.
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS; `/watch/[key]` is gone from the route table.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  chore: remove Cloudflare R2 storage and the legacy /watch route

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 20: Streaming and thumbnail routes

**Files:**
- Create: `src/app/api/stream/[videoId]/route.ts`
- Create: `src/app/api/thumb/[videoId]/route.ts`

`[videoId]` is the `videos.id` UUID (not the slug), which is what `watch-view.tsx` receives. `params` is a Promise in Next 16.

- [ ] Create `src/app/api/stream/[videoId]/route.ts`:
  ```ts
  import { getVideoById } from "@/lib/db";
  import { fetchMedia } from "@/lib/google-drive";
  import { RANGE_WINDOW_BYTES, clampRange } from "@/lib/range";
  import { corsHeaders, preflight } from "@/lib/cors";

  export const maxDuration = 300;

  type Context = { params: Promise<{ videoId: string }> };

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  export async function OPTIONS(request: Request) {
    return preflight(request);
  }

  async function handle(request: Request, context: Context, includeBody: boolean) {
    const cors = corsHeaders(request.headers.get("origin"));
    const { videoId } = await context.params;

    if (!UUID_RE.test(videoId)) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const video = await getVideoById(videoId);
    if (!video) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const size = video.size_bytes ?? 0;
    let requested = clampRange(
      request.headers.get("range"),
      size,
      RANGE_WINDOW_BYTES,
    );
    // No Range, or one we don't parse (e.g. multi-range): never stream a whole
    // multi-GB file from one invocation. Serve the first window as a 206 and
    // let the player ask for the rest.
    if (requested === null && size > RANGE_WINDOW_BYTES) {
      requested = { start: 0, end: RANGE_WINDOW_BYTES - 1 };
    }

    const headers = new Headers(cors);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Type", video.mime || "video/webm");
    // `private`: the browser may cache ranges, but no shared cache (Vercel CDN)
    // may store a 206 under this URL and replay it for a different Range.
    headers.set("Cache-Control", "private, max-age=31536000");
    headers.set("ETag", `"${video.drive_file_id}"`);

    if (requested && "unsatisfiable" in requested) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }

    const upstreamRange = requested
      ? `bytes=${requested.start}-${requested.end}`
      : undefined;

    if (!includeBody) {
      if (size > 0) headers.set("Content-Length", String(size));
      return new Response(null, { status: 200, headers });
    }

    const upstream = await fetchMedia(video.drive_file_id, upstreamRange);
    if (!upstream.ok && upstream.status !== 206) {
      return new Response("Upstream error", { status: 502, headers: cors });
    }

    const upstreamContentRange = upstream.headers.get("content-range");
    const upstreamContentLength = upstream.headers.get("content-length");
    if (upstreamContentRange) headers.set("Content-Range", upstreamContentRange);
    if (upstreamContentLength) headers.set("Content-Length", upstreamContentLength);

    return new Response(upstream.body, {
      status: upstream.status === 206 ? 206 : 200,
      headers,
    });
  }

  export async function GET(request: Request, context: Context) {
    return handle(request, context, true);
  }

  export async function HEAD(request: Request, context: Context) {
    return handle(request, context, false);
  }
  ```
- [ ] Create `src/app/api/thumb/[videoId]/route.ts`:
  ```ts
  import { getVideoById } from "@/lib/db";
  import { fetchMedia } from "@/lib/google-drive";
  import { corsHeaders, preflight } from "@/lib/cors";

  export const maxDuration = 60;

  type Context = { params: Promise<{ videoId: string }> };

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  export async function OPTIONS(request: Request) {
    return preflight(request);
  }

  export async function GET(request: Request, context: Context) {
    const cors = corsHeaders(request.headers.get("origin"));
    const { videoId } = await context.params;

    if (!UUID_RE.test(videoId)) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const video = await getVideoById(videoId);
    if (!video?.thumbnail_drive_file_id) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const upstream = await fetchMedia(video.thumbnail_drive_file_id);
    if (!upstream.ok) {
      return new Response("Upstream error", { status: 502, headers: cors });
    }

    const headers = new Headers(cors);
    headers.set("Content-Type", "image/jpeg");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", `"${video.thumbnail_drive_file_id}"`);
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    return new Response(upstream.body, { status: 200, headers });
  }
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS; the route table lists `/api/stream/[videoId]` and `/api/thumb/[videoId]`.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: stream Drive video and thumbnails with clamped byte ranges

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 21: View tracking routes

**Files:**
- Create: `src/app/api/view/start/route.ts`
- Create: `src/app/api/view/heartbeat/route.ts`

Both read the body with `request.text()` because `navigator.sendBeacon` sends a `text/plain` Blob (which avoids a CORS preflight), and both export `OPTIONS` explicitly — Next auto-generates `OPTIONS` with only an `Allow` header otherwise.

- [ ] Create `src/app/api/view/start/route.ts`:
  ```ts
  import { after } from "next/server";
  import {
    claimAlert,
    createViewSession,
    getVideoById,
    getViewSession,
  } from "@/lib/db";
  import { readViewerContext } from "@/lib/geo";
  import { sendFirstPlayEmail } from "@/lib/alerts";
  import { corsHeaders, preflight } from "@/lib/cors";

  export const maxDuration = 60;

  export async function OPTIONS(request: Request) {
    return preflight(request);
  }

  export async function POST(request: Request) {
    const cors = corsHeaders(request.headers.get("origin"));

    let body: { videoId?: string; viewerName?: string };
    try {
      body = JSON.parse(await request.text()) as typeof body;
    } catch {
      return Response.json({ error: "Invalid request" }, { status: 400, headers: cors });
    }

    const videoId = body.videoId?.trim();
    if (!videoId) {
      return Response.json({ error: "videoId is required" }, {
        status: 400,
        headers: cors,
      });
    }

    const video = await getVideoById(videoId);
    if (!video) {
      return Response.json({ error: "Not found" }, { status: 404, headers: cors });
    }

    const viewer = readViewerContext(request);
    const viewerName = body.viewerName?.trim().slice(0, 80) || null;

    const sessionId = await createViewSession({
      video_id: video.id,
      viewer_name: viewerName,
      ip_hash: viewer.ipHash,
      user_agent: viewer.userAgent,
      country: viewer.country,
      city: viewer.city,
    });

    after(async () => {
      try {
        const claimed = await claimAlert(sessionId, "alert_sent_at");
        if (!claimed) return;
        const session = await getViewSession(sessionId);
        if (!session) return;
        await sendFirstPlayEmail(session, video);
      } catch (error) {
        console.error("first-play alert failed", error);
      }
    });

    return Response.json({ sessionId }, { headers: cors });
  }
  ```
- [ ] Create `src/app/api/view/heartbeat/route.ts`:
  ```ts
  import { after } from "next/server";
  import { claimAlert, getVideoById, updateViewSession } from "@/lib/db";
  import { sendSummaryEmail } from "@/lib/alerts";
  import { corsHeaders, preflight } from "@/lib/cors";

  export const maxDuration = 60;

  export async function OPTIONS(request: Request) {
    return preflight(request);
  }

  export async function POST(request: Request) {
    const cors = corsHeaders(request.headers.get("origin"));

    let body: { sessionId?: string; percent?: number; ended?: boolean };
    try {
      body = JSON.parse(await request.text()) as typeof body;
    } catch {
      return Response.json({ error: "Invalid request" }, { status: 400, headers: cors });
    }

    const sessionId = body.sessionId?.trim();
    if (!sessionId) {
      return Response.json({ error: "sessionId is required" }, {
        status: 400,
        headers: cors,
      });
    }

    const percent = Math.max(0, Math.min(100, Math.round(Number(body.percent) || 0)));
    const ended = body.ended === true;

    const session = await updateViewSession(sessionId, percent, ended);
    if (!session) {
      return Response.json({ error: "Not found" }, { status: 404, headers: cors });
    }

    if (percent >= 100 || ended) {
      after(async () => {
        try {
          const claimed = await claimAlert(sessionId, "summary_sent_at");
          if (!claimed) return;
          const video = await getVideoById(session.video_id);
          if (!video) return;
          await sendSummaryEmail(session, video);
        } catch (error) {
          console.error("summary alert failed", error);
        }
      });
    }

    return Response.json({ ok: true, maxPercent: session.max_percent }, {
      headers: cors,
    });
  }
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add view start/heartbeat routes with debounced email alerts

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 22: `src/hooks/use-view-tracker.ts`

**Files:**
- Create: `src/hooks/use-view-tracker.ts`

This hook touches `HTMLVideoElement`, `navigator.sendBeacon` and `document.visibilityState`, none of which exist in the node test environment, so it is verified manually (see the checks at the end of this task and Task 28 step 5) rather than by unit tests.

- [ ] Create `src/hooks/use-view-tracker.ts`:
  ```ts
  "use client";

  import { useCallback, useEffect, useRef } from "react";

  const HEARTBEAT_MS = 10_000;

  export type ViewTrackerOptions = {
    videoId: string;
    /** Absolute app origin, e.g. https://yoom.vercel.app */
    apiBase: string;
    /** Stored duration in ms; MediaRecorder WebM often reports Infinity. */
    durationMs: number | null;
    viewerName: string | null;
  };

  export type ViewTracker = {
    /** Attach to the <video> element's ref. */
    videoRef: React.RefObject<HTMLVideoElement | null>;
  };

  function percentOf(video: HTMLVideoElement, durationMs: number | null): number {
    const fallbackSeconds = durationMs && durationMs > 0 ? durationMs / 1000 : 0;
    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : fallbackSeconds;
    if (!duration) return 0;
    return Math.max(0, Math.min(100, Math.round((video.currentTime / duration) * 100)));
  }

  export function useViewTracker(options: ViewTrackerOptions): ViewTracker {
    const { videoId, apiBase, durationMs, viewerName } = options;

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const startingRef = useRef(false);
    const lastPercentRef = useRef(0);
    const finishedRef = useRef(false);

    const heartbeat = useCallback(
      (percent: number, ended: boolean, useBeacon: boolean) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        if (ended && finishedRef.current) return;
        if (ended) finishedRef.current = true;

        const url = `${apiBase}/api/view/heartbeat`;
        const payload = JSON.stringify({ sessionId, percent, ended });

        if (useBeacon && typeof navigator.sendBeacon === "function") {
          // A text/plain Blob keeps this a simple request: no CORS preflight.
          navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" }));
          return;
        }

        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: payload,
          keepalive: true,
        }).catch(() => undefined);
      },
      [apiBase],
    );

    const start = useCallback(async () => {
      if (sessionIdRef.current || startingRef.current) return;
      startingRef.current = true;
      try {
        const response = await fetch(`${apiBase}/api/view/start`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ videoId, viewerName }),
        });
        if (!response.ok) return;
        const json = (await response.json()) as { sessionId: string };
        sessionIdRef.current = json.sessionId;
      } catch {
        // View tracking is best-effort; never break playback.
      } finally {
        startingRef.current = false;
      }
    }, [apiBase, videoId, viewerName]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const onPlay = () => {
        void start();
      };

      const onTimeUpdate = () => {
        lastPercentRef.current = Math.max(
          lastPercentRef.current,
          percentOf(video, durationMs),
        );
      };

      const onEnded = () => {
        heartbeat(100, true, false);
      };

      const onPageHide = () => {
        heartbeat(lastPercentRef.current, true, true);
      };

      // Tab switches are not the end of a session: persist progress only. Only
      // `pagehide` and the `ended` event close the session (and trigger the
      // summary email), otherwise a glance at another tab at 5% would claim it.
      const onVisibility = () => {
        if (document.visibilityState === "hidden") {
          heartbeat(lastPercentRef.current, false, true);
        }
      };

      const interval = window.setInterval(() => {
        if (!video.paused && !video.ended) {
          heartbeat(lastPercentRef.current, false, false);
        }
      }, HEARTBEAT_MS);

      video.addEventListener("play", onPlay);
      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("ended", onEnded);
      window.addEventListener("pagehide", onPageHide);
      document.addEventListener("visibilitychange", onVisibility);

      return () => {
        window.clearInterval(interval);
        video.removeEventListener("play", onPlay);
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("ended", onEnded);
        window.removeEventListener("pagehide", onPageHide);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }, [durationMs, heartbeat, start]);

    return { videoRef };
  }
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS.
- [ ] Manual verification (deferred to Task 28 step 5): first `play` issues exactly one `POST /api/view/start`; a heartbeat fires every 10s while playing; switching tabs sends a beacon with `ended: false`; closing the tab sends one `sendBeacon` to `/api/view/heartbeat` with `ended: true`.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add view tracking hook with heartbeats and pagehide beacon

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 23: `src/components/watch-view.tsx`

**Files:**
- Create: `src/components/watch-view.tsx`

Keeps the existing visual language from `video-player.tsx` (`border-border`, `bg-surface`, `text-muted`, `bg-accent`) and reuses `YoomLogo`. `video-player.tsx` itself stays in place unchanged for the Phase 3 detail page; the watch page needs a tracked player, so this is a sibling component rather than an edit.

- [ ] Create `src/components/watch-view.tsx`:
  ```tsx
  "use client";

  import { useEffect, useState } from "react";
  import { YoomLogo } from "./logo";
  import { useViewTracker } from "@/hooks/use-view-tracker";

  const VIEWER_NAME_KEY = "yoom_viewer_name";

  export type WatchVideo = {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    durationMs: number | null;
    hasThumbnail: boolean;
  };

  type WatchViewProps = {
    video: WatchVideo;
    /** Absolute app origin; the page may be served from jtylerray.com. */
    apiBase: string;
    shareUrl: string;
  };

  export function WatchView({ video, apiBase, shareUrl }: WatchViewProps) {
    const [viewerName, setViewerName] = useState<string | null>(null);
    const [nameResolved, setNameResolved] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [copied, setCopied] = useState(false);

    useEffect(() => {
      try {
        const stored = window.localStorage.getItem(VIEWER_NAME_KEY);
        if (stored !== null) {
          setViewerName(stored || null);
          setNameResolved(true);
        }
      } catch {
        setNameResolved(true);
      }
    }, []);

    const { videoRef } = useViewTracker({
      videoId: video.id,
      apiBase,
      durationMs: video.durationMs,
      viewerName,
    });

    function rememberName(name: string) {
      try {
        window.localStorage.setItem(VIEWER_NAME_KEY, name);
      } catch {
        // Private browsing; carry on without persisting.
      }
      setViewerName(name || null);
      setNameResolved(true);
    }

    async function copyLink() {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        // Insecure context; the URL is shown in full next to the button.
      }
    }

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 px-4 py-8">
        <div className="flex items-center justify-between">
          <YoomLogo size="sm" />
          <span className="text-xs text-muted-dim">Shared recording</span>
        </div>

        <div className="relative">
          <video
            ref={videoRef}
            src={`${apiBase}/api/stream/${video.id}`}
            poster={video.hasThumbnail ? `${apiBase}/api/thumb/${video.id}` : undefined}
            controls
            preload="metadata"
            playsInline
            className="w-full rounded-xl border border-border bg-black shadow-lg shadow-black/30"
          />

          {!nameResolved && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  rememberName(nameDraft.trim());
                }}
                className="w-full max-w-xs space-y-3 rounded-2xl border border-border bg-surface/90 p-6"
              >
                <p className="text-sm text-foreground">Who&rsquo;s watching?</p>
                <input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  placeholder="Your name (optional)"
                  maxLength={80}
                  autoFocus
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder-muted-dim outline-none transition-all focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover"
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    onClick={() => rememberName("")}
                    className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-all hover:text-foreground"
                  >
                    Skip
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">{video.title}</h1>
          {video.description && (
            <p className="whitespace-pre-wrap text-sm text-muted">{video.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-lg border border-border bg-surface px-3 py-2">
            <span className="block truncate text-sm text-muted">{shareUrl}</span>
          </div>
          <button
            onClick={copyLink}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </main>
    );
  }
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add tracked watch view with optional viewer-name prompt

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 24: `/v/[slug]` watch page

**Files:**
- Create: `src/app/v/[slug]/page.tsx`
- Create: `src/app/v/[slug]/not-found.tsx`

`generateMetadata` builds absolute `og:image` / `og:video` URLs from the app origin because the page is served under `jtylerray.com`. `next/image` is deliberately not used — `assetPrefix` does not cover `/_next/image`.

- [ ] Create `src/app/v/[slug]/not-found.tsx` (restore the markup saved in Task 19):
  ```tsx
  export default function NotFound() {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="space-y-3 text-center">
          <p className="font-mono text-sm text-muted-dim">404</p>
          <h1 className="text-lg font-semibold text-foreground">Video not found</h1>
          <p className="text-sm text-muted">
            This recording may have been removed or the link is invalid.
          </p>
        </div>
      </main>
    );
  }
  ```
- [ ] Create `src/app/v/[slug]/page.tsx`:
  ```tsx
  import type { Metadata } from "next";
  import { notFound, permanentRedirect } from "next/navigation";
  import { getVideoById, getVideoBySlug, getVideoIdByOldSlug } from "@/lib/db";
  import { appUrl } from "@/lib/env";
  import { shareUrl } from "@/lib/share";
  import { SLUG_RE } from "@/lib/slug";
  import { WatchView } from "@/components/watch-view";

  type PageProps = { params: Promise<{ slug: string }> };

  /**
   * Resolve a slug to a live video, following one hop of slug history.
   * Returns `{ redirectTo }` when the caller should 308 to the current slug.
   */
  async function resolve(slug: string) {
    if (!SLUG_RE.test(slug)) return { video: null, redirectTo: null };

    const video = await getVideoBySlug(slug);
    if (video) return { video, redirectTo: null };

    const videoId = await getVideoIdByOldSlug(slug);
    if (!videoId) return { video: null, redirectTo: null };

    const current = await getVideoById(videoId);
    if (!current) return { video: null, redirectTo: null };

    return { video: null, redirectTo: `/v/${current.slug}` };
  }

  export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    if (!SLUG_RE.test(slug)) return { title: "Video not found" };

    const video = await getVideoBySlug(slug);
    if (!video) return { title: "Video not found" };

    const base = appUrl();
    const canonical = shareUrl(video.slug);
    const images = video.thumbnail_drive_file_id
      ? [`${base}/api/thumb/${video.id}`]
      : undefined;

    return {
      title: video.title,
      description: video.description ?? "Shared with Yoom",
      alternates: { canonical },
      openGraph: {
        type: "video.other",
        title: video.title,
        description: video.description ?? "Shared with Yoom",
        url: canonical,
        images,
        videos: [
          {
            url: `${base}/api/stream/${video.id}`,
            type: video.mime || "video/webm",
            width: video.width ?? undefined,
            height: video.height ?? undefined,
          },
        ],
      },
      twitter: {
        card: "player",
        title: video.title,
        description: video.description ?? "Shared with Yoom",
        images,
      },
    };
  }

  export default async function WatchPage({ params }: PageProps) {
    const { slug } = await params;
    const { video, redirectTo } = await resolve(slug);

    if (redirectTo) permanentRedirect(redirectTo);
    if (!video) notFound();

    return (
      <WatchView
        video={{
          id: video.id,
          slug: video.slug,
          title: video.title,
          description: video.description,
          durationMs: video.duration_ms,
          hasThumbnail: Boolean(video.thumbnail_drive_file_id),
        }}
        apiBase={appUrl()}
        shareUrl={shareUrl(video.slug)}
      />
    );
  }
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS; the route table lists `/v/[slug]`.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: add /v/[slug] watch page with old-slug redirects and OG metadata

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 25: Cross-origin hosting config

**Files:**
- Modify: `next.config.ts` (whole file)

`assetPrefix` covers `/_next/static` only; the `headers()` entry opens CORS for those files so fonts and chunks load when the page is served from `jtylerray.com`.

- [ ] Replace `next.config.ts` with:
  ```ts
  import type { NextConfig } from "next";

  const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const isProduction = process.env.NODE_ENV === "production";

  const nextConfig: NextConfig = {
    // The watch page is served through a rewrite on jtylerray.com, so static
    // chunks must be requested from the app origin, not the share origin.
    assetPrefix: isProduction && appOrigin ? appOrigin : undefined,

    async headers() {
      return [
        {
          source: "/_next/static/:path*",
          headers: [
            { key: "Access-Control-Allow-Origin", value: "*" },
            { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          ],
        },
      ];
    },
  };

  export default nextConfig;
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS.
- [ ] Manual check: `curl -I http://localhost:3000/_next/static/chunks/main-app.js` (path taken from the built output) → `Access-Control-Allow-Origin: *`.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: serve static assets from the app origin with open CORS

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 26: Rewrite the README

**Files:**
- Modify: `README.md` (whole file)

- [ ] Replace `README.md` with:
  ```markdown
  # Yoom

  A personal Loom: record your screen and camera in the browser, store the video in
  your own Google Drive, and share it as `https://jtylerray.com/v/<slug>` with view
  tracking and email alerts.

  - **App**: Next.js 16 (App Router) on Vercel
  - **Storage**: Google Drive (`drive.file` scope, one app-created folder)
  - **Metadata**: Supabase Postgres (service-role key, RLS with no policies)
  - **Alerts**: Resend
  - **Share links**: `jtylerray.com/v/:slug`, rewritten to this app

  ## Setup

  ### 1. Install

  ```bash
  npm install
  cp .env.example .env.local
  ```

  Generate a session secret:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

  Put it in `SESSION_SECRET`. It signs the `yoom_session` cookie and salts viewer IP
  hashes — changing it logs you out and breaks viewer de-duplication.

  ### 2. Google Drive

  1. In Google Cloud, create an **OAuth client ID** of type *Web application* with the
     redirect URI `http://localhost:3000/oauth/callback`.
  2. Enable the **Google Drive API**.
  3. Publish the OAuth consent screen to **In production**. Refresh tokens from a
     "Testing" app expire after 7 days.
  4. Run the one-shot setup script:

  ```bash
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-oauth.mjs
  ```

  It opens the consent screen, exchanges the code, creates a Drive folder named
  "Yoom", and prints `GOOGLE_REFRESH_TOKEN` and `GOOGLE_DRIVE_FOLDER_ID`. Paste all
  four Google variables into `.env.local` and into the Vercel project.

  The `drive.file` scope only grants access to files this app created, which is why
  the folder is created by the script rather than picked in the Drive UI.

  ### 3. Supabase

  Create a project, then apply the migration:

  ```bash
  supabase link --project-ref <ref>
  supabase db push
  ```

  Or paste `supabase/migrations/20260901000000_init.sql` into the SQL editor. Copy the
  project URL into `SUPABASE_URL` and the **service role** key into
  `SUPABASE_SERVICE_ROLE_KEY`. The service role key is server-only — it must never be
  exposed to the browser and must never be prefixed with `NEXT_PUBLIC_`.

  ### 4. Resend

  Verify a sending domain (for example `jtylerray.com`), then set `RESEND_API_KEY`,
  `ALERT_FROM_EMAIL=alerts@jtylerray.com` and `ALERT_TO_EMAIL=jt@jtylerray.com`.
  Alerts are opt-out per type via the `settings` row (`alert_on_first_view`,
  `alert_on_completion`); a UI for it arrives in Phase 3.

  ### 5. Share links from jtylerray.com

  In the `jtylerray.com` repo, add these two rewrites to `vercel.json` **before** the
  `/(.*)` catch-all:

  ```json
  { "source": "/v/:slug", "destination": "https://<app>.vercel.app/v/:slug" },
  { "source": "/v/:slug/:path*", "destination": "https://<app>.vercel.app/v/:slug/:path*" }
  ```

  Because the page then runs cross-origin, this app sets `assetPrefix` to
  `NEXT_PUBLIC_APP_URL` in production and opens CORS on `/_next/static/*`. All client
  fetches and the `<video src>` on the watch page use the absolute app origin.

  ## Environment

  | Variable | Purpose |
  |---|---|
  | `UPLOAD_PASSWORD` | Shared password for the recorder |
  | `SESSION_SECRET` | Signs `yoom_session`; salts viewer IP hashes |
  | `NEXT_PUBLIC_APP_URL` | Absolute origin this app is served from |
  | `NEXT_PUBLIC_SHARE_BASE_URL` | Origin used to build share links (`https://jtylerray.com`) |
  | `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the public API routes |
  | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client |
  | `GOOGLE_REFRESH_TOKEN` | Long-lived Drive credential |
  | `GOOGLE_DRIVE_FOLDER_ID` | Destination folder for uploads |
  | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Metadata database |
  | `RESEND_API_KEY` | Email transport |
  | `ALERT_FROM_EMAIL` / `ALERT_TO_EMAIL` | Alert sender and recipient |

  ## Scripts

  ```bash
  npm run dev     # local development
  npm run build   # production build
  npm run lint    # eslint
  npm test        # vitest (unit tests for the pure modules)
  ```

  ## How it works

  1. **Record** — `recorder.tsx` captures screen and/or camera, compositing to a canvas
     when both are used, and produces one WebM blob.
  2. **Upload** — `POST /api/upload` mints a Drive resumable session URI;
     `src/lib/upload-client.ts` PUTs 8 MiB chunks straight to Google, resuming from the
     committed offset after an error. `/api/upload/chunk` is a server-side fallback if
     Drive ever refuses CORS on those PUTs.
  3. **Save** — `POST /api/upload/complete` verifies the Drive file and inserts a
     `videos` row with a fresh 8-character slug; a JPEG thumbnail follows via
     `/api/upload/thumbnail`.
  4. **Watch** — `/v/[slug]` looks up the video (falling back to `slug_history` and a
     308 redirect) and plays `/api/stream/[videoId]`, which proxies Drive bytes and
     clamps open-ended Range requests to 32 MiB per invocation.
  5. **Track** — the player posts to `/api/view/start` and `/api/view/heartbeat`;
     `claimAlert` guarantees at most one first-play email and one summary email per
     view session, sent from `after()` so they never delay the response.

  ## Known limits

  - All video bytes flow through Vercel functions; 206 responses are not CDN-cached.
    Fine for personal volume, worth revisiting if traffic grows.
  - MediaRecorder WebM has no cues index. The duration header is patched client-side
    (`fix-webm-duration`) so the seek bar works, but seeking still relies on the
    browser scanning clusters, so it is coarser than a remuxed file. Watch
    percentages fall back to the stored `duration_ms` when the header is missing.
  - Old `/watch/<uuid>.webm` links from the R2 era no longer resolve.
  ```
- [ ] Run `npm test` — expect PASS (unchanged count).
- [ ] Run `npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  docs: rewrite README for Drive, Supabase, Resend and the share rewrite

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

### Task 27: `jtylerray.com` rewrite — **requires Tyler's confirmation before pushing**

**Files:**
- Modify: `~/jtylerray.com/vercel.json` (the `rewrites` array, immediately before the `/(.*)` catch-all)

This edits a **different, outward-facing repository** (`The-Ops-King/jtylerray.com`). Edit and commit locally only. Do **not** `git push` and do **not** deploy until Tyler explicitly approves.

- [ ] Confirm the deployed app origin (e.g. `https://yoom-kravok.vercel.app`) and substitute it for `<app>` below.
- [ ] In `~/jtylerray.com/vercel.json`, the `rewrites` array currently ends:
  ```json
      { "source": "/apply", "destination": "/apply/index.html" },
      { "source": "/apply/", "destination": "/apply/index.html" },
      { "source": "/(.*)", "destination": "/index.html" }
    ]
  ```
  Insert the two Yoom rewrites so it reads:
  ```json
      { "source": "/apply", "destination": "/apply/index.html" },
      { "source": "/apply/", "destination": "/apply/index.html" },
      { "source": "/v/:slug", "destination": "https://<app>.vercel.app/v/:slug" },
      { "source": "/v/:slug/:path*", "destination": "https://<app>.vercel.app/v/:slug/:path*" },
      { "source": "/(.*)", "destination": "/index.html" }
    ]
  ```
  Order matters: Vercel applies the first matching rewrite, so these must sit above the
  catch-all. RSC navigations (`/v/<slug>?_rsc=…`) match the same source and carry their
  query string through.
- [ ] Validate the JSON: `node -e "JSON.parse(require('fs').readFileSync(process.env.HOME + '/jtylerray.com/vercel.json','utf8')); console.log('ok')"` — expect `ok`.
- [ ] Commit locally in that repo (no push):
  ```bash
  git -C ~/jtylerray.com add vercel.json && git -C ~/jtylerray.com commit -m "$(cat <<'EOF'
  feat: rewrite /v/:slug to the Yoom app

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```
- [ ] **STOP.** Report to Tyler: the commit exists locally in `~/jtylerray.com`, the app origin used, and that pushing will deploy `jtylerray.com`. Push only after he says go.

---

### Task 28: Manual verification (Phase 1 checklist)

**Files:** none (verification only)

Run against a deployed preview with all env vars set, plus `npm run dev` where noted.

- [ ] **1. OAuth** — `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/google-oauth.mjs` prints all four Google env lines and creates the Drive folder. Confirm refresh works: restart the dev server and load any page that hits Drive — no `Token refresh failed` in the logs.
- [ ] **2. Record and upload** — record ~30 s. DevTools › Network shows PUTs to `googleapis.com/upload/…` returning 308 then a final 200/201. The file appears in the Drive "Yoom" folder. In Supabase: `select slug, size_bytes, duration_ms, width, height from videos order by created_at desc limit 1;` and confirm `size_bytes` matches the Drive file size.
- [ ] **3. Range streaming** —
  ```bash
  curl -sI -H "Range: bytes=0-1023" "$APP/api/stream/<videoId>"
  ```
  → `HTTP/2 206`, `Content-Range: bytes 0-1023/<size>`, `Accept-Ranges: bytes`. Then:
  ```bash
  curl -sI -H "Range: bytes=0-" "$APP/api/stream/<videoId>" | grep -i content-range
  ```
  → the end offset is `33554431` (32 MiB − 1) for any file larger than 32 MiB.
- [ ] **4. Cross-origin** — open `https://jtylerray.com/v/<slug>`. The page renders, chunks load from the app origin, and the console shows no CORS errors. Then:
  ```bash
  curl -si -X OPTIONS "$APP/api/view/start" -H "Origin: https://jtylerray.com" | head -20
  ```
  → `204` with `Access-Control-Allow-Origin: https://jtylerray.com` and `Vary: Origin`.
- [ ] **5. View tracking and email** — play the video from `jtylerray.com`. A `view_sessions` row appears with `country`/`city` populated and `ip_hash` set; exactly one first-play email arrives. Scrub to the end (or close the tab) → `max_percent` updates and exactly **one** summary email arrives. Reload and play again → a second session row, and again exactly one email of each kind (the `claimAlert` debounce is per session).
- [ ] **6. Slug history** — in Supabase:
  ```sql
  insert into slug_history (old_slug, video_id) values ('old-demo', '<videoId>');
  update videos set slug = 'new-demo' where id = '<videoId>';
  ```
  Then `curl -sI https://jtylerray.com/v/old-demo` → 308 to `/v/new-demo`.
- [ ] **7. Auth** — `curl -si -X POST "$APP/api/upload"` with no cookie → `401 {"error":"Unauthorized"}`. Loading `/` in a fresh private window shows the password gate; entering the password reveals the recorder without a full page reload.
- [ ] **8. Build and cleanup** — `npm run build` passes, `npm run lint` passes, `npm test` passes, and `grep -rn "R2_" src` returns nothing.
- [ ] **Drive CORS spike (do this before trusting step 2 in production):** if the browser PUTs in step 2 fail preflight, switch `recorder.tsx`'s call to
  `uploadToDrive(blob, sessionUri, setUploadProgress, { proxyUrl: "/api/upload/chunk" })`.
  The chunk size drops to 4 MiB automatically and the interface is otherwise identical.
- [ ] Commit any fixes discovered here with the standard trailer:
  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  fix: address Phase 1 manual verification findings

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MuH5jiRtnF8h6mo42MXCwr
  EOF
  )"
  ```

---

## Self-review

**Spec coverage.** Every Phase 1 bullet maps to a task. Deps/env: `npm rm`/`npm i` and the full `.env.example` → Task 2; `scripts/google-oauth.mjs` (localhost:3000/oauth/callback, `drive.file`, `access_type=offline&prompt=consent`, folder creation, printed env lines, production-publish warning) → Task 13. `src/lib/` modules: `env.ts` → 3, `slug.ts` → 4, `session.ts` → 5, `cors.ts` → 6, `geo.ts` → 7, `supabase.ts` → 9, `db.ts` → 10, `alerts.ts` (+ `share.ts`) → 11, `google-drive.ts` (with `r2.ts` deleted in 19) → 12, `upload-client.ts` → 17. Migration `supabase/migrations/20260901000000_init.sql` with all four tables, the `(video_id, started_at desc)` index, RLS-with-no-policies and the seeded single-row `settings` → Task 9. Auth: `timingSafeEqual` + cookie + `DELETE` → 14; `src/proxy.ts` with `config.matcher = ['/', '/library/:path*', '/api/upload/:path*']` → 15; server-component `page.tsx` → 18. Upload: `/api/upload`, `/complete`, `/thumbnail`, `/chunk` → 16; `recorder.tsx` `handleRecordingComplete` → 18. Streaming: `/api/stream/[videoId]` with `maxDuration = 300` and the 32 MiB clamp (`clampRange` → 8) and `/api/thumb/[videoId]` → 20. Watch and tracking: `/v/[slug]` with `SLUG_RE`, `getVideoIdByOldSlug` → `permanentRedirect`, `notFound`, `generateMetadata` → 24; `watch-view.tsx` → 23; `use-view-tracker.ts` → 22; `/api/view/start` and `/api/view/heartbeat` with `after()` + `claimAlert` → 21. Cross-origin hosting: `assetPrefix` + `headers()` → 25; `vercel.json` → 27. Cleanup: `r2.ts` and `src/app/watch/` deleted → 19; README → 26. Verification checklist → 28.

**Placeholder scan.** No "TBD", "TODO", "add error handling", "similar to Task N", or "write tests for the above" appears in any step. Every code block is complete and pasteable. Every referenced symbol is defined somewhere in the plan: `env`/`optionalEnv`/`appUrl`/`shareBaseUrl`/`allowedOrigins` (Task 3), `SLUG_RE`/`newSlug` (4), `SESSION_COOKIE`/`SESSION_MAX_AGE`/`signSession`/`verifySession`/`sessionCookieOptions` (5), `corsHeaders`/`preflight`/`withCors`/`isAllowedOrigin` (6), `readViewerContext` (7), `clampRange`/`RANGE_WINDOW_BYTES` (8), `getSupabase` and the `update_view_progress` SQL function (9), `Video`/`ViewSession`/`Settings`/`NewVideo`/`NewViewSession`/`AlertColumn`/`DbError`/`UNIQUE_VIOLATION` and all nine db functions (10), `shareUrl` plus `escapeHtml`/`deviceFromUserAgent`/`locationLabel`/`viewerLabel`/`renderFirstPlayEmail`/`renderSummaryEmail`/`sendFirstPlayEmail`/`sendSummaryEmail` (11), the seven Drive helpers plus `resetAccessTokenCache` (12), `uploadToDrive`/`CHUNK_SIZE_BYTES`/`PROXY_CHUNK_SIZE_BYTES`/`UploadOptions` (17), `captureThumbnail`/`readTrackDimensions` (18), `useViewTracker` (22), `WatchView`/`WatchVideo` (23).

**Type consistency.** `Video` and `ViewSession` are declared once in `db.ts` and imported by `alerts.ts`, the stream/thumb routes, the view routes and the watch page; no shape is redeclared. `claimAlert(sessionId: string, column: AlertColumn): Promise<boolean>` has the same signature at both call sites. `updateViewSession(sessionId, percent, ended)` returns `ViewSession | null` and both callers null-check it. `uploadToDrive(blob, sessionUri, onProgress?, options?)` returns `{ id: string }`, matching `recorder.tsx`'s destructure and the `driveFileId` field `/api/upload/complete` expects. `/api/upload` returns `{ sessionUri }`; `/api/upload/complete` returns `{ id, slug, url }`, and `recorder.tsx` uses `id` (for the thumbnail POST) and `url` (for the share box). `[videoId]` route params are the `videos.id` UUID everywhere — `watch-view.tsx` passes `video.id` into both `/api/stream/` and `/api/thumb/`, and `generateMetadata` builds the same URLs. `clampRange` returns `{start, end} | {unsatisfiable: true} | null`, and the stream route handles all three branches.

**Ambiguities resolved.** (a) The spec lists `env.ts` exports as constants; they are implemented as zero-argument functions (`appUrl()`, `shareBaseUrl()`, `allowedOrigins()`) because module-level constants that throw would fail at import time and break `next build`. (b) `updateViewSession`'s `greatest(...)` is implemented as the `update_view_progress` SQL function in the migration so the max is atomic server-side rather than a read-modify-write race. (c) `getVideoIdByOldSlug` returns the id (per the spec's name); the page then calls `getVideoById` to learn the current slug for the 308. (d) The proxy hard-rejects only `/api/upload/*`; pages read the cookie themselves via `isOwner()` in `src/lib/auth.ts` (no forgeable request header, and Phase 3's `/library` reuses the same helper). (e) Task 2 stubs `r2.ts` and the upload route so the tree keeps compiling between the AWS-SDK removal and the Task 19 deletion. (f) `video-player.tsx` is left untouched and `watch-view.tsx` is a new sibling — the watch page needs a tracked `videoRef` and a poster, which the existing component does not expose; `video-player.tsx` is reused by the Phase 3 detail page.

