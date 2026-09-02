import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from, rpc }),
}));

import {
  changeSlug,
  getVideoStats,
  isSlugTaken,
  listRecentViewers,
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

  it("rounds avg_max_percent to one decimal place", async () => {
    const videos = chain({ data: [ROW_A], error: null });
    const stats = chain({
      data: [
        {
          video_id: ROW_A.id,
          view_count: 1,
          unique_viewers: 1,
          avg_max_percent: "42.567",
          last_viewed_at: null,
        },
      ],
      error: null,
    });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : stats,
    );

    const rows = await listVideos({ sort: "newest" });
    expect(rows[0].avgMaxPercent).toBe(42.6);
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

  it("strips ilike wildcard characters (% and _) from the search term", async () => {
    const videos = chain({ data: [], error: null });
    from.mockImplementation((table: string) =>
      table === "videos" ? videos : chain({ data: [], error: null }),
    );

    await listVideos({ q: "a%b_c", sort: "newest" });

    expect(videos.or).toHaveBeenCalledWith(
      "title.ilike.%abc%,description.ilike.%abc%,slug.ilike.%abc%",
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
    expect(builder.is).toHaveBeenCalledWith("deleted_at", null);
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(row?.title).toBe("New");
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
    expect(builder.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("returns null when the video is missing or soft-deleted", async () => {
    const builder = chain({ data: null, error: null });
    from.mockReturnValue(builder);
    await expect(updateVideoMeta(ROW_A.id, { title: "New" })).resolves.toBeNull();
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

describe("getVideoStats", () => {
  it("bins max_percent into ten buckets and averages them", async () => {
    const builder = chain({
      data: [
        { max_percent: 0, viewer_name: null, ip_hash: "a" },
        { max_percent: 5, viewer_name: null, ip_hash: "a" },
        { max_percent: 55, viewer_name: "Jo", ip_hash: "b" },
        { max_percent: 100, viewer_name: null, ip_hash: "c" },
      ],
      error: null,
    });
    from.mockReturnValue(builder);

    const stats = await getVideoStats(ROW_A.id);

    expect(from).toHaveBeenCalledWith("view_sessions");
    expect(builder.eq).toHaveBeenCalledWith("video_id", ROW_A.id);
    expect(stats.views).toBe(4);
    expect(stats.unique).toBe(3);
    expect(stats.avgMaxPercent).toBe(40);
    expect(stats.buckets).toHaveLength(10);
    // 0 and 5 both land in bucket 0; 55 in bucket 5; 100 clamps into bucket 9.
    expect(stats.buckets).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("returns zeroed stats with ten empty buckets when there are no views", async () => {
    from.mockReturnValue(chain({ data: [], error: null }));
    const stats = await getVideoStats(ROW_A.id);
    expect(stats).toEqual({
      views: 0,
      unique: 0,
      avgMaxPercent: 0,
      buckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  });
});

describe("listRecentViewers", () => {
  it("orders by start time and applies the limit", async () => {
    const builder = chain({
      data: [
        {
          id: "s1",
          viewer_name: "Jo",
          city: "Austin",
          country: "US",
          user_agent: "Mozilla/5.0 (Macintosh) Chrome/120",
          started_at: "2026-09-02T10:00:00Z",
          last_seen_at: "2026-09-02T10:05:00Z",
          max_percent: 80,
        },
      ],
      error: null,
    });
    from.mockReturnValue(builder);

    const rows = await listRecentViewers(ROW_A.id);

    expect(builder.order).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(50);
    expect(rows[0].viewer_name).toBe("Jo");
  });

  it("honours an explicit limit", async () => {
    const builder = chain({ data: [], error: null });
    from.mockReturnValue(builder);
    await listRecentViewers(ROW_A.id, 5);
    expect(builder.limit).toHaveBeenCalledWith(5);
  });
});
