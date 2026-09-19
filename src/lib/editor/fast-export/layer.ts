import type { VideoLayer } from "../render";

/**
 * Give a decoded frame the two properties `drawFrame` reads. Defined on the
 * frame itself so `drawImage` still receives a genuine `VideoFrame`.
 */
export function asLayer(frame: VideoFrame): VideoLayer {
  Object.defineProperties(frame, {
    videoWidth: { value: frame.displayWidth, configurable: true },
    videoHeight: { value: frame.displayHeight, configurable: true },
  });
  return frame as unknown as VideoLayer;
}
