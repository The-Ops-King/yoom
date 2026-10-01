import { createViewSession, getVideoById, recordPlaybackError } from "@/lib/db";
import { readViewerContext } from "@/lib/geo";
import { mediaErrorName, normalizeErrorCode } from "@/lib/drive-embed";
import { corsHeaders, preflight } from "@/lib/cors";

export const maxDuration = 60;

/** Plenty for a browser's error text; the column is not a log sink. */
const DETAIL_MAX = 500;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

/**
 * A viewer's player failed. Record what the browser said.
 *
 * `sessionId` is optional on purpose: `useViewTracker` only opens a session on
 * the `play` event, so a video that fails to load before the first tap has no
 * session at all — which is exactly the case that went unrecorded before. When
 * no session is supplied this opens one so the failure has somewhere to live.
 */
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));

  let body: {
    videoId?: string;
    sessionId?: string;
    code?: unknown;
    detail?: string;
    usedFallback?: boolean;
    viewerName?: string;
  };
  try {
    body = JSON.parse(await request.text()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: cors });
  }

  const videoId = body.videoId?.trim();
  if (!videoId) {
    return Response.json({ error: "videoId is required" }, { status: 400, headers: cors });
  }

  const video = await getVideoById(videoId);
  if (!video) {
    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  }

  const code = normalizeErrorCode(body.code);
  const usedFallback = body.usedFallback === true;
  const detail = [mediaErrorName(code), body.detail?.trim()]
    .filter(Boolean)
    .join(": ")
    .slice(0, DETAIL_MAX);

  let sessionId = body.sessionId?.trim() || null;
  if (!sessionId) {
    const viewer = readViewerContext(request);
    sessionId = await createViewSession({
      video_id: video.id,
      viewer_name: body.viewerName?.trim().slice(0, 80) || null,
      ip_hash: viewer.ipHash,
      user_agent: viewer.userAgent,
      country: viewer.country,
      city: viewer.city,
    });
  }

  const recorded = await recordPlaybackError(sessionId, code, detail, usedFallback);
  if (!recorded) {
    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  }

  // Logged as well as stored: this is the line that turns "someone said it
  // broke" into a timestamp, a route and a MediaError code in the Vercel logs.
  console.warn("[Yoom] playback error", {
    videoId: video.id,
    slug: video.slug,
    mime: video.mime,
    code,
    detail,
    usedFallback,
  });

  return Response.json({ ok: true, sessionId }, { headers: cors });
}
