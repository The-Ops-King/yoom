import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/auth";
import { PasswordGate } from "@/components/password-gate";
import { getVideoById, getVideoStats, listRecentViewers } from "@/lib/db";
import { parseEdits } from "@/lib/edits";
import { appUrl, shareBaseUrl } from "@/lib/env";
import { fmtBytes, fmtDuration, fmtRelative } from "@/lib/format";
import { shareUrl } from "@/lib/share";
import { updateDescription, updateTitle } from "@/app/(owner)/actions";
import { CopyLinkButton } from "@/components/library/copy-link-button";
import { RetentionBars } from "@/components/analytics/retention-bars";
import { StatTiles } from "@/components/analytics/stat-tiles";
import { ViewersTable } from "@/components/analytics/viewers-table";
import { DeleteButton } from "@/components/video/delete-button";
import { EditPlayer } from "@/components/video/edit-player";
import { EditableText } from "@/components/video/editable-text";
import { NewToast } from "@/components/video/new-toast";
import { SlugEditor } from "@/components/video/slug-editor";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!(await isOwner())) return { title: "Yoom" };
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Recording · Yoom" };
  const video = await getVideoById(id);
  return { title: video ? `${video.title} · Yoom` : "Recording · Yoom" };
}

export default async function VideoDetailPage({ params, searchParams }: PageProps) {
  // Page-level gate (the layout alone does not stop this segment from being
  // rendered into the RSC payload). Refuse before any database read.
  if (!(await isOwner())) return <PasswordGate />;

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const video = await getVideoById(id);
  if (!video) notFound();

  const query = await searchParams;
  const isNew = (Array.isArray(query.new) ? query.new[0] : query.new) === "1";

  const [stats, viewers] = await Promise.all([
    getVideoStats(video.id),
    listRecentViewers(video.id),
  ]);

  const edits = parseEdits(video.edits);
  const base = appUrl();
  const link = shareUrl(video.slug);
  const prefix = `${shareBaseUrl()}/v/`;

  return (
    <main className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {isNew && <NewToast message="Uploaded. Share link copied." />}

        <EditPlayer
          src={`${base}/api/stream/${video.id}`}
          poster={
            video.thumbnail_drive_file_id
              ? `${base}/api/thumb/${video.id}`
              : undefined
          }
          edits={edits}
          markers={edits.markers}
        />

        <EditableText
          videoId={video.id}
          name="title"
          value={video.title}
          placeholder="Untitled recording"
          action={updateTitle}
          autoFocus={isNew}
        />

        <EditableText
          videoId={video.id}
          name="description"
          value={video.description ?? ""}
          placeholder="Add a description…"
          action={updateDescription}
          multiline
        />

        <SlugEditor videoId={video.id} slug={video.slug} prefix={prefix} />

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2">
            <span className="block truncate text-sm text-muted">{link}</span>
          </div>
          <CopyLinkButton url={link} />
          <a
            href={`/api/videos/${video.id}/download`}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Download
          </a>
          <DeleteButton videoId={video.id} title={video.title} />
        </div>

        <p className="text-xs text-muted-dim">
          {fmtDuration(video.duration_ms)} · {fmtBytes(video.size_bytes)} ·{" "}
          {video.width && video.height ? `${video.width}×${video.height} · ` : ""}
          recorded {fmtRelative(video.created_at)}
        </p>
      </div>

      <aside className="space-y-3">
        <StatTiles stats={stats} />
        <RetentionBars buckets={stats.buckets} />

        {edits.markers.length > 0 && (
          <section className="rounded-xl border border-border bg-surface p-3">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-dim">
              Markers
            </h2>
            <ol className="mt-2 space-y-1 text-xs text-muted">
              {edits.markers.map((marker, index) => (
                <li
                  key={`${marker.t}-${index}`}
                  className="flex items-baseline gap-2"
                >
                  <span className="tabular-nums text-foreground">
                    {fmtDuration(marker.t * 1000)}
                  </span>
                  <span className="truncate">
                    {marker.label ?? `Marker ${index + 1}`}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <ViewersTable viewers={viewers} />
      </aside>
    </main>
  );
}
