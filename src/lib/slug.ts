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

/**
 * Best-effort tidy-up of a hand-typed slug. Deliberately does NOT validate —
 * the caller still tests the result against SLUG_RE so the user sees an error
 * for input that cannot be rescued (e.g. "AB" is too short).
 */
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
