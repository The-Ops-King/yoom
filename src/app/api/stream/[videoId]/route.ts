import { getVideoById } from "@/lib/db";
import { fetchMedia } from "@/lib/google-drive";
import { RANGE_WINDOW_BYTES, clampRange } from "@/lib/range";
import { corsHeaders, preflight } from "@/lib/cors";

export const maxDuration = 300;

type Context = { params: Promise<{ videoId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

async function handle(request: Request, context: Context, includeBody: boolean) {
  const cors = corsHeaders(request.headers.get("origin"));
  const { videoId } = await context.params;

  if (!UUID_RE.test(videoId)) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  const video = await getVideoById(videoId);
  if (!video) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  const size = video.size_bytes ?? 0;
  let requested = clampRange(
    request.headers.get("range"),
    size,
    RANGE_WINDOW_BYTES,
  );
  // No Range, or one we don't parse (e.g. multi-range): never stream a whole
  // multi-GB file from one invocation. Serve the first window as a 206 and
  // let the player ask for the rest.
  if (requested === null && size > RANGE_WINDOW_BYTES) {
    requested = { start: 0, end: RANGE_WINDOW_BYTES - 1 };
  }

  const headers = new Headers(cors);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", video.mime || "video/webm");
  // `private`: the browser may cache ranges, but no shared cache (Vercel CDN)
  // may store a 206 under this URL and replay it for a different Range.
  headers.set("Cache-Control", "private, max-age=31536000");
  headers.set("ETag", `"${video.drive_file_id}"`);

  if (requested && "unsatisfiable" in requested) {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const upstreamRange = requested
    ? `bytes=${requested.start}-${requested.end}`
    : undefined;

  if (!includeBody) {
    if (size > 0) headers.set("Content-Length", String(size));
    return new Response(null, { status: 200, headers });
  }

  const upstream = await fetchMedia(video.drive_file_id, upstreamRange);
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Upstream error", { status: 502, headers: cors });
  }

  const upstreamContentRange = upstream.headers.get("content-range");
  const upstreamContentLength = upstream.headers.get("content-length");
  if (upstreamContentRange) headers.set("Content-Range", upstreamContentRange);
  if (upstreamContentLength) headers.set("Content-Length", upstreamContentLength);

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}

export async function GET(request: Request, context: Context) {
  return handle(request, context, true);
}

export async function HEAD(request: Request, context: Context) {
  return handle(request, context, false);
}
