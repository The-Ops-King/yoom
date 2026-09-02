import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import {
  MAX_DURATION_MS,
  initialRecorderState,
  recorderReducer,
  type RecorderEvent,
  type RecorderState,
} from "./recorder-machine";

const init = () => initialRecorderState(DEFAULT_SETTINGS);

function run(state: RecorderState, events: RecorderEvent[]): RecorderState {
  return events.reduce(recorderReducer, state);
}

const ACQUIRED: RecorderEvent = {
  type: "ACQUIRED",
  surface: "monitor",
  hasSystemAudio: true,
  hasCamera: true,
};

describe("initialRecorderState", () => {
  it("starts idle with the persisted preferences applied", () => {
    const s = init();
    expect(s.status).toBe("idle");
    expect(s.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(s.micOn).toBe(true);
    expect(s.systemOn).toBe(true);
    expect(s.streamsAlive).toBe(false);
  });
});

describe("acquisition", () => {
  it("idle → acquiring → setup", () => {
    const s = run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);
    expect(s.status).toBe("setup");
    expect(s.surface).toBe("monitor");
    expect(s.hasSystemAudio).toBe(true);
    expect(s.streamsAlive).toBe(true);
    expect(s.error).toBe("");
  });

  it("ACQUIRE_FAILED goes to error and clears streams", () => {
    const s = run(init(), [{ type: "ACQUIRE" }, { type: "ACQUIRE_FAILED", error: "denied" }]);
    expect(s.status).toBe("error");
    expect(s.error).toBe("denied");
    expect(s.streamsAlive).toBe(false);
  });

  it("RESET from error returns to idle keeping preferences", () => {
    const s = run(init(), [
      { type: "SELECT_MODE", mode: "camera" },
      { type: "ACQUIRE" },
      { type: "ACQUIRE_FAILED", error: "denied" },
      { type: "RESET" },
    ]);
    expect(s.status).toBe("idle");
    expect(s.mode).toBe("camera");
    expect(s.error).toBe("");
  });

  it("ignores ACQUIRED when not acquiring", () => {
    const s = init();
    expect(recorderReducer(s, ACQUIRED)).toBe(s);
  });
});

describe("mode and surface selection", () => {
  it("SELECT_MODE and SET_SURFACE_PREF only apply while idle or in setup", () => {
    const idle = recorderReducer(init(), { type: "SELECT_MODE", mode: "screen" });
    expect(idle.mode).toBe("screen");

    const recording = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
    ]);
    expect(recording.status).toBe("recording");
    expect(recorderReducer(recording, { type: "SELECT_MODE", mode: "camera" })).toBe(recording);
    expect(
      recorderReducer(recording, { type: "SET_SURFACE_PREF", pref: "window" }),
    ).toBe(recording);
  });
});

describe("countdown and recording", () => {
  const setup = () => run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);

  it("START enters a 3-second countdown", () => {
    const s = recorderReducer(setup(), { type: "START" });
    expect(s.status).toBe("countdown");
    expect(s.countdown).toBe(3);
  });

  it("COUNTDOWN_TICK walks down and then starts recording", () => {
    let s = recorderReducer(setup(), { type: "START" });
    s = recorderReducer(s, { type: "COUNTDOWN_TICK" });
    expect(s.countdown).toBe(2);
    s = recorderReducer(s, { type: "COUNTDOWN_TICK" });
    expect(s.countdown).toBe(1);
    s = recorderReducer(s, { type: "COUNTDOWN_TICK" });
    expect(s.status).toBe("recording");
    expect(s.elapsedMs).toBe(0);
  });

  it("SKIP_COUNTDOWN jumps straight to recording", () => {
    const s = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    expect(s.status).toBe("recording");
  });

  it("TICK accumulates elapsed only while recording", () => {
    const rec = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    const ticked = recorderReducer(rec, { type: "TICK", elapsedMs: 4200 });
    expect(ticked.elapsedMs).toBe(4200);

    const paused = recorderReducer(ticked, { type: "PAUSE" });
    expect(paused.status).toBe("paused");
    expect(recorderReducer(paused, { type: "TICK", elapsedMs: 9999 }).elapsedMs).toBe(4200);
  });

  it("PAUSE ⇄ RESUME", () => {
    const rec = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    const paused = recorderReducer(rec, { type: "PAUSE" });
    expect(paused.status).toBe("paused");
    expect(recorderReducer(paused, { type: "RESUME" }).status).toBe("recording");
    // PAUSE while paused is a no-op
    expect(recorderReducer(paused, { type: "PAUSE" })).toBe(paused);
  });

  it("STOP from recording and from paused both go to stopping", () => {
    const rec = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    expect(recorderReducer(rec, { type: "STOP" }).status).toBe("stopping");
    const paused = recorderReducer(rec, { type: "PAUSE" });
    expect(recorderReducer(paused, { type: "STOP" }).status).toBe("stopping");
  });

  it("MAX_DURATION stops the recording", () => {
    const rec = run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }]);
    const s = recorderReducer(rec, { type: "MAX_DURATION" });
    expect(s.status).toBe("stopping");
    expect(s.notice).toContain("30");
    expect(MAX_DURATION_MS).toBe(30 * 60 * 1000);
  });

  it("RESTART clears elapsed and returns to countdown", () => {
    const rec = run(setup(), [
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "TICK", elapsedMs: 5000 },
      { type: "RESTART" },
    ]);
    expect(rec.status).toBe("countdown");
    expect(rec.countdown).toBe(3);
    expect(rec.elapsedMs).toBe(0);
  });
});

describe("STREAM_ENDED", () => {
  it("in setup returns to idle", () => {
    const s = run(init(), [{ type: "ACQUIRE" }, ACQUIRED, { type: "STREAM_ENDED" }]);
    expect(s.status).toBe("idle");
    expect(s.streamsAlive).toBe(false);
  });

  it("while recording stops the recording", () => {
    const s = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "STREAM_ENDED" },
    ]);
    expect(s.status).toBe("stopping");
    expect(s.streamsAlive).toBe(false);
  });
});

describe("review, upload and done", () => {
  const stopped = () =>
    run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "TICK", elapsedMs: 12_000 },
      { type: "STOP" },
    ]);

  const blob = { size: 1234 } as Blob;

  it("BLOB_READY moves to review with the recording metadata", () => {
    const s = recorderReducer(stopped(), {
      type: "BLOB_READY",
      blob,
      durationMs: 12_000,
      width: 1920,
      height: 1080,
    });
    expect(s.status).toBe("review");
    expect(s.blob).toBe(blob);
    expect(s.durationMs).toBe(12_000);
    expect(s.width).toBe(1920);
  });

  it("DISCARD returns to setup while streams are alive and to idle otherwise", () => {
    const review = recorderReducer(stopped(), {
      type: "BLOB_READY",
      blob,
      durationMs: 1,
      width: 2,
      height: 3,
    });
    expect(recorderReducer(review, { type: "DISCARD" }).status).toBe("setup");
    expect(recorderReducer(review, { type: "DISCARD" }).blob).toBeNull();

    const dead = { ...review, streamsAlive: false };
    expect(recorderReducer(dead, { type: "DISCARD" }).status).toBe("idle");
  });

  it("UPLOAD → UPLOAD_PROGRESS → UPLOAD_DONE", () => {
    const review = recorderReducer(stopped(), {
      type: "BLOB_READY",
      blob,
      durationMs: 1,
      width: 2,
      height: 3,
    });
    let s = recorderReducer(review, { type: "UPLOAD" });
    expect(s.status).toBe("uploading");
    expect(s.uploadProgress).toBe(0);
    s = recorderReducer(s, { type: "UPLOAD_PROGRESS", percent: 62 });
    expect(s.uploadProgress).toBe(62);
    s = recorderReducer(s, {
      type: "UPLOAD_DONE",
      videoId: "vid-1",
      shareUrl: "https://jtylerray.com/v/abc",
    });
    expect(s.status).toBe("done");
    expect(s.shareUrl).toBe("https://jtylerray.com/v/abc");
    expect(s.blob).toBeNull();
  });

  it("UPLOAD_FAILED returns to review with an error so the blob can be retried", () => {
    const uploading = run(stopped(), [
      { type: "BLOB_READY", blob, durationMs: 1, width: 2, height: 3 },
      { type: "UPLOAD" },
      { type: "UPLOAD_FAILED", error: "network" },
    ]);
    expect(uploading.status).toBe("review");
    expect(uploading.error).toBe("network");
    expect(uploading.blob).toBe(blob);
  });
});

describe("live toggles", () => {
  it("TOGGLE_MIC / TOGGLE_SYSTEM flip in any state", () => {
    const rec = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
    ]);
    expect(recorderReducer(rec, { type: "TOGGLE_MIC" }).micOn).toBe(false);
    expect(recorderReducer(rec, { type: "TOGGLE_SYSTEM" }).systemOn).toBe(false);
    expect(
      recorderReducer(rec, { type: "TOGGLE_MIC", on: true }).micOn,
    ).toBe(true);
  });

  it("SET_BUBBLE merges partial bubble config", () => {
    const rec = run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);
    const s = recorderReducer(rec, { type: "SET_BUBBLE", patch: { visible: false } });
    expect(s.bubble.visible).toBe(false);
    expect(s.bubble.shape).toBe(DEFAULT_SETTINGS.bubble.shape);
  });

  it("SET_BACKGROUND and SET_FRAME replace/merge their configs", () => {
    const s0 = run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);
    const s1 = recorderReducer(s0, {
      type: "SET_BACKGROUND",
      background: { kind: "color", color: "#123456" },
    });
    expect(s1.background).toEqual({ kind: "color", color: "#123456" });
    const s2 = recorderReducer(s1, { type: "SET_FRAME", patch: { enabled: true } });
    expect(s2.frame.enabled).toBe(true);
    expect(s2.frame.padding).toBe(DEFAULT_SETTINGS.frame.padding);
  });

  it("SET_DEVICE stores mic and camera ids", () => {
    const s = run(init(), [
      { type: "SET_DEVICE", kind: "mic", deviceId: "m1" },
      { type: "SET_DEVICE", kind: "camera", deviceId: "c1" },
    ]);
    expect(s.micId).toBe("m1");
    expect(s.cameraId).toBe("c1");
  });
});

describe("unknown transitions", () => {
  it("returns the same object reference for a no-op", () => {
    const s = init();
    expect(recorderReducer(s, { type: "PAUSE" })).toBe(s);
    expect(recorderReducer(s, { type: "UPLOAD" })).toBe(s);
    expect(recorderReducer(s, { type: "COUNTDOWN_TICK" })).toBe(s);
  });
});
