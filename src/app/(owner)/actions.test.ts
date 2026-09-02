import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ isOwner: vi.fn(async () => true) }));
vi.mock("@/lib/google-drive", () => ({ trashFile: vi.fn(async () => undefined) }));
const softDeleteVideo = vi.fn();
vi.mock("@/lib/db", () => ({
  softDeleteVideo: (id: string) => softDeleteVideo(id),
  changeSlug: vi.fn(), getVideoById: vi.fn(), isSlugTaken: vi.fn(), updateSettings: vi.fn(), updateVideoMeta: vi.fn(),
}));

import { deleteVideos } from "./actions";

const UUID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

beforeEach(() => softDeleteVideo.mockReset());

describe("deleteVideos", () => {
  it("deletes each id and reports failures by id", async () => {
    softDeleteVideo
      .mockResolvedValueOnce({ id: UUID(1), slug: "a", drive_file_id: "d1", thumbnail_drive_file_id: null })
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(null);
    const result = await deleteVideos([UUID(1), UUID(2), UUID(3)]);
    expect(result.deleted).toEqual([UUID(1)]);
    expect(result.failed.map((f) => f.id)).toEqual([UUID(2), UUID(3)]);
  });
  it("rejects malformed ids without touching the db", async () => {
    const result = await deleteVideos(["nope"]);
    expect(result.failed[0].error).toMatch(/invalid/i);
    expect(softDeleteVideo).not.toHaveBeenCalled();
  });
});
