import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendChunk,
  CHUNK_MS,
  createTake,
  deleteTake,
  finalizeTake,
  listTakes,
  loadTake,
  pruneTakes,
  resetTakeDbForTests,
  saveTakeDraft,
  TAKE_DB,
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
 * null (which only requires the "screen" chunks to be missing). Uses
 * `TAKE_DB` rather than hardcoded strings, so a renamed store fails this
 * helper loudly instead of hanging the test to its timeout.
 */
function rawChunkOwners(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TAKE_DB.name, 1);
    req.onsuccess = () => {
      const db = req.result;
      const getAllReq = db.transaction(TAKE_DB.chunks, "readonly").objectStore(TAKE_DB.chunks).getAllKeys();
      getAllReq.onsuccess = () => {
        resolve((getAllReq.result as [string, string, number][]).map((key) => key[0]));
        db.close();
      };
      getAllReq.onerror = () => reject(getAllReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Writes a chunk keyed under an arbitrary kind string, bypassing the
 * `FileKind` union — so a delete test can prove `deleteTake`'s range covers
 * whatever kind a future capture mode adds, not just today's "camera"/"screen".
 */
function rawPutChunk(id: string, kind: string, seq: number, data: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TAKE_DB.name, 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(TAKE_DB.chunks, "readwrite");
      tx.objectStore(TAKE_DB.chunks).put({ key: [id, kind, seq], data });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
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
    await appendChunk(a, "screen", 0, new Blob(["a"]));
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
  });

  it("truncates playback at the first missing chunk instead of splicing a hole", async () => {
    const id = await createTake({ mode: "screen", mimeType: "video/webm" });
    await appendChunk(id, "screen", 0, new Blob(["0"]));
    await appendChunk(id, "screen", 1, new Blob(["1"]));
    // seq 2 never arrives.
    await appendChunk(id, "screen", 3, new Blob(["3"]));
    await appendChunk(id, "screen", 4, new Blob(["4"]));
    const take = await loadTake(id);
    expect(await take!.screen.text()).toBe("01");
  });

  it("returns null when the very first chunk is missing", async () => {
    const id = await createTake({ mode: "screen", mimeType: "video/webm" });
    await appendChunk(id, "screen", 1, new Blob(["1"]));
    expect(await loadTake(id)).toBeNull();
  });

  it("estimates duration from the chunks actually returned, not the high-water mark", async () => {
    const id = await createTake({ mode: "screen", mimeType: "video/webm" });
    await appendChunk(id, "screen", 0, new Blob(["0"]));
    await appendChunk(id, "screen", 1, new Blob(["1"]));
    // seq 2/3 never arrive; the high-water mark still jumps to 5 chunks.
    await appendChunk(id, "screen", 4, new Blob(["4"]));
    const take = await loadTake(id);
    expect(take!.meta.durationMs).toBe(2 * CHUNK_MS); // 2 contiguous chunks, not 5
  });

  it("deletes a take and all its chunks (both kinds, and any future kind), leaving other takes untouched", async () => {
    const id = await createTake({ mode: "screen+camera", mimeType: "video/webm" });
    await appendChunk(id, "screen", 0, new Blob(["x"]));
    await appendChunk(id, "camera", 0, new Blob(["y"]));
    // "zzz" sorts after "screen" — a range hand-bounded to "camera".."screen"
    // (the old implementation) would leave this one behind.
    await rawPutChunk(id, "zzz", 0, new Blob(["q"]));
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
    await appendChunk(id, "screen", 0, new Blob(["old"]));
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

  it("omits a zero-byte take (e.g. a crash before the first chunk landed) from listTakes", async () => {
    const empty = await createTake({ mode: "screen", mimeType: "video/webm" });
    const real = await createTake({ mode: "screen", mimeType: "video/webm" });
    await appendChunk(real, "screen", 0, new Blob(["x"]));

    const list = await listTakes();

    expect(list.map((t) => t.id)).toEqual([real]);
    expect(list.map((t) => t.id)).not.toContain(empty);
  });

  it("keeps a truncated take's other tracks but reports the contiguous duration, not the recorder's", async () => {
    const id = await createTake({ mode: "screen+camera", mimeType: "video/webm" });
    await appendChunk(id, "screen", 0, new Blob(["0"]));
    await appendChunk(id, "screen", 1, new Blob(["1"]));
    // seq 2 never arrives — the recorder still thinks it captured META's full 1234 ms.
    await finalizeTake(id, META, { truncated: true });

    const take = await loadTake(id);

    expect(take!.meta.durationMs).toBe(2 * CHUNK_MS); // 2 contiguous chunks, not META.durationMs
    // every other track from `meta` survives untouched — no fallback to an empty estimatedMeta
    expect(take!.meta.mode).toBe(META.mode);
    expect(take!.meta.mimeType).toBe(META.mimeType);
    expect(take!.meta.cameraOffsetMs).toBe(META.cameraOffsetMs);
    expect(take!.meta.width).toBe(META.width);
    expect(take!.meta.height).toBe(META.height);
    expect(take!.meta.markers).toEqual(META.markers);
    expect(take!.meta.cursor).toEqual(META.cursor);
    expect(take!.meta.clicks).toEqual(META.clicks);
    expect(take!.meta.keys).toEqual(META.keys);
  });

  it("flags a listed duration as estimated unless the take finalized cleanly", async () => {
    const unfinished = await createTake({ mode: "screen", mimeType: "video/webm" });
    await appendChunk(unfinished, "screen", 0, new Blob(["x"]));

    const truncated = await createTake({ mode: "screen", mimeType: "video/webm" });
    await appendChunk(truncated, "screen", 0, new Blob(["x"]));
    await finalizeTake(truncated, META, { truncated: true });

    const clean = await createTake({ mode: "screen", mimeType: "video/webm" });
    await appendChunk(clean, "screen", 0, new Blob(["x"]));
    await finalizeTake(clean, META);

    const byId = new Map((await listTakes()).map((t) => [t.id, t]));
    expect(byId.get(unfinished)!.estimated).toBe(true);
    expect(byId.get(truncated)!.estimated).toBe(true);
    expect(byId.get(clean)!.estimated).toBe(false);
  });

  it("returns empty results when IndexedDB is unavailable", async () => {
    // @ts-expect-error simulate a browser without IDB
    delete globalThis.indexedDB;
    resetTakeDbForTests();
    expect(await listTakes()).toEqual([]);
  });
});
