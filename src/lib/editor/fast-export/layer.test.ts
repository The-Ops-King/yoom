import { describe, expect, it } from "vitest";
import { asLayer } from "./layer";

describe("asLayer", () => {
  it("exposes a decoded frame's display size as videoWidth/videoHeight", () => {
    const frame = { displayWidth: 2880, displayHeight: 1800 } as unknown as VideoFrame;
    const layer = asLayer(frame);
    expect(layer).toBe(frame); // same object: drawImage still gets the real frame
    expect(layer.videoWidth).toBe(2880);
    expect(layer.videoHeight).toBe(1800);
  });
});
