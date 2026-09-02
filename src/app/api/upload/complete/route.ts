import { NextResponse } from "next/server";
import { DbError, UNIQUE_VIOLATION, insertVideo, updateVideoMeta } from "@/lib/db";
import { getFileMeta } from "@/lib/google-drive";
import { newSlug, SLUG_RE } from "@/lib/slug";
import { parseEdits } from "@/lib/edits";
import { shareUrl } from "@/lib/share";

function defaultTitle(): string {
  return `Recording — ${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date())}`;
}

export async function POST(request: Request) {
  let body: {
    driveFileId?: string;
    title?: string;
    description?: string;
    durationMs?: number;
    width?: number;
    height?: number;
    slug?: string;
    markers?: unknown;
    edits?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const driveFileId = body.driveFileId?.trim();
  if (!driveFileId) {
    return NextResponse.json({ error: "driveFileId is required" }, { status: 400 });
  }

  let meta;
  try {
    meta = await getFileMeta(driveFileId);
  } catch (error) {
    console.error("getFileMeta failed", error);
    return NextResponse.json({ error: "Drive file not found" }, { status: 404 });
  }

  if (meta.trashed) {
    return NextResponse.json({ error: "Drive file is trashed" }, { status: 404 });
  }

  const title = body.title?.trim() || defaultTitle();

  // The slug the client reserved from /api/upload and already copied to the
  // user's clipboard. Untrusted input, so it still has to pass SLUG_RE.
  const reserved =
    typeof body.slug === "string" && SLUG_RE.test(body.slug) ? body.slug : null;

  // The staging edit list. `parseEdits` is the single normaliser: caps, clamps
  // and unknown keys are all handled there, so a hostile client cannot stuff
  // the column. Legacy clients that still send `markers` alone are honoured.
  const edits = parseEdits(
    body.edits && typeof body.edits === "object"
      ? body.edits
      : {
          version: 1,
          cuts: [],
          crop: null,
          zooms: [],
          overlays: [],
          markers: Array.isArray(body.markers) ? body.markers : [],
        },
  );
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 2000) : null;
  const toInt = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    // Prefer the reserved slug on the first attempt so the link already on the
    // clipboard stays correct; a genuine collision falls back to a fresh one.
    const slug = attempt === 0 && reserved ? reserved : newSlug();
    try {
      const video = await insertVideo({
        slug,
        title,
        drive_file_id: meta.id,
        mime: meta.mimeType || "video/webm",
        size_bytes: meta.size,
        duration_ms: toInt(body.durationMs),
        width: toInt(body.width),
        height: toInt(body.height),
        edits,
      });
      // `NewVideo` has no `description` column yet, so it can't go through
      // `insertVideo` above; fold it in with the existing metadata patch path
      // instead of widening the insert type here. The video is already saved
      // at this point, so a failure here must not surface as a save error.
      if (description) {
        try {
          await updateVideoMeta(video.id, { description });
        } catch (error) {
          console.error("updateVideoMeta (description) failed", error);
        }
      }
      return NextResponse.json({
        id: video.id,
        slug: video.slug,
        url: shareUrl(video.slug),
      });
    } catch (error) {
      if (error instanceof DbError && error.code === UNIQUE_VIOLATION) {
        // Either the slug collided (retry) or this Drive file is already
        // recorded (surface it as a conflict rather than looping). Match the
        // videos_drive_file_id_key unique constraint specifically, not the
        // slug's own unique constraint, which also mentions "drive_file_id"
        // only incidentally in some drivers' error text.
        if (
          error.message.includes("drive_file_id") ||
          error.message.includes("videos_drive_file_id_key")
        ) {
          return NextResponse.json(
            { error: "This recording was already saved" },
            { status: 409 },
          );
        }
        continue;
      }
      console.error("insertVideo failed", error);
      return NextResponse.json({ error: "Could not save the recording" }, {
        status: 500,
      });
    }
  }

  return NextResponse.json({ error: "Could not allocate a slug" }, { status: 500 });
}
