"use client";

import { useEffect, useState } from "react";

/** Shown once after an upload redirect (`?new=1`); the link is already copied. */
export function NewToast({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
    >
      {message}
    </div>
  );
}
