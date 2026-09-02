import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getVideoById, getVideoBySlug, getVideoIdByOldSlug } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { shareUrl } from "@/lib/share";
import { SLUG_RE } from "@/lib/slug";
import { WatchView } from "@/components/watch-view";

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Resolve a slug to a live video, following one hop of slug history.
 * Returns `{ redirectTo }` when the caller should 308 to the current slug.
 */
async function resolve(slug: string) {
  if (!SLUG_RE.test(slug)) return { video: null, redirectTo: null };

  const video = await getVideoBySlug(slug);
  if (video) return { video, redirectTo: null };

  const videoId = await getVideoIdByOldSlug(slug);
  if (!videoId) return { video: null, redirectTo: null };

  const current = await getVideoById(videoId);
  if (!current) return { video: null, redirectTo: null };

  return { video: null, redirectTo: `/v/${current.slug}` };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return { title: "Video not found" };

  const video = await getVideoBySlug(slug);
  if (!video) return { title: "Video not found" };

  const base = appUrl();
  const canonical = shareUrl(video.slug);
  const images = video.thumbnail_drive_file_id
    ? [`${base}/api/thumb/${video.id}`]
    : undefined;

  return {
    title: video.title,
    description: video.description ?? "Shared with Yoom",
    alternates: { canonical },
    openGraph: {
      type: "video.other",
      title: video.title,
      description: video.description ?? "Shared with Yoom",
      url: canonical,
      images,
      videos: [
        {
          url: `${base}/api/stream/${video.id}`,
          type: video.mime || "video/webm",
          width: video.width ?? undefined,
          height: video.height ?? undefined,
        },
      ],
    },
    twitter: {
      card: "player",
      title: video.title,
      description: video.description ?? "Shared with Yoom",
      images,
    },
  };
}

export default async function WatchPage({ params }: PageProps) {
  const { slug } = await params;
  const { video, redirectTo } = await resolve(slug);

  if (redirectTo) permanentRedirect(redirectTo);
  if (!video) notFound();

  return (
    <WatchView
      video={{
        id: video.id,
        slug: video.slug,
        title: video.title,
        description: video.description,
        durationMs: video.duration_ms,
        hasThumbnail: Boolean(video.thumbnail_drive_file_id),
      }}
      apiBase={appUrl()}
      shareUrl={shareUrl(video.slug)}
    />
  );
}
