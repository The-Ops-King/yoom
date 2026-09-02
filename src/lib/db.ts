import { cache } from "react";
import type { VideoEdits } from "@/lib/edits";
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
  edits: Record<string, unknown>;
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

export const getVideoBySlug = cache(async (slug: string): Promise<Video | null> => {
  const result = (await getSupabase()
    .from("videos")
    .select("*")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle()) as QueryResult<Video | null>;
  return unwrap(result);
});

export const getVideoById = cache(async (id: string): Promise<Video | null> => {
  const result = (await getSupabase()
    .from("videos")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()) as QueryResult<Video | null>;
  return unwrap(result);
});

export const getVideoIdByOldSlug = cache(async (oldSlug: string): Promise<string | null> => {
  const result = (await getSupabase()
    .from("slug_history")
    .select("video_id")
    .eq("old_slug", oldSlug)
    .maybeSingle()) as QueryResult<{ video_id: string } | null>;
  const row = unwrap(result);
  return row ? row.video_id : null;
});

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

/** Most recent session for this viewer+video started within the last `withinMinutes`, or null. */
export async function findRecentViewSession(
  videoId: string,
  ipHash: string,
  withinMinutes: number,
): Promise<ViewSession | null> {
  const result = (await getSupabase()
    .from("view_sessions")
    .select("*")
    .eq("video_id", videoId)
    .eq("ip_hash", ipHash)
    .gte("started_at", new Date(Date.now() - withinMinutes * 60_000).toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as QueryResult<ViewSession | null>;
  return unwrap(result);
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

export type VideoSort = "newest" | "oldest" | "views" | "title";

export type VideoStatsRow = {
  video_id: string;
  view_count: number;
  unique_viewers: number;
  avg_max_percent: number | string;
  last_viewed_at: string | null;
};

export type VideoListItem = Video & {
  views: number;
  uniqueViewers: number;
  avgMaxPercent: number;
  lastViewedAt: string | null;
};

/**
 * PostgREST's `or=` filter is comma/parenthesis delimited, so those characters
 * cannot appear inside a value. `%` and `_` are `ilike` wildcards. Strip all of
 * them rather than escape them: the search box is a convenience, not a query
 * language.
 */
function sanitizeSearch(term: string): string {
  return term.replace(/[,()*\\%_]/g, "").trim();
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Live videos with their aggregates. `video_stats` is a view, so PostgREST
 * cannot embed it from `videos`; two queries are merged in JS instead.
 */
export async function listVideos(options: {
  q?: string;
  sort: VideoSort;
}): Promise<VideoListItem[]> {
  const { q, sort } = options;

  let query = getSupabase().from("videos").select("*").is("deleted_at", null);

  const term = q ? sanitizeSearch(q) : "";
  if (term) {
    query = query.or(
      `title.ilike.%${term}%,description.ilike.%${term}%,slug.ilike.%${term}%`,
    );
  }

  if (sort === "oldest") query = query.order("created_at", { ascending: true });
  else if (sort === "title") query = query.order("title", { ascending: true });
  else query = query.order("created_at", { ascending: false });

  const videos = unwrap((await query) as QueryResult<Video[] | null>) ?? [];
  if (videos.length === 0) return [];

  const statsResult = (await getSupabase()
    .from("video_stats")
    .select("*")
    .in(
      "video_id",
      videos.map((video) => video.id),
    )) as QueryResult<VideoStatsRow[] | null>;
  const stats = unwrap(statsResult) ?? [];
  const byId = new Map(stats.map((row) => [row.video_id, row]));

  const merged: VideoListItem[] = videos.map((video) => {
    const row = byId.get(video.id);
    return {
      ...video,
      views: row?.view_count ?? 0,
      uniqueViewers: row?.unique_viewers ?? 0,
      avgMaxPercent: row ? round1(Number(row.avg_max_percent) || 0) : 0,
      lastViewedAt: row?.last_viewed_at ?? null,
    };
  });

  // view_count lives in the view, so this ordering cannot be pushed into SQL
  // without a join PostgREST will not infer. Personal-scale row counts.
  if (sort === "views") merged.sort((a, b) => b.views - a.views);

  return merged;
}

export type VideoMetaPatch = { title?: string; description?: string | null };

/** Returns null when the video is missing or soft-deleted, rather than throwing. */
export async function updateVideoMeta(
  id: string,
  patch: VideoMetaPatch,
): Promise<Video | null> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.description !== undefined) {
    const trimmed = (patch.description ?? "").trim();
    update.description = trimmed === "" ? null : trimmed;
  }

  const table = getSupabase().from("videos");
  const query =
    Object.keys(update).length === 0
      ? table.select("*").eq("id", id).is("deleted_at", null).maybeSingle()
      : table
          .update(update)
          .eq("id", id)
          .is("deleted_at", null)
          .select("*")
          .maybeSingle();

  return unwrap((await query) as QueryResult<Video | null>);
}

/**
 * True when `slug` is already in use by another video, either as its current
 * slug or as one of its historical slugs (which still 308-redirect).
 */
export async function isSlugTaken(
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const videoResult = (await getSupabase()
    .from("videos")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()) as QueryResult<{ id: string } | null>;
  const video = unwrap(videoResult);
  if (video && video.id !== excludeId) return true;

  const historyResult = (await getSupabase()
    .from("slug_history")
    .select("video_id")
    .eq("old_slug", slug)
    .maybeSingle()) as QueryResult<{ video_id: string } | null>;
  const history = unwrap(historyResult);
  if (history && history.video_id !== excludeId) return true;

  return false;
}

/** One transaction: record the old slug in slug_history and swap the new one in. */
export async function changeSlug(
  id: string,
  newSlug: string,
): Promise<Video | null> {
  const result = (await getSupabase().rpc("change_video_slug", {
    p_video_id: id,
    p_new_slug: newSlug,
  })) as QueryResult<Video | null>;
  const row = unwrap(result);
  return row && row.id ? row : null;
}

/**
 * Soft delete. Returns the row (so the caller can trash the Drive files) or
 * null when it was already deleted — which makes the action idempotent.
 */
export async function softDeleteVideo(id: string): Promise<Video | null> {
  const result = (await getSupabase()
    .from("videos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle()) as QueryResult<Video | null>;
  return unwrap(result);
}

/** Persist the non-destructive edit decision list (Phase 5 writes it; Phase 3 plumbs it). */
export async function setVideoEdits(id: string, edits: VideoEdits): Promise<void> {
  const result = (await getSupabase()
    .from("videos")
    .update({ edits })
    .eq("id", id)) as QueryResult<unknown>;
  unwrap(result);
}

export type SettingsPatch = {
  alert_on_first_view?: boolean;
  alert_on_completion?: boolean;
};

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const result = (await getSupabase()
    .from("settings")
    .update(patch)
    .eq("id", 1)
    .select("*")
    .single()) as QueryResult<Settings>;
  return unwrap(result);
}

export type VideoStats = {
  views: number;
  unique: number;
  avgMaxPercent: number;
  /** Ten retention buckets: 0–10%, 10–20% … 90–100%. */
  buckets: number[];
};

export type ViewerRow = Pick<
  ViewSession,
  | "id"
  | "viewer_name"
  | "city"
  | "country"
  | "user_agent"
  | "started_at"
  | "last_seen_at"
  | "max_percent"
>;

const VIEWER_COLUMNS =
  "id,viewer_name,city,country,user_agent,started_at,last_seen_at,max_percent";

/**
 * Per-video analytics. The histogram is computed here rather than in SQL so the
 * dashboard needs exactly one round trip and no extra view.
 */
export async function getVideoStats(videoId: string): Promise<VideoStats> {
  const result = (await getSupabase()
    .from("view_sessions")
    .select("max_percent,viewer_name,ip_hash")
    .eq("video_id", videoId)) as QueryResult<
    { max_percent: number; viewer_name: string | null; ip_hash: string | null }[] | null
  >;
  const rows = unwrap(result) ?? [];

  const buckets = new Array<number>(10).fill(0);
  const viewers = new Set<string>();
  let total = 0;

  for (const [index, row] of rows.entries()) {
    const percent = Math.max(0, Math.min(100, Number(row.max_percent) || 0));
    buckets[Math.min(9, Math.floor(percent / 10))] += 1;
    total += percent;
    viewers.add(row.viewer_name ?? row.ip_hash ?? `session-${index}`);
  }

  return {
    views: rows.length,
    unique: viewers.size,
    avgMaxPercent: rows.length === 0 ? 0 : round1(total / rows.length),
    buckets,
  };
}

export async function listRecentViewers(
  videoId: string,
  limit = 50,
): Promise<ViewerRow[]> {
  const result = (await getSupabase()
    .from("view_sessions")
    .select(VIEWER_COLUMNS)
    .eq("video_id", videoId)
    .order("started_at", { ascending: false })
    .limit(limit)) as QueryResult<ViewerRow[] | null>;
  return unwrap(result) ?? [];
}
