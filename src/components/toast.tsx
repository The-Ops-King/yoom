"use client";

import { useEffect } from "react";

type ToastProps = {
  message: string;
  tone?: "success" | "error";
  /** Called when the toast times out; the parent unmounts it. */
  onDone: () => void;
  durationMs?: number;
};

/**
 * A floating, bottom-centred notice for a one-off outcome ("Link copied").
 * Fixed-positioned so it reads wherever the page is scrolled to, unlike the
 * inline `NewToast` that sits at the top of the detail page.
 */
export function Toast({ message, tone = "success", onDone, durationMs = 2200 }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(timer);
  }, [onDone, durationMs]);

  const tones =
    tone === "error"
      ? "border-danger/40 bg-danger/15 text-danger-hover"
      : "border-emerald-500/25 bg-emerald-500/15 text-emerald-200";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 animate-[toast-in_180ms_ease-out]`}
    >
      <div className={`rounded-lg border px-4 py-2 text-sm shadow-lg shadow-black/40 backdrop-blur ${tones}`}>
        {message}
      </div>
    </div>
  );
}
