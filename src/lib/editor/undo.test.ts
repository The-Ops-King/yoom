import { describe, expect, it } from "vitest";
import { createHistory, push, redo, undo, canUndo, canRedo } from "./undo";

describe("undo history", () => {
  it("pushes, undoes and redoes", () => {
    let h = createHistory(0);
    h = push(h, 1);
    h = push(h, 2);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(false);
  });
  it("a push after undo drops the redo branch", () => {
    let h = push(push(createHistory(0), 1), 2);
    h = undo(h);
    h = push(h, 9);
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toBe(1);
  });
  it("caps at 50 past entries", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 80; i++) h = push(h, i);
    expect(h.past).toHaveLength(50);
    expect(canUndo(h)).toBe(true);
  });
});
