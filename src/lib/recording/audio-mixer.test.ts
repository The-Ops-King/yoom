import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioMixer } from "./audio-mixer";

class FakeParam {
  value = 1;
  calls: Array<[string, number, number]> = [];
  cancelScheduledValues(t: number) {
    this.calls.push(["cancel", 0, t]);
  }
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.value = v;
    this.calls.push(["ramp", v, t]);
  }
}

class FakeNode {
  connected: FakeNode[] = [];
  disconnectCount = 0;
  connect(target: FakeNode) {
    this.connected.push(target);
    return target;
  }
  disconnect() {
    this.disconnectCount += 1;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  frequencyBinCount = 128;
  private level = 0;
  setLevel(v: number) {
    this.level = v;
  }
  getByteTimeDomainData(arr: Uint8Array) {
    arr.fill(128 + Math.round(this.level * 127));
  }
}

class FakeDestination extends FakeNode {
  stream = { getAudioTracks: () => [{ kind: "audio", id: "out" }] } as unknown as MediaStream;
}

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  sources: FakeNode[] = [];
  gains: FakeGain[] = [];
  analysers: FakeAnalyser[] = [];
  destination = new FakeDestination();
  closed = false;
  resumed = 0;

  createMediaStreamSource() {
    const n = new FakeNode();
    this.sources.push(n);
    return n;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createAnalyser() {
    const a = new FakeAnalyser();
    this.analysers.push(a);
    return a;
  }
  createMediaStreamDestination() {
    return this.destination;
  }
  async resume() {
    this.resumed += 1;
    this.state = "running";
  }
  async close() {
    this.closed = true;
    this.state = "closed";
  }
}

const fakeStream = () => ({ getAudioTracks: () => [{ kind: "audio" }] }) as unknown as MediaStream;

let ctx: FakeAudioContext;
let mixer: AudioMixer;

beforeEach(() => {
  ctx = new FakeAudioContext();
  mixer = new AudioMixer(ctx as unknown as AudioContext);
});

describe("AudioMixer", () => {
  it("exposes an output track before any source is added", () => {
    expect(mixer.outputTrack).toBeTruthy();
    expect(mixer.outputStream.getAudioTracks()).toHaveLength(1);
  });

  it("wires source → gain → destination and source → analyser (pre-gain)", () => {
    mixer.addSource("mic", fakeStream());
    const [source] = ctx.sources;
    const [gain] = ctx.gains;
    const [analyser] = ctx.analysers;
    expect(source.connected).toContain(gain);
    expect(gain.connected).toContain(ctx.destination);
    // The analyser taps the raw source so the meter still moves while muted —
    // that's how the UI can warn "you're talking but the mic is off".
    expect(source.connected).toContain(analyser);
    expect(gain.connected).not.toContain(analyser);
    expect(analyser.fftSize).toBe(256);
  });

  it("starts enabled at unity gain", () => {
    mixer.addSource("mic", fakeStream());
    expect(mixer.isEnabled("mic")).toBe(true);
    expect(ctx.gains[0].gain.value).toBe(1);
  });

  it("adds a source disabled when asked", () => {
    mixer.addSource("system", fakeStream(), { enabled: false });
    expect(mixer.isEnabled("system")).toBe(false);
    expect(ctx.gains[0].gain.value).toBe(0);
  });

  it("ramps to 0 over 20ms and disconnects on disable", () => {
    vi.useFakeTimers();
    mixer.addSource("mic", fakeStream());
    const gain = ctx.gains[0];
    mixer.setEnabled("mic", false);
    expect(gain.gain.calls.some(([k, v]) => k === "ramp" && v === 0)).toBe(true);
    expect(gain.disconnectCount).toBe(0);
    vi.advanceTimersByTime(40);
    expect(gain.disconnectCount).toBe(1);
    vi.useRealTimers();
  });

  it("reconnects and ramps back up on enable", () => {
    vi.useFakeTimers();
    mixer.addSource("mic", fakeStream());
    const gain = ctx.gains[0];
    mixer.setEnabled("mic", false);
    vi.advanceTimersByTime(40);
    mixer.setEnabled("mic", true);
    expect(gain.connected.filter((n) => n === ctx.destination).length).toBe(2);
    expect(gain.gain.calls.at(-1)?.[1]).toBe(1);
    vi.useRealTimers();
  });

  it("is idempotent when toggling to the current value", () => {
    mixer.addSource("mic", fakeStream());
    const before = ctx.gains[0].gain.calls.length;
    mixer.setEnabled("mic", true);
    expect(ctx.gains[0].gain.calls.length).toBe(before);
  });

  it("reports 0 for an unknown source and a positive level for a loud one", () => {
    expect(mixer.getLevel("mic")).toBe(0);
    mixer.addSource("mic", fakeStream());
    ctx.analysers[0].setLevel(0.5);
    expect(mixer.getLevel("mic")).toBeGreaterThan(0.4);
    expect(mixer.getLevel("mic")).toBeLessThanOrEqual(1);
  });

  it("still reports the live level for a disabled source (meter shows input while muted)", () => {
    mixer.addSource("mic", fakeStream());
    ctx.analysers[0].setLevel(0.9);
    mixer.setEnabled("mic", false);
    expect(mixer.getLevel("mic")).toBeGreaterThan(0.5);
  });

  it("replaces a source when the same id is added twice", () => {
    mixer.addSource("mic", fakeStream());
    const first = ctx.gains[0];
    mixer.addSource("mic", fakeStream());
    expect(first.disconnectCount).toBeGreaterThan(0);
    expect(ctx.gains).toHaveLength(2);
    expect(mixer.sourceIds()).toEqual(["mic"]);
  });

  it("removeSource disconnects and forgets it", () => {
    mixer.addSource("system", fakeStream());
    mixer.removeSource("system");
    expect(mixer.hasSource("system")).toBe(false);
    expect(ctx.gains[0].disconnectCount).toBeGreaterThan(0);
  });

  it("close() disconnects everything and closes the context", async () => {
    mixer.addSource("mic", fakeStream());
    mixer.addSource("system", fakeStream());
    await mixer.close();
    expect(ctx.closed).toBe(true);
    expect(mixer.sourceIds()).toEqual([]);
  });

  it("resume() resumes a suspended context", async () => {
    ctx.state = "suspended";
    await mixer.resume();
    expect(ctx.resumed).toBe(1);
  });
});
