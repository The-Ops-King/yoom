/**
 * Copy `text` to the clipboard, reporting whether it actually landed.
 *
 * `navigator.clipboard.writeText` rejects in an insecure context and wherever
 * the embedder denies `clipboard-sanitized-write` (Electron does, unless the
 * shell grants it). The legacy `execCommand("copy")` path needs no
 * permission, only a user gesture — which a click handler has — so it is the
 * fallback rather than a silent failure.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
