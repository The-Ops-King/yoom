import { NextResponse } from "next/server";

// Fallback path used only when Drive refuses CORS on resumable PUTs from the
// browser. Vercel caps request bodies at 4.5 MB, so upload-client.ts switches to
// 4 MB chunks when it targets this route.
export const maxDuration = 60;

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function PUT(request: Request) {
  const sessionUri = request.headers.get("x-upload-session-uri");
  const contentRange = request.headers.get("x-upload-content-range");

  if (!sessionUri || !sessionUri.startsWith("https://")) {
    return NextResponse.json({ error: "Missing upload session URI" }, {
      status: 400,
    });
  }
  if (!contentRange) {
    return NextResponse.json({ error: "Missing content range" }, { status: 400 });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Chunk too large" }, { status: 413 });
  }

  const upstream = await fetch(sessionUri, {
    method: "PUT",
    headers: {
      "Content-Range": contentRange,
      "Content-Type": "application/octet-stream",
    },
    body: body.byteLength > 0 ? body : undefined,
    cache: "no-store",
  });

  const headers = new Headers();
  const range = upstream.headers.get("range");
  if (range) headers.set("Range", range);
  headers.set("Content-Type", "application/json");

  const text = await upstream.text();
  const payload = text.length > 0 ? text : "{}";

  return new NextResponse(payload, { status: upstream.status, headers });
}
