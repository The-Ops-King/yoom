/** Display formatters shared by the owner dashboard. */

// This module must stay importable from Client Components, so it cannot pull
// in anything that transitively reaches `server-only` (e.g. alerts.ts -> db.ts
// -> supabase.ts). deviceFromUserAgent is pure string parsing, so it lives
// here; alerts.ts imports it from here (and re-exports it for compatibility).
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

const DASH = "—";

export function fmtDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return DASH;
  const total = Math.round(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function fmtBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return DASH;
  // Round to whole bytes first so a value like 1023.6 crosses into the next
  // unit before we compare against 1024, rather than printing "1024 B".
  const rounded = Math.round(bytes);
  if (rounded < 1024) return `${rounded} B`;
  let value = rounded;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

export function fmtRelative(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return DASH;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return DASH;

  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 52) return `${weeks}w ago`;
  return `${Math.round(days / 365)}y ago`;
}
