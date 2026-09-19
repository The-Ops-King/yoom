import { describe, expect, it, vi } from "vitest";

const can = { video: new Set<string>(), audio: new Set<string>() };
vi.mock("mediabunny", () => ({
  canEncodeVideo: async (c: string) => can.video.has(c),
  canEncodeAudio: async (c: string) => can.audio.has(c),
}));

import { pickCodecs } from "./codecs";

describe("pickCodecs", () => {
  it("prefers hardware-friendly avc + aac", async () => {
    can.video = new Set(["avc", "vp9"]); can.audio = new Set(["aac", "opus"]);
    await expect(pickCodecs(1920, 1080, true)).resolves.toEqual({ video: "avc", audio: "aac" });
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
