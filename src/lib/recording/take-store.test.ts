import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendChunk,
  createTake,
  deleteTake,
  finalizeTake,
  listTakes,
  loadTake,
  pruneTakes,
  resetTakeDbForTests,
  saveTakeDraft,
  type TakeMeta,
} from "./take-store";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  // take-store.ts uses the real IDBKeyRange global, which Node doesn't provide.
  globalThis.IDBKeyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;
  resetTakeDbForTests();
});

const META: TakeMeta = {
  mode: "screen+camera",
  mimeType: "video/webm",
  durationMs: 1234,
  cameraOffsetMs: -40,
  width: 1920,
  height: 1080,
  markers: [{ t: 0.5 }],
  cursor: [],
  clicks: [],
  keys: [],
};

describe("take store", () => {
  it("reassembles each file from its chunks in order", async () => {
    const id = await createTake({ mode: "screen+camera", mimeType: "video/webm" });
    await appendChunk(id, "screen", 0, new Blob(["ab"]));
    await appendChunk(id, "camera", 0, new Blob(["X"]));
    await appendChunk(id, "screen", 1, new Blob(["cd"]));
    await finalizeTake(id, META);
    const take = await loadTake(id);
    expect(await take!.screen.text()).toBe("abcd");
    expect(await take!.camera!.text()).toBe("X");
    expect(take!.meta.durationMs).toBe(1234);
  });

  it("lists unfinished and finalized takes, newest first, and keeps the draft", async () => {
    const a = await createTake({ mode: "screen", mimeType: "video/webm" }, 1_000);
    const b = await createTake({ mode: "screen", mimeType: "video/webm" }, 2_000);
    await appendChunk(b, "screen", 0, new Blob(["zz"]));
    await saveTakeDraft(b, { durationMs: 1234, edits: { version: 1 }, details: { title: "Hi" } });
    const list = await listTakes();
    expect(list.map((t) => t.id)).toEqual([b, a]);
    expect(list[0].bytes).toBe(2);
    expect((await loadTake(b))!.draft).toEqual({ durationMs: 1234, edits: { version: 1 }, details: { title: "Hi" } });
  });

  it("a take whose recording never finished still loads, with an estimated duration", async () => {
    const id = await createTake({ mode: "screen", mimeType: "video/webm" });
    for (let i = 0; i < 8; i++) await appendChunk(id, "screen", i, new Blob(["x"]));
    const take = await loadTake(id);
    expect(take!.meta.durationMs).toBe(2000); // 8 chunks × 250 ms
    expect(take!.finalized).toBe(false);
  });

  it("deletes a take and all its chunks", async () => {
    const id = await createTake({ mode: "screen", mimeType: "video/webm" });
    await appendChunk(id, "screen", 0, new Blob(["x"]));
    await deleteTake(id);
    expect(await loadTake(id)).toBeNull();
    expect(await listTakes()).toEqual([]);
  });

  it("prunes takes older than the cutoff", async () => {
    const id = await createTake({ mode: "screen", mimeType: "video/webm" }, 1_000);
    await createTake({ mode: "screen", mimeType: "video/webm" }, 10_000);
    await pruneTakes(5_000);
    expect((await listTakes()).map((t) => t.id)).not.toContain(id);
  });

  it("returns empty results when IndexedDB is unavailable", async () => {
    // @ts-expect-error simulate a browser without IDB
    delete globalThis.indexedDB;
    resetTakeDbForTests();
    expect(await listTakes()).toEqual([]);
  });
});
