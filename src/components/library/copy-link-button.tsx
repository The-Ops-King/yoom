"use client";

import { useCallback, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { Toast } from "@/components/toast";

type CopyLinkButtonProps = {
  url: string;
  label?: string;
  className?: string;
};

type Outcome = "copied" | "failed" | null;

export function CopyLinkButton({
  url,
  label = "Copy link",
  className,
}: CopyLinkButtonProps) {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const clear = useCallback(() => setOutcome(null), []);

  async function copy() {
    setOutcome((await copyText(url)) ? "copied" : "failed");
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className={
          className ??
          "shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover"
        }
      >
        {outcome === "copied" ? "Copied!" : label}
      </button>
      {outcome === "copied" && (
        <Toast message="Link copied to clipboard" onDone={clear} />
      )}
      {outcome === "failed" && (
        <Toast
          tone="error"
          message="Couldn't copy — select the link and copy it by hand"
          onDone={clear}
          durationMs={4000}
        />
      )}
    </>
  );
}
