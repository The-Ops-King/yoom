import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  type StreamTargetChunk,
  type VideoSample,
  type WrappedAudioBuffer,
} from "mediabunny";
import type { VideoEdits } from "@/lib/edits";
import { CHUNK_SIZE_BYTES } from "@/lib/upload-client";
import { editedToSourceIn, keptRanges, type Range } from "../cuts";
import {
  buildRenderInputs,
  loadBackground,
  releaseBackground,
  type RenderOptions,
  type RenderSources,
} from "../export";
import { drawFrame, outputSize, preloadOverlayImages, type VideoLayer } from "../render";
import { AudioAssembler } from "./audio-assembler";
import { AUDIO_BITRATE, VIDEO_BITRATE, pickCodecs } from "./codecs";
import { asLayer } from "./layer";
import { cameraTimes, frameCount, sourceTimes, thumbnailFrame } from "./timeline";

export type FastRenderOptions = RenderOptions & {
  /** Receives the output file's bytes strictly in order. Awaited (backpressure). */
  onChunk: (data: Uint8Array, position: number) => Promise<void>;
};

export type FastRenderResult = {
  mimeType: string;
  size: number;
  thumbnail: Blob | null;
  width: number;
  height: number;
};

/** Thrown when this machine cannot fast-export; the caller falls back to `renderToBlob`. */
export class FastExportUnsupported extends Error {}

const FPS = 30;

/** Audio is kept this far ahead of video so the muxer can interleave without buffering. */
const AUDIO_LEAD_S = 1;

/** Thumbnail JPEG quality — the same as the legacy exporter's, so takes look alike. */
const THUMBNAIL_QUALITY = 0.8;

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Source second at an edited second, clamped to the last range's end. An
 * infinite edited time means "everything that is left", which the audio pump
 * reads as "drain the decoder".
 */
function sourceAtEdited(ranges: Range[], editedS: number): number {
  if (!Number.isFinite(editedS)) return Infinity;
  return editedToSourceIn(ranges, editedS);
}

/**
 * The drawable for a decoded sample, sized the way `drawFrame` expects.
 *
 * `toCanvasImageSource()` hands back either the sample's own `VideoFrame` or,
 * for a canvas-backed sample, that canvas — and whatever it returns must be
 * used before the next microtask, so callers draw immediately and never store
 * the result. `asLayer` covers the frame case; a canvas has no `displayWidth`,
 * so it gets the same two properties straight off the sample.
 */
function layerOf(sample: VideoSample): VideoLayer {
  const source = sample.toCanvasImageSource();
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) return asLayer(source);
  Object.defineProperties(source, {
    videoWidth: { value: sample.displayWidth, configurable: true },
    videoHeight: { value: sample.displayHeight, configurable: true },
  });
  return source as unknown as VideoLayer;
}

/**
 * Renders the kept ranges frame by frame with WebCodecs: every output frame's
 * source time is decoded on demand, drawn with the same `drawFrame` the
 * preview uses, and encoded on the hardware encoder into a FRAGMENTED MP4.
 *
 * Unlike `renderToBlob` this never plays anything, so it cannot stall and is
 * not capped at 1×. A fragmented MP4 is written monotonically, so `onChunk`
 * sees the file's bytes strictly in order and can stream them to an upload
 * that is still running while the render is.
 *
 * Throws `FastExportUnsupported` when this machine has no WebCodecs or no
 * encodable codec pair; the caller then falls back to `renderToBlob`.
 */
export async function renderFast(
  sources: RenderSources,
  edits: VideoEdits,
  opts: FastRenderOptions,
): Promise<FastRenderResult> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    throw new FastExportUnsupported("This machine has no WebCodecs.");
  }
  const fps = opts.fps ?? FPS;
  const primaryBlob = sources.mode === "camera" ? sources.camera : sources.screen;
  if (!primaryBlob) throw new Error("Nothing to render.");

  const inputs: Input[] = [];
  const open = (blob: Blob) => {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    inputs.push(input);
    return input;
  };

  let background: HTMLImageElement | HTMLVideoElement | null = null;
  let output: Output | null = null;
  // Held at function scope so the `finally` can close them however we leave:
  // a decoded sample that is never closed pins a decoder buffer, and a few
  // hundred of those wedge the decoder for good.
  let screenSamples: AsyncGenerator<VideoSample | null, void, unknown> | null = null;
  let cameraSamples: AsyncGenerator<VideoSample | null, void, unknown> | null = null;
  let audioBuffers: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null = null;
  let lastScreen: VideoSample | null = null;
  let lastCamera: VideoSample | null = null;

  try {
    const primaryIn = open(primaryBlob);
    const video = await primaryIn.getPrimaryVideoTrack();
    if (!video) throw new Error("The recording has no video track we can render.");
    const audio = await primaryIn.getPrimaryAudioTrack();
    const cameraTrack =
      sources.mode === "screen+camera" && sources.camera
        ? await open(sources.camera).getPrimaryVideoTrack()
        : null;

    const { width, height } = outputSize(video.displayWidth, video.displayHeight, edits);
    const codecs = await pickCodecs(width, height, !!audio);
    if (!codecs) throw new FastExportUnsupported("No encodable codec pair on this machine.");

    const ranges = keptRanges(edits, sources.durationMs / 1000);
    if (!ranges.length) throw new Error("Everything is cut. Keep at least part of the take.");

    background = await loadBackground(edits);
    // Image overlays decode asynchronously; drawFrame is sync and skips images
    // that are not ready, so decode them all before the first frame.
    await preloadOverlayImages(edits);

    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("No 2D context.");
    const renderInputs = buildRenderInputs(sources, edits, background, opts);

    const frames = frameCount(ranges, fps);
    const thumbAt = thumbnailFrame(opts.thumbnailAt, frames, fps);

    let size = 0;
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: "fragmented" }),
      target: new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          write: async (chunk) => {
            // Fragmented output is written monotonically, so the furthest write
            // that has landed is the file's length so far.
            size = Math.max(size, chunk.position + chunk.data.byteLength);
            await opts.onChunk(chunk.data, chunk.position);
          },
        }),
        { chunked: true, chunkSize: CHUNK_SIZE_BYTES },
      ),
    });
    const videoOut = new CanvasSource(canvas, {
      codec: codecs.video,
      bitrate: VIDEO_BITRATE,
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoOut, { frameRate: fps });

    let audioOut: AudioBufferSource | null = null;
    let assembler: AudioAssembler | null = null;
    let sampleRate = 48_000;
    if (audio && codecs.audio) {
      audioOut = new AudioBufferSource({ codec: codecs.audio, bitrate: AUDIO_BITRATE });
      output.addAudioTrack(audioOut);
      sampleRate = audio.sampleRate;
      assembler = new AudioAssembler(ranges, sampleRate, audio.numberOfChannels);
      audioBuffers = new AudioBufferSink(audio).buffers(ranges[0].start);
    }
    await output.start();

    /** Source seconds of decoded audio already handed to the assembler. */
    let audioSourceEdge = 0;
    /** Edited audio frames already handed to the encoder. */
    let audioDrained = 0;
    const pumpAudio = async (untilEditedS: number) => {
      if (!assembler || !audioBuffers || !audioOut) return;
      // Decoded audio is pulled in stream order, and edited time increases with
      // source time, so everything the window needs lies before this source second.
      const needSource = sourceAtEdited(ranges, untilEditedS);
      while (audioSourceEdge < needSource) {
        if (opts.signal.aborted) throw abortError();
        const next = await audioBuffers.next();
        if (next.done) { audioSourceEdge = Infinity; break; }
        const { buffer, timestamp } = next.value;
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
          buffer.getChannelData(c),
        );
        assembler.push(channels, timestamp);
        audioSourceEdge = timestamp + buffer.duration;
      }
      const block = assembler.drain(Math.round(untilEditedS * sampleRate));
      if (block.frames === 0) return;
      const encoded = new AudioBuffer({
        length: block.frames,
        numberOfChannels: block.channels.length,
        sampleRate,
      });
      // The assembler's blocks are `slice()`s of its own arrays, so they are
      // always ArrayBuffer-backed; `Float32Array[]` just doesn't say so.
      block.channels.forEach((channel, c) =>
        encoded.copyToChannel(channel as Float32Array<ArrayBuffer>, c),
      );
      // Buffers are placed back to back, so this must stay contiguous.
      await audioOut.add(encoded);
      audioDrained += block.frames;
    };

    const times = [...sourceTimes(ranges, fps)];
    const offsetS = (edits.cameraOffsetMs ?? 0) / 1000;
    screenSamples = new VideoSampleSink(video).samplesAtTimestamps(times);
    // `cameraTimes` only guarantees NON-decreasing timestamps (a plateau when the
    // camera started late). `samplesAtTimestamps` handles that: a repeated
    // timestamp resolves to the same packet and is emitted again as a clone, so
    // the stream still yields exactly one (possibly null) sample per request.
    cameraSamples = cameraTrack
      ? new VideoSampleSink(cameraTrack).samplesAtTimestamps(cameraTimes(times, offsetS))
      : null;

    let thumbnail: Blob | null = null;
    let reported = -1;
    for (let k = 0; k < frames; k++) {
      if (opts.signal.aborted) throw abortError();
      const editedT = k / fps;
      // Keep the audio track ahead of the video one: whichever runs behind makes
      // the muxer hold the other's packets in memory until it catches up.
      if (audioOut && audioDrained / sampleRate < editedT + AUDIO_LEAD_S / 2) {
        await pumpAudio(editedT + AUDIO_LEAD_S);
      }

      const screen = (await screenSamples.next()).value ?? null;
      if (screen) { lastScreen?.close(); lastScreen = screen; }
      if (cameraSamples) {
        const camera = (await cameraSamples.next()).value ?? null;
        if (camera) { lastCamera?.close(); lastCamera = camera; }
      }

      // A missing sample (a VFR gap, or past the end of a short file) repeats the
      // last one. Everything from here to `drawFrame` is synchronous on purpose:
      // `toCanvasImageSource()` may hand back a frame that closes itself on the
      // next microtask, so an await in between would draw a closed frame.
      const primaryLayer = lastScreen ? layerOf(lastScreen) : null;
      renderInputs.screen = sources.mode === "camera" ? null : primaryLayer;
      renderInputs.camera = sources.mode === "camera"
        ? primaryLayer
        : lastCamera ? layerOf(lastCamera) : null;
      drawFrame(ctx, renderInputs, times[k], width, height);

      await videoOut.add(editedT, 1 / fps);
      if (k === thumbAt) {
        thumbnail = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", THUMBNAIL_QUALITY),
        );
      }
      // 100 is the caller's cue that the file is complete; hold it back to 99
      // until finalize has actually run.
      const pct = Math.min(99, Math.floor(((k + 1) / frames) * 100));
      if (pct !== reported) { reported = pct; opts.onProgress(pct); }
    }

    // Anything the lead never reached — the last second of audio, and the tail
    // past the last video frame.
    await pumpAudio(Infinity);
    await output.finalize();
    opts.onProgress(100);
    return { mimeType: output.format.mimeType, size, thumbnail, width, height };
  } catch (err) {
    // Releases the encoders and the target; safe to call before `start()` and a
    // no-op once finalized.
    if (output && output.state !== "finalized") await output.cancel().catch(() => undefined);
    throw err;
  } finally {
    lastScreen?.close();
    lastCamera?.close();
    lastScreen = null;
    lastCamera = null;
    // `return()` stops each pump and closes every sample still queued behind it.
    // Without it an abort leaves decoded frames alive and the decoder wedged.
    await screenSamples?.return().catch(() => undefined);
    await cameraSamples?.return().catch(() => undefined);
    await audioBuffers?.return().catch(() => undefined);
    for (const input of inputs) input.dispose();
    releaseBackground(background);
  }
}
