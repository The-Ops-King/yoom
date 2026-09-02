import { describe, expect, it } from "vitest";
import { IPC as SHARED } from "../shared/ipc";
import { IPC as APP } from "./app.channels";
import { IPC as BUBBLE } from "./bubble.channels";
import { IPC as PICKER } from "./picker.channels";

/**
 * The preloads cannot import `shared/ipc.ts` as a value — Rollup would emit a
 * shared chunk and a sandboxed preload cannot `require` one. Each preload
 * therefore carries its own copy of the channel names it uses. These tests are
 * what keeps the copies honest.
 */
describe("preload channel constants", () => {
  const sharedNames = new Set<string>(Object.values(SHARED));

  for (const [label, table] of [
    ["app", APP],
    ["bubble", BUBBLE],
    ["picker", PICKER],
  ] as const) {
    it(`${label}: every channel exists in shared/ipc.ts`, () => {
      for (const [key, value] of Object.entries(table)) {
        expect(sharedNames.has(value)).toBe(true);
        // Not just present — present under the same key, so a rename in
        // shared/ipc.ts cannot silently pair a preload key with another
        // channel's string.
        expect((SHARED as Record<string, string>)[key]).toBe(value);
      }
    });
  }

  it("covers every shared channel between the three preloads", () => {
    const covered = new Set<string>([
      ...Object.values(APP),
      ...Object.values(BUBBLE),
      ...Object.values(PICKER),
    ]);
    // `bubbleApply`/`bubbleCamera` reach the bubble renderer and the picker
    // channels reach the picker renderer, so the union is the whole contract.
    expect([...sharedNames].filter((name) => !covered.has(name))).toEqual([]);
  });
});
