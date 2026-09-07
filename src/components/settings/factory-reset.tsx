"use client";

import { useState } from "react";
import { SETTINGS_KEY } from "@/lib/recording/settings";

/**
 * The quiet escape hatch: wipe every remembered recorder/editor preference
 * and fall back to shipped defaults. Distinct from the staging editor's
 * panel-level "Reset" links, which restore a user's *saved* defaults —
 * this instead deletes them.
 *
 * `window.confirm` matches the confirmation pattern `DeleteButton` already
 * uses for a destructive action in this app: it is native, so it is reachable
 * from the keyboard (Tab to the button, Enter/Space to activate, then the
 * browser dialog itself takes Enter/Escape) without any extra wiring here.
 */
export function FactoryReset() {
  const [done, setDone] = useState(false);

  function handleClick() {
    if (
      !window.confirm(
        "Restore factory defaults? This clears remembered recorder and editor appearance. Recordings are not affected.",
      )
    ) {
      return;
    }
    try {
      window.localStorage.removeItem(SETTINGS_KEY);
    } catch {
      // Private mode / storage disabled — nothing was stored to begin with.
    }
    setDone(true);
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <div className="space-y-1">
        <p className="text-sm text-foreground">Restore factory defaults</p>
        <p className="text-xs text-muted-dim">
          Clears remembered recorder and editor appearance. Recordings are not affected.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleClick}
          className="rounded-lg border border-danger/30 px-3 py-2 text-sm font-medium text-danger-text/90 transition-colors hover:bg-danger/10"
        >
          Restore factory defaults
        </button>
        {done && (
          <p aria-live="polite" className="text-xs text-muted-dim">
            Cleared
          </p>
        )}
      </div>
    </div>
  );
}
