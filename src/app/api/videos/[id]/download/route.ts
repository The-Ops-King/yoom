import { getVideoById } from "@/lib/db";
import { fetchMedia } from "@/lib/google-drive";

// Large files stream through this function; give it the same headroom as
// /api/stream.
export const maxDuration = 300;

function extensionFor(mime: string): string {
  if (mime.startsWith("video/mp4")) return "mp4";
  if (mime.startsWith("video/quicktime")) return "mov";
  return "webm";
}

/**
 * Owner-only original download. `src/proxy.ts` gates `/api/videos/*` on the
 * session cookie, so this handler only has to find the file.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const video = await getVideoById(id);
  if (!video) {
    return new Response("Not found", { status: 404 });
  }

  const upstream = await fetchMedia(video.drive_file_id);
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream error", { status: 502 });
  }

  const filename = `${video.slug}.${extensionFor(video.mime || "video/webm")}`;
  const headers = new Headers();
  headers.set("Content-Type", video.mime || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "private, no-store");
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { status: 200, headers });
}
