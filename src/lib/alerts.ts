import { Resend } from "resend";
import { env, optionalEnv } from "@/lib/env";
import { getSettings, type Video, type ViewSession } from "@/lib/db";
import { deviceFromUserAgent } from "@/lib/format";
import { shareUrl } from "@/lib/share";

// Kept for backwards compatibility; the implementation lives in format.ts so
// that module can stay free of the server-only chain (format.ts -> alerts.ts
// -> db.ts -> supabase.ts) that would break Client Component imports.
export { deviceFromUserAgent } from "@/lib/format";

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function locationLabel(session: ViewSession): string {
  if (session.city && session.country) return `${session.city}, ${session.country}`;
  if (session.country) return session.country;
  if (session.city) return session.city;
  return "Unknown location";
}

export function viewerLabel(session: ViewSession): string {
  return session.viewer_name?.trim() || "Someone";
}

function layout(headline: string, rows: [string, string][], link: string): string {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#8b8b96;font-size:13px;">${escapeHtml(
          label,
        )}</td><td style="padding:4px 0;color:#f5f3ee;font-size:13px;">${escapeHtml(
          value,
        )}</td></tr>`,
    )
    .join("");

  return [
    `<div style="background:#0c0b0a;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">`,
    `<h1 style="margin:0 0 16px;color:#f5f3ee;font-size:18px;font-weight:600;">${escapeHtml(
      headline,
    )}</h1>`,
    `<table style="border-collapse:collapse;margin-bottom:20px;">${cells}</table>`,
    `<a href="${escapeHtml(link)}" style="display:inline-block;background:#3f7d5c;color:#f5f3ee;`,
    `text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">Open the recording</a>`,
    `<p style="margin:16px 0 0;color:#5e5a54;font-size:12px;">${escapeHtml(link)}</p>`,
    `</div>`,
  ].join("");
}

function plain(headline: string, rows: [string, string][], link: string): string {
  return [headline, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", link].join("\n");
}

export function renderFirstPlayEmail(
  session: ViewSession,
  video: Video,
): RenderedEmail {
  const link = shareUrl(video.slug);
  const headline = `${viewerLabel(session)} started watching ${video.title}`;
  const rows: [string, string][] = [
    ["Viewer", viewerLabel(session)],
    ["Location", locationLabel(session)],
    ["Device", deviceFromUserAgent(session.user_agent)],
    ["Video", video.title],
  ];
  return {
    subject: `▶ ${headline}`,
    html: layout(headline, rows, link),
    text: plain(headline, rows, link),
  };
}

export function renderSummaryEmail(
  session: ViewSession,
  video: Video,
): RenderedEmail {
  const link = shareUrl(video.slug);
  const percent = Math.max(0, Math.min(100, session.max_percent));
  const headline = `${viewerLabel(session)} watched ${percent}% of ${video.title}`;
  const rows: [string, string][] = [
    ["Viewer", viewerLabel(session)],
    ["Watched", `${percent}%`],
    ["Location", locationLabel(session)],
    ["Device", deviceFromUserAgent(session.user_agent)],
    ["Video", video.title],
  ];
  return {
    subject: `✅ ${headline}`,
    html: layout(headline, rows, link),
    text: plain(headline, rows, link),
  };
}

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) resend = new Resend(env("RESEND_API_KEY"));
  return resend;
}

async function send(email: RenderedEmail): Promise<void> {
  const apiKey = optionalEnv("RESEND_API_KEY");
  const from = optionalEnv("ALERT_FROM_EMAIL");
  const to = optionalEnv("ALERT_TO_EMAIL");
  if (!apiKey) {
    console.warn("Skipping alert email: RESEND_API_KEY is not set");
    return;
  }
  if (!from) {
    console.warn("Skipping alert email: ALERT_FROM_EMAIL is not set");
    return;
  }
  if (!to) {
    console.warn("Skipping alert email: ALERT_TO_EMAIL is not set");
    return;
  }

  const { error } = await getResend().emails.send({
    from,
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (error) throw new Error(`Resend failed: ${error.message}`);
}

export async function sendFirstPlayEmail(
  session: ViewSession,
  video: Video,
): Promise<void> {
  const settings = await getSettings();
  if (!settings.alert_on_first_view) return;
  await send(renderFirstPlayEmail(session, video));
}

export async function sendSummaryEmail(
  session: ViewSession,
  video: Video,
): Promise<void> {
  const settings = await getSettings();
  if (!settings.alert_on_completion) return;
  await send(renderSummaryEmail(session, video));
}
