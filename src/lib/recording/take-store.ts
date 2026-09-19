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

/**
 * Test seam: the raw db/store names, for a test that reaches past the public
 * API to inspect the store directly. Importing these rather than hardcoding
 * the strings means a rename here breaks the test loudly (a wrong string
 * fails inside an `onsuccess` callback, hanging the test to its timeout).
 */
export const TAKE_DB = { name: DB_NAME, chunks: CHUNKS };

/** `"screen"` is always the PRIMARY file — in camera-only mode the single recorded file is stored under `"screen"`, and `loadTake` returns null without it. */
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
  chunks: number; // high-water mark of screen `seq + 1` seen so far (not a running count), for the duration estimate
  bytes: number;
  meta: TakeMeta | null; // set when the take lands in staging
  draft: TakeDraft | null;
};
type ChunkRecord = { key: [string, FileKind, number]; data: Blob };

export type TakeSummary = {
  id: string;
  createdAt: number;
  mode: RecordingMode;
  durationMs: number;
  bytes: number;
  finalized: boolean;
};
export type StoredTake = {
  id: string;
  screen: Blob;
  camera: Blob | null;
  meta: TakeMeta;
  draft: TakeDraft | null;
  finalized: boolean;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function indexedDb(): IDBFactory | null {
  return typeof indexedDB === "undefined" ? null : indexedDB;
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const idb = indexedDb();
  if (!idb) return Promise.reject(new Error("IndexedDB unavailable"));
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TAKES)) db.createObjectStore(TAKES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // A version change from another tab would otherwise leave us holding a
      // connection that blocks it forever.
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("Could not open the take store."));
    req.onblocked = () => reject(new Error("Take store open blocked by another connection."));
  });
  // A failed open must not be cached: private mode / a torn-down IDB can recover on a retry.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Test seam: drop the cached connection so a fresh fake IndexedDB is picked up. */
export function resetTakeDbForTests(): void {
  dbPromise = null;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Take store transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Take store transaction aborted."));
  });
}
function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Take store request failed."));
  });
}

export async function createTake(
  init: { mode: RecordingMode; mimeType: string },
  now = Date.now(),
): Promise<string> {
  const db = await open();
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tx = db.transaction(TAKES, "readwrite");
  const rec: TakeRecord = { id, createdAt: now, ...init, chunks: 0, bytes: 0, meta: null, draft: null };
  tx.objectStore(TAKES).put(rec);
  await done(tx);
  return id;
}

/**
 * Appends a chunk and bumps the take's running byte count / chunk count.
 *
 * The read-then-write of the take record has to happen inside ONE transaction
 * with the chunk `put`, but awaiting a request's promise resumes on a
 * microtask — which in a real browser can let the transaction go idle and
 * auto-commit before the follow-up `put` fires. So the get/put pair is wired
 * through `onsuccess` directly, synchronously, rather than awaited.
 *
 * A take record that's gone (raced by a `deleteTake` discard) aborts the
 * whole transaction — rolling back the chunk `put` too — and rejects, rather
 * than silently writing an orphaned chunk nothing will ever read. The caller
 * (`TakeWriter`) logs the rejection and stops.
 */
export function appendChunk(id: string, kind: FileKind, seq: number, data: Blob): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([TAKES, CHUNKS], "readwrite");
        const chunk: ChunkRecord = { key: [id, kind, seq], data };
        tx.objectStore(CHUNKS).put(chunk);
        const takes = tx.objectStore(TAKES);
        let missing = false;
        const getReq = takes.get(id) as IDBRequest<TakeRecord | undefined>;
        getReq.onsuccess = () => {
          const rec = getReq.result;
          if (rec) {
            rec.bytes += data.size;
            if (kind === "screen") rec.chunks = Math.max(rec.chunks, seq + 1);
            takes.put(rec);
          } else {
            missing = true;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Take store transaction failed."));
        tx.onabort = () =>
          reject(missing ? new Error(`Unknown take: ${id}`) : (tx.error ?? new Error("Take store transaction aborted.")));
      }),
  );
}

/**
 * Same read-modify-write shape as `appendChunk` — see its comment on why the
 * get/put stay unawaited, and on why a missing take aborts rather than
 * resolving as if the write had landed.
 */
function patch(id: string, fn: (r: TakeRecord) => void): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(TAKES, "readwrite");
        const store = tx.objectStore(TAKES);
        let missing = false;
        const getReq = store.get(id) as IDBRequest<TakeRecord | undefined>;
        getReq.onsuccess = () => {
          const rec = getReq.result;
          if (rec) {
            fn(rec);
            store.put(rec);
          } else {
            missing = true;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Take store transaction failed."));
        tx.onabort = () =>
          reject(missing ? new Error(`Unknown take: ${id}`) : (tx.error ?? new Error("Take store transaction aborted.")));
      }),
  );
}

export const finalizeTake = (id: string, meta: TakeMeta) => patch(id, (r) => { r.meta = meta; });
export const saveTakeDraft = (id: string, draft: TakeDraft) => patch(id, (r) => { r.draft = draft; });

/**
 * `chunkCount` defaults to the take's high-water mark (`r.chunks`) — fine for
 * the lightweight `listTakes` summary, which doesn't load any chunk blobs.
 * `loadTake` passes the CONTIGUOUS count it actually returned instead: past a
 * gap, the high-water mark overshoots how much of the blob is really
 * playable, which would draw a staging timeline longer than the footage.
 */
function estimatedMeta(r: TakeRecord, chunkCount = r.chunks): TakeMeta {
  return {
    mode: r.mode,
    mimeType: r.mimeType,
    durationMs: chunkCount * CHUNK_MS,
    cameraOffsetMs: 0,
    width: null,
    height: null,
    markers: [],
    cursor: [],
    clicks: [],
    keys: [],
  };
}

/** Newest first. Never throws: a browser without IndexedDB just has no takes. */
export async function listTakes(): Promise<TakeSummary[]> {
  try {
    const db = await open();
    const all = await result(db.transaction(TAKES).objectStore(TAKES).getAll() as IDBRequest<TakeRecord[]>);
    return all
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        mode: r.mode,
        durationMs: (r.meta ?? estimatedMeta(r)).durationMs,
        bytes: r.bytes,
        finalized: !!r.meta,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

async function chunksOf(db: IDBDatabase, id: string, kind: FileKind): Promise<Blob[]> {
  const range = IDBKeyRange.bound([id, kind, 0], [id, kind, Number.MAX_SAFE_INTEGER]);
  const recs = await result(db.transaction(CHUNKS).objectStore(CHUNKS).getAll(range) as IDBRequest<ChunkRecord[]>);
  // Key order = seq order. A gap (a chunk that never made it to disk, e.g. a
  // crash mid-write) would otherwise splice a corrupt file together with a
  // hole in the middle — truncate at the first one instead, so a restored
  // take is playable up to the point of loss.
  const contiguous: Blob[] = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].key[2] !== i) break;
    contiguous.push(recs[i].data);
  }
  return contiguous;
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
    meta: rec.meta ?? estimatedMeta(rec, screen.length),
    draft: rec.draft,
    finalized: !!rec.meta,
  };
}

export async function deleteTake(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([TAKES, CHUNKS], "readwrite");
  tx.objectStore(TAKES).delete(id);
  // A true prefix range — arrays sort after strings in IDB key order, so
  // `[id, []]` is greater than `[id, <any kind string>, <any seq>]` — rather
  // than a range hand-bounded by today's two `FileKind` values, so a future
  // third kind is covered without touching this line.
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id], [id, []]));
  await done(tx);
}

/** Drop takes created before `cutoff` (epoch ms). */
export async function pruneTakes(cutoff: number): Promise<void> {
  for (const t of await listTakes()) {
    if (t.createdAt >= cutoff) continue;
    try {
      await deleteTake(t.id);
    } catch {
      // Best-effort: one take failing to delete (e.g. a held lock) shouldn't stop the rest.
    }
  }
}
