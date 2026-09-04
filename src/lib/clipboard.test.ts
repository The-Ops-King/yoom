import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

/** A DOM just big enough for the legacy path: one textarea, one execCommand. */
function fakeDocument(execResult: boolean) {
  const area = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
  };
  const execCommand = vi.fn(() => execResult);
  const doc = {
    createElement: vi.fn(() => area),
    body: { appendChild: vi.fn() },
    execCommand,
  };
  return { doc, area, execCommand };
}

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("prefers the async clipboard when it works", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { doc, execCommand } = fakeDocument(true);
    vi.stubGlobal("document", doc);
    await expect(copyText("https://jtylerray.com/v/x")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://jtylerray.com/v/x");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the async clipboard is denied", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    const { doc, area, execCommand } = fakeDocument(true);
    vi.stubGlobal("document", doc);
    await expect(copyText("hello")).resolves.toBe(true);
    expect(area.value).toBe("hello");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(area.remove).toHaveBeenCalled();
  });

  it("reports failure instead of pretending", async () => {
    vi.stubGlobal("navigator", {});
    const { doc } = fakeDocument(false);
    vi.stubGlobal("document", doc);
    await expect(copyText("hello")).resolves.toBe(false);
  });
});
