import { after } from "next/server";
import { claimAlert, getSettings, getVideoById, updateViewSession } from "@/lib/db";
import { sendSummaryEmail } from "@/lib/alerts";
import { corsHeaders, preflight } from "@/lib/cors";

export const maxDuration = 60;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));

  let body: { sessionId?: string; percent?: number; ended?: boolean };
  try {
    body = JSON.parse(await request.text()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: cors });
  }

  const sessionId = body.sessionId?.trim();
  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, {
      status: 400,
      headers: cors,
    });
  }

  const percent = Math.max(0, Math.min(100, Math.round(Number(body.percent) || 0)));
  const ended = body.ended === true;

  const session = await updateViewSession(sessionId, percent, ended);
  if (!session) {
    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  }

  if (percent >= 100 || ended) {
    after(async () => {
      try {
        const settings = await getSettings();
        if (!settings.alert_on_completion) return;
        const claimed = await claimAlert(sessionId, "summary_sent_at");
        if (!claimed) return;
        const video = await getVideoById(session.video_id);
        if (!video) return;
        await sendSummaryEmail(session, video);
      } catch (error) {
        console.error("summary alert failed", error);
      }
    });
  }

  return Response.json({ ok: true, maxPercent: session.max_percent }, {
    headers: cors,
  });
}
