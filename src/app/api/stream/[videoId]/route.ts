import { getVideoById } from "@/lib/db";
import { fetchMedia } from "@/lib/google-drive";
import { RANGE_WINDOW_BYTES, planUpstreamRange } from "@/lib/range";
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
  // `clampRange` (via `planUpstreamRange`) handles the known-size case: no
  // Range, or one we don't parse (e.g. multi-range), never streams a whole
  // multi-GB file from one invocation — it serves the first window as a 206
  // and lets the player ask for the rest. When Drive omitted `size` we can't
  // clamp against it, so we forward the client's Range verbatim or force a
  // bounded first-window request; see `planUpstreamRange`.
  const plan = planUpstreamRange(
    request.headers.get("range"),
    size,
    RANGE_WINDOW_BYTES,
  );

  const headers = new Headers(cors);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", video.mime || "video/webm");
  // `private`: the browser may cache ranges, but no shared cache (Vercel CDN)
  // may store a 206 under this URL and replay it for a different Range.
  headers.set("Cache-Control", "private, max-age=31536000");
  headers.set("ETag", `"${video.drive_file_id}"`);

  if (plan.kind === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const upstreamRange =
    plan.kind === "range"
      ? `bytes=${plan.start}-${plan.end}`
      : plan.kind === "passthrough"
        ? plan.header
        : undefined;

  if (!includeBody) {
    if (plan.kind === "range") {
      headers.set("Content-Range", `bytes ${plan.start}-${plan.end}/${size}`);
      headers.set("Content-Length", String(plan.end - plan.start + 1));
      return new Response(null, { status: 206, headers });
    }
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
