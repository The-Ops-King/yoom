import { canEncodeAudio, canEncodeVideo } from "mediabunny";

/** Export bitrate. Screen content at this rate is visually lossless in H.264. */
export const VIDEO_BITRATE = 8_000_000;
export const AUDIO_BITRATE = 128_000;

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
    if (await canEncodeVideo(c, { width, height, bitrate: VIDEO_BITRATE })) { video = c; break; }
  }
  if (!video) return null;
  if (!hasAudio) return { video, audio: null };
  for (const a of ["aac", "opus"] as const) {
    if (await canEncodeAudio(a, { bitrate: AUDIO_BITRATE })) return { video, audio: a };
  }
  return null;
}
