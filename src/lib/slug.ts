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
