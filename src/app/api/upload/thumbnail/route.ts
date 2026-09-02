import { NextResponse } from "next/server";
import { getVideoById, setVideoThumbnail } from "@/lib/db";
import { uploadSmall } from "@/lib/google-drive";

const MAX_THUMBNAIL_BYTES = 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form data" }, {
      status: 400,
    });
  }

  const videoId = String(form.get("videoId") ?? "").trim();
  const file = form.get("file");

  if (!videoId || !(file instanceof File)) {
    return NextResponse.json({ error: "videoId and file are required" }, {
      status: 400,
    });
  }
  if (file.size === 0 || file.size > MAX_THUMBNAIL_BYTES) {
    return NextResponse.json({ error: "Thumbnail must be 1 MB or less" }, {
      status: 413,
    });
  }

  const video = await getVideoById(videoId);
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  try {
    const bytes = await file.arrayBuffer();
    const thumbnailId = await uploadSmall(
      `${video.slug}-thumb.jpg`,
      "image/jpeg",
      bytes,
    );
    await setVideoThumbnail(video.id, thumbnailId);
    return NextResponse.json({ thumbnailDriveFileId: thumbnailId });
  } catch (error) {
    console.error("thumbnail upload failed", error);
    return NextResponse.json({ error: "Thumbnail upload failed" }, { status: 502 });
  }
}
