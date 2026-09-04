import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import {
  COUNTDOWN_SECONDS,
  MAX_DURATION_MS,
  RESTART_COUNTDOWN_SECONDS,
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

  it("ACQUIRE_CANCELLED goes back to idle with no error", () => {
    const s = run(init(), [{ type: "ACQUIRE" }, { type: "ACQUIRE_CANCELLED" }]);
    expect(s.status).toBe("idle");
    expect(s.error).toBe("");
    expect(s.notice).toBe("");
    expect(s.streamsAlive).toBe(false);
    expect(s.surface).toBe(null);
  });

  it("ACQUIRE_CANCELLED keeps the preferences the picker was opened with", () => {
    const s = run(init(), [
      { type: "SELECT_MODE", mode: "camera" },
      { type: "ACQUIRE" },
      { type: "ACQUIRE_CANCELLED" },
    ]);
    expect(s.mode).toBe("camera");
    expect(s.status).toBe("idle");
  });

  it("ignores ACQUIRE_CANCELLED outside of acquiring", () => {
    const s = run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);
    expect(recorderReducer(s, { type: "ACQUIRE_CANCELLED" })).toBe(s);
  });

  it("ignores ACQUIRED when not acquiring", () => {
    const s = init();
    expect(recorderReducer(s, ACQUIRED)).toBe(s);
  });

  it("ignores ACQUIRE_FAILED outside of acquiring", () => {
    const s = run(init(), [{ type: "SELECT_MODE", mode: "screen" }]);
    expect(recorderReducer(s, { type: "ACQUIRE_FAILED", error: "denied" })).toBe(s);
  });
});

describe("RECORD_FAILED", () => {
  it("exits stopping to error, clearing the blob and streams", () => {
    const s = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "STOP" },
      { type: "RECORD_FAILED", error: "no data" },
    ]);
    expect(s.status).toBe("error");
    expect(s.error).toBe("no data");
    expect(s.blob).toBeNull();
    expect(s.streamsAlive).toBe(false);
  });

  it("is a no-op from idle", () => {
    const s = init();
    expect(recorderReducer(s, { type: "RECORD_FAILED", error: "x" })).toBe(s);
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

  it("setup → STREAM_ENDED → SELECT_MODE lands back in idle with the new mode", () => {
    // The hook's `switchMode`: tear the streams down, tell the machine, then
    // pick the new mode. The user re-acquires straight away from `idle`.
    const s = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "STREAM_ENDED" },
      { type: "SELECT_MODE", mode: "camera" },
    ]);
    expect(s.status).toBe("idle");
    expect(s.mode).toBe("camera");
    expect(s.streamsAlive).toBe(false);
    expect(s.surface).toBeNull();
  });

  it("SET_SURFACE_PREF applies in setup so the hook can re-acquire the display", () => {
    const s = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "SET_SURFACE_PREF", pref: "browser" },
    ]);
    expect(s.status).toBe("setup");
    expect(s.surfacePref).toBe("browser");
  });
});

describe("countdown and recording", () => {
  const setup = () => run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);

  it("START enters the two-beat 'Ready? Go!' countdown", () => {
    const s = recorderReducer(setup(), { type: "START" });
    expect(s.status).toBe("countdown");
    expect(s.countdown).toBe(2);
    expect(COUNTDOWN_SECONDS).toBe(2);
  });

  it("START takes the countdown length as a parameter", () => {
    expect(recorderReducer(setup(), { type: "START", seconds: 2 }).countdown).toBe(2);
    expect(recorderReducer(setup(), { type: "START", seconds: 5 }).countdown).toBe(5);
    // A nonsensical length still has to leave a countdown that terminates.
    expect(recorderReducer(setup(), { type: "START", seconds: 0 }).countdown).toBe(1);
    expect(recorderReducer(setup(), { type: "START", seconds: -4 }).countdown).toBe(1);
    expect(recorderReducer(setup(), { type: "START", seconds: 2.6 }).countdown).toBe(2);
  });

  it("COUNTDOWN_TICK walks down and then starts recording", () => {
    let s = recorderReducer(setup(), { type: "START" });
    expect(s.countdown).toBe(2); // "Ready?"
    s = recorderReducer(s, { type: "COUNTDOWN_TICK" });
    expect(s.countdown).toBe(1); // "Go!"
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
    expect(rec.countdown).toBe(COUNTDOWN_SECONDS);
    expect(rec.elapsedMs).toBe(0);
  });

  it("RESTART restarts through a countdown from every live state", () => {
    const live = (extra: RecorderEvent[] = []) =>
      run(setup(), [
        { type: "START" },
        { type: "SKIP_COUNTDOWN" },
        { type: "TICK", elapsedMs: 5000 },
        ...extra,
      ]);

    for (const from of [
      run(setup(), [{ type: "START" }]), // countdown
      live(), // recording
      live([{ type: "PAUSE" }]), // paused
    ]) {
      const s = recorderReducer(from, {
        type: "RESTART",
        seconds: RESTART_COUNTDOWN_SECONDS,
      });
      expect(s.status).toBe("countdown");
      expect(s.countdown).toBe(2);
      expect(s.elapsedMs).toBe(0);
      expect(s.blob).toBeNull();
      expect(s.streamsAlive).toBe(true);
    }
  });

  // ⌘⇧K, the HUD button and the in-page Restart button all take this route:
  // "Ready? Go!" and then the encoder is running again.
  it("RESTART with 2 seconds counts down and lands back in recording", () => {
    const restarted = run(setup(), [
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "TICK", elapsedMs: 5000 },
      { type: "MARK" },
      { type: "RESTART", seconds: RESTART_COUNTDOWN_SECONDS },
    ]);
    expect(restarted.status).toBe("countdown");
    expect(restarted.countdown).toBe(2);
    expect(restarted.markers).toEqual([]);

    const ready = recorderReducer(restarted, { type: "COUNTDOWN_TICK" });
    expect(ready.status).toBe("countdown");
    expect(ready.countdown).toBe(1);

    const go = recorderReducer(ready, { type: "COUNTDOWN_TICK" });
    expect(go.status).toBe("recording");
    expect(go.countdown).toBe(0);
    expect(go.elapsedMs).toBe(0);
    expect(go.streamsAlive).toBe(true);
    expect(RESTART_COUNTDOWN_SECONDS).toBe(2);
  });

  it("RESTART is a no-op outside countdown/recording/paused", () => {
    const idle = init();
    expect(recorderReducer(idle, { type: "RESTART" })).toBe(idle);
    const s = setup();
    expect(recorderReducer(s, { type: "RESTART" })).toBe(s);
    const stopping = run(setup(), [
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "STOP" },
    ]);
    expect(recorderReducer(stopping, { type: "RESTART" })).toBe(stopping);
  });

  it("CANCEL throws the take away and returns to setup", () => {
    const live = (extra: RecorderEvent[] = []) =>
      run(setup(), [
        { type: "START" },
        { type: "SKIP_COUNTDOWN" },
        { type: "TICK", elapsedMs: 5000 },
        ...extra,
      ]);

    for (const from of [
      run(setup(), [{ type: "START" }]), // countdown
      live(), // recording
      live([{ type: "PAUSE" }]), // paused
      live([{ type: "STOP" }]), // stopping
    ]) {
      const s = recorderReducer(from, { type: "CANCEL" });
      expect(s.status).toBe("setup");
      expect(s.blob).toBeNull();
      expect(s.elapsedMs).toBe(0);
      expect(s.countdown).toBe(COUNTDOWN_SECONDS);
      expect(s.streamsAlive).toBe(true);
      expect(s.error).toBe("");
      expect(s.notice).toBe("");
    }
  });

  it("CANCEL is a no-op in idle and staging", () => {
    const idle = init();
    expect(recorderReducer(idle, { type: "CANCEL" })).toBe(idle);
    const staging = run(setup(), [
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "STOP" },
      {
        type: "BLOB_READY",
        blob: new Blob(["x"]),
        cameraBlob: null,
        cameraOffsetMs: 0,
        durationMs: 1000,
        width: 1280,
        height: 720,
      },
    ]);
    expect(staging.status).toBe("staging");
    expect(recorderReducer(staging, { type: "CANCEL" })).toBe(staging);
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

  it("while uploading only clears streamsAlive, so a failed upload discards to idle", () => {
    const uploading = run(init(), [
      { type: "ACQUIRE" },
      ACQUIRED,
      { type: "START" },
      { type: "SKIP_COUNTDOWN" },
      { type: "STOP" },
      {
        type: "BLOB_READY",
        blob: new Blob(["x"]),
        cameraBlob: null,
        cameraOffsetMs: 0,
        durationMs: 1_000,
        width: 1280,
        height: 720,
      },
      { type: "RENDER" },
      { type: "RENDER_DONE" },
      { type: "STREAM_ENDED" },
    ]);
    expect(uploading.status).toBe("uploading");
    expect(uploading.streamsAlive).toBe(false);

    const failed = recorderReducer(uploading, { type: "UPLOAD_FAILED", error: "nope" });
    expect(failed.status).toBe("staging");
    expect(recorderReducer(failed, { type: "DISCARD" }).status).toBe("idle");
  });
});

describe("staging, rendering, upload and done", () => {
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

  it("BLOB_READY moves to staging with the recording metadata", () => {
    const s = recorderReducer(stopped(), {
      type: "BLOB_READY",
      blob,
      cameraBlob: null,
      cameraOffsetMs: 0,
      durationMs: 12_000,
      width: 1920,
      height: 1080,
    });
    expect(s.status).toBe("staging");
    expect(s.blob).toBe(blob);
    expect(s.durationMs).toBe(12_000);
    expect(s.width).toBe(1920);
  });

  it("DISCARD returns to setup while streams are alive and to idle otherwise", () => {
    const staging = recorderReducer(stopped(), {
      type: "BLOB_READY",
      blob,
      cameraBlob: null,
      cameraOffsetMs: 0,
      durationMs: 1,
      width: 2,
      height: 3,
    });
    expect(recorderReducer(staging, { type: "DISCARD" }).status).toBe("setup");
    expect(recorderReducer(staging, { type: "DISCARD" }).blob).toBeNull();

    const dead = { ...staging, streamsAlive: false };
    expect(recorderReducer(dead, { type: "DISCARD" }).status).toBe("idle");
  });

  it("RENDER → RENDER_DONE → UPLOAD_PROGRESS → UPLOAD_DONE", () => {
    const staging = recorderReducer(stopped(), {
      type: "BLOB_READY",
      blob,
      cameraBlob: null,
      cameraOffsetMs: 0,
      durationMs: 1,
      width: 2,
      height: 3,
    });
    let s = recorderReducer(staging, { type: "RENDER" });
    expect(s.status).toBe("rendering");
    s = recorderReducer(s, { type: "RENDER_DONE" });
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
    expect(s.cameraBlob).toBeNull();
  });

  it("DISCARD resets render progress; CANCEL drops the camera blob", () => {
    const blob = new Blob(["x"], { type: "video/webm" });
    let s = initialRecorderState();
    s = recorderReducer(s, { type: "ACQUIRE" });
    s = recorderReducer(s, { type: "ACQUIRED", surface: "monitor", hasSystemAudio: true, hasCamera: true });
    s = recorderReducer(s, { type: "START" });
    s = recorderReducer(s, { type: "SKIP_COUNTDOWN" });
    const live = s;
    s = recorderReducer(s, { type: "STOP" });
    s = recorderReducer(s, { type: "BLOB_READY", blob, cameraBlob: blob, cameraOffsetMs: 10, durationMs: 1000, width: 1, height: 1 });
    s = recorderReducer(s, { type: "RENDER" });
    s = recorderReducer(s, { type: "RENDER_PROGRESS", percent: 40 });
    s = recorderReducer(s, { type: "RENDER_FAILED", error: "" });
    s = recorderReducer(s, { type: "DISCARD" });
    expect(s.renderProgress).toBe(0);
    const cancelled = recorderReducer({ ...live, cameraBlob: blob, cameraOffsetMs: 10 }, { type: "CANCEL" });
    expect(cancelled.cameraBlob).toBeNull();
    expect(cancelled.cameraOffsetMs).toBe(0);
  });

  it("UPLOAD_FAILED returns to staging with an error so the blob can be retried", () => {
    const uploading = run(stopped(), [
      { type: "BLOB_READY", blob, cameraBlob: null, cameraOffsetMs: 0, durationMs: 1, width: 2, height: 3 },
      { type: "RENDER" },
      { type: "RENDER_DONE" },
      { type: "UPLOAD_FAILED", error: "network" },
    ]);
    expect(uploading.status).toBe("staging");
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

  it("SET_FRAME merges its config", () => {
    const s1 = run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);
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
    expect(recorderReducer(s, { type: "RENDER" })).toBe(s);
    expect(recorderReducer(s, { type: "COUNTDOWN_TICK" })).toBe(s);
  });
});

describe("markers", () => {
  const setup = () => run(init(), [{ type: "ACQUIRE" }, ACQUIRED]);
  const live = (extra: RecorderEvent[] = []) =>
    run(setup(), [{ type: "START" }, { type: "SKIP_COUNTDOWN" }, ...extra]);

  it("starts with no markers", () => {
    expect(init().markers).toEqual([]);
  });

  it("MARK appends the current elapsed time in seconds", () => {
    const s = run(live(), [
      { type: "TICK", elapsedMs: 4200 },
      { type: "MARK" },
      { type: "TICK", elapsedMs: 9000 },
      { type: "MARK" },
    ]);
    expect(s.markers).toEqual([{ t: 4.2 }, { t: 9 }]);
  });

  it("MARK only fires while recording", () => {
    for (const state of [
      init(),
      setup(),
      run(setup(), [{ type: "START" }]), // countdown
      live([{ type: "PAUSE" }]), // paused
      live([{ type: "STOP" }]), // stopping
    ]) {
      expect(recorderReducer(state, { type: "MARK" })).toBe(state);
    }
  });

  it("keeps markers through stopping, staging, rendering and upload so they get saved", () => {
    const marked = run(live(), [{ type: "TICK", elapsedMs: 1000 }, { type: "MARK" }]);
    const staging = run(marked, [
      { type: "STOP" },
      {
        type: "BLOB_READY",
        blob: new Blob(["x"]),
        cameraBlob: null,
        cameraOffsetMs: 0,
        durationMs: 1000,
        width: 100,
        height: 50,
      },
    ]);
    expect(staging.status).toBe("staging");
    expect(staging.markers).toEqual([{ t: 1 }]);
    const uploading = run(staging, [{ type: "RENDER" }, { type: "RENDER_DONE" }]);
    expect(uploading.markers).toEqual([{ t: 1 }]);
  });

  it("clears markers on every transition that discards the take", () => {
    const marked = run(live(), [{ type: "TICK", elapsedMs: 1000 }, { type: "MARK" }]);
    expect(recorderReducer(marked, { type: "RESTART" }).markers).toEqual([]);
    expect(recorderReducer(marked, { type: "CANCEL" }).markers).toEqual([]);
    expect(recorderReducer(marked, { type: "RESET" }).markers).toEqual([]);

    const staging = run(marked, [
      { type: "STOP" },
      {
        type: "BLOB_READY",
        blob: new Blob(["x"]),
        cameraBlob: null,
        cameraOffsetMs: 0,
        durationMs: 1000,
        width: null,
        height: null,
      },
    ]);
    expect(recorderReducer(staging, { type: "DISCARD" }).markers).toEqual([]);
  });

  it("a new take starts with a clean marker list", () => {
    const marked = run(live(), [{ type: "TICK", elapsedMs: 1000 }, { type: "MARK" }]);
    const back = run(marked, [{ type: "CANCEL" }, { type: "START" }]);
    expect(back.markers).toEqual([]);
  });
});

describe("staging and rendering", () => {
  const blob = new Blob(["x"], { type: "video/webm" });
  function toStopping() {
    let s = initialRecorderState();
    s = recorderReducer(s, { type: "ACQUIRE" });
    s = recorderReducer(s, { type: "ACQUIRED", surface: "monitor", hasSystemAudio: true, hasCamera: true });
    s = recorderReducer(s, { type: "START" });
    s = recorderReducer(s, { type: "SKIP_COUNTDOWN" });
    s = recorderReducer(s, { type: "STOP" });
    return s;
  }

  it("BLOB_READY lands in staging with both blobs and the offset", () => {
    const s = recorderReducer(toStopping(), {
      type: "BLOB_READY", blob, cameraBlob: blob, cameraOffsetMs: 40, durationMs: 1000, width: 100, height: 50,
    });
    expect(s.status).toBe("staging");
    expect(s.cameraBlob).toBe(blob);
    expect(s.cameraOffsetMs).toBe(40);
  });

  it("RENDER → RENDER_PROGRESS → RENDER_DONE → uploading; RENDER_FAILED returns to staging", () => {
    let s = recorderReducer(toStopping(), {
      type: "BLOB_READY", blob, cameraBlob: null, cameraOffsetMs: 0, durationMs: 1000, width: 100, height: 50,
    });
    s = recorderReducer(s, { type: "RENDER" });
    expect(s.status).toBe("rendering");
    s = recorderReducer(s, { type: "RENDER_PROGRESS", percent: 40 });
    expect(s.renderProgress).toBe(40);
    const failed = recorderReducer(s, { type: "RENDER_FAILED", error: "nope" });
    expect(failed.status).toBe("staging");
    expect(failed.error).toBe("nope");
    s = recorderReducer(s, { type: "RENDER_DONE" });
    expect(s.status).toBe("uploading");
    expect(s.uploadProgress).toBe(0);
  });

  it("UPLOAD_FAILED returns to staging and DISCARD clears both blobs", () => {
    let s = recorderReducer(toStopping(), {
      type: "BLOB_READY", blob, cameraBlob: blob, cameraOffsetMs: 0, durationMs: 1000, width: 100, height: 50,
    });
    s = recorderReducer(s, { type: "RENDER" });
    s = recorderReducer(s, { type: "RENDER_DONE" });
    s = recorderReducer(s, { type: "UPLOAD_FAILED", error: "x" });
    expect(s.status).toBe("staging");
    s = recorderReducer(s, { type: "DISCARD" });
    expect(s.blob).toBeNull();
    expect(s.cameraBlob).toBeNull();
  });
});
