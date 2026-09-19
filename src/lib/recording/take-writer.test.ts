import { describe, expect, it, vi } from "vitest";
import { TakeWriter } from "./take-writer";

describe("TakeWriter", () => {
  it("numbers chunks per file and writes them in call order", async () => {
    const calls: string[] = [];
    // The first write is slow; if writes ran concurrently instead of queued,
    // the fast camera0/screen1 writes would start (and finish) before it does.
    let first = true;
    const events: string[] = [];
    const append = vi.fn(async (_id: string, kind: string, seq: number) => {
      const label = `${kind}${seq}`;
      events.push(`start:${label}`);
      if (first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      calls.push(label);
      events.push(`end:${label}`);
    });
    const w = new TakeWriter(Promise.resolve("t1"), { append });
    w.chunk("screen", new Blob(["a"]));
    w.chunk("camera", new Blob(["b"]));
    w.chunk("screen", new Blob(["c"]));
    await w.flush();
    expect(calls).toEqual(["screen0", "camera0", "screen1"]);
    expect(events).toEqual([
      "start:screen0",
      "end:screen0",
      "start:camera0",
      "end:camera0",
      "start:screen1",
      "end:screen1",
    ]);
  });

  it("keeps going after a failed write and never rejects", async () => {
    const append = vi.fn().mockRejectedValueOnce(new Error("quota")).mockResolvedValue(undefined);
    const w = new TakeWriter(Promise.resolve("t1"), { append });
    w.chunk("screen", new Blob(["a"]));
    w.chunk("screen", new Blob(["b"]));
    await expect(w.flush()).resolves.toBeUndefined();
    expect(append).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the take could not be created", async () => {
    const append = vi.fn();
    const w = new TakeWriter(Promise.reject(new Error("no idb")), { append });
    w.chunk("screen", new Blob(["a"]));
    await w.flush();
    expect(append).not.toHaveBeenCalled();
    await expect(w.id()).resolves.toBeNull();
  });
});
