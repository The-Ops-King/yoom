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

// Next only inlines *literal* `process.env.NEXT_PUBLIC_X` accesses at build
// time; `process.env[name]` stays dynamic and resolves to `undefined` in the
// browser bundle. Read these through literal property access so they get
// inlined.
function publicEnv(): {
  NEXT_PUBLIC_APP_URL?: string;
  NEXT_PUBLIC_SHARE_BASE_URL?: string;
} {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SHARE_BASE_URL: process.env.NEXT_PUBLIC_SHARE_BASE_URL,
  };
}

/** Absolute origin this Next app is served from. */
export function appUrl(): string {
  const explicit = publicEnv().NEXT_PUBLIC_APP_URL || undefined;
  if (explicit) return stripTrailingSlash(explicit);
  const prod = optionalEnv("VERCEL_PROJECT_PRODUCTION_URL");
  if (prod) return `https://${prod}`;
  const preview = optionalEnv("VERCEL_URL");
  if (preview) return `https://${preview}`;
  return "http://localhost:3000";
}

/**
 * Where share links live when nothing says otherwise. Links are handed to
 * other people, so they must never point at whatever origin happens to be
 * serving the app (a dev server, a Vercel preview): `jtylerray.com/v/*`
 * rewrites to the app, and that is the address the world gets.
 */
export const DEFAULT_SHARE_BASE_URL = "https://jtylerray.com";

/** Public origin that share links are built from. */
export function shareBaseUrl(): string {
  const explicit = publicEnv().NEXT_PUBLIC_SHARE_BASE_URL || undefined;
  return explicit ? stripTrailingSlash(explicit) : DEFAULT_SHARE_BASE_URL;
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
