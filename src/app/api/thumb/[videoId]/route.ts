import { getVideoById } from "@/lib/db";
import { fetchMedia } from "@/lib/google-drive";
import { corsHeaders, preflight } from "@/lib/cors";

export const maxDuration = 60;

type Context = { params: Promise<{ videoId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request, context: Context) {
  const cors = corsHeaders(request.headers.get("origin"));
  const { videoId } = await context.params;

  if (!UUID_RE.test(videoId)) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  const video = await getVideoById(videoId);
  if (!video?.thumbnail_drive_file_id) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  const upstream = await fetchMedia(video.thumbnail_drive_file_id);
  if (!upstream.ok) {
    return new Response("Upstream error", { status: 502, headers: cors });
  }

  const headers = new Headers(cors);
  headers.set("Content-Type", "image/jpeg");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", `"${video.thumbnail_drive_file_id}"`);
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { status: 200, headers });
}
