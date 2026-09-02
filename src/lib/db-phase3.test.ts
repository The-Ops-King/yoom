import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from, rpc }),
}));

import {
  changeSlug,
  isSlugTaken,
  listVideos,
  setVideoEdits,
  softDeleteVideo,
  updateSettings,
  updateVideoMeta,
} from "@/lib/db";

type AnyRecord = Record<string, unknown>;

/** Chainable Supabase query-builder stub that resolves to `result`. */
function chain(result: AnyRecord) {
  const calls: Record<string, unknown[][]> = {};
  const builder: AnyRecord = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "is",
    "in",
    "gte",
    "ilike",
    "or",
    "order",
    "limit",
    "range",
  ]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return builder;
    });
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: AnyRecord) => unknown) => resolve(result);
  builder.__calls = calls;
  return builder;
}

const ROW_A = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  slug: "alpha",
  title: "Alpha",
  description: null,
  drive_file_id: "drive-a",
  mime: "video/webm",
  size_bytes: 100,
  duration_ms: 5000,
  width: 1280,
  height: 720,
  thumbnail_drive_file_id: "thumb-a",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  deleted_at: null,
  edits: {},
};

const ROW_B = {
  ...ROW_A,
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  slug: "bravo",
  title: "Bravo",
  drive_file_id: "drive-b",
  created_at: "2026-09-02T00:00:00Z",
};

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
});

describe("listVideos", () => {
  it("filters out deleted rows and merges video_stats", async () => {
    const videos = chain({ data: [ROW_B, ROW_A], error: null });
    const stats = chain({
      data: [
        {
          video_id: ROW_A.id,
          view_count: 7,
          unique_viewers: 3,
          avg_max_percent: "42.50",
          last_viewed_at: "2026-09-02T10:00:00Z",
        },
      ],
      error: null,
    });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : stats,
    );

    const rows = await listVideos({ sort: "newest" });

    expect(videos.is).toHaveBeenCalledWith("deleted_at", null);
    expect(from).toHaveBeenCalledWith("video_stats");
    expect(rows.map((r) => r.slug)).toEqual(["bravo", "alpha"]);
    expect(rows[1].views).toBe(7);
    expect(rows[1].uniqueViewers).toBe(3);
    expect(rows[1].avgMaxPercent).toBe(42.5);
    // No stats row at all still yields zeros, never undefined.
    expect(rows[0].views).toBe(0);
    expect(rows[0].avgMaxPercent).toBe(0);
    expect(rows[0].lastViewedAt).toBeNull();
  });

  it("applies a search filter across title, description and slug", async () => {
    const videos = chain({ data: [], error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: [], error: null }),
    );

    await listVideos({ q: "demo", sort: "newest" });

    expect(videos.or).toHaveBeenCalledWith(
      "title.ilike.%demo%,description.ilike.%demo%,slug.ilike.%demo%",
    );
  });

  it("escapes PostgREST metacharacters in the search term", async () => {
    const videos = chain({ data: [], error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: [], error: null }),
    );

    await listVideos({ q: "a,b(c)", sort: "newest" });

    expect(videos.or).toHaveBeenCalledWith(
      "title.ilike.%a b c %,description.ilike.%a b c %,slug.ilike.%a b c %".replace(
        / /g,
        "",
      ),
    );
  });

  it("orders oldest-first when asked", async () => {
    const videos = chain({ data: [], error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: [], error: null }),
    );

    await listVideos({ sort: "oldest" });

    expect(videos.order).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  it("sorts by view count in JS for sort=views", async () => {
    const videos = chain({ data: [ROW_A, ROW_B], error: null });
    const stats = chain({
      data: [
        { video_id: ROW_A.id, view_count: 1, unique_viewers: 1, avg_max_percent: 0, last_viewed_at: null },
        { video_id: ROW_B.id, view_count: 9, unique_viewers: 2, avg_max_percent: 0, last_viewed_at: null },
      ],
      error: null,
    });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : stats,
    );

    const rows = await listVideos({ sort: "views" });
    expect(rows.map((r) => r.slug)).toEqual(["bravo", "alpha"]);
  });

  it("throws on a database error", async () => {
    from.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    await expect(listVideos({ sort: "newest" })).rejects.toThrow("boom");
  });
});

describe("updateVideoMeta", () => {
  it("writes only the provided fields and returns the row", async () => {
    const builder = chain({ data: { ...ROW_A, title: "New" }, error: null });
    from.mockReturnValue(builder);

    const row = await updateVideoMeta(ROW_A.id, { title: "New" });

    expect(from).toHaveBeenCalledWith("videos");
    expect(builder.update).toHaveBeenCalledWith({ title: "New" });
    expect(builder.eq).toHaveBeenCalledWith("id", ROW_A.id);
    expect(row.title).toBe("New");
  });

  it("normalises an empty description to null", async () => {
    const builder = chain({ data: ROW_A, error: null });
    from.mockReturnValue(builder);
    await updateVideoMeta(ROW_A.id, { description: "   " });
    expect(builder.update).toHaveBeenCalledWith({ description: null });
  });

  it("is a no-op read when nothing changed", async () => {
    const builder = chain({ data: ROW_A, error: null });
    from.mockReturnValue(builder);
    await updateVideoMeta(ROW_A.id, {});
    expect(builder.update).not.toHaveBeenCalled();
    expect(builder.select).toHaveBeenCalled();
  });
});

describe("isSlugTaken", () => {
  it("is true when a live video already owns the slug", async () => {
    const videos = chain({ data: { id: ROW_B.id }, error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: null, error: null }),
    );
    await expect(isSlugTaken("alpha")).resolves.toBe(true);
  });

  it("ignores the excluded video's own slug", async () => {
    const videos = chain({ data: { id: ROW_A.id }, error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: null, error: null }),
    );
    await expect(isSlugTaken("alpha", ROW_A.id)).resolves.toBe(false);
  });

  it("is true when slug_history points at another video", async () => {
    from.mockImplementation((table: string) =>
      table === "videos"
        ? chain({ data: null, error: null })
        : chain({ data: { video_id: ROW_B.id }, error: null }),
    );
    await expect(isSlugTaken("alpha", ROW_A.id)).resolves.toBe(true);
  });

  it("lets a video reclaim its own old slug", async () => {
    from.mockImplementation((table: string) =>
      table === "videos"
        ? chain({ data: null, error: null })
        : chain({ data: { video_id: ROW_A.id }, error: null }),
    );
    await expect(isSlugTaken("alpha", ROW_A.id)).resolves.toBe(false);
  });
});

describe("changeSlug", () => {
  it("calls the change_video_slug RPC", async () => {
    rpc.mockResolvedValue({ data: { ...ROW_A, slug: "my-demo" }, error: null });
    const row = await changeSlug(ROW_A.id, "my-demo");
    expect(rpc).toHaveBeenCalledWith("change_video_slug", {
      p_video_id: ROW_A.id,
      p_new_slug: "my-demo",
    });
    expect(row?.slug).toBe("my-demo");
  });

  it("returns null when the video does not exist", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(changeSlug(ROW_A.id, "my-demo")).resolves.toBeNull();
  });

  it("throws on a database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(changeSlug(ROW_A.id, "my-demo")).rejects.toThrow("nope");
  });
});

describe("softDeleteVideo", () => {
  it("stamps deleted_at and returns the row for Drive cleanup", async () => {
    const builder = chain({
      data: { ...ROW_A, deleted_at: "2026-09-02T00:00:00Z" },
      error: null,
    });
    from.mockReturnValue(builder);

    const row = await softDeleteVideo(ROW_A.id);

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }),
    );
    expect(builder.eq).toHaveBeenCalledWith("id", ROW_A.id);
    expect(builder.is).toHaveBeenCalledWith("deleted_at", null);
    expect(row?.drive_file_id).toBe("drive-a");
  });

  it("returns null when the video was already deleted", async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    await expect(softDeleteVideo(ROW_A.id)).resolves.toBeNull();
  });
});

describe("setVideoEdits", () => {
  it("writes the edit list as jsonb", async () => {
    const builder = chain({ data: null, error: null });
    from.mockReturnValue(builder);

    await setVideoEdits(ROW_A.id, {
      version: 1,
      cuts: [],
      crop: null,
      zooms: [],
      overlays: [],
      markers: [],
    });

    expect(builder.update).toHaveBeenCalledWith({
      edits: { version: 1, cuts: [], crop: null, zooms: [], overlays: [], markers: [] },
    });
    expect(builder.eq).toHaveBeenCalledWith("id", ROW_A.id);
  });
});

describe("updateSettings", () => {
  it("patches the single settings row and returns it", async () => {
    const builder = chain({
      data: {
        id: 1,
        alert_on_first_view: false,
        alert_on_completion: true,
        updated_at: "2026-09-02T00:00:00Z",
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const settings = await updateSettings({ alert_on_first_view: false });

    expect(from).toHaveBeenCalledWith("settings");
    expect(builder.update).toHaveBeenCalledWith({ alert_on_first_view: false });
    expect(builder.eq).toHaveBeenCalledWith("id", 1);
    expect(settings.alert_on_first_view).toBe(false);
  });

  it("throws on a database error", async () => {
    from.mockReturnValue(chain({ data: null, error: { message: "nope" } }));
    await expect(updateSettings({ alert_on_completion: true })).rejects.toThrow(
      "nope",
    );
  });
});
