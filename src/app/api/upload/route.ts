import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { createResumableSession } from "@/lib/google-drive";
import { isSlugTaken } from "@/lib/db";
import { newSlug, normalizeSlug, SLUG_RE } from "@/lib/slug";

const MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

export async function POST(request: Request) {
  let body: { mimeType?: string; sizeBytes?: number; filename?: string; slug?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const mimeType = body.mimeType || "video/webm";
  const sizeBytes = Number(body.sizeBytes);
  const filename = body.filename?.trim() || `yoom-${Date.now()}.webm`;

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Invalid sizeBytes" }, { status: 400 });
  }

  // The slug the user chose in staging, if any; untrusted input, so it still
  // has to pass SLUG_RE and a fresh availability check.
  let slug = newSlug();
  if (typeof body.slug === "string" && body.slug) {
    const wanted = normalizeSlug(body.slug);
    if (!SLUG_RE.test(wanted)) {
      return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    }
    if (await isSlugTaken(wanted)) {
      return NextResponse.json({ error: "That link is already taken" }, { status: 409 });
    }
    slug = wanted;
  }

  // In dev the browser origin is http://localhost:3000; in production it must be
  // the deployed app origin so Google echoes the right CORS headers.
  const origin =
    process.env.NODE_ENV === "production"
      ? appUrl()
      : request.headers.get("origin") || appUrl();

  try {
    const sessionUri = await createResumableSession({
      name: filename,
      mimeType,
      sizeBytes,
      origin,
    });
    // Reserve a slug so the client can put the share link on the clipboard
    // inside the click's transient activation, long before the upload
    // finishes. Nothing is written yet — /api/upload/complete prefers this
    // slug and only mints another one if it has collided by then.
    return NextResponse.json({ sessionUri, slug });
  } catch (error) {
    console.error("createResumableSession failed", error);
    return NextResponse.json(
      { error: "Could not start the upload" },
      { status: 502 },
    );
  }
}
