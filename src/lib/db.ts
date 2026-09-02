import { getSupabase } from "@/lib/supabase";

export type Video = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  drive_file_id: string;
  mime: string;
  size_bytes: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  thumbnail_drive_file_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ViewSession = {
  id: string;
  video_id: string;
  viewer_name: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  country: string | null;
  city: string | null;
  started_at: string;
  last_seen_at: string;
  max_percent: number;
  ended_at: string | null;
  alert_sent_at: string | null;
  summary_sent_at: string | null;
  milestones: Record<string, unknown>;
};

export type Settings = {
  id: number;
  alert_on_first_view: boolean;
  alert_on_completion: boolean;
  updated_at: string | null;
};

export type NewVideo = {
  slug: string;
  title: string;
  drive_file_id: string;
  mime: string;
  size_bytes: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
};

export type NewViewSession = {
  video_id: string;
  viewer_name: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  country: string | null;
  city: string | null;
};

export type AlertColumn = "alert_sent_at" | "summary_sent_at";

export class DbError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
}

/** Postgres unique-violation code, used to retry slug generation. */
export const UNIQUE_VIOLATION = "23505";

type QueryResult<T> = { data: T; error: { message: string; code?: string } | null };

function unwrap<T>(result: QueryResult<T>): T {
  if (result.error) throw new DbError(result.error.message, result.error.code);
  return result.data;
}

export async function getVideoBySlug(slug: string): Promise<Video | null> {
  const result = (await getSupabase()
    .from("videos")
    .select("*")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle()) as QueryResult<Video | null>;
  return unwrap(result);
}

export async function getVideoById(id: string): Promise<Video | null> {
  const result = (await getSupabase()
    .from("videos")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()) as QueryResult<Video | null>;
  return unwrap(result);
}

export async function getVideoIdByOldSlug(oldSlug: string): Promise<string | null> {
  const result = (await getSupabase()
    .from("slug_history")
    .select("video_id")
    .eq("old_slug", oldSlug)
    .maybeSingle()) as QueryResult<{ video_id: string } | null>;
  const row = unwrap(result);
  return row ? row.video_id : null;
}

export async function insertVideo(input: NewVideo): Promise<Video> {
  const result = (await getSupabase()
    .from("videos")
    .insert({
      slug: input.slug,
      title: input.title,
      drive_file_id: input.drive_file_id,
      mime: input.mime,
      size_bytes: input.size_bytes,
      duration_ms: input.duration_ms,
      width: input.width,
      height: input.height,
    })
    .select("*")
    .single()) as QueryResult<Video>;
  return unwrap(result);
}

export async function setVideoThumbnail(
  videoId: string,
  thumbnailDriveFileId: string,
): Promise<void> {
  const result = (await getSupabase()
    .from("videos")
    .update({ thumbnail_drive_file_id: thumbnailDriveFileId })
    .eq("id", videoId)) as QueryResult<unknown>;
  unwrap(result);
}

export async function createViewSession(input: NewViewSession): Promise<string> {
  const result = (await getSupabase()
    .from("view_sessions")
    .insert(input)
    .select("id")
    .single()) as QueryResult<{ id: string }>;
  return unwrap(result).id;
}

export async function getViewSession(sessionId: string): Promise<ViewSession | null> {
  const result = (await getSupabase()
    .from("view_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle()) as QueryResult<ViewSession | null>;
  return unwrap(result);
}

export async function updateViewSession(
  sessionId: string,
  percent: number,
  ended: boolean,
): Promise<ViewSession | null> {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const result = (await getSupabase().rpc("update_view_progress", {
    p_session_id: sessionId,
    p_percent: clamped,
    p_ended: ended,
  })) as QueryResult<ViewSession | null>;
  const row = unwrap(result);
  // PostgREST can surface a missing composite as an all-null row; treat it as absent.
  return row && row.id ? row : null;
}

/**
 * Atomically claim the right to send one alert for a view session.
 * `update … where <column> is null returning id` — a second caller gets zero
 * rows back and therefore false, which is the email debounce.
 */
export async function claimAlert(
  sessionId: string,
  column: AlertColumn,
): Promise<boolean> {
  const result = (await getSupabase()
    .from("view_sessions")
    .update({ [column]: new Date().toISOString() })
    .eq("id", sessionId)
    .is(column, null)
    .select("id")) as QueryResult<{ id: string }[] | null>;
  if (result.error) {
    console.error("claimAlert failed", result.error);
    return false;
  }
  return Array.isArray(result.data) && result.data.length > 0;
}

export async function getSettings(): Promise<Settings> {
  const result = (await getSupabase()
    .from("settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle()) as QueryResult<Settings | null>;
  const row = unwrap(result);
  return (
    row ?? {
      id: 1,
      alert_on_first_view: true,
      alert_on_completion: true,
      updated_at: null,
    }
  );
}
