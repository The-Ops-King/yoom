import { canEncodeAudio, canEncodeVideo } from "mediabunny";

/**
 * Export bitrate. The legacy real-time exporter used 10 Mbps VP9; 8 Mbps H.264 is roughly 20%
 * smaller for screen content at the same perceived quality, which directly shortens the upload.
 * Provisional: Task 10 of the fast-export plan measures this on real hardware and may tune it.
 */
export const VIDEO_BITRATE = 8_000_000;
export const AUDIO_BITRATE = 128_000;

/**
 * The exporter always writes fragmented MP4 regardless of this pair (MP4 legitimately carries
 * vp9/opus as well as avc/aac) because fragmented output is what lets bytes stream to Drive in
 * order while rendering, so no codec-to-container mapping belongs here.
 */
export type CodecPair = { video: "avc" | "vp9" | "vp8"; audio: "aac" | "opus" | null };

/**
 * Best encodable pair for this size, or null when the fast path cannot run.
 *
 * A machine that can encode video but has no usable audio codec still returns null when the
 * take has audio: falling back to the legacy real-time exporter is better than silently
 * producing a video with the user's voice dropped.
 */
export async function pickCodecs(width: number, height: number, hasAudio: boolean): Promise<CodecPair | null> {
  let video: CodecPair["video"] | null = null;
  for (const c of ["avc", "vp9", "vp8"] as const) {
    // `bitrate` is deprecated in mediabunny in favor of a coarse `quality` enum, but it's used
    // intentionally here: we need exact control over the byte rate for upload-size tuning, which
    // `quality` can't express. Do not "fix" this to `quality`.
    if (await canEncodeVideo(c, { width, height, bitrate: VIDEO_BITRATE })) { video = c; break; }
  }
  if (!video) return null;
  if (!hasAudio) return { video, audio: null };
  for (const a of ["aac", "opus"] as const) {
    // Same reasoning as above: `bitrate` over `quality` for exact byte-rate control.
    if (await canEncodeAudio(a, { bitrate: AUDIO_BITRATE })) return { video, audio: a };
  }
  return null;
}
