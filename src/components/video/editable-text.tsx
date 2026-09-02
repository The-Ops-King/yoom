"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/app/(owner)/actions";

type EditableTextProps = {
  videoId: string;
  /** Form field name; also the action's expected key. */
  name: "title" | "description";
  value: string;
  placeholder: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  multiline?: boolean;
  autoFocus?: boolean;
  className?: string;
};

const INITIAL: ActionState = {};

/**
 * Click-to-edit text bound to a server action. Saves on blur or ⌘/Ctrl+Enter,
 * reverts on Escape.
 */
export function EditableText({
  videoId,
  name,
  value,
  placeholder,
  action,
  multiline = false,
  autoFocus = false,
  className,
}: EditableTextProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const [focused, setFocused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Adopt server-rendered changes (e.g. after a revalidate) unless the field is
  // currently focused, which would yank text out from under the cursor.
  // Adjusting state during render is the supported pattern here; doing it in an
  // effect would trip `react-hooks/set-state-in-effect` and cascade a render.
  if (value !== lastValue) {
    setLastValue(value);
    if (!focused) setDraft(value);
  }

  useEffect(() => {
    if (autoFocus) {
      const field = fieldRef.current;
      field?.focus();
      field?.select();
    }
  }, [autoFocus]);

  function submitIfChanged() {
    if (draft.trim() === value.trim()) return;
    formRef.current?.requestSubmit();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setDraft(value);
      fieldRef.current?.blur();
      return;
    }
    if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitIfChanged();
    }
  }

  const shared =
    "w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-foreground outline-none transition-all hover:border-border focus:border-accent/50 focus:bg-surface focus:ring-1 focus:ring-accent/20";

  return (
    <form ref={formRef} action={formAction} className="space-y-1">
      <input type="hidden" name="id" value={videoId} />
      <label htmlFor={`field-${name}`} className="sr-only">
        {name === "title" ? "Title" : "Description"}
      </label>
      {multiline ? (
        <textarea
          id={`field-${name}`}
          ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
          name={name}
          rows={3}
          value={draft}
          placeholder={placeholder}
          readOnly={pending}
          aria-busy={pending}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            submitIfChanged();
          }}
          onKeyDown={onKeyDown}
          className={`${shared} resize-y text-sm ${className ?? ""}`}
        />
      ) : (
        <input
          id={`field-${name}`}
          ref={fieldRef as React.RefObject<HTMLInputElement>}
          name={name}
          value={draft}
          placeholder={placeholder}
          readOnly={pending}
          aria-busy={pending}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            submitIfChanged();
          }}
          onKeyDown={onKeyDown}
          className={`${shared} text-lg font-semibold ${className ?? ""}`}
        />
      )}
      <p aria-live="polite" className="min-h-4 px-2 text-xs">
        {state.error ? (
          <span className="text-red-400/90">{state.error}</span>
        ) : pending ? (
          <span className="text-muted-dim">Saving…</span>
        ) : state.ok ? (
          <span className="text-muted-dim">Saved</span>
        ) : null}
      </p>
    </form>
  );
}
