"use client";

import { useActionState } from "react";
import { deleteVideo, type ActionState } from "@/app/(owner)/actions";

type DeleteButtonProps = {
  videoId: string;
  title: string;
};

const INITIAL: ActionState = {};

export function DeleteButton({ videoId, title }: DeleteButtonProps) {
  const [state, formAction, pending] = useActionState(deleteVideo, INITIAL);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Delete “${title}”? The share link stops working and the Drive file moves to Trash.`,
          )
        ) {
          event.preventDefault();
        }
      }}
      className="space-y-1"
    >
      <input type="hidden" name="id" value={videoId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-danger/30 px-3 py-2 text-sm text-danger-text/90 transition-colors hover:bg-danger/10 disabled:opacity-40"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state.error && (
        <p aria-live="polite" className="text-xs text-danger-text/90">
          {state.error}
        </p>
      )}
    </form>
  );
}
