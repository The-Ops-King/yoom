import { describe, expect, it, vi } from "vitest";
import { TakeWriter } from "./take-writer";

describe("TakeWriter", () => {
  it("numbers chunks per file and writes them in call order", async () => {
    const calls: string[] = [];
    const append = vi.fn(async (_id: string, kind: string, seq: number) => { calls.push(`${kind}${seq}`); });
    const w = new TakeWriter(Promise.resolve("t1"), { append });
    w.chunk("screen", new Blob(["a"]));
    w.chunk("camera", new Blob(["b"]));
    w.chunk("screen", new Blob(["c"]));
    await w.flush();
    expect(calls).toEqual(["screen0", "camera0", "screen1"]);
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
