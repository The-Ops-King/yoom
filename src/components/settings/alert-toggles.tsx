"use client";

import { useActionState } from "react";
import { saveSettings, type ActionState } from "@/app/(owner)/actions";
import type { Settings } from "@/lib/db";

const INITIAL: ActionState = {};

const FIELDS: {
  name: "alert_on_first_view" | "alert_on_completion";
  label: string;
  hint: string;
}[] = [
  {
    name: "alert_on_first_view",
    label: "Email me when someone starts watching",
    hint: "One email per view session, sent on first play.",
  },
  {
    name: "alert_on_completion",
    label: "Email me a summary when they finish",
    hint: "Sent once when a viewer reaches the end or closes the tab.",
  },
];

export function AlertToggles({ settings }: { settings: Settings }) {
  const [state, formAction, pending] = useActionState(saveSettings, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      {FIELDS.map((field) => (
        <label
          key={field.name}
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3"
        >
          <input
            type="checkbox"
            name={field.name}
            defaultChecked={settings[field.name]}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>
            <span className="block text-sm text-foreground">{field.label}</span>
            <span className="block text-xs text-muted-dim">{field.hint}</span>
          </span>
        </label>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        <p aria-live="polite" className="text-xs">
          {state.error ? (
            <span className="text-danger-text/90">{state.error}</span>
          ) : state.ok ? (
            <span className="text-muted-dim">Saved</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
