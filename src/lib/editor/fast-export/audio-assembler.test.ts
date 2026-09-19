import { describe, expect, it } from "vitest";
import { AudioAssembler } from "./audio-assembler";

const SR = 10; // 10 Hz keeps the arithmetic readable
const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i);

describe("AudioAssembler", () => {
  it("drops samples inside a cut and closes the gap", () => {
    const a = new AudioAssembler([{ start: 0, end: 1 }, { start: 2, end: 3 }], SR, 1);
    a.push([ramp(0, 30)], 0); // source 0..3 s, sample value = source index
    const out = a.drain(20);
    expect(out.frames).toBe(20);
    expect(Array.from(out.channels[0])).toEqual([...Array.from(ramp(0, 10)), ...Array.from(ramp(20, 10))]);
  });

  it("fills missing audio with silence and only drains what was asked", () => {
    const a = new AudioAssembler([{ start: 0, end: 2 }], SR, 2);
    a.push([ramp(1, 5), ramp(1, 5)], 1); // only source 1.0–1.5 s present
    const first = a.drain(10);
    expect(Array.from(first.channels[0])).toEqual(new Array(10).fill(0));
    const second = a.drain(20);
    expect(Array.from(second.channels[1])).toEqual([1, 2, 3, 4, 5, 0, 0, 0, 0, 0]);
  });

  it("never drains past the edited end", () => {
    const a = new AudioAssembler([{ start: 0, end: 1 }], SR, 1);
    expect(a.drain(1000).frames).toBe(10);
    expect(a.drain(1000).frames).toBe(0);
  });

  it("drains nothing for a non-finite edge", () => {
    const a = new AudioAssembler([{ start: 0, end: 1 }], SR, 1);
    a.push([ramp(0, 10)], 0);
    expect(a.drain(Number.NaN).frames).toBe(0);
    expect(a.drain(Number.NaN).channels[0].length).toBe(0);
    expect(a.drain(10).frames).toBe(10); // the stream is untouched
  });

  it("leaves no hole at a seam that falls between samples", () => {
    // Every boundary here is off the sample grid, so the edited frame a range
    // starts on and the number of frames it owns cannot both round cleanly.
    const a = new AudioAssembler(
      [{ start: 0, end: 0.44 }, { start: 1, end: 1.44 }, { start: 2, end: 3 }],
      SR,
      1,
    );
    a.push([ramp(0, 30)], 0);
    const out = a.drain(100);
    expect(out.frames).toBe(19); // round((0.44 + 0.44 + 1) * 10)
    // Contiguous: each range hands off to the next with no silent frame and no
    // overwritten one, and the samples stay in source order.
    expect(Array.from(out.channels[0])).toEqual([
      0, 1, 2, 3,
      10, 11, 12, 13, 14,
      20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    ]);
  });

  it("ignores a late buffer that lands in already-drained frames", () => {
    const a = new AudioAssembler([{ start: 0, end: 3 }], SR, 1);
    a.push([ramp(0, 10)], 0);
    expect(Array.from(a.drain(10).channels[0])).toEqual(Array.from(ramp(0, 10)));

    a.push([ramp(100, 10)], 0); // wholly behind the drained edge — dropped
    a.push([ramp(50, 20)], 0.5); // straddles it — only frames 10..25 survive

    const out = a.drain(25);
    expect(out.frames).toBe(15);
    expect(Array.from(out.channels[0])).toEqual(Array.from(ramp(55, 15)));
  });

  it("spreads a mono source across every output channel", () => {
    const a = new AudioAssembler([{ start: 0, end: 1 }], SR, 2);
    a.push([ramp(1, 10)], 0);
    const out = a.drain(10);
    expect(Array.from(out.channels[0])).toEqual(Array.from(ramp(1, 10)));
    expect(Array.from(out.channels[1])).toEqual(Array.from(ramp(1, 10)));
  });

  it("holds only the undrained window while pushes and drains interleave", () => {
    const a = new AudioAssembler([{ start: 0, end: 20 }], SR, 1);
    const got: number[] = [];
    for (let i = 0; i < 20; i++) {
      a.push([ramp(i * 10, 10)], i);
      got.push(...a.drain((i + 1) * 10).channels[0]);
    }
    expect(got).toEqual(Array.from(ramp(0, 200)));
  });

  it("keeps unwritten frames silent across a reused buffer", () => {
    const a = new AudioAssembler([{ start: 0, end: 4 }], SR, 1);
    a.push([ramp(1, 10)], 0);
    a.drain(10);
    a.push([ramp(1, 10)], 3); // 1 s of missing audio between the two buffers
    const out = a.drain(40);
    expect(Array.from(out.channels[0])).toEqual([
      ...new Array(20).fill(0),
      ...Array.from(ramp(1, 10)),
    ]);
  });
});
