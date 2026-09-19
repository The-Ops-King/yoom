# Crash-Safe Takes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No quit, crash, reload, or hung upload can lose a take or its edits: every recorded second and every edit is on disk, and the next launch offers "Restore unsaved take".

**Architecture:** A small IndexedDB store (`yoom-takes`) receives each 250 ms `MediaRecorder` chunk as its own record while recording, plus the take's metadata (duration, offset, mode, markers, cursor/click/key tracks) when it lands in staging, plus the staging draft (edits + details) on every debounced save. On launch, an unsaved take shows a prompt; Restore rebuilds the blobs from the stored chunks and enters staging through a new `RESTORE` machine event, with the draft seeded so the editor opens exactly where it was. A take is deleted on successful upload or Discard.

**Tech Stack:** Raw IndexedDB (same style as `src/lib/wallpapers.ts`), `fake-indexeddb` for tests, React, vitest (node env), Electron `persist:yoom` partition.

**Why IndexedDB, not OPFS:** each chunk is committed by its own transaction, so a hard crash loses at most the in-flight 250 ms. OPFS `createWritable` only commits on `close()` (a crash loses the whole file), and its durable in-place API (`createSyncAccessHandle`) needs a dedicated worker. Chromium stores IDB blobs as files, and `new Blob(chunks)` over stored blobs does not copy them into memory.

**Why:** 2026-09-19, a stuck render wiped Tyler's edits (fixed in `d28b9d0`). The larger hole remains: the take itself lives only in renderer memory, so a quit, crash, or a hung upload (the only way out is to quit) loses the recording.

---

## Facts the engineer needs (verified 2026-09-19)

- `use-recorder.ts`:
  - `beginRecording` (~:505-581): `recorder.start(250)` and `cameraRecorderRef.current?.start(250)`. `ondataavailable` pushes to `chunksRef` / `cameraChunksRef`. Refs are cleared at :524-531.
  - `finishRecording` (~:641-712): builds blobs with `fixWebmDuration` (webm only) and dispatches `BLOB_READY {blob, cameraBlob, cameraOffsetMs, durationMs, width, height}`. `type = recorder.mimeType.split(";")[0]`.
  - Tracks: `cursorRef`, `clicksRef` and `keysRef` hold arrays (ms `t`) of `CursorSample`, `ClickSample` and `KeySample` from `@/lib/recording/types`.
  - Markers are machine state: `state.markers`.
  - Desktop auto-acquires on mount while `idle` (~:466-471).
  - `finish` clears the sessionStorage draft on `UPLOAD_DONE` (`clearStagingDraft`, commit `d28b9d0`).
- `recorder-machine.ts`: no event enters `staging` except `BLOB_READY` (only from `stopping`) and the render/upload failure fallbacks. `DISCARD` resets the take (:395-409).
- `recorder.tsx`: the idle UI (~:243-344) has the logo, mode toggle, device selectors, error/notice text (:328-333) and the "Choose what to share" button.
- Staging draft: `staging.tsx` `readDraft(durationMs)` reads **sessionStorage synchronously at mount** (`STAGING_DRAFT_KEY`, `{durationMs, edits, details}`). `writeDraft` is debounced 300 ms and flushed on Save. `Details = {title, description, slug, thumbnailAt, slugOk?}`.
- IDB pattern: `src/lib/wallpapers.ts` (cached open promise, `onversionchange` close, reset seam for tests). Test style: `src/lib/wallpapers.test.ts` sets `globalThis.indexedDB = new IDBFactory()` from `fake-indexeddb` in `beforeEach`.
- Use a **separate DB name** (`yoom-takes`) so the wallpapers DB version is untouched.
- vitest runs in `node` env on `src/**/*.test.ts`. `fake-indexeddb` stores Blobs, but node's `Blob` lacks some browser behaviour; tests compare `await blob.text()` / `.size`.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/recording/take-store.ts` (new) | IDB store: create take, append chunk, finalize meta, save draft, list, load, delete, prune. |
| `src/lib/recording/take-writer.ts` (new) | Serial, never-throwing write queue the recorder calls from `ondataavailable`. |
| `src/lib/recording/recorder-machine.ts` (modify) | `RESTORE` event: idle → staging with a stored take. |
| `src/lib/recording/use-recorder.ts` (modify) | Write chunks + meta; delete on restart/cancel/discard/upload; `pendingTakes` + `restoreTake` / `dropTake` actions; gate desktop auto-acquire. |
| `src/components/staging/staging.tsx` (modify) | Mirror the draft into the take store. |
| `src/components/recorder.tsx` (modify) | "Restore unsaved take" prompt in idle. |

---

### Task 1: Take store

**Files:**
- Create: `src/lib/recording/take-store.ts`
- Test: `src/lib/recording/take-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/recording/take-store.test.ts
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendChunk, createTake, deleteTake, finalizeTake, listTakes, loadTake, pruneTakes,
  resetTakeDbForTests, saveTakeDraft, type TakeMeta,
} from "./take-store";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetTakeDbForTests();
});

const META: TakeMeta = {
  mode: "screen+camera", mimeType: "video/webm", durationMs: 1234, cameraOffsetMs: -40,
  width: 1920, height: 1080, markers: [{ t: 0.5 }], cursor: [], clicks: [], keys: [],
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/recording/take-store.test.ts`
Expected: FAIL — cannot resolve `./take-store`.

- [ ] **Step 3: Implement**

```ts
// src/lib/recording/take-store.ts
import type { ClickSample, CursorSample, KeySample, RecordingMode } from "./types";

/**
 * Crash-safe copy of the take being recorded / edited. Every 250 ms encoder
 * chunk is its own record, so a hard crash loses at most the chunk in flight.
 * A take is deleted once it uploads or is discarded.
 */
const DB_NAME = "yoom-takes";
const DB_VERSION = 1;
const TAKES = "takes";
const CHUNKS = "chunks";
/** `MediaRecorder.start(250)` — used to estimate the length of a take that never finished. */
export const CHUNK_MS = 250;

export type FileKind = "screen" | "camera";
export type TakeMeta = {
  mode: RecordingMode;
  mimeType: string;
  durationMs: number;
  cameraOffsetMs: number;
  width: number | null;
  height: number | null;
  markers: { t: number }[];
  cursor: CursorSample[];
  clicks: ClickSample[];
  keys: KeySample[];
};
/** Same shape `staging.tsx` keeps in sessionStorage. */
export type TakeDraft = { durationMs: number; edits?: unknown; details?: unknown };

type TakeRecord = {
  id: string;
  createdAt: number;
  mode: RecordingMode;
  mimeType: string;
  chunks: number; // screen chunk count, for the duration estimate
  bytes: number;
  meta: TakeMeta | null; // set when the take lands in staging
  draft: TakeDraft | null;
};
type ChunkRecord = { key: [string, FileKind, number]; data: Blob };

export type TakeSummary = { id: string; createdAt: number; mode: RecordingMode; durationMs: number; bytes: number; finalized: boolean };
export type StoredTake = { id: string; screen: Blob; camera: Blob | null; meta: TakeMeta; draft: TakeDraft | null; finalized: boolean };

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TAKES)) db.createObjectStore(TAKES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).catch((err) => { dbPromise = null; throw err; });
  return dbPromise;
}

export function resetTakeDbForTests(): void {
  dbPromise = null;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function createTake(init: { mode: RecordingMode; mimeType: string }, now = Date.now()): Promise<string> {
  const db = await open();
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tx = db.transaction(TAKES, "readwrite");
  const rec: TakeRecord = { id, createdAt: now, ...init, chunks: 0, bytes: 0, meta: null, draft: null };
  tx.objectStore(TAKES).put(rec);
  await done(tx);
  return id;
}

export async function appendChunk(id: string, kind: FileKind, seq: number, data: Blob): Promise<void> {
  const db = await open();
  const tx = db.transaction([TAKES, CHUNKS], "readwrite");
  const chunk: ChunkRecord = { key: [id, kind, seq], data };
  tx.objectStore(CHUNKS).put(chunk);
  const takes = tx.objectStore(TAKES);
  const rec = await result(takes.get(id) as IDBRequest<TakeRecord | undefined>);
  if (rec) {
    rec.bytes += data.size;
    if (kind === "screen") rec.chunks = Math.max(rec.chunks, seq + 1);
    takes.put(rec);
  }
  await done(tx);
}

async function patch(id: string, fn: (r: TakeRecord) => void): Promise<void> {
  const db = await open();
  const tx = db.transaction(TAKES, "readwrite");
  const store = tx.objectStore(TAKES);
  const rec = await result(store.get(id) as IDBRequest<TakeRecord | undefined>);
  if (rec) { fn(rec); store.put(rec); }
  await done(tx);
}

export const finalizeTake = (id: string, meta: TakeMeta) => patch(id, (r) => { r.meta = meta; });
export const saveTakeDraft = (id: string, draft: TakeDraft) => patch(id, (r) => { r.draft = draft; });

function estimatedMeta(r: TakeRecord): TakeMeta {
  return {
    mode: r.mode, mimeType: r.mimeType, durationMs: r.chunks * CHUNK_MS, cameraOffsetMs: 0,
    width: null, height: null, markers: [], cursor: [], clicks: [], keys: [],
  };
}

export async function listTakes(): Promise<TakeSummary[]> {
  try {
    const db = await open();
    const all = await result(db.transaction(TAKES).objectStore(TAKES).getAll() as IDBRequest<TakeRecord[]>);
    return all
      .map((r) => ({ id: r.id, createdAt: r.createdAt, mode: r.mode, durationMs: (r.meta ?? estimatedMeta(r)).durationMs, bytes: r.bytes, finalized: !!r.meta }))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

async function chunksOf(db: IDBDatabase, id: string, kind: FileKind): Promise<Blob[]> {
  const range = IDBKeyRange.bound([id, kind, 0], [id, kind, Number.MAX_SAFE_INTEGER]);
  const recs = await result(db.transaction(CHUNKS).objectStore(CHUNKS).getAll(range) as IDBRequest<ChunkRecord[]>);
  return recs.map((c) => c.data); // key order = seq order
}

export async function loadTake(id: string): Promise<StoredTake | null> {
  const db = await open();
  const rec = await result(db.transaction(TAKES).objectStore(TAKES).get(id) as IDBRequest<TakeRecord | undefined>);
  if (!rec) return null;
  const screen = await chunksOf(db, id, "screen");
  if (screen.length === 0) return null;
  const camera = await chunksOf(db, id, "camera");
  return {
    id,
    screen: new Blob(screen, { type: rec.mimeType }),
    camera: camera.length ? new Blob(camera, { type: rec.mimeType }) : null,
    meta: rec.meta ?? estimatedMeta(rec),
    draft: rec.draft,
    finalized: !!rec.meta,
  };
}

export async function deleteTake(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([TAKES, CHUNKS], "readwrite");
  tx.objectStore(TAKES).delete(id);
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, "camera", 0], [id, "screen", Number.MAX_SAFE_INTEGER]));
  await done(tx);
}

/** Drop takes created before `cutoff` (epoch ms). */
export async function pruneTakes(cutoff: number): Promise<void> {
  for (const t of await listTakes()) if (t.createdAt < cutoff) await deleteTake(t.id);
}
```

Note: in camera-only mode the single recorded file is the camera, but it is still stored as kind `"screen"` (the "primary" file). `RESTORE` maps it back by `mode`, exactly like `BLOB_READY` does today (`blob` = primary, `cameraBlob` = secondary).

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/recording/take-store.test.ts`
Expected: PASS (6 tests). If `appendChunk`'s `await` inside the transaction lets it auto-commit under fake-indexeddb, restructure it to issue the `get` first and do the `put`s in its `onsuccess` (the real-browser-safe pattern). Do not await across unrelated promises inside a transaction.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recording/take-store.ts src/lib/recording/take-store.test.ts
git commit -m "feat(recorder): crash-safe IndexedDB store for raw takes"
```

---

### Task 2: Write queue

**Files:**
- Create: `src/lib/recording/take-writer.ts`
- Test: `src/lib/recording/take-writer.test.ts`

The recorder must never block on or crash from storage. The writer serialises writes per take, numbers chunks per file, and swallows and logs failures such as quota or a missing IDB. Recording keeps working in memory exactly as today.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/recording/take-writer.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/recording/take-writer.test.ts`
Expected: FAIL — cannot resolve `./take-writer`.

- [ ] **Step 3: Implement**

```ts
// src/lib/recording/take-writer.ts
import { appendChunk, type FileKind } from "./take-store";

type Deps = { append: (id: string, kind: FileKind, seq: number, data: Blob) => Promise<void> };

/**
 * Fire-and-forget persistence for one take. Storage failures are logged and
 * ignored: the in-memory recording is still the source of truth for this run.
 */
export class TakeWriter {
  private queue: Promise<void> = Promise.resolve();
  private readonly seq: Record<FileKind, number> = { screen: 0, camera: 0 };
  private readonly takeId: Promise<string | null>;

  constructor(takeId: Promise<string>, private readonly deps: Deps = { append: appendChunk }) {
    this.takeId = takeId.catch((err) => {
      console.warn("[Yoom] take not persisted", err);
      return null;
    });
  }

  chunk(kind: FileKind, data: Blob): void {
    const seq = this.seq[kind]++;
    this.queue = this.queue.then(async () => {
      const id = await this.takeId;
      if (!id) return;
      try {
        await this.deps.append(id, kind, seq, data);
      } catch (err) {
        console.warn("[Yoom] could not persist a chunk", err);
      }
    });
  }

  /** Resolves once every queued chunk has been attempted. */
  flush(): Promise<void> {
    return this.queue;
  }

  id(): Promise<string | null> {
    return this.takeId;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/recording/take-writer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/recording/take-writer.ts src/lib/recording/take-writer.test.ts
git commit -m "feat(recorder): non-blocking chunk writer for crash-safe takes"
```

---

### Task 3: `RESTORE` machine event

**Files:**
- Modify: `src/lib/recording/recorder-machine.ts` (event union ~:86-144, reducer next to `BLOB_READY` ~:380)
- Test: `src/lib/recording/recorder-machine.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("RESTORE", () => {
  const blob = new Blob(["x"]);
  const RESTORE: RecorderEvent = {
    type: "RESTORE", mode: "screen+camera", blob, cameraBlob: null, cameraOffsetMs: -40,
    durationMs: 446_635, width: 1920, height: 1080, markers: [{ t: 1 }],
  };

  it("enters staging from idle with the stored take and no live streams", () => {
    const s = recorderReducer(init(), RESTORE);
    expect(s.status).toBe("staging");
    expect(s.blob).toBe(blob);
    expect(s.durationMs).toBe(446_635);
    expect(s.mode).toBe("screen+camera");
    expect(s.markers).toEqual([{ t: 1 }]);
    expect(s.streamsAlive).toBe(false);
  });

  it("is ignored anywhere but idle or error", () => {
    const recording = { ...init(), status: "recording" as const };
    expect(recorderReducer(recording, RESTORE)).toBe(recording);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/recording/recorder-machine.test.ts`
Expected: FAIL — type error on `"RESTORE"`.

- [ ] **Step 3: Implement**

Add to the event union:

```ts
  | {
      type: "RESTORE";
      mode: RecordingMode;
      blob: Blob;
      cameraBlob: Blob | null;
      cameraOffsetMs: number;
      durationMs: number;
      width: number | null;
      height: number | null;
      markers: Marker[];
    }
```

Add the case:

```ts
    case "RESTORE":
      // A take recovered from disk after a quit/crash: straight into staging,
      // with nothing live behind it.
      if (state.status !== "idle" && state.status !== "error") return state;
      return {
        ...state,
        status: "staging",
        mode: event.mode,
        blob: event.blob,
        cameraBlob: event.cameraBlob,
        cameraOffsetMs: event.cameraOffsetMs,
        durationMs: event.durationMs,
        width: event.width,
        height: event.height,
        markers: event.markers,
        streamsAlive: false,
        renderProgress: 0,
        error: "",
      };
```

Match the `width`/`height` types to what `BLOB_READY` uses, and use the existing `Marker` type.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/recording/recorder-machine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recording/recorder-machine.ts src/lib/recording/recorder-machine.test.ts
git commit -m "feat(recorder): RESTORE event re-enters staging with a stored take"
```

---

### Task 4: Persist while recording; clean up at the right moments

**Files:**
- Modify: `src/lib/recording/use-recorder.ts`

- [ ] **Step 1: Add refs and create the take in `beginRecording`**

Near the other refs (~:203-228):

```ts
  /** Crash-safe copy of the current take (see take-store.ts); null outside a take. */
  const takeWriterRef = useRef<TakeWriter | null>(null);
```

In `beginRecording`, after `const mimeType = pickMimeType();`:

```ts
    // A restart (⌘⇧K) begins a new take; the abandoned one is not worth keeping.
    void discardStoredTake();
    takeWriterRef.current = new TakeWriter(
      createTake({ mode: current.mode, mimeType: (mimeType || "video/webm").split(";")[0] }),
    );
```

In both `ondataavailable` handlers, add the writer call after the push:

```ts
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        takeWriterRef.current?.chunk("screen", e.data);
      }
```

(Use `"camera"` in the camera recorder's handler.)

Add the helper next to `teardown`:

```ts
  /** Forget the stored copy of the current take (restart, cancel, discard, uploaded). */
  const discardStoredTake = useCallback(async () => {
    const writer = takeWriterRef.current;
    takeWriterRef.current = null;
    const id = await writer?.id();
    if (id) await deleteTake(id).catch(() => undefined);
  }, []);
```

- [ ] **Step 2: Finalize when the take lands in staging**

In `finishRecording`, right before `dispatch({ type: "BLOB_READY", … })`:

```ts
    const writer = takeWriterRef.current;
    void writer?.id().then((id) =>
      id
        ? writer.flush().then(() =>
            finalizeTake(id, {
              mode: stateRef.current.mode,
              mimeType: type,
              durationMs,
              cameraOffsetMs,
              width,
              height,
              markers: stateRef.current.markers,
              cursor: cursorRef.current,
              clicks: clicksRef.current,
              keys: keysRef.current,
            }),
          )
        : undefined,
    ).catch((err) => console.warn("[Yoom] could not finalize the stored take", err));
```

- [ ] **Step 3: Delete at the end of the take's life**

Call `void discardStoredTake()` in:
- `finish`, right after `clearStagingDraft()` on a successful upload
- the discard action, after `dispatch({ type: "DISCARD" })`
- the cancel path (⌘⇧X / HUD cancel), where the recording is thrown away. Find it with `grep -n "CANCEL" src/lib/recording/use-recorder.ts`.

- [ ] **Step 4: Expose the take id to staging**

Next to the other state (~:184):

```ts
  /** Id of the stored copy of the take on screen, for staging's durable draft. */
  const [takeId, setTakeId] = useState<string | null>(null);
```

In Step 2's finalize chain, call `setTakeId(id)` right before `finalizeTake(...)`. In `discardStoredTake`, call `setTakeId(null)`. Add `takeId` to the `staging` memo the hook returns (~:745-755) and to its deps:

```ts
      stagingUrls
        ? {
            ...stagingUrls,
            takeId,
            // …existing fields unchanged
          }
        : null,
    [stagingUrls, takeId],
```

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "db.test.ts\|upload-client.test.ts"; npx vitest run`
Expected: no new type errors; all tests pass.

```bash
git add src/lib/recording/use-recorder.ts
git commit -m "feat(recorder): persist every chunk of the take while recording"
```

---

### Task 5: Mirror the staging draft into the take

**Files:**
- Modify: `src/components/staging/types.ts` (add `takeId: string | null` to `StagingProps`)
- Modify: `src/components/staging/staging.tsx` (`writeDraft`)
- Modify: `src/components/recorder.tsx` (pass `takeId={staging.takeId}`)

- [ ] **Step 1: Implement**

In `staging.tsx` `writeDraft`, build the payload once and write it to both places:

```ts
  const writeDraft = useCallback(() => {
    const draft = { durationMs: props.durationMs, edits: persistableEdits(edits), details };
    try {
      sessionStorage.setItem(STAGING_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage full or unavailable: the draft just is not restorable */
    }
    // The durable copy: survives a quit or crash, restored with the take.
    if (props.takeId) void saveTakeDraft(props.takeId, draft).catch(() => undefined);
  }, [details, edits, props.durationMs, props.takeId]);
```

`persistableEdits` already strips `blob:` backgrounds, which would be dead after a relaunch, and keeps saved wallpaper ids.

- [ ] **Step 2: Typecheck, tests, commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "db.test.ts\|upload-client.test.ts"; npx vitest run src/components src/lib/recording`
Expected: clean; PASS.

```bash
git add src/components/staging/types.ts src/components/staging/staging.tsx src/components/recorder.tsx
git commit -m "feat(staging): keep a durable copy of the draft with the take"
```

---

### Task 6: Restore and drop actions

**Files:**
- Modify: `src/lib/recording/use-recorder.ts`

- [ ] **Step 1: Load pending takes on mount and gate auto-acquire**

```ts
  /** Unsaved takes from an earlier run; null until the store has been read. */
  const [pendingTakes, setPendingTakes] = useState<TakeSummary[] | null>(null);
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined); // ask Chromium not to evict takes
    void pruneTakes(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .then(listTakes)
      .then(setPendingTakes);
  }, []);
```

In the desktop auto-acquire effect (~:466-471), add a guard at the top so the prompt is not skipped:

```ts
    // Offer to restore an unsaved take before grabbing the screen again.
    if (pendingTakes === null || pendingTakes.length > 0) return;
```

Add `pendingTakes` to that effect's deps.

- [ ] **Step 2: `restoreTake(id)`**

```ts
  const restoreTake = useCallback(async (id: string) => {
    const take = await loadTake(id);
    if (!take) {
      setPendingTakes((p) => p?.filter((t) => t.id !== id) ?? null);
      return;
    }
    const { meta } = take;
    // The stored chunks have no EBML duration, same as a fresh recording.
    const patch = async (b: Blob) =>
      meta.mimeType.includes("webm")
        ? fixWebmDuration(b, meta.durationMs, { logger: false }).catch(() => b)
        : b;
    const primary = await patch(take.screen);
    const secondary = take.camera ? await patch(take.camera) : null;
    cursorRef.current = meta.cursor;
    clicksRef.current = meta.clicks;
    keysRef.current = meta.keys;
    // Staging reads its draft synchronously at mount, from sessionStorage.
    if (take.draft) {
      try {
        sessionStorage.setItem(STAGING_DRAFT_KEY, JSON.stringify({ ...take.draft, durationMs: meta.durationMs }));
      } catch {
        /* the take restores without its edits */
      }
    }
    takeWriterRef.current = new TakeWriter(Promise.resolve(id));
    setTakeId(id);
    setPendingTakes((p) => p?.filter((t) => t.id !== id) ?? null);
    dispatch({
      type: "RESTORE",
      mode: meta.mode,
      blob: primary,
      cameraBlob: secondary,
      cameraOffsetMs: meta.cameraOffsetMs,
      durationMs: meta.durationMs,
      width: meta.width,
      height: meta.height,
      markers: meta.markers,
    });
  }, []);

  const dropTake = useCallback(async (id: string) => {
    await deleteTake(id).catch(() => undefined);
    setPendingTakes((p) => p?.filter((t) => t.id !== id) ?? null);
  }, []);
```

For a take that never finalized, the draft's `durationMs` may differ from the estimate. Overwriting it with `meta.durationMs` keeps `readDraft`'s guard from rejecting the edits.

Expose `pendingTakes` in the returned state bag, and add `restoreTake` and `dropTake` to `actions` (update the actions type at ~:148).

- [ ] **Step 3: Typecheck, tests, commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "db.test.ts\|upload-client.test.ts"; npx vitest run`
Expected: clean; PASS.

```bash
git add src/lib/recording/use-recorder.ts
git commit -m "feat(recorder): restore or drop an unsaved take from disk"
```

---

### Task 7: The restore prompt

**Files:**
- Modify: `src/components/recorder.tsx` (idle UI, next to the error/notice text ~:328)

- [ ] **Step 1: Implement**

```tsx
          {state.status === "idle" && pendingTakes && pendingTakes.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-surface-raised p-3">
              <p className="text-sm font-medium">Unsaved take{pendingTakes.length > 1 ? "s" : ""}</p>
              {pendingTakes.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">
                    {new Date(t.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {" · "}
                    {formatDuration(t.durationMs)}
                  </span>
                  <span className="flex gap-2">
                    <button type="button" onClick={() => void actions.restoreTake(t.id)} className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                      Restore
                    </button>
                    <button type="button" onClick={() => void actions.dropTake(t.id)} className="rounded-md border border-border px-3 py-1 text-xs text-muted hover:text-foreground">
                      Delete
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
```

Reuse the timer formatter the recorder already uses for `elapsedMs` (`grep -n "format" src/components/recorder.tsx`). If there isn't one, add `const formatDuration = (ms: number) => \`${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}\``. Match the button classes to the existing ones in this file (`accent-foreground` may not exist). Copy the classes from the "Choose what to share" button.

Delete uses a plain click, not `window.confirm`: it only appears for a take the user already walked away from. Also, `confirm` blocks CDP-driven tests (see memory `project-yoom-desktop-debugging`).

- [ ] **Step 2: Lint, build, commit**

Run: `npx eslint src/components/recorder.tsx && npm run build 2>&1 | tail -3`
Expected: no lint output; build succeeds.

```bash
git add src/components/recorder.tsx
git commit -m "feat(recorder): offer to restore an unsaved take on launch"
```

---

### Task 8: Verify in the real app

Use the dev Electron shell (memory `project-yoom-desktop-debugging`). Use `pkill -9` and confirm with `ps -o lstart` between launches.

- [ ] **Step 1: Crash mid-recording.** Record 60 s with camera and mic, then `pkill -9 Yoom` (dev: the Electron process). Relaunch. Expected: the prompt shows about 1:00. Restore opens staging; both files play; audio is intact up to about the last 250 ms.
- [ ] **Step 2: Crash mid-edit.** Record 60 s, stop, add 2 cuts, a zoom, and a title. Wait 1 s and `pkill -9`. Relaunch → Restore. Expected: the cuts, zoom, title, cursor-follow zoom, and click ripples are all back.
- [ ] **Step 3: Hung upload.** Save with the network off (macOS: turn off Wi-Fi mid-upload). Quit Yoom. Relaunch → Restore. Expected: the edits are intact, and Save uploads once the network is back.
- [ ] **Step 4: Cleanup.** After a successful upload, and after Discard, relaunch. Expected: no prompt. In DevTools → Application → IndexedDB → `yoom-takes`, both stores are empty.
- [ ] **Step 5: Restart and cancel.** ⌘⇧K mid-recording, then finish normally and upload. Expected: no leftover take in `yoom-takes`.
- [ ] **Step 6: Storage.** Check `await navigator.storage.estimate()` after a 7-minute take (expected: about 500 MB used). Confirm `navigator.storage.persisted()` returns `true` in Electron.
