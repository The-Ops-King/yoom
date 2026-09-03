/**
 * Saved frame wallpapers.
 *
 * An uploaded background used to live for exactly one staging session: the
 * picker minted an object URL, the screen revoked it on unmount, and the next
 * take started from the gradients again. These persist the bytes instead —
 * IndexedDB, because a 4 MB PNG has no business in localStorage — and hand
 * out a *fresh* object URL every time one is loaded.
 *
 * Only the `wallpaperId` travels in settings and in `videos.edits`; the `src`
 * is always re-minted (see `loadBackground`), because a blob: URL is dead the
 * moment its document goes away.
 */

export interface Wallpaper {
  id: string;
  name: string;
  blob: Blob;
  addedAt: number;
}

/** What `listWallpapers` returns: the record without the (potentially large) blob. */
export type WallpaperMeta = Omit<Wallpaper, "blob">;

const DB_NAME = "yoom";
const DB_VERSION = 1;
const STORE = "wallpapers";

/** 20 MB. A frame background is a still image; anything larger is a mistake. */
export const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;

let dbPromise: Promise<IDBDatabase> | null = null;

function indexedDb(): IDBFactory | null {
  return typeof indexedDB === "undefined" ? null : indexedDB;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const idb = indexedDb();
  if (!idb) return Promise.reject(new Error("IndexedDB is not available."));
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt");
      }
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
    req.onerror = () => reject(req.error ?? new Error("Could not open the wallpaper store."));
  });
  // A failed open must not be cached: private mode can recover on a retry.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Wallpaper store request failed."));
        tx.onabort = () => reject(tx.error ?? new Error("Wallpaper store transaction aborted."));
      }),
  );
}

function isWallpaper(value: unknown): value is Wallpaper {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.addedAt === "number" &&
    !!r.blob &&
    typeof r.blob === "object"
  );
}

/** Newest first. Never throws: a browser without IndexedDB just has no wallpapers. */
export async function listWallpapers(): Promise<WallpaperMeta[]> {
  let rows: unknown[];
  try {
    rows = await run<unknown[]>("readonly", (s) => s.getAll() as IDBRequest<unknown[]>);
  } catch {
    return [];
  }
  return rows
    .filter(isWallpaper)
    .map(({ id, name, addedAt }) => ({ id, name, addedAt }))
    .sort((a, b) => b.addedAt - a.addedAt);
}

/** Store an uploaded image and return its record. Rejects on an oversized or non-image file. */
export async function addWallpaper(file: File): Promise<WallpaperMeta> {
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Only image files can be saved as wallpapers.");
  }
  if (file.size > MAX_WALLPAPER_BYTES) {
    throw new Error("That image is too large to save (20 MB max).");
  }
  const record: Wallpaper = {
    id: crypto.randomUUID(),
    name: file.name || "Wallpaper",
    // A `File` *is* a `Blob`, but structured-cloning the File subclass keeps a
    // filesystem handle in some engines; the plain slice is what we want.
    blob: file.slice(0, file.size, file.type || "application/octet-stream"),
    addedAt: Date.now(),
  };
  await run("readwrite", (s) => s.put(record));
  const { id, name, addedAt } = record;
  return { id, name, addedAt };
}

export async function removeWallpaper(id: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {
    // Nothing to do — the row is gone either way.
  }
}

/** The stored bytes, or null when the id is unknown (deleted on another device, cleared storage). */
export async function getWallpaperBlob(id: string): Promise<Blob | null> {
  if (!id) return null;
  try {
    const row = await run<unknown>("readonly", (s) => s.get(id) as IDBRequest<unknown>);
    return isWallpaper(row) ? row.blob : null;
  } catch {
    return null;
  }
}

/** Test seam: drop the cached connection so a fresh fake IndexedDB is picked up. */
export function resetWallpaperDbForTests(): void {
  dbPromise = null;
}
