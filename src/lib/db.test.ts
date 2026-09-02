import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from, rpc }),
}));

import {
  claimAlert,
  createViewSession,
  findRecentViewSession,
  getSettings,
  getVideoById,
  getVideoBySlug,
  getVideoIdByOldSlug,
  getViewSession,
  insertVideo,
  setVideoThumbnail,
  updateViewSession,
} from "@/lib/db";

type AnyRecord = Record<string, unknown>;

/** A chainable Supabase query-builder stub that resolves to `result`. */
function chain(result: AnyRecord) {
  const calls: Record<string, unknown[][]> = {};
  const builder: AnyRecord = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "eq",
    "is",
    "gte",
    "order",
    "limit",
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

const VIDEO = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "abc12345",
  title: "Demo",
  description: null,
  drive_file_id: "drive-1",
  mime: "video/webm",
  size_bytes: 100,
  duration_ms: 5000,
  width: 1280,
  height: 720,
  thumbnail_drive_file_id: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  deleted_at: null,
};

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
});

describe("getVideoBySlug", () => {
  it("selects a live video by slug", async () => {
    const builder = chain({ data: VIDEO, error: null });
    from.mockReturnValue(builder);

    await expect(getVideoBySlug("abc12345")).resolves.toEqual(VIDEO);
    expect(from).toHaveBeenCalledWith("videos");
    expect(builder.eq).toHaveBeenCalledWith("slug", "abc12345");
    expect(builder.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("returns null when absent", async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    await expect(getVideoBySlug("nope")).resolves.toBeNull();
  });

  it("throws on a database error", async () => {
    from.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    await expect(getVideoBySlug("abc12345")).rejects.toThrow("boom");
  });
});

describe("getVideoById", () => {
  it("selects by id", async () => {
    const builder = chain({ data: VIDEO, error: null });
    from.mockReturnValue(builder);
    await expect(getVideoById(VIDEO.id)).resolves.toEqual(VIDEO);
    expect(builder.eq).toHaveBeenCalledWith("id", VIDEO.id);
  });
});

describe("getVideoIdByOldSlug", () => {
  it("returns the mapped video id", async () => {
    const builder = chain({ data: { video_id: VIDEO.id }, error: null });
    from.mockReturnValue(builder);
    await expect(getVideoIdByOldSlug("old-slug")).resolves.toBe(VIDEO.id);
    expect(from).toHaveBeenCalledWith("slug_history");
    expect(builder.eq).toHaveBeenCalledWith("old_slug", "old-slug");
  });

  it("returns null when there is no history row", async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    await expect(getVideoIdByOldSlug("old-slug")).resolves.toBeNull();
  });
});

describe("insertVideo", () => {
  it("inserts and returns the row", async () => {
    const builder = chain({ data: VIDEO, error: null });
    from.mockReturnValue(builder);

    await expect(
      insertVideo({
        slug: "abc12345",
        title: "Demo",
        drive_file_id: "drive-1",
        mime: "video/webm",
        size_bytes: 100,
        duration_ms: 5000,
        width: 1280,
        height: 720,
      }),
    ).resolves.toEqual(VIDEO);
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "abc12345", drive_file_id: "drive-1" }),
    );
  });

  it("reports a unique violation as a typed error code", async () => {
    from.mockReturnValue(
      chain({ data: null, error: { code: "23505", message: "duplicate key" } }),
    );
    await expect(
      insertVideo({
        slug: "abc12345",
        title: "Demo",
        drive_file_id: "drive-1",
        mime: "video/webm",
        size_bytes: null,
        duration_ms: null,
        width: null,
        height: null,
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("createViewSession", () => {
  it("inserts a view session and returns its id", async () => {
    const builder = chain({ data: { id: "session-1" }, error: null });
    from.mockReturnValue(builder);

    await expect(
      createViewSession({
        video_id: VIDEO.id,
        viewer_name: "Ada",
        ip_hash: "hash",
        user_agent: "UA",
        country: "US",
        city: "SLC",
      }),
    ).resolves.toBe("session-1");
    expect(from).toHaveBeenCalledWith("view_sessions");
  });
});

describe("updateViewSession", () => {
  it("calls the update_view_progress RPC", async () => {
    rpc.mockResolvedValue({
      data: { ...VIDEO, id: "session-1", max_percent: 55 },
      error: null,
    });
    const row = await updateViewSession("session-1", 55, false);
    expect(rpc).toHaveBeenCalledWith("update_view_progress", {
      p_session_id: "session-1",
      p_percent: 55,
      p_ended: false,
    });
    expect(row?.max_percent).toBe(55);
  });

  it("clamps a percent above 100 down to 100", async () => {
    rpc.mockResolvedValue({
      data: { ...VIDEO, id: "session-1", max_percent: 100 },
      error: null,
    });
    await updateViewSession("session-1", 500, false);
    expect(rpc).toHaveBeenCalledWith("update_view_progress", {
      p_session_id: "session-1",
      p_percent: 100,
      p_ended: false,
    });
  });

  it("clamps a negative percent up to 0", async () => {
    rpc.mockResolvedValue({
      data: { ...VIDEO, id: "session-1", max_percent: 0 },
      error: null,
    });
    await updateViewSession("session-1", -5, false);
    expect(rpc).toHaveBeenCalledWith("update_view_progress", {
      p_session_id: "session-1",
      p_percent: 0,
      p_ended: false,
    });
  });

  it("returns null when the session is gone", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(updateViewSession("nope", 10, false)).resolves.toBeNull();
  });

  it("treats an all-null composite row as absent", async () => {
    rpc.mockResolvedValue({ data: { id: null, video_id: null }, error: null });
    await expect(updateViewSession("nope", 10, false)).resolves.toBeNull();
  });
});

describe("getViewSession", () => {
  it("selects a session by id", async () => {
    const builder = chain({ data: { id: "session-1", video_id: VIDEO.id }, error: null });
    from.mockReturnValue(builder);
    const row = await getViewSession("session-1");
    expect(from).toHaveBeenCalledWith("view_sessions");
    expect(builder.eq).toHaveBeenCalledWith("id", "session-1");
    expect(row?.id).toBe("session-1");
  });

  it("returns null when absent", async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    await expect(getViewSession("nope")).resolves.toBeNull();
  });
});

describe("claimAlert", () => {
  it("returns true when a row was claimed", async () => {
    const builder = chain({ data: [{ id: "session-1" }], error: null });
    from.mockReturnValue(builder);

    await expect(claimAlert("session-1", "alert_sent_at")).resolves.toBe(true);
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ alert_sent_at: expect.any(String) }),
    );
    expect(builder.is).toHaveBeenCalledWith("alert_sent_at", null);
    expect(builder.select).toHaveBeenCalledWith("id");
  });

  it("returns false when the alert was already claimed", async () => {
    from.mockReturnValue(chain({ data: [], error: null }));
    await expect(claimAlert("session-1", "summary_sent_at")).resolves.toBe(false);
  });

  it("returns false on error rather than throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    from.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    await expect(claimAlert("session-1", "alert_sent_at")).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("setVideoThumbnail", () => {
  it("updates the thumbnail column", async () => {
    const builder = chain({ data: null, error: null });
    from.mockReturnValue(builder);
    await setVideoThumbnail(VIDEO.id, "thumb-1");
    expect(builder.update).toHaveBeenCalledWith({
      thumbnail_drive_file_id: "thumb-1",
    });
    expect(builder.eq).toHaveBeenCalledWith("id", VIDEO.id);
  });
});

describe("findRecentViewSession", () => {
  it("returns the most recent session within the window", async () => {
    const builder = chain({ data: { id: "session-1", video_id: VIDEO.id }, error: null });
    from.mockReturnValue(builder);

    const row = await findRecentViewSession(VIDEO.id, "hash", 30);

    expect(from).toHaveBeenCalledWith("view_sessions");
    expect(builder.eq).toHaveBeenCalledWith("video_id", VIDEO.id);
    expect(builder.eq).toHaveBeenCalledWith("ip_hash", "hash");
    expect(builder.gte).toHaveBeenCalledWith("started_at", expect.any(String));
    const [[, gteValue]] = builder.__calls.gte;
    expect(() => new Date(gteValue as string)).not.toThrow();
    expect(new Date(gteValue as string).toISOString()).toBe(gteValue);
    expect(builder.order).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(row?.id).toBe("session-1");
  });

  it("returns null when absent", async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    await expect(findRecentViewSession(VIDEO.id, "hash", 30)).resolves.toBeNull();
  });
});

describe("getSettings", () => {
  it("returns the single settings row", async () => {
    const builder = chain({
      data: {
        id: 1,
        alert_on_first_view: true,
        alert_on_completion: false,
        updated_at: "2026-09-01T00:00:00Z",
      },
      error: null,
    });
    from.mockReturnValue(builder);
    const settings = await getSettings();
    expect(settings.alert_on_completion).toBe(false);
    expect(builder.eq).toHaveBeenCalledWith("id", 1);
  });

  it("defaults both alerts to on when the row is missing", async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    const settings = await getSettings();
    expect(settings).toEqual({
      id: 1,
      alert_on_first_view: true,
      alert_on_completion: true,
      updated_at: null,
    });
  });
});
