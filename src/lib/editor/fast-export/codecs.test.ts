import { describe, expect, it, vi } from "vitest";

const can = { video: new Set<string>(), audio: new Set<string>() };
const { canEncodeVideoMock, canEncodeAudioMock } = vi.hoisted(() => ({
  canEncodeVideoMock: vi.fn(),
  canEncodeAudioMock: vi.fn(),
}));
vi.mock("mediabunny", () => ({
  canEncodeVideo: canEncodeVideoMock,
  canEncodeAudio: canEncodeAudioMock,
}));
canEncodeVideoMock.mockImplementation(async (c: string) => can.video.has(c));
canEncodeAudioMock.mockImplementation(async (c: string) => can.audio.has(c));

import { pickCodecs, VIDEO_BITRATE } from "./codecs";

describe("pickCodecs", () => {
  it("prefers hardware-friendly avc + aac", async () => {
    can.video = new Set(["avc", "vp9"]); can.audio = new Set(["aac", "opus"]);
    await expect(pickCodecs(1920, 1080, true)).resolves.toEqual({ video: "avc", audio: "aac" });
    expect(canEncodeVideoMock).toHaveBeenCalledWith("avc", { width: 1920, height: 1080, bitrate: VIDEO_BITRATE });
  });
  it("falls back to vp9 + opus", async () => {
    can.video = new Set(["vp9"]); can.audio = new Set(["opus"]);
    await expect(pickCodecs(1920, 1080, true)).resolves.toEqual({ video: "vp9", audio: "opus" });
  });
  it("needs no audio codec for a silent take", async () => {
    can.video = new Set(["avc"]); can.audio = new Set();
    await expect(pickCodecs(1920, 1080, false)).resolves.toEqual({ video: "avc", audio: null });
  });
  it("returns null when nothing usable exists (caller uses the legacy exporter)", async () => {
    can.video = new Set(); can.audio = new Set(["aac"]);
    await expect(pickCodecs(1920, 1080, true)).resolves.toBeNull();
  });
});
