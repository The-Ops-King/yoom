"use client";

import { useState } from "react";

type CopyLinkButtonProps = {
  url: string;
  label?: string;
  className?: string;
};

export function CopyLinkButton({
  url,
  label = "Copy link",
  className,
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Insecure context; the URL is always shown next to the button.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        className ??
        "shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover"
      }
    >
      <span aria-live="polite">{copied ? "Copied!" : label}</span>
    </button>
  );
}
