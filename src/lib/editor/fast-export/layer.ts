import type { VideoLayer } from "../render";

/**
 * Give a decoded frame the two properties `drawFrame` reads. This MUTATES
 * `frame` in place and returns that same object (no wrapper, no copy) so
 * `drawImage` still receives a genuine `VideoFrame`. The properties are
 * `configurable`, so calling this more than once on the same frame is safe.
 *
 * Lifetime: `videoWidth`/`videoHeight` are plain JS properties, so they
 * survive `frame.close()`. The underlying frame does not — it's unusable for
 * `drawImage` once closed. The exporter loop closes each frame after it's
 * drawn, so callers must draw (or otherwise consume the pixels) before
 * closing.
 */
export function asLayer(frame: VideoFrame): VideoLayer {
  Object.defineProperties(frame, {
    videoWidth: { value: frame.displayWidth, configurable: true },
    videoHeight: { value: frame.displayHeight, configurable: true },
  });
  return frame as unknown as VideoLayer;
}
