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

/**
 * Reaches past the module's public API to read the raw `chunks` store
 * directly, so a delete/prune test can prove BOTH file kinds' chunks are
 * actually gone rather than just inferring it from `loadTake` returning
 * null (which only requires the "screen" chunks to be missing). Mirrors
 * take-store.ts's own internal db/store names.
 */
function rawChunkOwners(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("yoom-takes", 1);
    req.onsuccess = () => {
      const db = req.result;
      const getAllReq = db.transaction("chunks", "readonly").objectStore("chunks").getAllKeys();
      getAllReq.onsuccess = () => {
        resolve((getAllReq.result as [string, string, number][]).map((key) => key[0]));
        db.close();
      };
      getAllReq.onerror = () => reject(getAllReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("take store", () => {
  it("reassembles each file from its chunks in order", async () => {
    const id = await createTake({ mode: "screen+camera", mimeType: "video/webm" });
    await appendChunk(id, "screen", 0, new Blob(["ab"]));
    await appendChunk(id, "camera", 0, new Blob(["X"]));
    await appendChunk(id, "screen", 1, new Blob(["cd"]));
    await finalizeTake(id, META);
    const take = await loadTake(id);
    expect(await take!.screen.text()).toBe("abcd");
    expect(take!.screen.type).toBe("video/webm");
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

  it("deletes a take and all its chunks (both kinds), leaving other takes untouched", async () => {
    const id = await createTake({ mode: "screen+camera", mimeType: "video/webm" });
    await appendChunk(id, "screen", 0, new Blob(["x"]));
    await appendChunk(id, "camera", 0, new Blob(["y"]));
    const other = await createTake({ mode: "screen", mimeType: "video/webm" });
    await appendChunk(other, "screen", 0, new Blob(["z"]));

    await deleteTake(id);

    expect(await loadTake(id)).toBeNull();
    expect(await rawChunkOwners()).not.toContain(id);
    expect((await listTakes()).map((t) => t.id)).toEqual([other]);
    const survivor = await loadTake(other);
    expect(await survivor!.screen.text()).toBe("z");
  });

  it("prunes takes older than the cutoff, leaving newer takes and their chunks intact", async () => {
    const id = await createTake({ mode: "screen", mimeType: "video/webm" }, 1_000);
    const survivorId = await createTake({ mode: "screen", mimeType: "video/webm" }, 10_000);
    await appendChunk(survivorId, "screen", 0, new Blob(["keep"]));

    await pruneTakes(5_000);

    expect((await listTakes()).map((t) => t.id)).toEqual([survivorId]);
    const survivor = await loadTake(survivorId);
    expect(await survivor!.screen.text()).toBe("keep");
    expect(await rawChunkOwners()).not.toContain(id);
  });

  it("keeps exact byte accounting under concurrent unawaited appendChunk calls", async () => {
    const id = await createTake({ mode: "screen+camera", mimeType: "video/webm" });
    await Promise.all([
      appendChunk(id, "screen", 0, new Blob(["a"])),
      appendChunk(id, "screen", 1, new Blob(["bb"])),
      appendChunk(id, "screen", 2, new Blob(["ccc"])),
      appendChunk(id, "camera", 0, new Blob(["dddd"])),
    ]);
    const summary = (await listTakes()).find((t) => t.id === id);
    expect(summary!.bytes).toBe(1 + 2 + 3 + 4);
  });

  it("rejects a write against an unknown take instead of silently orphaning chunks", async () => {
    await expect(appendChunk("nope", "screen", 0, new Blob(["x"]))).rejects.toThrow();
    await expect(finalizeTake("nope", META)).rejects.toThrow();
    // the chunk from the rejected appendChunk didn't get left behind either
    expect(await rawChunkOwners()).not.toContain("nope");
  });

  it("returns empty results when IndexedDB is unavailable", async () => {
    // @ts-expect-error simulate a browser without IDB
    delete globalThis.indexedDB;
    resetTakeDbForTests();
    expect(await listTakes()).toEqual([]);
  });
});
