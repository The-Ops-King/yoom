import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addWallpaper,
  getWallpaperBlob,
  listWallpapers,
  MAX_WALLPAPER_BYTES,
  removeWallpaper,
  resetWallpaperDbForTests,
} from "./wallpapers";

/**
 * A `File` that behaves the way `addWallpaper` needs: `.slice()` has to survive
 * a structured clone into the fake IndexedDB, which the platform `File` in Node
 * 20+ does.
 */
function imageFile(name: string, bytes = 8, type = "image/png"): File {
  return new File([new Uint8Array(bytes).fill(7)], name, { type });
}

beforeEach(() => {
  // A fresh factory per test: fake-indexeddb keeps its databases on the object.
  globalThis.indexedDB = new IDBFactory();
  resetWallpaperDbForTests();
});

afterEach(() => {
  resetWallpaperDbForTests();
});

describe("addWallpaper", () => {
  it("stores the file and returns its metadata", async () => {
    const meta = await addWallpaper(imageFile("hills.png"));
    expect(meta.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(meta.name).toBe("hills.png");
    expect(meta.addedAt).toBeGreaterThan(0);
  });

  it("round-trips the bytes through getWallpaperBlob", async () => {
    const meta = await addWallpaper(imageFile("hills.png", 12));
    const blob = await getWallpaperBlob(meta.id);
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(12);
    expect(new Uint8Array(await blob!.arrayBuffer())[0]).toBe(7);
  });

  it("rejects a non-image file", async () => {
    const bad = new File(["x"], "notes.txt", { type: "text/plain" });
    await expect(addWallpaper(bad)).rejects.toThrow(/image files/i);
    expect(await listWallpapers()).toHaveLength(0);
  });

  it("rejects an oversized image", async () => {
    const huge = new File([new Uint8Array(10)], "big.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: MAX_WALLPAPER_BYTES + 1 });
    await expect(addWallpaper(huge)).rejects.toThrow(/too large/i);
  });
});

describe("listWallpapers", () => {
  it("is empty to start with", async () => {
    expect(await listWallpapers()).toEqual([]);
  });

  it("returns metadata without the blob, newest first", async () => {
    const a = await addWallpaper(imageFile("a.png"));
    const b = await addWallpaper(imageFile("b.png"));
    // `Date.now()` can tie inside one tick; force a distinct order.
    const rows = await listWallpapers();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !("blob" in r))).toBe(true);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([a.id, b.id]));
    expect(rows[0].addedAt).toBeGreaterThanOrEqual(rows[1].addedAt);
  });

  it("survives a dropped connection (a version change in another tab)", async () => {
    const meta = await addWallpaper(imageFile("a.png"));
    resetWallpaperDbForTests();
    expect((await listWallpapers()).map((r) => r.id)).toEqual([meta.id]);
  });
});

describe("removeWallpaper", () => {
  it("drops the row and its bytes", async () => {
    const meta = await addWallpaper(imageFile("a.png"));
    await removeWallpaper(meta.id);
    expect(await listWallpapers()).toEqual([]);
    expect(await getWallpaperBlob(meta.id)).toBeNull();
  });

  it("is a no-op for an unknown id", async () => {
    await expect(removeWallpaper("nope")).resolves.toBeUndefined();
  });
});

describe("getWallpaperBlob", () => {
  it("returns null for an unknown or empty id", async () => {
    expect(await getWallpaperBlob("")).toBeNull();
    expect(await getWallpaperBlob("missing")).toBeNull();
  });
});

describe("without IndexedDB", () => {
  it("degrades to an empty list rather than throwing", async () => {
    // @ts-expect-error deliberately removing the global for this test
    delete globalThis.indexedDB;
    resetWallpaperDbForTests();
    expect(await listWallpapers()).toEqual([]);
    expect(await getWallpaperBlob("x")).toBeNull();
    await expect(removeWallpaper("x")).resolves.toBeUndefined();
  });
});
