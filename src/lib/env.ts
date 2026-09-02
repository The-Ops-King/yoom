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
