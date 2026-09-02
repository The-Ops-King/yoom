import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Video, ViewSession } from "@/lib/db";
import {
  deviceFromUserAgent,
  locationLabel,
  renderFirstPlayEmail,
  renderSummaryEmail,
  sendFirstPlayEmail,
  sendSummaryEmail,
} from "@/lib/alerts";

const sendMock = vi.hoisted(() => vi.fn());
const getSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSettings: getSettingsMock };
});

const video: Video = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "abc12345",
  title: "Q3 walkthrough",
  description: null,
  drive_file_id: "drive-1",
  mime: "video/webm",
  size_bytes: 1000,
  duration_ms: 60_000,
  width: 1280,
  height: 720,
  thumbnail_drive_file_id: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  deleted_at: null,
};

const session: ViewSession = {
  id: "22222222-2222-2222-2222-222222222222",
  video_id: video.id,
  viewer_name: "Ada",
  ip_hash: "hash",
  user_agent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  country: "US",
  city: "Salt Lake City",
  started_at: "2026-09-01T12:00:00Z",
  last_seen_at: "2026-09-01T12:00:30Z",
  max_percent: 64,
  ended_at: null,
  alert_sent_at: null,
  summary_sent_at: null,
  milestones: {},
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SHARE_BASE_URL = "https://jtylerray.com";
  process.env.RESEND_API_KEY = "test-key";
  process.env.ALERT_FROM_EMAIL = "alerts@jtylerray.com";
  process.env.ALERT_TO_EMAIL = "me@jtylerray.com";
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
  getSettingsMock.mockReset();
  getSettingsMock.mockResolvedValue({
    id: 1,
    alert_on_first_view: true,
    alert_on_completion: true,
    updated_at: null,
  });
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERT_FROM_EMAIL;
  delete process.env.ALERT_TO_EMAIL;
});

describe("deviceFromUserAgent", () => {
  it("recognises a Mac desktop", () => {
    expect(deviceFromUserAgent(session.user_agent)).toBe("Mac · Chrome");
  });

  it("recognises an iPhone", () => {
    expect(
      deviceFromUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
  });

  it("falls back to Unknown device", () => {
    expect(deviceFromUserAgent(null)).toBe("Unknown device");
  });
});

describe("locationLabel", () => {
  it("joins city and country", () => {
    expect(locationLabel(session)).toBe("Salt Lake City, US");
  });

  it("uses the country alone", () => {
    expect(locationLabel({ ...session, city: null })).toBe("US");
  });

  it("falls back when there is no geo", () => {
    expect(locationLabel({ ...session, city: null, country: null })).toBe(
      "Unknown location",
    );
  });
});

describe("renderFirstPlayEmail", () => {
  it("names the viewer in the subject", () => {
    const { subject } = renderFirstPlayEmail(session, video);
    expect(subject).toBe("▶ Ada started watching Q3 walkthrough");
  });

  it("says Someone when the viewer is anonymous", () => {
    const { subject } = renderFirstPlayEmail(
      { ...session, viewer_name: null },
      video,
    );
    expect(subject).toBe("▶ Someone started watching Q3 walkthrough");
  });

  it("includes location, device and the share link", () => {
    const { html, text } = renderFirstPlayEmail(session, video);
    expect(html).toContain("Salt Lake City, US");
    expect(html).toContain("Mac · Chrome");
    expect(html).toContain("https://jtylerray.com/v/abc12345");
    expect(text).toContain("https://jtylerray.com/v/abc12345");
  });

  it("escapes HTML in untrusted fields", () => {
    const { html } = renderFirstPlayEmail(
      { ...session, viewer_name: "<script>x</script>" },
      video,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderSummaryEmail", () => {
  it("reports the watched percentage in the subject", () => {
    const { subject } = renderSummaryEmail({ ...session, max_percent: 100 }, video);
    expect(subject).toBe("✅ Ada watched 100% of Q3 walkthrough");
  });

  it("includes the watched percentage in the body", () => {
    const { html, text } = renderSummaryEmail(session, video);
    expect(html).toContain("64%");
    expect(text).toContain("64%");
  });
});

describe("sendFirstPlayEmail", () => {
  it("sends when settings allow and env is set", async () => {
    await sendFirstPlayEmail(session, video);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "alerts@jtylerray.com",
        to: "me@jtylerray.com",
        subject: "▶ Ada started watching Q3 walkthrough",
      }),
    );
  });

  it("skips when alert_on_first_view is false", async () => {
    getSettingsMock.mockResolvedValue({
      id: 1,
      alert_on_first_view: false,
      alert_on_completion: true,
      updated_at: null,
    });
    await sendFirstPlayEmail(session, video);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips without throwing when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendFirstPlayEmail(session, video)).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("throws when send resolves with an error", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(sendFirstPlayEmail(session, video)).rejects.toThrow(
      "Resend failed: boom",
    );
  });
});

describe("sendSummaryEmail", () => {
  it("sends when settings allow and env is set", async () => {
    await sendSummaryEmail(session, video);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "alerts@jtylerray.com",
        to: "me@jtylerray.com",
        subject: "✅ Ada watched 64% of Q3 walkthrough",
      }),
    );
  });

  it("skips when alert_on_completion is false", async () => {
    getSettingsMock.mockResolvedValue({
      id: 1,
      alert_on_first_view: true,
      alert_on_completion: false,
      updated_at: null,
    });
    await sendSummaryEmail(session, video);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips without throwing when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendSummaryEmail(session, video)).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("throws when send resolves with an error", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(sendSummaryEmail(session, video)).rejects.toThrow(
      "Resend failed: boom",
    );
  });
});
