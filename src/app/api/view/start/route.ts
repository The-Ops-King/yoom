import { after } from "next/server";
import {
  claimAlert,
  createViewSession,
  getVideoById,
  getViewSession,
} from "@/lib/db";
import { readViewerContext } from "@/lib/geo";
import { sendFirstPlayEmail } from "@/lib/alerts";
import { corsHeaders, preflight } from "@/lib/cors";

export const maxDuration = 60;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));

  let body: { videoId?: string; viewerName?: string };
  try {
    body = JSON.parse(await request.text()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: cors });
  }

  const videoId = body.videoId?.trim();
  if (!videoId) {
    return Response.json({ error: "videoId is required" }, {
      status: 400,
      headers: cors,
    });
  }

  const video = await getVideoById(videoId);
  if (!video) {
    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  }

  const viewer = readViewerContext(request);
  const viewerName = body.viewerName?.trim().slice(0, 80) || null;

  const sessionId = await createViewSession({
    video_id: video.id,
    viewer_name: viewerName,
    ip_hash: viewer.ipHash,
    user_agent: viewer.userAgent,
    country: viewer.country,
    city: viewer.city,
  });

  after(async () => {
    try {
      const claimed = await claimAlert(sessionId, "alert_sent_at");
      if (!claimed) return;
      const session = await getViewSession(sessionId);
      if (!session) return;
      await sendFirstPlayEmail(session, video);
    } catch (error) {
      console.error("first-play alert failed", error);
    }
  });

  return Response.json({ sessionId }, { headers: cors });
}
