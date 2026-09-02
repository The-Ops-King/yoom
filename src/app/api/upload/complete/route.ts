import { NextResponse } from "next/server";
import { DbError, UNIQUE_VIOLATION, insertVideo } from "@/lib/db";
import { getFileMeta } from "@/lib/google-drive";
import { newSlug } from "@/lib/slug";
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
    durationMs?: number;
    width?: number;
    height?: number;
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
  const toInt = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = newSlug();
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
      });
      return NextResponse.json({
        id: video.id,
        slug: video.slug,
        url: shareUrl(video.slug),
      });
    } catch (error) {
      if (error instanceof DbError && error.code === UNIQUE_VIOLATION) {
        // Either the slug collided (retry) or this Drive file is already
        // recorded (surface it as a conflict rather than looping).
        if (error.message.includes("drive_file_id")) {
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
