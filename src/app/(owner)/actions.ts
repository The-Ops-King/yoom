"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isOwner } from "@/lib/auth";
import {
  changeSlug,
  getVideoById,
  isSlugTaken,
  softDeleteVideo,
  updateSettings,
  updateVideoMeta,
} from "@/lib/db";
import { trashFile } from "@/lib/google-drive";
import { SLUG_RE, normalizeSlug } from "@/lib/slug";

export type ActionState = { error?: string; ok?: boolean };
export type SlugState = ActionState & { slug?: string };

const UNAUTHORIZED: ActionState = { error: "Not signed in." };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function revalidateVideo(id: string): void {
  revalidatePath("/library");
  revalidatePath(`/library/${id}`);
}

export async function updateTitle(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Server Functions are reachable by direct POST, so every one re-checks auth.
  if (!(await isOwner())) return UNAUTHORIZED;

  const id = field(formData, "id");
  const title = field(formData, "title").trim();
  if (!id) return { error: "Missing video." };
  if (title.length === 0) return { error: "Title cannot be empty." };
  if (title.length > 200) return { error: "Title is too long (200 max)." };

  try {
    await updateVideoMeta(id, { title });
  } catch {
    return { error: "Could not save the title." };
  }

  revalidateVideo(id);
  return { ok: true };
}

export async function updateDescription(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await isOwner())) return UNAUTHORIZED;

  const id = field(formData, "id");
  const description = field(formData, "description");
  if (!id) return { error: "Missing video." };
  if (description.length > 5000) return { error: "Description is too long." };

  try {
    await updateVideoMeta(id, { description });
  } catch {
    return { error: "Could not save the description." };
  }

  revalidateVideo(id);
  return { ok: true };
}

export async function updateSlug(
  _prevState: SlugState,
  formData: FormData,
): Promise<SlugState> {
  if (!(await isOwner())) return UNAUTHORIZED;

  const id = field(formData, "id");
  if (!id) return { error: "Missing video." };

  const raw = field(formData, "slug");
  const slug = normalizeSlug(raw);
  if (!SLUG_RE.test(slug)) {
    return {
      error: "Use 3–40 lowercase letters, numbers or hyphens.",
      slug: raw,
    };
  }

  const video = await getVideoById(id);
  if (!video) return { error: "Recording not found." };
  if (video.slug === slug) return { ok: true, slug };

  if (await isSlugTaken(slug, id)) {
    return { error: "That link is already taken.", slug: raw };
  }

  let updated;
  try {
    updated = await changeSlug(id, slug);
  } catch {
    return { error: "Could not change the link.", slug: raw };
  }
  if (!updated) return { error: "Recording not found.", slug: raw };

  revalidateVideo(id);
  revalidatePath(`/v/${video.slug}`);
  revalidatePath(`/v/${updated.slug}`);
  return { ok: true, slug: updated.slug };
}

export async function deleteVideo(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await isOwner())) return UNAUTHORIZED;

  const id = field(formData, "id");
  if (!id) return { error: "Missing video." };

  let deleted;
  try {
    deleted = await softDeleteVideo(id);
  } catch {
    return { error: "Could not delete the recording." };
  }

  if (deleted) {
    // Drive trash is best-effort: the row is already gone from the dashboard,
    // and a failed trash must not strand the owner on an error screen.
    for (const fileId of [deleted.drive_file_id, deleted.thumbnail_drive_file_id]) {
      if (!fileId) continue;
      try {
        await trashFile(fileId);
      } catch (error) {
        console.error("Drive trash failed", fileId, error);
      }
    }
    revalidatePath(`/v/${deleted.slug}`);
  }

  revalidateVideo(id);
  // redirect() throws NEXT_REDIRECT, so nothing after this line runs.
  redirect("/library");
}

export async function saveSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await isOwner())) return UNAUTHORIZED;

  try {
    await updateSettings({
      alert_on_first_view: formData.get("alert_on_first_view") === "on",
      alert_on_completion: formData.get("alert_on_completion") === "on",
    });
  } catch {
    return { error: "Could not save settings." };
  }

  revalidatePath("/settings");
  return { ok: true };
}
