import { afterEach, describe, expect, it, vi } from "vitest";
import { createFpsOverlay, createNoopOverlay, debugOverlaysEnabled } from "./overlays";
import type { FrameInfo } from "./types";

function fakeCtx() {
  const calls: string[] = [];
  return {
    calls,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    fillRect: () => calls.push("fillRect"),
    fillText: (text: string) => calls.push(`fillText:${text}`),
    set font(v: string) {
      calls.push(`font:${v}`);
    },
    set fillStyle(v: string) {
      calls.push(`fillStyle:${v}`);
    },
    set textBaseline(v: string) {
      calls.push(`baseline:${v}`);
    },
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
}

const frame = (patch: Partial<FrameInfo> = {}): FrameInfo => ({
  width: 1920,
  height: 1080,
  nowMs: 1000,
  deltaMs: 16.7,
  frameIndex: 1,
  screenRect: { x: 0, y: 0, w: 1920, h: 1080 },
  bubbleRect: null,
  ...patch,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createNoopOverlay", () => {
  it("has a stable id and draws nothing", () => {
    const ctx = fakeCtx();
    const layer = createNoopOverlay();
    expect(layer.id).toBe("noop");
    layer.draw(ctx, frame());
    expect((ctx as unknown as { calls: string[] }).calls).toEqual([]);
  });
});

describe("createFpsOverlay", () => {
  it("draws a readout once it has a delta", () => {
    const ctx = fakeCtx();
    const layer = createFpsOverlay();
    expect(layer.id).toBe("debug-fps");
    layer.draw(ctx, frame({ deltaMs: 16.666 }));
    const calls = (ctx as unknown as { calls: string[] }).calls;
    expect(calls.some((c) => c.startsWith("fillText:60"))).toBe(true);
    expect(calls).toContain("save");
    expect(calls).toContain("restore");
  });

  it("smooths across frames instead of jumping", () => {
    const ctx = fakeCtx();
    const layer = createFpsOverlay();
    layer.draw(ctx, frame({ deltaMs: 16.666 }));
    layer.draw(ctx, frame({ deltaMs: 100, frameIndex: 2 }));
    const last = (ctx as unknown as { calls: string[] }).calls
      .filter((c) => c.startsWith("fillText:"))
      .at(-1)!;
    const fps = Number(last.split(":")[1].split(" ")[0]);
    // 60 → 10 fps instantly would be a jump; smoothing keeps it in between.
    expect(fps).toBeGreaterThan(10);
    expect(fps).toBeLessThan(60);
  });

  it("ignores a zero or negative delta", () => {
    const ctx = fakeCtx();
    const layer = createFpsOverlay();
    expect(() => layer.draw(ctx, frame({ deltaMs: 0 }))).not.toThrow();
  });
});

describe("debugOverlaysEnabled", () => {
  it("is off unless the env flag is exactly '1'", () => {
    expect(debugOverlaysEnabled(undefined)).toBe(false);
    expect(debugOverlaysEnabled("0")).toBe(false);
    expect(debugOverlaysEnabled("1")).toBe(true);
  });
});
